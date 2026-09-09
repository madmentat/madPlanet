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
console.log('river-loop-topology.test.js: OK');
