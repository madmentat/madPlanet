'use strict';
/* Regression for 0.5.180+ renderer: physical weather rivers are NOT
   sampled from the legacy RGBA8 cubemap; only its lake G/A channels are. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx={weatherCoreCreate(){},weatherCoreStep(){}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/river-gpu.js'),'utf8'),ctx);
vm.runInContext(
  'riverGpuN=32;'+
  'riverGpuCurrRiver=Array.from({length:6},()=>new Float32Array(32*32));'+
  'riverGpuCurrLake=Array.from({length:6},()=>new Float32Array(32*32));'+
  'riverGpuPaintVisualBranches=()=>{throw Error("obsolete tributary rasterization")};'+
  'riverGpuPaintEdge=()=>{throw Error("obsolete trunk rasterization")};',ctx);
const makeCore=(lakes)=>({
  count:4,
  riverChannelStrength:Float32Array.from([1,1,1,1]),
  riverDownstream:Int32Array.from([1,2,3,-1]),
  riverVisualBranches:[{cells:[1,2],strength:0.8}],
  riverLakeFraction:Float32Array.from(lakes),
  dirX:Float32Array.from([1,0,0,0]),dirY:Float32Array.from([0,1,0,0]),
  dirZ:Float32Array.from([0,0,1,-1])
});
const inspect=()=>vm.runInContext(
  '({river:riverGpuCurrRiver.reduce((s,a)=>s+a.reduce((x,y)=>x+y,0),0),'+
  'lake:riverGpuCurrLake.reduce((s,a)=>s+a.reduce((x,y)=>x+y,0),0)})',ctx);
ctx.riverGpuReadCurrent(makeCore([0,0,0,0]));
let data=inspect();
assert.equal(data.river,0);
assert.equal(data.lake,0);
ctx.riverGpuReadCurrent(makeCore([0.8,0,0.35,0]));
data=inspect();
assert.equal(data.river,0,'obsolete weather rivers must not burn CPU or enter legacy cubemap');
assert.ok(data.lake>0,'physical lake storage must remain visible');
console.log('river-lake-only.test.js: OK',JSON.stringify(data));
