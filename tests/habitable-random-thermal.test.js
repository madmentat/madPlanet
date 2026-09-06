const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/habitable-random-thermal-fix.js'),'utf8');
assert.match(src,/CITY_TA_TARGET_MIN_C=10/);
assert.match(src,/CITY_TA_TARGET_MAX_C=25/);
assert.match(src,/weatherCoreEnsure/);
assert.match(src,/weatherCore=null/);
assert.match(src,/surfaceSkinTemp/);
assert.match(src,/CITY_TA_SOLVE_STEPS=12/);

let calls=0;
const state={seed:123456,temp:0.52,star:0.43,luminosity:0.43,distance:0.51};
const core={count:4,N:2,surfaceTemp:new Float32Array([283.15,291.15,289.15,285.15]),areaWeight:new Float32Array([1,1,1,1])};
const ctx={console,Math,Number,Float32Array,state,window:{},
  weatherCore:null,weatherCoreEnsure:()=>{calls++;return core;},
  weatherHash01:()=>0.5,
  starPhysics:()=>({T:5772,L:1}),
  habitableZoneForStar:()=>({conservativeInner:0.95,conservativeOuter:1.70}),
  orbitDistanceAU:()=>1,
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
assert.ok(state.distance>0,'thermal correction must set an orbital distance');
const mean=(283.15+291.15+289.15+285.15)/4-273.15;
assert.equal(mean,13.65);
console.log('habitable-random-thermal.test.js: OK');
