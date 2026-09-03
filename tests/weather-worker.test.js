const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/weather-worker.js'),'utf8');
const edge=fs.readFileSync(path.join(root,'js/cryosphere-edge-display.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=147),'weather worker requires 0.5.147+');
for(const [name,text] of [['shell',buildSh],['PowerShell',buildPs]]){
  const mods=text.match(/js\/[a-z0-9-]+\.js/g)||[];
  assert.equal(mods[mods.length-1],'js/weather-worker.js',name+' build must load the worker bridge last so it wraps every final binding');
}

/* Bridge invariants. */
assert.match(src,/document\.currentScript\.textContent/,'worker must be built from the page\'s own bundle text');
assert.match(src,/self\.MP_WEATHER_WORKER=true/,'worker preamble must mark the worker realm');
assert.match(src,/self\.setTimeout=\(\)=>0;/,'worker must not run the cooperative scheduler on its own: the main thread is the only clock');
assert.match(src,/self\.requestIdleCallback=undefined/,'idle callbacks must be absent in the worker');
assert.match(src,/weatherCoreClimateSnapshot=function\(\)\{return wwClimate/,'worker must consume the main-thread climate snapshot');
assert.match(src,/if\(v instanceof Float64Array\)continue;/,'scratch buffers must not be mirrored to the main thread');
assert.match(src,/weatherCoreStep\(core,Number\(m\.dtSec\)\|\|WEATHER_CORE_FIXED_DT_SEC,/,'worker must honour the runtime tick length');
assert.match(src,/cryoGpuEnsure\(wwDisplayN\);cryoGpuReadCurrent\(core\);/,'cryosphere reconstruction must run in the worker');
assert.match(src,/riverGpuEnsure\(wwRiverN\);riverGpuReadCurrent\(core\);/,'river reconstruction must run in the worker');
assert.match(src,/\},mir\.transfer\);/,'mirror must be transferred zero-copy');
assert.match(src,/if\(core&&core\.__mirror\)return core;/,'main thread must never step a mirror');
assert.match(src,/weatherCoreTick=weatherWorkerTickHook;/,'main-thread tick must become a request');
assert.match(src,/setTimeout\(weatherWorkerInstall,0\);/,'hooks must install after the microtask-deferred late hooks');
assert.match(src,/weatherWorkerPumpTimer=setTimeout\(weatherWorkerPump,16\)/,'apply pipeline must be pumped by a macrotask chain, not the render loop');
assert.match(src,/weatherWorkerApplyStage===2\)\{[\s\S]*riverGpuUpload/,'river upload must sit on its own frame');
assert.match(src,/function weatherWorkerFallback\(\)/,'a worker failure must restore the synchronous path');
assert.doesNotMatch(src,/requestAnimationFrame\(weatherWorkerApplyStep\)/,'no private rAF chain: it starved under low frame rates');

/* Tabulated cryosphere reconstruction. */
assert.match(edge,/function cryoDisplayBuildTable\(core,N\)/,'display reconstruction must be tabulated');
assert.match(edge,/noise\[t\]=edge;/,'edge noise must be cached per texel');
assert.doesNotMatch(edge,/cryoDisplaySampleDirection\(core,d,false\)/,'per-texel projected sampling must not remain in the tick path');

/* Behavioural: a realm without Worker leaves every binding untouched. */
const ctx={console,Math,Number,Float32Array,Uint8Array,JSON,Object,Array,ArrayBuffer,
  state:{seed:1},weatherCoreEnsure(){return {seed:1,N:4};},weatherCoreStep(c){return c;},weatherCoreTick(){return true;},
  weatherCoreRequestedResolution(){return 4;},weatherCoreAxis(){return [0,1,0];},weatherCoreClimateSnapshot(){return {T:288};},
  cryoGpuReadCurrent(){},riverGpuReadCurrent(){},WEATHER_CORE_FIXED_DT_SEC:300,refreshWeatherCoreDiagnostics(){},
  setTimeout(){return 0;},clearTimeout(){},weatherCore:null,drawFrame(){},performance:{now:()=>0}};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'weather-worker.js'});
