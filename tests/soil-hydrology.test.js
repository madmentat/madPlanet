const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['weather-core.js','orographic-lift.js','local-energy-balance.js','baric-field.js','wind-dynamics.js','h2o-advection.js','condensation.js','precipitation.js','soil-hydrology.js'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'js',f),'utf8')]));
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+0\.5\.47\s*$/m,'soil hydrology milestone must be 0.5.47');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/h2o-advection.js','js/condensation.js','js/precipitation.js','js/soil-hydrology.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell soil order');
assertOrdered(buildSh,order,'shell soil order');

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.72,star:0.43,luminosity:0.43};
const world={seedS:[2.3,-4.1,7.7],plateN:4,
  plateP:new Float32Array([1,0,0,0,0,0,1,0,-1,0,0,0,0,0,-1,0]),
  plateW:new Float32Array([0,.45,0,0,0,-.35,0,0,0,.30,0,0,0,-.40,0,0])};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,state,world};
vm.createContext(ctx);for(const f of files)vm.runInContext(src[f],ctx,{filename:f});
const axis=[0,1,0];
const climate={T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:.45,iceArea:.02,waterAvail:1,S:1,regime:'temperate',A:.30,tau:.76,globalASR:239,globalOLR:239,sea:.58,iceAlbedo:.62,meanMolarMassKg:.02897,gravityMS2:9.80665,radiusM:6371000,rotationPeriodSec:86400};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);

assert.equal(core.soilHydrologyModel,1);
for(const k of ['soilMoisture','soilCapacity','infiltrationRate','soilDrainageRate','soilEvaporationRate',
  'runoffGenerationRate','runoffWater','runoffRoutedRate','runoffOceanReturnRate','runoffDrop']){
  assert.ok(core[k] instanceof Float32Array,k);assert.equal(core[k].length,core.count,k+' length');
}
assert.ok(core.runoffDownstream instanceof Int32Array);
assert.ok(core.runoffMassDelta instanceof Float64Array);
assert.ok(ctx.weatherCoreFinite(core));

/* Infiltration transfers liquid surface water into soil without changing
   local H2O mass. */
let i=core.surfaceWaterFraction.findIndex(v=>v<0.1);
assert.ok(i>=0,'test grid needs a land cell');
core.surfaceWaterFraction[i]=0;core.orographicRoughness[i]=0;core.soilCapacity[i]=100;
core.soilHydrologySignature=ctx.soilSignature(core);
core.surfaceTemp[i]=290;core.surfaceLiquidWater[i]=4;core.soilMoisture[i]=0;core.runoffWater[i]=0;
const inf0=core.surfaceLiquidWater[i]+core.soilMoisture[i]+core.runoffWater[i];
ctx.soilInfiltrateAndGenerateRunoff(core,300);
const inf1=core.surfaceLiquidWater[i]+core.soilMoisture[i]+core.runoffWater[i];
assert.ok(core.soilMoisture[i]>0&&core.infiltrationRate[i]>0,'warm unsaturated soil must accept infiltration');
assert.ok(Math.abs(inf1-inf0)<2e-5,'infiltration/runoff generation must only repartition landed water');

/* Saturated rugged ground with ponded water must create runoff. */
core.surfaceWaterFraction[i]=0;core.orographicRoughness[i]=1;core.soilCapacity[i]=10;
core.soilHydrologySignature=ctx.soilSignature(core);
core.soilMoisture[i]=10;core.surfaceLiquidWater[i]=30;core.runoffWater[i]=0;core.surfaceTemp[i]=290;
ctx.soilInfiltrateAndGenerateRunoff(core,1800);
assert.ok(core.runoffWater[i]>0&&core.runoffGenerationRate[i]>0,'saturated rugged land must generate surface runoff');
assert.ok(core.soilMoisture[i]<=core.soilCapacity[i]+1e-6,'soil water cannot exceed capacity');

