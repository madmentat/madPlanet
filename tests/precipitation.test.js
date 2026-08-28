const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['weather-core.js','local-energy-balance.js','baric-field.js','wind-dynamics.js','h2o-advection.js','condensation.js','precipitation.js'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'js',f),'utf8')]));
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'precipitation test must see a semantic version');
assert.ok(buildPs.includes("'js/h2o-advection.js','js/condensation.js','js/precipitation.js','js/soil-hydrology.js','js/render.js'"));
assert.ok(buildSh.includes('js/h2o-advection.js js/condensation.js js/precipitation.js js/soil-hydrology.js js/render.js'));

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.65,star:0.43,luminosity:0.43};
const world={seedS:[2.3,-4.1,7.7],plateN:4,
  plateP:new Float32Array([1,0,0,0,0,0,1,0,-1,0,0,0,0,0,-1,0]),
  plateW:new Float32Array([0,.45,0,0,0,-.35,0,0,0,.30,0,0,0,-.40,0,0])};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,state,world};
vm.createContext(ctx);for(const f of files)vm.runInContext(src[f],ctx,{filename:f});
const axis=[0,1,0];
const climate={T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:.45,iceArea:.02,waterAvail:1,S:1,regime:'temperate',A:.30,tau:.76,globalASR:239,globalOLR:239,sea:.58,iceAlbedo:.62,meanMolarMassKg:.02897,gravityMS2:9.80665,radiusM:6371000,rotationPeriodSec:86400};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);
assert.equal(core.precipitationModel,1);
for(const k of ['surfaceLiquidWater','surfaceSnowWater','rainRate','snowRate','precipSnowFraction','precipOceanReturnRate','surfaceMeltRate']){
  assert.ok(core[k] instanceof Float32Array,k);assert.equal(core[k].length,core.count);
}
assert.ok(ctx.weatherCoreFinite(core));

/* Mature warm cloud over land must rain and conserve local mobile H2O. */
const i=17;core.surfaceWaterFraction[i]=0;core.airTemp[i]=290;core.surfaceTemp[i]=292;
core.vaporColumn[i]=5;core.cloudWaterState[i]=1;core.surfaceLiquidWater[i]=0;core.surfaceSnowWater[i]=0;
const warm0=core.vaporColumn[i]+core.cloudWaterState[i]+core.surfaceLiquidWater[i]+core.surfaceSnowWater[i];
ctx.precipApply(core,300,climate);
const warm1=core.vaporColumn[i]+core.cloudWaterState[i]+core.surfaceLiquidWater[i]+core.surfaceSnowWater[i];
assert.ok(core.precipRate[i]>0&&core.rainRate[i]>core.snowRate[i]);
assert.ok(core.surfaceLiquidWater[i]>0&&core.cloudWaterState[i]<1);
assert.ok(Math.abs(warm1-warm0)<2e-5,'land rain must transfer, not create, H2O');

/* Cold cloud produces snow instead of liquid rain. */
const j=31;core.surfaceWaterFraction[j]=0;core.airTemp[j]=265;core.surfaceTemp[j]=268;
core.cloudWaterState[j]=1;core.surfaceLiquidWater[j]=0;core.surfaceSnowWater[j]=0;
ctx.precipApply(core,300,climate);
assert.ok(core.snowRate[j]>core.rainRate[j]&&core.surfaceSnowWater[j]>0,'cold precipitation must land as snow');

/* Ocean precipitation returns to the bulk reservoir and must not create a
   fake local puddle on the ocean cell. */
const q=45;core.surfaceWaterFraction[q]=1;core.airTemp[q]=290;core.surfaceTemp[q]=292;core.cloudWaterState[q]=1;
core.surfaceLiquidWater[q]=core.surfaceSnowWater[q]=0;ctx.precipApply(core,300,climate);
assert.ok(core.precipOceanReturnRate[q]>0);assert.equal(core.surfaceLiquidWater[q],0);assert.equal(core.surfaceSnowWater[q],0);

/* Retained landed water occupies part of the mobile H2O closure, so global
   normalization cannot refill a full atmosphere on top of it. */
for(let n=0;n<core.count;n++){core.vaporColumn[n]=10;core.cloudWaterState[n]=1;core.surfaceLiquidWater[n]=2;core.surfaceSnowWater[n]=1;}
ctx.h2oNormalizeGlobalVapor(core,climate);
const target=climate.h2oBar*1e5/climate.gravityMS2;
const closure=ctx.condAreaMeanTotal(core)+ctx.precipAreaMeanStore(core);
assert.ok(Math.abs(closure-target)<5e-4,'atmosphere + landed water must match mobile H2O target');
assert.ok(ctx.condAreaMeanTotal(core)<target,'surface retention must reduce the atmospheric share');

/* Landed liquid water can re-evaporate without changing local total mass. */
core.surfaceWaterFraction[i]=0;core.surfaceLiquidWater[i]=2;core.surfaceSnowWater[i]=0;
core.vaporColumn[i]=0;core.cloudWaterState[i]=0;core.surfaceTemp[i]=300;core.airTemp[i]=295;core.windStateU[i]=8;core.windStateV[i]=0;
const ev0=core.vaporColumn[i]+core.surfaceLiquidWater[i];ctx.h2oApplyEvaporation(core,300,climate);
const ev1=core.vaporColumn[i]+core.surfaceLiquidWater[i];
assert.ok(core.vaporColumn[i]>0&&core.surfaceLiquidWater[i]<2);assert.ok(Math.abs(ev1-ev0)<2e-5);

/* Warm snow melts into liquid while preserving landed-water mass. */
core.surfaceSnowWater[i]=4;core.surfaceLiquidWater[i]=1;core.surfaceTemp[i]=285;
const melt0=core.surfaceSnowWater[i]+core.surfaceLiquidWater[i];ctx.precipMeltSurfaceSnow(core,300);
assert.ok(core.surfaceSnowWater[i]<4&&core.surfaceLiquidWater[i]>1);
assert.ok(Math.abs(core.surfaceSnowWater[i]+core.surfaceLiquidWater[i]-melt0)<2e-5);

const live=ctx.weatherCoreCreate(77,12,climate,axis);for(let n=0;n<16;n++)ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live));
assert.ok(live.precipRate.every(v=>v>=0&&Number.isFinite(v)));
assert.ok(src['precipitation.js'].includes('cloudWaterState')&&src['precipitation.js'].includes('surfaceLiquidWater'));
assert.ok(!src['precipitation.js'].includes('requestAnimationFrame'));
console.log('precipitation.test.js: OK');
