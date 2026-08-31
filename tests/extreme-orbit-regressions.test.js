const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const extreme=read('js/extreme-orbit-physics.js');
const rebase=read('js/weather-regime-rebase.js');
const crisp=read('js/cryosphere-edge-display.js');
const sh=read('build.sh');
const ps=read('build.ps1');

for(const build of [sh,ps]){
  assert.ok(build.indexOf('js/climate-regimes.js')<build.indexOf('js/extreme-orbit-physics.js'),
    'extreme equilibrium must wrap the final climate model');
  assert.ok(build.indexOf('js/extreme-orbit-physics.js')<build.indexOf('js/weather-core.js'),
    'Weather Core must initialize from retained atmosphere/water and uncapped hot climate');
  assert.ok(build.indexOf('js/weather-core.js')<build.indexOf('js/weather-regime-rebase.js'),
    'weather rebase must wrap persistent Weather Core');
  assert.ok(build.indexOf('js/cryosphere-gpu.js')<build.indexOf('js/cryosphere-edge-display.js'),
    'crisp land-ice transfer must wrap the cryosphere GPU reconstruction');
}
assert.match(extreme,/EXTREME_CLIMATE_MAX_K=2200/,'the accidental 900 K climate ceiling must be bypassed');
assert.match(extreme,/stellarHeavyAtmosRetention/);
assert.match(extreme,/stellarWaterRetention/);
assert.match(extreme,/escapeKMS/,'volatile retention must depend on escape velocity');
assert.match(extreme,/ageGyr/,'volatile retention must integrate exposure over planet age');

/* Exercise the evolutionary proxy without loading the browser app. Keep the
   changing fixture values in an explicit object captured by arrow functions;
   host-created object methods use host `this` semantics inside vm.Context and
   are not a reliable way to mutate a synthetic global between assertions. */
const ectx={
  console,Math,Number,
  state:{distance:1,waterTotal:0.5,atmo:0.6,ageTest:4.54,escapeTest:11.186},
  GAS_KEYS:['gasN2','gasO2','gasH2O','gasCO2','gasSO2','gasCH4','gasHHe'],
  WATER_EOW_TO_ATM_INV:261.3,EARTH_ATM_BAR:1.01325,
  atmosphereGravityEarth(){return 1;},
  gasPartialPressureBar(k){return ({gasN2:0.78,gasO2:0.21,gasH2O:0.004,gasCO2:0.00042,gasSO2:0.000001,gasCH4:0.000002,gasHHe:0.000005})[k]||0;},
  atmosphereSurfacePressureBar(){return 1.0;},
  waterTotalEowFromSlider(){return 1.0;},
  updateLegacyAtmoProxy(){return 0.6;},
  CLIMATE_SOLAR_CONSTANT:1361,CLIMATE_SIGMA:5.670374419e-8,
  climateWaterAvailability(x){return Math.max(0,Math.min(1,x));},
  climateIceArea(){return 0;},
  climateClassify(){return 'temperate';},climateRegimeLabel(){return 'умеренный';},
  settleWaterEquilibriumImmediate(){return null;}
};
ectx.distanceInfo=()=>({S:ectx.state.distance});
ectx.planetPhysics=()=>({ageGyr:ectx.state.ageTest,escapeKMS:ectx.state.escapeTest,gravityEarth:1});
ectx.climateModel=()=>({T:900,C:626.85,S:ectx.state.distance,A:0.30,tau:0,pressureBar:1,waterEow:1,waterAvail:1,iceArea:0,ASR:0,OLR:0});
vm.createContext(ectx);vm.runInContext(extreme,ectx,{filename:'extreme-orbit-physics.js'});
assert.ok(ectx.stellarHeavyAtmosRetention()>0.999,'Earth-flux heavy atmosphere should not be erased');
assert.ok(ectx.stellarWaterRetention()>0.999,'Earth-flux water should not be erased');
ectx.state.distance=233.68;ectx.state.ageTest=6.6;ectx.state.escapeTest=11.186;
const er=ectx.extremeOrbitDiagnostics();
assert.ok(er.atmosphereRetention<0.01,'old Earth-gravity world at ~234 Searth should be strongly volatile-depleted');
assert.ok(er.waterRetention<1e-4,'old Earth-gravity world at ~234 Searth should not keep an Earth ocean');
assert.ok(er.T>950,'1 Lsun / ~0.065 AU must exceed the retired 900 K ceiling');
assert.ok(er.pressureBar<0.02,'retained ordinary atmosphere should collapse under the extreme equilibrium proxy');
assert.ok(ectx.waterTotalEowFromSlider(0.5)<1e-4,'water budget must consume retained, not original, H2O cause');

/* A major BASE-forcing jump rebuilds weather once; ordinary tuning does not. */
const wctx={console,Math,Number,state:{seed:7},
  climate:{T:288,S:1,pressureBar:1},weatherCore:{id:1},nextId:1};
wctx.weatherCoreEnsure=()=>wctx.weatherCore;
wctx.weatherCoreClimateSnapshot=()=>({...wctx.climate});
wctx.weatherCoreRequestedResolution=()=>32;
wctx.weatherCoreAxis=()=>[0,1,0];
wctx.weatherCoreCreate=()=>({id:++wctx.nextId});
vm.createContext(wctx);vm.runInContext(rebase,wctx,{filename:'weather-regime-rebase.js'});
const a=wctx.weatherCoreEnsure();
wctx.climate={T:300,S:1.1,pressureBar:0.9};
const b=wctx.weatherCoreEnsure();
assert.equal(b.id,a.id,'small climate edits must preserve persistent weather');
wctx.climate={T:1040,S:233.68,pressureBar:0.001};
const c=wctx.weatherCoreEnsure();
assert.notEqual(c.id,b.id,'extreme orbit/pressure jump must discard stale HZ weather immediately');
assert.equal(wctx.weatherRegimeRebaseDiagnostics().rebases,1);

/* Continental ice is optically crisp; sea concentration stays gradual. */
const cctx={console,Math,Number,
  cryoGpuSmooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);},
  cryoGpuVisualCoverage(raw,edge,sea){return sea?raw*0.5:raw;}
};
vm.createContext(cctx);vm.runInContext(crisp,cctx,{filename:'cryosphere-edge-display.js'});
assert.equal(cctx.cryoGpuVisualCoverage(0,0.5,false),0);
assert.equal(cctx.cryoGpuVisualCoverage(0.8,0.5,false),1,'dense continental ice must be opaque');
const edgeDark=cctx.cryoGpuVisualCoverage(0.33,0.05,false);
const edgeLight=cctx.cryoGpuVisualCoverage(0.33,0.95,false);
assert.ok(Math.abs(edgeDark-edgeLight)>0.8,'sub-cell edge noise must move a sharp boundary instead of making grey milk');
assert.equal(cctx.cryoGpuVisualCoverage(0.8,0.5,true),0.4,'sea pack-ice transfer must remain delegated to the existing gradual model');

console.log('extreme-orbit-regressions.test.js: OK');
