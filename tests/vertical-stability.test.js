const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['weather-core.js','orographic-lift.js','local-energy-balance.js','baric-field.js','wind-dynamics.js','h2o-advection.js','condensation.js','precipitation.js','soil-hydrology.js','vertical-stability.js'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'js',f),'utf8')]));
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+0\.5\.48\s*$/m,'vertical-stability milestone must be 0.5.48');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/condensation.js','js/precipitation.js','js/soil-hydrology.js','js/vertical-stability.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell vertical order');
assertOrdered(buildSh,order,'shell vertical order');

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.72,star:0.43,luminosity:0.43};
const world={seedS:[2.3,-4.1,7.7],plateN:4,
  plateP:new Float32Array([1,0,0,0,0,0,1,0,-1,0,0,0,0,0,-1,0]),
  plateW:new Float32Array([0,.45,0,0,0,-.35,0,0,0,.30,0,0,0,-.40,0,0])};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,state,world};
vm.createContext(ctx);for(const f of files)vm.runInContext(src[f],ctx,{filename:f});
const axis=[0,1,0];
const climate={T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:.45,iceArea:.02,waterAvail:1,S:1,regime:'temperate',A:.30,tau:.76,globalASR:239,globalOLR:239,sea:.58,iceAlbedo:.62,meanMolarMassKg:.02897,gravityMS2:9.80665,radiusM:6371000,rotationPeriodSec:86400};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);
assert.equal(core.verticalStabilityModel,1);
for(const k of ['environmentLapseKPerKm','parcelLapseKPerKm','bulkStabilityIndex','convectiveIndex','lclHeightM','cloudBaseHeightM','cloudTopHeightM','cloudBasePressurePa','cloudTopPressurePa','cloudLowMass','cloudMidMass','cloudHighMass','cloudLowFraction','cloudMidFraction','cloudHighFraction']){
  assert.ok(core[k] instanceof Float32Array,k);assert.equal(core[k].length,core.count,k+' length');
}
assert.ok(ctx.weatherCoreFinite(core));

/* Humid air has a lower lifting-condensation level than dry air at the same
   temperature. */
const a=17,b=31;
core.scaleHeight[a]=core.scaleHeight[b]=8400;
core.airTemp[a]=core.airTemp[b]=293;core.surfaceTemp[a]=core.surfaceTemp[b]=297;
core.relativeHumidity[a]=0.90;core.relativeHumidity[b]=0.35;
core.cloudWaterState[a]=core.cloudWaterState[b]=0.4;
ctx.verticalRefresh(core,climate);
assert.ok(core.lclHeightM[a]<core.lclHeightM[b]-1000,'humid column must have a substantially lower LCL');
assert.ok(core.cloudBaseHeightM[a]<core.cloudBaseHeightM[b],'cloud base must follow the LCL diagnostic');

/* Controlled stable vs unstable columns. The unstable warm surface should
   deepen the cloud column and shift condensate upward. */
const stable=45,unstable=59;
for(const i of [stable,unstable]){
  core.scaleHeight[i]=8400;core.relativeHumidity[i]=0.92;core.cloudWaterState[i]=1.0;
  core.orographicVerticalVelocity[i]=0;core.pressure[i]=101325;
}
core.surfaceTemp[stable]=292;core.airTemp[stable]=290;
core.surfaceTemp[unstable]=306;core.airTemp[unstable]=291;
ctx.verticalRefresh(core,climate);
assert.ok(core.bulkStabilityIndex[stable]>0.65,'weak near-surface lapse must classify as stable');
assert.ok(core.bulkStabilityIndex[unstable]<0.35,'steep warm-surface lapse must classify as unstable');
assert.ok(core.convectiveIndex[unstable]>core.convectiveIndex[stable]+0.35,'unstable column must have stronger convective potential');
assert.ok(core.cloudTopHeightM[unstable]>core.cloudTopHeightM[stable]+2500,'unstable column must build a deeper cloud column');
assert.ok(core.cloudMidMass[unstable]+core.cloudHighMass[unstable] > core.cloudMidMass[stable]+core.cloudHighMass[stable]+0.20,
  'deep instability must shift more condensate into middle/high layers');

/* Layer partitioning is bookkeeping only: no condensate mass is created or
   removed by the vertical diagnosis. */
for(let i=0;i<core.count;i++) core.cloudWaterState[i]=0.03*(i%19);
const before=Array.from(core.cloudWaterState);
ctx.verticalRefresh(core,climate);
for(let i=0;i<core.count;i++){
  const layers=core.cloudLowMass[i]+core.cloudMidMass[i]+core.cloudHighMass[i];
  const frac=core.cloudLowFraction[i]+core.cloudMidFraction[i]+core.cloudHighFraction[i];
  assert.ok(Math.abs(layers-core.cloudWaterState[i])<2e-5,'layer masses must sum to bulk condensate');
  assert.ok(Math.abs(frac-1)<2e-5,'layer fractions must sum to one');
  assert.equal(core.cloudWaterState[i],before[i],'vertical partition must not mutate bulk cloud water');
}

/* A cloud-free cell stays cloud-free in every layer. */
core.cloudWaterState[a]=0;ctx.verticalRefresh(core,climate);
assert.equal(core.cloudLowMass[a],0);assert.equal(core.cloudMidMass[a],0);assert.equal(core.cloudHighMass[a],0);

const live=ctx.weatherCoreCreate(77,12,climate,axis);
for(let n=0;n<16;n++)ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live),'coupled vertical-stability weather ticks must remain finite');
for(let i=0;i<live.count;i++){
  const layers=live.cloudLowMass[i]+live.cloudMidMass[i]+live.cloudHighMass[i];
  assert.ok(Math.abs(layers-live.cloudWaterState[i])<2e-4,'live layer mass closure');
}
assert.ok(src['vertical-stability.js'].includes('verticalDewPointK')&&src['vertical-stability.js'].includes('scaleHeight'),
  'vertical structure must use thermodynamics and pressure scale height');
assert.ok(src['vertical-stability.js'].includes('cloudWaterState')&&src['vertical-stability.js'].includes('cloudLowMass'),
  'cloud layers must partition physical condensate');
assert.ok(!src['vertical-stability.js'].includes('Math.random'),'vertical cloud layers must not use random morphology');
assert.ok(!src['vertical-stability.js'].includes('requestAnimationFrame'),'vertical physics must stay on fixed Weather Core clock');
assert.ok(!/cloudWaterState\s*\[[^\]]+\]\s*=/.test(src['vertical-stability.js']),
  'vertical diagnosis must not overwrite authoritative condensate mass');
console.log('vertical-stability.test.js: OK');
