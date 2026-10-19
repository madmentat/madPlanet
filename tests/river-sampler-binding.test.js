'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const units=[],binds=[],floats=[];
let allocations=0;
const gl={
  TEXTURE0:1000,TEXTURE_CUBE_MAP:2,TEXTURE_CUBE_MAP_POSITIVE_X:100,
  TEXTURE_MIN_FILTER:3,TEXTURE_MAG_FILTER:4,TEXTURE_WRAP_S:5,
  TEXTURE_WRAP_T:6,TEXTURE_WRAP_R:7,NEAREST:8,CLAMP_TO_EDGE:9,
  RGBA32UI:10,RGBA_INTEGER:11,UNSIGNED_INT:12,NO_ERROR:0,
  createTexture(){return {kind:'integer-fallback'};},
  activeTexture(unit){this.unit=unit;},
  bindTexture(target,texture){binds.push([this.unit,texture]);},
  texParameteri(){},
  texImage2D(target,level,internal,width,height,border,format,type,pixels){
    assert.equal(internal,this.RGBA32UI);
    assert.equal(format,this.RGBA_INTEGER);
    assert.equal(type,this.UNSIGNED_INT);
    assert.equal(pixels.length,4);
    allocations++;
  },
  getError(){return this.NO_ERROR;},
  uniform1i(loc,unit){units.push([loc,unit]);},
  uniform1f(loc,val){floats.push([loc,val]);},
  useProgram(){},
  deleteTexture(){}
};
const ctx={
  gl,webglVersion:2,prog:{},riverGpuTex:{kind:'lake-float'},
  riverLoopTex:null,riverLoopSupported:false,riverLoopReady:false,
  RIVER_LOOP_TEX_UNIT:8,RIVER_TEX_UNIT:2,drawFrame(){},
  riverGpuEnsureCurrent(){},riverGpuBlendAt(){return 1;},
  riverGpuNowMs(){return 100;},
  U:{uRiverTex:'lake',uRiverLoopTex:'integer',uRiverBlend:'blend',
     uRiverPhysicsOn:'physics',uRiverLoopOn:'river'}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/river-render.js'),'utf8'),ctx);

ctx.riverBindForFrame();
assert.ok(units.some(([loc,unit])=>loc==='lake'&&unit===2));
assert.ok(units.some(([loc,unit])=>loc==='integer'&&unit===1));
assert.ok(!units.some(([loc,unit])=>loc==='integer'&&unit===2),
  'float and integer samplers must never alias the same texture unit');
assert.equal(allocations,6,'integer fallback must have six initialized faces');
assert.ok(floats.some(([loc,v])=>loc==='river'&&v===0));
const oldAssignments=units.length;
ctx.riverBindForFrame();
assert.equal(allocations,6,'do not reallocate fallback every frame');
assert.equal(units.length,oldAssignments,'do not rebind unchanged sampler uniforms');

ctx.riverLoopSupported=true;ctx.riverLoopReady=true;
ctx.riverLoopTex={kind:'integer-river'};
ctx.riverBindForFrame();
assert.ok(units.some(([loc,unit])=>loc==='integer'&&unit===8),
  'must switch sampler to actual integer atlas when ready');
assert.ok(floats.some(([loc,val])=>loc==='river'&&val===1));

ctx.riverLoopSupported=false;ctx.riverLoopReady=false;
ctx.riverBindForFrame();
assert.equal(units.at(-1)[1],1,
  'failure must reassign sampler to initialized integer fallback');
assert.equal(allocations,6);
console.log('river-sampler-binding.test.js: OK');
