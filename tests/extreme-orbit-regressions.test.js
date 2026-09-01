const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const extreme=read('js/extreme-orbit-physics.js');
const rebase=read('js/weather-regime-rebase.js');
const iceDisplay=read('js/cryosphere-edge-display.js');
const surfPre=read('shaders/surface-artifact-prelude.glsl');
const surfPost=read('shaders/surface-artifact-postlude.glsl');
const sh=read('build.sh');
const ps=read('build.ps1');

for(const build of [sh,ps]){
  assert.ok(build.indexOf('js/climate-regimes.js')<build.indexOf('js/extreme-orbit-physics.js'),
    'extreme climate/history must wrap the final ordinary climate model');
  assert.ok(build.indexOf('js/extreme-orbit-physics.js')<build.indexOf('js/weather-core.js'),
    'Weather Core must consume retained pressure/water and uncapped hot climate');
  assert.ok(build.indexOf('js/weather-core.js')<build.indexOf('js/weather-regime-rebase.js'),
    'staged forcing response must wrap persistent Weather Core');
  assert.ok(build.indexOf('js/cryosphere-gpu.js')<build.indexOf('js/cryosphere-edge-display.js'),
    'ice coverage display must wrap the physical cryosphere GPU bridge');
  assert.ok(build.indexOf('shaders/surface-artifact-prelude.glsl')<build.indexOf('shaders/surface.glsl'),
    'surface-only tectonic pigment guard must begin before surface.glsl');
  assert.ok(build.indexOf('shaders/surface.glsl')<build.indexOf('shaders/surface-artifact-postlude.glsl'),
    'surface-only tectonic pigment guard must end immediately after surface.glsl');
}
assert.match(extreme,/EXTREME_CLIMATE_MAX_K=2200/,'the accidental 900 K climate ceiling must stay retired');
assert.match(extreme,/stellarHeavyAtmosRetention/);
assert.match(extreme,/stellarWaterRetention/);
assert.match(extreme,/escaped volatiles never grow back/,'volatile loss must be irreversible inside one world history');
assert.match(extreme,/escapeKMS/,'retention target must depend on escape velocity');
assert.match(extreme,/ageGyr/,'retention target must integrate exposure over planet age');

/* Start Earth-like, then drag the SAME world to ~234 Searth. The equilibrium
   target may be catastrophic immediately, but actual retained inventory must
   decay over time rather than disappear in the slider event itself. */
