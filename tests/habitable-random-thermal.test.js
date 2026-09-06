const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/habitable-random-thermal-fix.js'),'utf8');

assert.match(src,/CITY_TA_MODEL=2/);
assert.match(src,/CITY_TA_TARGET_MIN_C=14/);
assert.match(src,/CITY_TA_TARGET_MAX_C=24/);
assert.match(src,/CITY_TA_ACCEPT_MIN_C=10/);
assert.match(src,/CITY_TA_ACCEPT_MAX_C=27/);
assert.match(src,/if\(c<target\)hi=au;else lo=au;/,
  'cold probes must move the binary-search bracket inward, toward the star');
assert.match(src,/weatherCoreEnsure/);
assert.match(src,/weatherCore=null/);
assert.match(src,/surfaceSkinTemp/);
assert.match(src,/CITY_TA_SOLVE_STEPS=12/);

let calls=0;
const state={seed:123456,temp:0.52,star:0.43,luminosity:0.43,distance:1.45};
const ctx={console,Math,Number,Float32Array,state,window:{},
  weatherCore:null,
  weatherCoreEnsure:()=>{
    calls++;
    /* Monotonic test climate: farther orbit = colder current surface.
       C=50-25*AU puts the warm target around 1.2-1.4 AU. */
    const C=50-25*state.distance;
    return {count:4,N:2,
      surfaceTemp:new Float32Array(4).fill(C+273.15),
      areaWeight:new Float32Array([1,1,1,1])};
  },
  weatherHash01:()=>0.5,
  starPhysics:()=>({T:5772,L:1}),
  habitableZoneForStar:()=>({conservativeInner:0.95,conservativeOuter:1.70}),
  orbitDistanceAU:x=>x,
  stellarDistanceSliderFromAU:x=>x,
  settleWaterEquilibriumImmediate:()=>{},
  updateLegacyAtmoProxy:()=>{},
  deriveWorld:()=>{},markRenderUniformsDirty:()=>{},syncUI:()=>{},saveHash:()=>{},
  climateModel:()=>({C:18})
};
let generated=0;
ctx.generateCityReadyRandomWorld=()=>{generated++;return {C:18};};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'habitable-random-thermal-fix.js'});
ctx.generateCityReadyRandomWorld(()=>0.5);

assert.equal(generated,1);
assert.ok(calls>0,'thermal correction must build Weather Core probes');
const finalC=50-25*state.distance;
assert.ok(finalC>=14&&finalC<=24,
  'random solve must converge to the warm target band, got '+finalC.toFixed(2)+' C');
assert.ok(state.distance<1.45,
  'an initially cold world must move inward, not outward');

console.log('habitable-random-thermal.test.js: OK');
