const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['weather-core.js','local-energy-balance.js','baric-field.js','wind-dynamics.js','h2o-advection.js','condensation.js'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'js',f),'utf8')]));
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'condensation test must see a semantic version');
assert.ok(buildPs.includes("'js/wind-dynamics.js','js/h2o-advection.js','js/condensation.js','js/precipitation.js','js/render.js'"),
  'PowerShell build must load condensation before precipitation and render');
assert.ok(buildSh.includes('js/wind-dynamics.js js/h2o-advection.js js/condensation.js js/precipitation.js js/render.js'),
  'shell build must load condensation before precipitation and render');

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.65,star:0.43,luminosity:0.43};
const world={
  seedS:[2.3,-4.1,7.7],
  plateN:4,
  plateP:new Float32Array([1,0,0,0, 0,0,1,0, -1,0,0,0, 0,0,-1,0]),
  plateW:new Float32Array([0,0.45,0,0, 0,-0.35,0,0, 0,0.30,0,0, 0,-0.40,0,0])
};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,state,world};
vm.createContext(ctx);
for(const f of files) vm.runInContext(src[f],ctx,{filename:f});

const axis=[0,1,0];
const climate={
  T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:0.45,iceArea:0.02,
  waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,
  globalASR:239,globalOLR:239,sea:0.58,iceAlbedo:0.62,
  meanMolarMassKg:0.02897,gravityMS2:9.80665,
  radiusM:6371000,rotationPeriodSec:86400
};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);
assert.equal(core.condensationModel,1,'Weather Core must advertise condensation model v1');
for(const k of ['cloudWaterState','condensationRate','cloudEvaporationRate','phaseVaporBefore']){
  assert.ok(core[k] instanceof Float32Array,k+' must be a persistent Float32Array');
  assert.equal(core[k].length,core.count,k+' length must match cubed-sphere cells');
}
assert.ok(ctx.weatherCoreFinite(core),'condensation-extended Weather Core must start finite');

const i=17;
core.airTemp[i]=275;core.pressure[i]=101325;core.cloudWaterState[i]=0;
const satCold=ctx.h2oSaturationColumnKgM2(core.airTemp[i],climate);
core.vaporColumn[i]=satCold*2.0;
const local0=core.vaporColumn[i]+core.cloudWaterState[i],t0=core.airTemp[i];
ctx.condPhaseChange(core,300,climate);
const local1=core.vaporColumn[i]+core.cloudWaterState[i];
assert.ok(core.cloudWaterState[i]>0,'supersaturated air must create cloud condensate');
assert.ok(core.vaporColumn[i]<local0,'condensation must remove vapor');
assert.ok(Math.abs(local1-local0)<1e-5,'local condensation must conserve H2O mass');
assert.ok(core.airTemp[i]>t0,'condensation must release latent heat');
assert.ok(core.airTemp[i]-t0<=4.0001,'latent heating must stay numerically bounded per tick');

core.airTemp[i]=295;core.cloudWaterState[i]=0.8;
const satWarm=ctx.h2oSaturationColumnKgM2(core.airTemp[i],climate);
core.vaporColumn[i]=satWarm*0.20;
const dry0=core.vaporColumn[i]+core.cloudWaterState[i],td0=core.airTemp[i],c0=core.cloudWaterState[i];
ctx.condPhaseChange(core,300,climate);
assert.ok(core.cloudWaterState[i]<c0&&core.vaporColumn[i]>satWarm*0.20,
  'undersaturated air must evaporate existing cloud water');
assert.ok(Math.abs(core.vaporColumn[i]+core.cloudWaterState[i]-dry0)<1e-5,
  'cloud evaporation must conserve local H2O mass');
assert.ok(core.airTemp[i]<td0,'cloud evaporation must cool the air through latent heat');

for(let n=0;n<core.count;n++){
  core.vaporColumn[n]=2+(n%7);
  core.cloudWaterState[n]=0.3*(n%5);
}
ctx.h2oNormalizeGlobalVapor(core,climate);
const target=climate.h2oBar*1e5/climate.gravityMS2;
assert.ok(Math.abs(ctx.condAreaMeanTotal(core)-target)<3e-4,
  'without precipitation loaded, global atmospheric target applies to vapor plus condensate');
assert.ok(ctx.h2oAreaMean(core,core.vaporColumn)<target,
  'cloud condensate must occupy part of the atmospheric H2O reservoir');

core.cloudWaterState.fill(0);core.windStateU.fill(0);core.windStateV.fill(0);core.windU.fill(0);core.windV.fill(0);
const e=0,a=core.h2oEdgeI[e],b=core.h2oEdgeJ[e];
core.cloudWaterState[a]=1;
core.windStateU[a]=20*core.h2oEdgeIE[e];core.windStateV[a]=20*core.h2oEdgeIN[e];
core.windStateU[b]=-20*core.h2oEdgeJE[e];core.windStateV[b]=-20*core.h2oEdgeJN[e];
const cloudMass0=ctx.h2oAreaMean(core,core.cloudWaterState);
const moved=ctx.condAdvectCloud(core,300);
const cloudMass1=ctx.h2oAreaMean(core,core.cloudWaterState);
assert.ok(moved>0&&core.cloudWaterState[b]>0,'wind must carry cloud condensate into a downwind neighbour');
assert.ok(Math.abs(cloudMass1-cloudMass0)<2e-6,'cloud advection must conserve area-weighted condensate mass');

const live=ctx.weatherCoreCreate(77,12,climate,axis);
for(let n=0;n<12;n++) ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live),'coupled condensation weather ticks must remain finite');
assert.ok(Math.abs(ctx.condAreaMeanTotal(live)-target)<4e-4,
  'condensation layer alone must not drift combined atmospheric H2O mass');
assert.ok(live.cloudWaterState.some(v=>v>0),'Earth-like coupled weather must form some cloud condensate');
assert.ok(live.precipRate.every(v=>v===0),'condensation layer alone must not invent precipitation');
assert.ok(live.cloudWater.every((v,n)=>Math.abs(v-live.cloudWaterState[n])<1e-7),
  'legacy cloudWater channel must mirror the physical condensate state');

assert.ok(src['condensation.js'].includes('CLOUD_LATENT_HEAT_J_KG')&&src['condensation.js'].includes('condApplyLatentHeat'),
  'phase change must include latent heat rather than only moving bookkeeping mass');
assert.ok(src['condensation.js'].includes('phaseVaporBefore=new Float32Array(core.count)'),
  'phase-rate scratch storage must be persistent instead of allocated every weather tick');
assert.ok(!src['condensation.js'].includes('new Float32Array(core.vaporColumn)'),
  'weather ticks must not allocate a full-grid vapor copy every second');
assert.ok(!src['condensation.js'].includes('requestAnimationFrame'),'condensation physics must stay on the slow fixed Weather Core clock');

console.log('condensation.test.js: OK');
