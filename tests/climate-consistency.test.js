const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/climate-consistency.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/smooth-motion-ui.js','js/climate-consistency.js','js/input-frame-pacing.js','js/frame-pacing-polish.js'],'shell consistency/pacing order');
ordered(buildPs,['js/smooth-motion-ui.js','js/climate-consistency.js','js/input-frame-pacing.js','js/frame-pacing-polish.js'],'PowerShell consistency/pacing order');

assert.match(src,/surfaceSkinTemp/,'current climate mean must prefer the radiating surface skin');
assert.match(src,/areaWeight/,'surface and weather means must be area weighted');
assert.match(src,/waterTemperatureK=function/,'water phase temperature must be overridden');
assert.match(src,/Расчётная T\* режима/,'equilibrium estimate must be labelled as calculated rather than current');
assert.match(src,/Текущая T̄ поверхности/,'panel must expose current physical surface mean');
assert.match(src,/smoothTelemetryValues\.temp/,'headline temperature must be overwritten from current physical surface state');
assert.match(src,/atmosphereTemperatureK=function/,'atmosphere diagnostics must use current air rather than climate target');
assert.match(src,/windPressureRel=.*\/\(o\.r\*o\.r\)/,'stellar-wind pressure must follow inverse-square orbital distance');
assert.match(src,/xuvFluxRel=.*\/\(o\.r\*o\.r\)/,'XUV forcing must follow inverse-square orbital distance');
assert.match(src,/weatherCoreStep=function/,'atmospheric escape must advance on physical Weather Core ticks');
assert.match(src,/energyLimitedKgS/,'XUV-driven energy-limited escape must be represented');
assert.match(src,/magnetopauseRp/,'magnetic shielding must affect stellar-wind exposure');

let oldWaterCalls=0,oldRelaxCalls=0,oldStepCalls=0;
const PARAMS=[{k:'temp',label:'Средняя температура'},{k:'aurora',label:'Солнечная активность (Kp)'}];
const GAS_KEYS=['gasN2','gasO2','gasH2O','gasHHe'];
const state={seed:42,temp:0.9,gasH2O:0.004,gasHHe:0.000005,gasN2:0.78,gasO2:0.21,
  star:0.43,luminosity:0.43,distance:0.51,planetAge:0.5,magnet:0.52,aurora:0.62,waterTotal:0.5};
const weatherCore={seed:42,count:2,
  surfaceTemp:new Float32Array([270,280]),surfaceSkinTemp:new Float32Array([250,300]),
  airTemp:new Float32Array([280,320]),humidity:new Float32Array([0.2,0.6]),cloudWater:new Float32Array([1,5]),
  insolation:new Float32Array([340.25,340.25]),areaWeight:new Float32Array([1,3]),orbitalDistanceAU:1};
const ctx={console,Math,Number,Date,Float32Array,PARAMS,GAS_KEYS,state,weatherCore,window:{},document:undefined,
  waterTemperatureK:()=>{oldWaterCalls++;return 800;},settleWaterEquilibriumImmediate:()=>({ok:true}),
  climateModel:()=>({T:700,C:426.85}),updateLegacyAtmoProxy:()=>{},markRenderUniformsDirty:()=>{},
  tempLabel:()=>'+427 °C',tempToSlider:C=>(C+100)/1000,
  relaxDerived:()=>{oldRelaxCalls++;state.temp=0.99;return true;},
  weatherCoreMeans:()=>({T:999,RH:999,cloud:999}),atmosphereTemperatureK:()=>700,
  starPhysics:()=>({T:5772,L:1,M:1,R:1,lumMult:1}),orbitDistanceAU:()=>1,orbitalFluxEarth:(L,r)=>L/(r*r),
  planetAgeGyr:()=>4.57,planetPhysics:()=>({radiusEarth:1,massEarth:1,surfaceAreaEarth:1,ageGyr:4.57}),
  gasInventoryTotal:()=>state.gasN2+state.gasO2+state.gasH2O+state.gasHHe,
  atmosphereSurfacePressureBar:()=>1.013,waterBudget:()=>({totalEow:1}),
  waterTotalEowFromSlider:()=>1,waterTotalSliderFromEow:x=>x,WATER_TOTAL_MIN_EOW:1e-4,
  updateWaterDerivedState:()=>{},sanitizeGasInventories:()=>{},atmoCompFromGases:()=>0,
  WEATHER_CORE_FIXED_DT_SEC:300,
  weatherCoreStep:(core,dt)=>{oldStepCalls++;core.simSeconds=(core.simSeconds||0)+dt;return core;}
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'climate-consistency.js'});

