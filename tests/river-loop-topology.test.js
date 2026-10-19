'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx={weatherCoreCreate(){},weatherCoreStep(){}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/river-gpu.js'),'utf8'),ctx);

// Surface sampling must not synchronously wait for either shader link. A
// pending bake also must not produce an all-zero texture from unread pixels.
{
  let created=0,complete=false,linkChecks=0,reads=0;
  const g={VERTEX_SHADER:1,FRAGMENT_SHADER:2,LINK_STATUS:3,DITHER:4,TRIANGLES:5,RGBA:6,UNSIGNED_BYTE:7,
    createProgram:()=>({}),createShader:()=>({}),shaderSource(){},compileShader(){},attachShader(){},deleteShader(){},linkProgram(){},
    getExtension:()=>({COMPLETION_STATUS_KHR:123}),
    getProgramParameter(p,key){if(key===123)return complete;linkChecks++;return true;},
    viewport(){},disable(){},useProgram(){},getUniformLocation:(p,n)=>n,
    uniform1f(){},uniform1i(){},uniformMatrix3fv(){},uniform3fv(){},uniform4fv(){},drawArrays(){},
    readPixels(x,y,w,h,format,type,pixels){reads++;for(let i=0;i<pixels.length;i+=4){pixels[i]=128;pixels[i+2]=255;pixels[i+3]=255;}}
  };
  ctx.FRAG='shader prefix\n#define lowCover';
  ctx.document={createElement(){created++;return {getContext:()=>g};}};
  ctx.pendingProgram={};
  ctx.world={seedS:[1,2,3],plateN:0,plateP:[],plateW:[]};ctx.state={cont:0.4,sea:0.4,tect:0.5,isle:0.3,lake:0.4};
  assert.equal(ctx.riverLoopSampleSurface(4).pending,true);
  assert.equal(created,0,'do not start a second compiler during planet shader link');
  ctx.pendingProgram=null;
  assert.equal(ctx.riverLoopSampleSurface(4).pending,true);
  assert.equal(linkChecks,0,'completion must be checked before blocking LINK_STATUS');
  assert.equal(reads,0,'pending GPU data must not be classified');
  complete=true;const sample=ctx.riverLoopSampleSurface(4);
  assert.equal(reads,6);assert.equal(linkChecks,1);assert.equal(sample.water.length,96);
  assert.ok(sample.water.every(x=>x===1));
  assert.ok(sample.height.length===96&&sample.height.every(h=>Math.abs(h)<0.0001),'16-bit elevation decode');
}
// Regression: the first surface bake can return "pending" while the full
// shader links; a cubemap allocated at that point must be retried afterwards
// without spinning an expensive terrain rebuild every frame.
{
  const idle=[];
  let rebuilt=0;
  ctx.requestIdleCallback=fn=>{idle.push(fn);return idle.length;};
  ctx.riverLoopBuildMask=()=>{rebuilt++;return false;};
  vm.runInContext('riverLoopSupported=true;riverLoopReady=false;riverLoopSamplerFailed=false;riverLoopLastRetryMs=-1e12;',ctx);
  ctx.pendingProgram={};
  ctx.riverLoopMaybeRetry({N:32});
  assert.equal(idle.length,0,'cannot build a river atlas while planet shader is linking');
  ctx.pendingProgram=null;
  ctx.riverLoopMaybeRetry({N:32});
  ctx.riverLoopMaybeRetry({N:32});
  assert.equal(idle.length,1,'one idle rebuild rather than work every frame');
  idle.shift()();
  assert.equal(rebuilt,1,'the terrain sampling must resume after shader linking');
}

// A GPU may support WebGL2 yet reject an integer cubemap allocation.
// Detect that error and do not claim to have an empty-but-ready river atlas.
{
  let allocations=0,error=0;
  const g={MAX_TEXTURE_IMAGE_UNITS:1,TEXTURE0:2,TEXTURE_CUBE_MAP:3,
    TEXTURE_MIN_FILTER:4,TEXTURE_MAG_FILTER:5,TEXTURE_WRAP_S:6,
    TEXTURE_WRAP_T:7,TEXTURE_WRAP_R:8,NEAREST:9,CLAMP_TO_EDGE:10,
    RGBA32UI:11,RGBA_INTEGER:12,UNSIGNED_INT:13,
    TEXTURE_CUBE_MAP_POSITIVE_X:20,NO_ERROR:0,
    getParameter(){return 16;},getError(){return error;},
    createTexture(){return {};},deleteTexture(){},
    activeTexture(){},bindTexture(){},texParameteri(){},
    texImage2D(target,level,internal,w,h,border,format,type,pixels){
      assert.equal(internal,this.RGBA32UI);
      assert.equal(format,this.RGBA_INTEGER);
      assert.equal(type,this.UNSIGNED_INT);
      assert.equal(pixels,null);
      allocations++;
    }
  };
  ctx.gl=g;ctx.webglVersion=2;
  assert.equal(ctx.riverLoopEnsureTexture(12),true);
  assert.equal(allocations,6,'one integer cubemap must contain six faces');
  error=1280; // GL_INVALID_ENUM in fake driver
  assert.equal(ctx.riverLoopEnsureTexture(16),false);
  assert.equal(ctx.riverLoopMaybeRetry({N:16}),undefined);
  assert.equal(vm.runInContext('riverLoopSamplerFailed',ctx),true);
  assert.equal(vm.runInContext('riverLoopReady',ctx),false);
  assert.equal(vm.runInContext('riverLoopSupported',ctx),false);
}

console.log('river-loop-topology.test.js: OK');
