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

assert.match(version,/^VERSION\s+0\.5\.50\s*$/m,'polish stays inside 0.5.50 before roadmap 0.5.51');
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

const state={
  seed:1,temp:0.5,waterTotal:0.5,sea:0.58,cloudLow:.48,cloudMid:.36,cloudHigh:.24,
  gasN2:.78,gasO2:.21,gasH2O:.004,gasCO2:.00042,gasSO2:1e-8,gasCH4:0,gasHHe:.001,
  pinTemp:false,pinCO2:false,pinSO2:false,pinH2O:false
};
let derived=0,synced=0,saved=0,marked=0,captured=0,released=0;
const ATM=1.01325;
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const ctx={
  console,Math,Number,Float32Array,state,EARTH_ATM_BAR:ATM,mulberry32,
  atmosphereGravityEarth:()=>1,
  gasPartialPressureBar:k=>Math.max(0,state[k]||0)*ATM,
  sanitizeGasInventories:()=>{},updateLegacyAtmoProxy:()=>{},
  waterTotalSliderFromEow:e=>e,
  settleWaterEquilibriumImmediate:()=>{state.gasH2O=.004/ATM;state.sea=.58;return{};},
  planetPhysics:()=>({gravityEarth:1}),
  stellarLuminositySliderFromMultiplier:x=>x,
  stellarDistanceSliderFromAU:au=>au,
  starPhysics:()=>({T:5772,L:1}),
  habitableZoneForStar:()=>({conservativeInner:.80,conservativeOuter:1.40}),
  tempToSlider:c=>c,
  climateModel:()=>{
    const au=Math.max(.2,Number(state.distance)||1);
    const C=18+70*(1/Math.sqrt(au)-1);
    const pressure=['gasN2','gasO2','gasH2O','gasCO2','gasSO2','gasCH4','gasHHe']
      .reduce((s,k)=>s+Math.max(0,state[k]||0)*ATM,0);
    return {C,T:C+273.15,pressureBar:pressure,waterAvail:1,iceArea:.08,runawayIndex:0,moistIndex:.08};
  },
  climateWeatherTargets:()=>({snowAlt:.45,cloudLow:.52,cloudMid:.37,cloudHigh:.24,wind:.44,convection:.38,storm:.35}),
  deriveWorld:()=>{derived++;},releaseLegacyPins:()=>{released++;},captureTransientEquilibrium:()=>{captured++;},
  markRenderUniformsDirty:()=>{marked++;},syncUI:()=>{synced++;},saveHash:()=>{saved++;}
};
vm.createContext(ctx);vm.runInContext(random,ctx,{filename:'habitable-random.js'});
function seeded(seed){let x=seed>>>0;return()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296);}
for(let n=1;n<=6;n++){
  const c=vm.runInContext(`generateCityReadyRandomWorld(__rng)`,Object.assign(ctx,{__rng:seeded(n*12345)}));
  assert.ok(c.C>=2&&c.C<=32,'generated global temperature must be city-ready');
  assert.ok(c.pressureBar>=.65&&c.pressureBar<=1.55,'generated pressure must be moderate');
  const o2=ctx.gasPartialPressureBar('gasO2');
  assert.ok(o2>=.16&&o2<=.30,'generated O2 partial pressure must stay in accepted envelope');
  assert.equal(state.gasCH4,0,'generated atmosphere must contain no methane');
  assert.ok(state.star>=.16&&state.star<=.60,'default random star must stay in K/G/F settlement band');
}
assert.ok(derived>=6&&synced>=6&&saved>=6&&marked>=6&&captured>=6&&released>=6,'random completion must rebuild and persist the world');
console.log('ui-random-polish.test.js: OK');