const ectx={
  console,Math,Number,
  state:{seed:7,distance:1,waterTotal:0.5,atmo:0.6,ageTest:4.54,escapeTest:11.186},
  GAS_KEYS:['gasN2','gasO2','gasH2O','gasCO2','gasSO2','gasCH4','gasHHe'],
  WATER_EOW_TO_ATM_INV:261.3,EARTH_ATM_BAR:1.01325,
  atmosphereGravityEarth(){return 1;},
  gasPartialPressureBar(k){return ({gasN2:0.78,gasO2:0.21,gasH2O:0.004,gasCO2:0.00042,gasSO2:0.000001,gasCH4:0.000002,gasHHe:0.000005})[k]||0;},
  atmosphereSurfacePressureBar(){return 1.0;},
  waterTotalEowFromSlider(){return 1.0;},
  updateLegacyAtmoProxy(){return 0.6;},
  relaxDerived(){return false;},
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
assert.ok(ectx.stellarHeavyAtmosRetention()>0.999,'Earth-flux heavy atmosphere should begin intact');
assert.ok(ectx.stellarWaterRetention()>0.999,'Earth-flux water should begin intact');
ectx.state.distance=233.68;ectx.state.ageTest=6.6;
let er=ectx.extremeOrbitDiagnostics();
assert.ok(er.atmosphereRetention>0.99 && er.waterRetention>0.99,
  'moving a live world inward must not delete atmosphere/ocean in one frame');
assert.ok(er.atmosphereRetentionTarget<0.01,'old Earth-gravity ~234 Searth target should be strongly atmosphere-depleted');
assert.ok(er.waterRetentionTarget<1e-4,'old Earth-gravity ~234 Searth target should be strongly water-depleted');
assert.ok(er.T>950,'1 Lsun / ~0.065 AU must exceed the retired 900 K ceiling');
ectx.stellarAdvanceVolatileHistory(0.5);
assert.ok(ectx.stellarWaterRetention()<1 && ectx.stellarWaterRetention()>0.90,
  'first loss step should be visible but gradual');
for(let i=0;i<300;i++)ectx.stellarAdvanceVolatileHistory(0.5);
er=ectx.extremeOrbitDiagnostics();
assert.ok(er.atmosphereRetention<0.02,'long severe exposure should approach stripped heavy-atmosphere target');
assert.ok(er.waterRetention<0.002,'long severe exposure should approach stripped water target');
assert.ok(er.pressureBar<0.03,'rendered/physical pressure should follow retained atmosphere');
const burnedHeavy=er.atmosphereRetention,burnedWater=er.waterRetention;
ectx.state.distance=1;
for(let i=0;i<200;i++)ectx.stellarAdvanceVolatileHistory(0.5);
assert.ok(ectx.stellarHeavyAtmosRetention()<=burnedHeavy+1e-12,'moving outward must not resurrect escaped atmosphere');
assert.ok(ectx.stellarWaterRetention()<=burnedWater+1e-12,'escaped global water inventory must not resurrect either');

/* Major forcing keeps the same live weather object and approaches the new
   thermal target in several timed nudges, not by a one-frame rebuild. */
let now=0;
const core={id:1,count:1,seed:7,
  dirX:new Float32Array([0]),dirY:new Float32Array([1]),dirZ:new Float32Array([0]),
  surfaceTemp:new Float32Array([288]),airTemp:new Float32Array([282]),pressure:new Float32Array([100000])};
const wctx={console,Math,Number,Date,state:{seed:7},performance:{now:()=>now},
  climate:{T:288,S:1,pressureBar:1},weatherCore:core};
wctx.weatherCoreEnsure=()=>wctx.weatherCore;
wctx.weatherCoreClimateSnapshot=()=>({...wctx.climate});
wctx.weatherCoreAxis=()=>[0,1,0];
wctx.weatherCoreTargetsForCell=(c,dx,dy,dz,axis,seed,index,out)=>{
  out.surfaceTemp=c.T;out.airTemp=c.T-6;out.pressurePa=c.pressureBar*1e5;out.humidity=0;out.cloudWater=0;return out;
};
vm.createContext(wctx);vm.runInContext(rebase,wctx,{filename:'weather-regime-rebase.js'});
const a=wctx.weatherCoreEnsure();
wctx.climate={T:300,S:1.1,pressureBar:0.9};now=100;const b=wctx.weatherCoreEnsure();
assert.equal(b,a,'small climate edits must preserve persistent weather');
wctx.climate={T:1040,S:233.68,pressureBar:0.01};now=200;const c=wctx.weatherCoreEnsure();
assert.equal(c,b,'extreme forcing must no longer replace the complete Weather Core object');
assert.ok(c.surfaceTemp[0]>288 && c.surfaceTemp[0]<600,'first extreme thermal response must be partial, not instantaneous');
for(let i=0;i<10;i++){now+=950;wctx.weatherCoreEnsure();}
assert.ok(c.surfaceTemp[0]>700 && c.surfaceTemp[0]<1040,'repeated timed nudges should approach hot equilibrium over seconds');
assert.equal(wctx.weatherRegimeRebaseDiagnostics().rebases,0);
assert.equal(wctx.weatherRegimeRebaseDiagnostics().transitions,1);

/* Fractional physical ice must become spatial opaque coverage, not uniform
   white alpha. The driver field must be 3-D hashed noise, not sine planes that
   appear as rotating longitude/latitude-like bands. */
assert.doesNotMatch(iceDisplay,/Math\.sin/,'ice geography must not be built from planar sine bands');
const cctx={console,Math,Number,
  weatherFaceDir(face,u,v){const p=face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1];const q=Math.hypot(...p)||1;return p.map(x=>x/q);},
  cryoGpuSmooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);},
  cryoGpuEdgeNoise(){return 0.5;},cryoGpuVisualCoverage(raw){return raw;}
};
vm.createContext(cctx);vm.runInContext(iceDisplay,cctx,{filename:'cryosphere-edge-display.js'});
assert.equal(cctx.cryoGpuVisualCoverage(0,0.5,false),0);
assert.equal(cctx.cryoGpuVisualCoverage(0.8,0.5,false),1,'dense continental ice must be opaque');
assert.ok(cctx.cryoGpuVisualCoverage(0.35,0.20,true)>0.95,'partial sea concentration should contain opaque floes');
assert.ok(cctx.cryoGpuVisualCoverage(0.35,0.80,true)<0.05,'the same concentration should also contain open leads, not milk');
const n0=cctx.cryoGpuEdgeNoise(123,0,20,20,64),n1=cctx.cryoGpuEdgeNoise(123,0,21,20,64);
assert.ok(n0>=0&&n0<=1&&n1>=0&&n1<=1&&Math.abs(n0-n1)<0.5,'3-D ice field should be bounded and spatially coherent');

/* 0.5.88 retired the mount-derived seam macro, and 0.5.98 retired the global
   texture() wrapper. Real plate seams and an explicit cryosphere sampler must
   reach surface shading without preprocessor hijacks. */
assert.doesNotMatch(surfPre,/#define\s+gSeamNear\b/,
  'surface prelude must not manufacture tectonic contour lines from mount');
assert.doesNotMatch(surfPost,/#undef\s+gSeamNear\b/,
  'postlude must not treat the real terrain seam global as a temporary macro');
assert.match(surfPre,/vec4\s+cryoSurfaceSample\s*\(samplerCube\s+tex,\s*vec3\s+dir\)/,
  'explicit cryosphere surface sampler must remain after retiring the texture macro');
assert.doesNotMatch(surfPre,/#define\s+texture\s*\(/,
  'cryosphere code must not hijack the GLSL texture builtin');

console.log('extreme-orbit-regressions.test.js: OK');
