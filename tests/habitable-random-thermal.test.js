const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/habitable-random-thermal-fix.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/climate-consistency.js','js/habitable-random-thermal-fix.js','js/input-frame-pacing.js'],'shell final thermal acceptance order');
ordered(buildPs,['js/climate-consistency.js','js/habitable-random-thermal-fix.js','js/input-frame-pacing.js'],'PowerShell final thermal acceptance order');

assert.match(src,/CITY_TA_MODEL=4/);
assert.match(src,/CITY_TA_TARGET_MIN_C=14/);
assert.match(src,/CITY_TA_TARGET_MAX_C=24/);
assert.match(src,/CITY_TA_ACCEPT_MIN_C=10/);
assert.match(src,/CITY_TA_ACCEPT_MAX_C=27/);
assert.match(src,/if\(c<target\)hi=au;else lo=au;/,
  'cold probes must move the binary-search bracket inward, toward the star');
assert.match(src,/weatherCoreEnsure/);
assert.match(src,/weatherCore=null/);
assert.match(src,/surfaceSkinTemp/);
assert.match(src,/CITY_TA_SOLVE_STEPS=14/);

let calls=0;
const state={seed:123456,temp:-70,star:0.43,luminosity:0.43,distance:1.45};
const ctx={console,Math,Number,Float32Array,state,window:{},
  weatherCore:{count:1,surfaceTemp:new Float32Array([200])},
  weatherCoreEnsure:()=>{
    calls++;
    /* Reproduce the regression: a cold state.temp keeps climate on a snowball
       branch regardless of orbit. Warm-starting state.temp restores a normal
       monotonic orbit/temperature relation. */
    const C=state.temp<0 ? -70 : 40-20*state.distance;
    ctx.weatherCore={count:4,N:2,
      surfaceTemp:new Float32Array(4).fill(C+273.15),
      areaWeight:new Float32Array([1,1,1,1])};
    return ctx.weatherCore;
  },
  weatherHash01:()=>0.5,
  starPhysics:()=>({T:5772,L:1}),
  habitableZoneForStar:()=>({conservativeInner:0.95,conservativeOuter:1.70}),
  orbitDistanceAU:x=>x,
  stellarDistanceSliderFromAU:x=>x,
  tempToSlider:C=>C,
  settleWaterEquilibriumImmediate:()=>{
    assert.equal(ctx.weatherCore,null,'each orbital probe must invalidate the previous Weather Core before water settling');
    assert.ok(state.temp>=14&&state.temp<=24,'each Random probe must warm-start the climate branch before water settling');
  },
  updateLegacyAtmoProxy:()=>{},
  deriveWorld:()=>{},markRenderUniformsDirty:()=>{},syncUI:()=>{},saveHash:()=>{},
  climateModel:()=>({C:18})
};
let generated=0;
ctx.generateCityReadyRandomWorld=()=>{generated++;state.temp=-70;state.distance=1.45;ctx.weatherCore={count:1,surfaceTemp:new Float32Array([210])};return {C:-60};};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'habitable-random-thermal-fix.js'});
ctx.generateCityReadyRandomWorld(()=>0.5);

assert.equal(generated,1);
assert.ok(calls>0,'thermal correction must build Weather Core probes');
const finalC=40-20*state.distance;
assert.ok(finalC>=14&&finalC<=24,
  'random solve must converge to the warm target band, got '+finalC.toFixed(2)+' C');
assert.ok(state.distance<1.45,
  'an initially cold world must move inward, not outward');

console.log('habitable-random-thermal.test.js: OK');
