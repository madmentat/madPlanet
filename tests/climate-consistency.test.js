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
assert.match(src,/areaWeight/,'current surface mean must be area weighted');
assert.match(src,/waterTemperatureK=function\(\)/,'water phase temperature must be overridden');
assert.match(src,/climateConsistencyCurrentSurfaceMeanK/,'water phase coupling must use current Weather Core mean');
assert.match(src,/settleWaterEquilibriumImmediate=function/,'bootstrap H2O solve must converge rather than stop after a few arbitrary passes');
assert.match(src,/Расчётная T\* режима/,'equilibrium estimate must be labelled as calculated rather than current');
assert.match(src,/Текущая T̄ поверхности/,'panel must expose current physical surface mean');
assert.match(src,/smoothTelemetryValues\.temp/,'headline temperature must be overwritten from current physical surface state');

let oldWaterCalls=0;
const state={seed:42,gasH2O:0.01};
const weatherCore={seed:42,count:2,surfaceTemp:new Float32Array([270,280]),surfaceSkinTemp:new Float32Array([250,300]),areaWeight:new Float32Array([1,3])};
const ctx={console,Math,Number,Float32Array,state,weatherCore,window:{},
  waterTemperatureK:()=>{oldWaterCalls++;return 800;},
  settleWaterEquilibriumImmediate:()=>({ok:true}),
  climateModel:()=>({T:700,C:426.85}),
  updateLegacyAtmoProxy:()=>{},markRenderUniformsDirty:()=>{}};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'climate-consistency.js'});
const mean=ctx.window.__madPlanetClimateConsistency.currentMeanK();
assert.ok(Math.abs(mean-287.5)<1e-6,'surface mean must use skin temperature and cubed-sphere area weights');
assert.ok(Math.abs(ctx.waterTemperatureK()-287.5)<1e-6,'H2O phase state must follow current physical mean, not 700 K climate target');
const callsBefore=oldWaterCalls;
ctx.state.seed=43;
assert.equal(ctx.waterTemperatureK(),800,'stale Weather Core from another seed must not drive the new world water budget');
assert.ok(oldWaterCalls>callsBefore,'seed mismatch must fall back to bootstrap climate temperature');

console.log('climate-consistency.test.js: OK');
