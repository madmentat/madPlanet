'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx={weatherCoreCreate(){},weatherCoreStep(){}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/river-gpu.js'),'utf8'),ctx);

function graph(n,edges,wet){
  const neighbors=Array.from({length:n},()=>[]),water=new Uint8Array(n);
  for(const [a,b] of edges){neighbors[a].push(b);neighbors[b].push(a);}
  for(const i of wet)water[i]=1;
  return {neighbors,water};
}
function check(g){
  const keep=ctx.riverLoopRootedForest(g.neighbors,g.water),seen=new Set();
  for(let i=0;i<keep.length;i++)if(keep[i]&&!seen.has(i)){
    const queue=[i];seen.add(i);let contacts=0,edges=0;
    for(const j of queue)for(const k of g.neighbors[j]){
      if(g.water[k])contacts++;
      else if(keep[k]){edges++;if(!seen.has(k)){seen.add(k);queue.push(k);}}
    }
    assert.equal(contacts,1,'every retained river must have exactly one water contact');
    assert.equal(edges/2,queue.length-1,'no retained river can flow into itself');
  }
  assert.deepEqual(ctx.riverLoopRootedForest(g.neighbors,g.water),keep,'deterministic mask');
  return keep;
}
assert.equal(check(graph(4,[[0,1],[1,2],[2,3],[3,0]],[])).reduce((a,b)=>a+b),0,'land loop removed');
assert.equal(check(graph(5,[[0,1],[1,2],[2,3],[3,1],[3,4]],[0])).reduce((a,b)=>a+b)>0,true,'loop with an outlet retains a river');
const coast=check(graph(7,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]],[0,6]));
assert.equal(coast[1],1);assert.equal(coast[5],1);assert.equal(coast[3],0,'coast-to-coast arc split inland');
check(graph(6,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]],[0])); // same sea/lake at both ends
assert.deepEqual(Array.from(check(graph(5,[[0,1],[1,2],[2,3],[2,4]],[0]))),[0,1,1,1,1],'valid tributaries survive');

// Actual spherical contour extraction must stitch face seams into degree-2
// curves. Several deterministic fields exercise ambiguous saddle cells too.
for(const seed of [[0,0,0],[17,31,43],[83,7,29]]){
  const N=20,d=[0,0,0],corners=[],water=new Uint8Array(6*N*N);
  for(let f=0;f<6;f++){
    const c=new Float32Array((N+1)*(N+1));corners.push(c);
    for(let y=0;y<=N;y++)for(let x=0;x<=N;x++){
      ctx.riverLoopFaceDir(f,x,y,N,d);
      c[y*(N+1)+x]=ctx.riverLoopScalar(...d,seed);
    }
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      ctx.riverLoopFaceDir(f,x+0.5,y+0.5,N,d);
      water[f*N*N+y*N+x]=Math.abs(d[1])>0.65?1:0;
    }
  }
  const g=ctx.riverLoopContourGraph(corners,water,N);
  assert.ok(g.neighbors.length>100);
  for(const list of g.neighbors)assert.equal(list.length,2,'closed sphere has no unmatched contour endpoints');
  check(g);
}
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
  assert.ok(sample.corners.every(face=>face.length===25&&Math.abs(face[0])<0.0001),'16-bit signed scalar decode');
}
console.log('river-loop-topology.test.js: OK');
