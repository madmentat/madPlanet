const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const toggle=fs.readFileSync(path.join(root,'js','ui-toggle-layout.js'),'utf8');
const random=fs.readFileSync(path.join(root,'js','habitable-random.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'ui/random polish regression must survive later roadmap patches');
assert.ok(toggle.includes('.param-panel .row label.tg'),'panel toggle override must be specific enough to beat .row label');
assert.ok(toggle.includes('flex:0 0 30px!important'),'panel toggles must have one standard width');
assert.ok(toggle.includes('width:30px!important')&&toggle.includes('min-width:30px!important'),'toggle width must not stretch');
assert.ok(toggle.includes('margin-left:auto'),'toggle must align to the right edge');
assert.ok(random.includes('state.gasCH4=0'),'city-ready random must explicitly exclude methane');
assert.ok(random.includes('stopImmediatePropagation'),'new random action must prevent legacy random listeners');
assert.ok(random.includes("addEventListener('click'")&&random.includes('},true);'),'random replacement must intercept in capture phase');
assert.ok(random.includes('climateModel')&&random.includes('citySolveTemperateOrbit'),'random world must be accepted by the coupled climate, not raw slider ranges only');
assert.ok(random.includes('habitableZoneForStar'),'orbit solve must use the physical HZ helper');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/ui.js','js/ui-toggle-layout.js','js/stellar-weather-coupling.js','js/habitable-random.js','js/weather-core.js'],'shell polish order');
ordered(buildPs,['js/ui.js','js/ui-toggle-layout.js','js/stellar-weather-coupling.js','js/habitable-random.js','js/weather-core.js'],'PowerShell polish order');

/* Mock the physical helpers used by habitable-random.js. The climate target is
   monotonic with AU, so its binary orbit solve can be exercised without the
   whole browser application. */
const state={planetAge:.4,planetRadius:.5,coreType:.25,rotationPeriod:.32,axialTilt:.26,waterTotal:.5,cont:.45,tect:.5,isle:.4,lake:.4,volcano:.2,city:.5,lava:.5,
  gasN2:.78,gasO2:.21,gasCO2:.00042,gasSO2:1e-8,gasHHe:.001,gasCH4:0,star:.43,luminosity:.43,distance:.51,cloudLow:.48,cloudMid:.36,cloudHigh:.24,
  snowAlt:.45,wind:.5,convection:.5,storm:.5,stormRate:.5,stormGlow:.5,magnet:.5,magTilt:.5,magAzimuth:.5,aurora:.5,rings:false,ringInner:.4,ringWidth:.5,ringDens:.5,ringCount:.5,ringMat:.2,ringGrain:.5};
function sliderAU(v){return .35+1.5*v;}
const ctx={console,Math,Number,Float32Array,state,EARTH_ATM_BAR:1.01325,GAS_KEYS:['gasN2','gasO2','gasCO2','gasSO2','gasCH4','gasHHe'],
  atmosphereGravityEarth:()=>1,gasPartialPressureBar:k=>Math.max(0,state[k]||0)*1.01325,
  sanitizeGasInventories:()=>{},updateLegacyAtmoProxy:()=>{},waterTotalSliderFromEow:e=>Math.max(0,Math.min(1,.5+.2*Math.log(e))),
  stellarLuminositySliderFromMultiplier:m=>.43+.15*Math.log(m),starPhysics:()=>({T:5772,L:1}),habitableZoneForStar:()=>({conservativeInner:.88,conservativeOuter:1.55}),
  stellarDistanceSliderFromAU:au=>Math.max(0,Math.min(1,(au-.35)/1.5)),tempToSlider:C=>(C+78)/175,settleWaterEquilibriumImmediate:()=>{},
  climateModel:()=>{const au=sliderAU(state.distance);const C=18+45*(1/au-1);return {C,pressureBar:(state.gasN2+state.gasO2+state.gasCO2+state.gasSO2+state.gasHHe)*1.01325,runawayIndex:0,moistIndex:.08,iceArea:.05,waterAvail:1};},
  planetPhysics:()=>({gravityEarth:1}),climateWeatherTargets:()=>({snowAlt:.5,cloudLow:.45,cloudMid:.32,cloudHigh:.20,wind:.48,convection:.42,storm:.35}),
  deriveWorld:()=>{},releaseLegacyPins:()=>{},captureTransientEquilibrium:()=>{},markRenderUniformsDirty:()=>{},syncUI:()=>{},saveHash:()=>{},
  mulberry32:a=>{return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
};
vm.createContext(ctx);vm.runInContext(random,ctx,{filename:'habitable-random.js'});
for(let n=0;n<8;n++){
  const r=ctx.mulberry32(100+n);const c=ctx.generateCityReadyRandomWorld(r);
  const pressure=c.pressureBar,o2=ctx.gasPartialPressureBar('gasO2');
  assert.ok(c.C>=2&&c.C<=32,'random city world temperature must be moderate');
  assert.ok(pressure>=.65&&pressure<=1.55,'random city world pressure must be moderate');
  assert.ok(o2>=.16&&o2<=.30,'random city world oxygen must be settlement-compatible');
  assert.equal(state.gasCH4,0,'random city world methane must stay exactly zero');
}
assert.ok(!random.includes('gasCH4 = 0.02'),'old methane-world branch must not exist in the replacement');
console.log('ui-random-polish.test.js: OK');