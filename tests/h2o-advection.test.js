const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const weatherSrc=fs.readFileSync(path.join(root,'js/weather-core.js'),'utf8');
const energySrc=fs.readFileSync(path.join(root,'js/local-energy-balance.js'),'utf8');
const baricSrc=fs.readFileSync(path.join(root,'js/baric-field.js'),'utf8');
const windSrc=fs.readFileSync(path.join(root,'js/wind-dynamics.js'),'utf8');
const h2oSrc=fs.readFileSync(path.join(root,'js/h2o-advection.js'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'H2O advection test must see a semantic version');
assert.ok(buildPs.includes("'js/baric-field.js','js/wind-dynamics.js','js/h2o-advection.js','js/condensation.js','js/precipitation.js','js/render.js'"),
  'PowerShell build must load H2O transport after wind and before condensation/precipitation/render');
assert.ok(buildSh.includes('js/baric-field.js js/wind-dynamics.js js/h2o-advection.js js/condensation.js js/precipitation.js js/render.js'),
  'shell build must load H2O transport after wind and before condensation/precipitation/render');

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.65,star:0.43,luminosity:0.43};
const world={
  seedS:[2.3,-4.1,7.7],
  plateN:4,
  plateP:new Float32Array([1,0,0,0, 0,0,1,0, -1,0,0,0, 0,0,-1,0]),
  plateW:new Float32Array([0,0.45,0,0, 0,-0.35,0,0, 0,0.30,0,0, 0,-0.40,0,0])
};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,state,world};
vm.createContext(ctx);
for(const [name,src] of [['weather-core.js',weatherSrc],['local-energy-balance.js',energySrc],['baric-field.js',baricSrc],['wind-dynamics.js',windSrc],['h2o-advection.js',h2oSrc]])
  vm.runInContext(src,ctx,{filename:name});

const axis=[0,1,0];
const climate={
  T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:0.45,iceArea:0.02,
  waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,
  globalASR:239,globalOLR:239,sea:0.58,iceAlbedo:0.62,
  meanMolarMassKg:0.02897,gravityMS2:9.80665,
  radiusM:6371000,rotationPeriodSec:86400
};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);
assert.equal(core.h2oModel,1,'Weather Core must advertise H2O transport model v1');
for(const k of ['vaporColumn','relativeHumidity','evaporationRate','macroTerrain','surfaceWaterFraction']){
  assert.ok(core[k] instanceof Float32Array,k+' must be a persistent Float32Array');
  assert.equal(core[k].length,core.count,k+' length must match cubed-sphere cells');
}
assert.ok(core.h2oEdgeI instanceof Int32Array&&core.h2oEdgeI.length>core.count,
  'transport must precompute a reusable cross-face edge graph');
assert.ok(ctx.weatherCoreFinite(core),'H2O-extended Weather Core must contain no NaN/Infinity');

const target=climate.h2oBar*1e5/climate.gravityMS2;
assert.ok(Math.abs(ctx.h2oAreaMean(core,core.vaporColumn)-target)<2e-4,
  'standalone H2O layer must initialize to the global atmospheric reservoir');

state.sea=0.20;ctx.h2oRefreshSurfaceWater(core);const lowSea=ctx.h2oAreaMean(core,core.surfaceWaterFraction);
state.sea=0.80;ctx.h2oRefreshSurfaceWater(core);const highSea=ctx.h2oAreaMean(core,core.surfaceWaterFraction);
assert.ok(highSea>lowSea+0.10,'raising sea level must monotonically increase surface-water area');
state.sea=0.58;ctx.h2oRefreshSurfaceWater(core);

core.vaporColumn.fill(0);core.windStateU.fill(0);core.windStateV.fill(0);core.windU.fill(0);core.windV.fill(0);
const e=0,i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e];
core.vaporColumn[i]=100;
core.windStateU[i]=20*core.h2oEdgeIE[e];core.windStateV[i]=20*core.h2oEdgeIN[e];
core.windStateU[j]=-20*core.h2oEdgeJE[e];core.windStateV[j]=-20*core.h2oEdgeJN[e];
const mass0=ctx.h2oAreaMean(core,core.vaporColumn);
const moved=ctx.h2oAdvectConservative(core,300);
const mass1=ctx.h2oAreaMean(core,core.vaporColumn);
assert.ok(moved>0&&core.vaporColumn[j]>0,'wind must carry vapor into a downwind neighbour');
assert.ok(Math.abs(mass1-mass0)<2e-5,'finite-volume H2O advection must conserve area-weighted vapor mass');

core.surfaceWaterFraction.fill(0);core.surfaceWaterFraction[i]=1;core.vaporColumn.fill(0);
core.surfaceTemp.fill(300);core.airTemp.fill(295);core.windStateU.fill(8);core.windStateV.fill(0);
ctx.h2oApplyEvaporation(core,300,climate);
assert.ok(core.evaporationRate[i]>0&&core.vaporColumn[i]>0,'warm liquid surface must inject atmospheric H2O');
core.vaporColumn.fill(0);core.surfaceTemp.fill(250);ctx.h2oApplyEvaporation(core,300,climate);
assert.ok(core.evaporationRate[i]<1e-12,'frozen surface must suppress liquid-water evaporation');

core.vaporColumn.fill(20);core.airTemp.fill(300);core.airTemp[i]=270;core.airTemp[j]=310;
ctx.h2oRefreshRelativeHumidity(core,climate);
assert.ok(core.relativeHumidity[i]>core.relativeHumidity[j],
  'same vapor column must be relatively wetter in colder air');

for(let n=0;n<core.count;n++) core.vaporColumn[n]=1+(n%17);
ctx.h2oNormalizeGlobalVapor(core,climate);
assert.ok(Math.abs(ctx.h2oAreaMean(core,core.vaporColumn)-target)<2e-4,
  'H2O transport must provide a deterministic global-reservoir normalization hook');

const live=ctx.weatherCoreCreate(77,12,climate,axis);
for(let n=0;n<8;n++) ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live),'coupled energy/baric/wind/H2O ticks must remain finite');
assert.ok(Math.abs(ctx.h2oAreaMean(live,live.vaporColumn)-target)<2e-4,
  'standalone H2O transport ticks must not drift their atmospheric vapor target');
assert.ok(live.relativeHumidity.some(v=>v>0),'physical relative humidity field must remain populated');
assert.ok(live.evaporationRate.some(v=>v>0),'Earth-like warm water should create a non-zero evaporation source');

assert.ok(h2oSrc.includes('windStateU')&&h2oSrc.includes('h2oAdvectConservative'),
  'H2O transport must consume the real 0.5.42 wind field');
assert.ok(h2oSrc.includes('world.seedS')&&h2oSrc.includes('h2oMacroTerrainHeight'),
  'evaporation geography must derive from the terrain macro field, not random cloud noise');
assert.ok(h2oSrc.includes('h2oNormalizeGlobalVapor'),
  'H2O transport must expose the normalization hook extended by later water phases');
assert.ok(!h2oSrc.includes('requestAnimationFrame'),'H2O physics must stay on the slow fixed Weather Core clock');

console.log('h2o-advection.test.js: OK');