assert.equal(ctx.weatherWorkerDiagnostics().active,false,'no Worker -> bridge inactive');
assert.equal(ctx.weatherCoreEnsure().seed,1,'bindings untouched without a Worker');

/* Worker realm: snapshot overrides take effect, a tick steps with the runtime
   dt, and the reply carries a transferred mirror plus quantised faces. */
const wctx={console,Math,Number,Float32Array,Float64Array,Uint8Array,Int32Array,JSON,Object,Array,ArrayBuffer,
  self:{MP_WEATHER_WORKER:true,postMessage(){}},performance:{now:()=>0},WEATHER_CORE_FIXED_DT_SEC:300,
  state:{seed:7,temp:0.5},
  weatherCoreEnsure(){return wctx.__core;},
  weatherCoreStep(c,dt){c.ticks++;c.lastDt=dt;return c;},
  weatherCoreClimateSnapshot(){return {T:1};},weatherCoreAxis(){return [1,0,0];},weatherCoreRequestedResolution(){return 99;},
  cryoGpuDisplayResolution(){return 1;},riverGpuDisplayN(){return 1;},deriveWorld(){wctx.derived=(wctx.derived||0)+1;},
  cryoGpuEnsure(){},cryoGpuReadCurrent(){},cryoGpuN:1,cryoGpuCurrLand:[0,1,2,3,4,5].map(()=>new Float32Array([0.5])),cryoGpuCurrSea:[0,1,2,3,4,5].map(()=>new Float32Array([1])),
  riverGpuEnsure(){},riverGpuReadCurrent(){wctx.riverReads=(wctx.riverReads||0)+1;},riverGpuN:1,riverGpuCurrRiver:[0,1,2,3,4,5].map(()=>new Float32Array([0.25])),riverGpuCurrLake:[0,1,2,3,4,5].map(()=>new Float32Array([0]))};
wctx.__core={seed:7,N:8,ticks:0,surfaceTemp:new Float32Array([280]),scratch:new Float64Array(2),dir:[1,2,3],riverChannelStrength:new Float32Array([0.5])};
let posted=[];wctx.self.postMessage=(msg,transfer)=>posted.push({msg,transfer});
vm.createContext(wctx);vm.runInContext(src,wctx,{filename:'weather-worker.js'});
assert.equal(posted[0].msg.type,'ready');
const msg=(id,step)=>({data:{type:'tick',requestId:id,step,dtSec:450,stateJson:JSON.stringify({seed:7,temp:0.9}),climate:{T:250},axis:[0,0,1],N:16,displayN:1,riverN:1}});
wctx.self.onmessage(msg(1,true));
assert.equal(wctx.state.temp,0.9,'state snapshot must be applied');
assert.equal(wctx.derived,1,'geography must be re-derived once per state change');
assert.equal(wctx.weatherCoreClimateSnapshot().T,250);assert.deepEqual(wctx.weatherCoreAxis(),[0,0,1]);assert.equal(wctx.weatherCoreRequestedResolution(),16);
const reply=posted[1];
assert.equal(reply.msg.type,'core');assert.equal(reply.msg.ok,true);
assert.equal(reply.msg.fields.ticks,1,'tick must have stepped');
assert.equal(wctx.__core.lastDt,450,'runtime tick length must reach the physics step');
assert.ok(reply.msg.fields.surfaceTemp instanceof Float32Array);
assert.equal(reply.msg.fields.scratch,undefined,'Float64 scratch excluded');
assert.ok(reply.transfer.length>=1&&reply.transfer.every(b=>b instanceof ArrayBuffer),'typed arrays transferred');
assert.ok(reply.msg.cryo&&reply.msg.cryo.land.length===6&&reply.msg.cryo.land[0][0]===128,'cryosphere faces quantised to bytes');
assert.ok(reply.msg.river&&reply.msg.river.river[0][0]===64,'river faces quantised on the first tick of a core');
wctx.self.onmessage(msg(2,true));
assert.equal(wctx.derived,1,'unchanged state must not re-derive geography');
assert.equal(posted[2].msg.river,null,'river faces are resent only every few ticks');
console.log('weather-worker.test.js: OK');