/* Downhill routing conserves area-weighted runoff when the receiver is land. */
ctx.h2oRefreshSurfaceWater(core);ctx.soilBuildRunoffRouting(core);
let r=-1;
for(let n=0;n<core.count;n++){
  const j=core.runoffDownstream[n];
  if(j>=0&&core.surfaceWaterFraction[n]<0.5&&core.surfaceWaterFraction[j]<0.5){r=n;break;}
}
assert.ok(r>=0,'test grid needs a land-to-land runoff edge');
core.runoffWater.fill(0);core.runoffWater[r]=20;
const rm0=ctx.h2oAreaMean(core,core.runoffWater);
const routed=ctx.soilRouteRunoff(core,3600);
const rm1=ctx.h2oAreaMean(core,core.runoffWater);
assert.ok(routed.moved>0,'runoff must move toward a lower land neighbour');
assert.ok(Math.abs(rm1-rm0)<2e-5,'land runoff routing must conserve area-weighted mass');

/* A downhill edge that reaches the ocean is an explicit return to the bulk
   condensed reservoir rather than a fake local ocean puddle. */
let coast=-1;
for(let n=0;n<core.count;n++){
  const j=core.runoffDownstream[n];
  if(j>=0&&core.surfaceWaterFraction[n]<0.5&&core.surfaceWaterFraction[j]>0.5){coast=n;break;}
}
assert.ok(coast>=0,'test grid needs a land-to-ocean runoff edge');
core.runoffWater.fill(0);core.runoffWater[coast]=20;
const ocean=ctx.soilRouteRunoff(core,3600);
assert.ok(ocean.ocean>0&&core.runoffOceanReturnRate[coast]>0,'coastal runoff must explicitly return water to the ocean reservoir');
assert.ok(ctx.h2oAreaMean(core,core.runoffWater)<20,'ocean return must remove local runoff storage');

/* Bare soil evaporation transfers mass back to vapor. */
core.surfaceWaterFraction[i]=0;core.surfaceLiquidWater[i]=0;core.soilCapacity[i]=100;core.soilMoisture[i]=40;
core.soilHydrologySignature=ctx.soilSignature(core);
core.surfaceTemp[i]=300;core.airTemp[i]=295;core.vaporColumn[i]=0;core.windStateU[i]=5;core.windStateV[i]=0;
const ev0=core.soilMoisture[i]+core.vaporColumn[i];
ctx.h2oApplyEvaporation(core,300,climate);
const ev1=core.soilMoisture[i]+core.vaporColumn[i];
assert.ok(core.soilEvaporationRate[i]>0&&core.soilMoisture[i]<40&&core.vaporColumn[i]>0,'moist warm soil must evaporate');
assert.ok(Math.abs(ev1-ev0)<2e-5,'soil evaporation must conserve local H2O');

/* Normalization now includes atmosphere, surface stores, soil and unresolved
   runoff in one weather-scale mobile closure. */
for(let n=0;n<core.count;n++){
  core.vaporColumn[n]=8;core.cloudWaterState[n]=1;
  core.surfaceLiquidWater[n]=1;core.surfaceSnowWater[n]=0.5;
  core.soilMoisture[n]=2;core.runoffWater[n]=0.5;
}
ctx.h2oNormalizeGlobalVapor(core,climate);
const target=climate.h2oBar*1e5/climate.gravityMS2;
const closure=ctx.condAreaMeanTotal(core)+ctx.soilAreaMeanStores(core);
assert.ok(Math.abs(closure-target)<6e-4,'soil-aware mobile H2O closure must match the global target');

const live=ctx.weatherCoreCreate(77,12,climate,axis);
for(let n=0;n<16;n++)ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live),'coupled soil/runoff weather ticks must remain finite');
assert.ok(live.soilMoisture.every((v,n)=>v>=0&&v<=live.soilCapacity[n]+1e-4));
assert.ok(src['soil-hydrology.js'].includes('macroTerrain')&&src['soil-hydrology.js'].includes('windNeighbor'),
  'runoff routing must derive from resolved terrain and cubed-sphere neighbours');
assert.ok(!src['soil-hydrology.js'].includes('Math.random'),'soil/runoff physics must not use random drainage morphology');
assert.ok(!src['soil-hydrology.js'].includes('requestAnimationFrame'),'soil hydrology must stay on the fixed Weather Core clock');
console.log('soil-hydrology.test.js: OK');
