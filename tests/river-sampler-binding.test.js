'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const units=[],binds=[],floats=[];
const gl={
  TEXTURE0:1000,TEXTURE_CUBE_MAP:2,
  activeTexture(unit){this.unit=unit;},
  bindTexture(target,texture){binds.push([this.unit,texture]);},
  uniform1i(loc,unit){units.push([loc,unit]);},
  uniform1f(loc,val){floats.push([loc,val]);},
  useProgram(){}
};
const ctx={
  gl,webglVersion:2,prog:{},riverGpuTex:{kind:'lake'},
  riverLoopTex:null,riverLoopSupported:false,riverLoopReady:false,
  RIVER_LOOP_TEX_UNIT:1,RIVER_TEX_UNIT:2,drawFrame(){},
  riverGpuEnsureCurrent(){},riverGpuBlendAt(){return 1;},
  riverGpuNowMs(){return 100;},
  U:{uRiverTex:'lake',uRiverLoopTex:'painted',uRiverBlend:'blend',
     uRiverPhysicsOn:'physics',uRiverLoopOn:'river'}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/river-render.js'),'utf8'),ctx);
ctx.riverBindForFrame();
assert.ok(units.some(([loc,u])=>loc==='lake'&&u===2));
assert.ok(units.some(([loc,u])=>loc==='painted'&&u===2),
  'absent painted mask shares compatible RGBA lake sampler, not invalid uint fallback');
assert.ok(floats.some(([loc,v])=>loc==='river'&&v===0));
ctx.riverLoopSupported=true;ctx.riverLoopReady=true;
ctx.riverLoopTex={kind:'painted-river'};
ctx.riverBindForFrame();
assert.ok(units.some(([loc,u])=>loc==='painted'&&u===1),
  'the real mask must be bound to portable WebGL2 texture unit 1');
assert.ok(binds.some(([u,t])=>u===1001&&t?.kind==='painted-river'));
assert.ok(floats.some(([loc,val])=>loc==='river'&&val===1));
// Disabling the mask for screenshot comparison must leave the underlying
// land, lakes and atlas allocation unchanged.
ctx.window={madPlanetHideRivers:true};
ctx.riverBindForFrame();
assert.deepEqual(floats.at(-1),['river',0]);
ctx.window.madPlanetHideRivers=false;
ctx.riverBindForFrame();
assert.deepEqual(floats.at(-1),['river',1]);
ctx.riverLoopSupported=false;ctx.riverLoopReady=false;
ctx.riverBindForFrame();
assert.deepEqual(units.at(-1),['painted',2]);
assert.ok(floats.some(([loc,v])=>loc==='river'&&v===0));
console.log('river-sampler-binding.test.js: OK');