const mean=ctx.window.__madPlanetClimateConsistency.currentMeanK();
assert.ok(Math.abs(mean-287.5)<1e-6,'surface mean must use skin temperature and cubed-sphere area weights');
assert.ok(Math.abs(ctx.waterTemperatureK()-287.5)<1e-6,'H2O phase state must follow current physical mean, not 700 K climate target');
assert.equal(PARAMS.find(p=>p.k==='temp').label,'Средняя T поверхности');
assert.equal(PARAMS.find(p=>p.k==='aurora').label,'Космическая погода / вспышки');
assert.equal(ctx.tempLabel(),'+14.4 °C','temperature value text must show the observed surface mean');
ctx.relaxDerived(0.1);
assert.equal(oldRelaxCalls,1);
assert.ok(Math.abs(state.temp-0.11435)<1e-8,'legacy renderer temperature proxy must follow current surface, not the attractor');
const means=ctx.weatherCoreMeans(weatherCore);
assert.ok(Math.abs(means.T-310)<1e-6,'weather-panel air mean must be cubed-sphere area weighted');
assert.ok(Math.abs(means.RH-0.5)<1e-6);
assert.ok(Math.abs(means.cloud-4)<1e-6);
assert.ok(Math.abs(ctx.atmosphereTemperatureK()-310)<1e-6,'density/scale-height temperature must use current air');

const forcing=ctx.window.__madPlanetStellarEscape.forcingCheck();
assert.ok(Math.abs(forcing.inferredS-1)<1e-6&&Math.abs(forcing.error)<1e-6,
  'Weather Core mean insolation must agree with the stellar/orbital flux');
const earth=ctx.window.__madPlanetStellarEscape.calculate();
assert.ok(earth.windPressureNPa>0&&earth.totalEscapeKgS>0);
weatherCore.orbitalDistanceAU=0.5;
const close=ctx.window.__madPlanetStellarEscape.calculate();
assert.ok(close.windPressureRel>earth.windPressureRel*3.9,'closer orbit must receive ~1/r^2 wind pressure');
assert.ok(close.xuvFluxRel>earth.xuvFluxRel*3.9,'closer orbit must receive ~1/r^2 XUV');
weatherCore.orbitalDistanceAU=1;
state.magnet=0.2;const weak=ctx.window.__madPlanetStellarEscape.calculate();
state.magnet=0.8;const strong=ctx.window.__madPlanetStellarEscape.calculate();
assert.ok(strong.magnetopauseRp>weak.magnetopauseRp,'stronger field must expand the magnetopause');
assert.ok(strong.windTransmission<weak.windTransmission,'stronger field must reduce direct wind exposure');
assert.ok(ctx.window.__madPlanetStellarEscape.anchor(0.86).wind>ctx.window.__madPlanetStellarEscape.anchor(0.43).wind*1000,
  'hot massive-star wind baseline must be much stronger than solar');

state.magnet=0;state.aurora=1;weatherCore.orbitalDistanceAU=0.02;
const dryBefore=state.gasN2+state.gasO2+state.gasHHe;
ctx.weatherCoreStep(weatherCore,300,{},[0,1,0]);
assert.equal(oldStepCalls,1);
assert.ok(state.gasN2+state.gasO2+state.gasHHe<dryBefore,
  'an extreme exposed atmosphere must physically lose inventory on a Weather Core tick');

const callsBefore=oldWaterCalls;
state.seed=43;
assert.equal(ctx.waterTemperatureK(),800,'stale Weather Core from another seed must not drive the new world water budget');
assert.ok(oldWaterCalls>callsBefore,'seed mismatch must fall back to bootstrap climate temperature');

console.log('climate-consistency.test.js: OK');
