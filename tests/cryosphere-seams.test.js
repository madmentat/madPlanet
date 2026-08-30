const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/cryosphere-gpu.js'),'utf8');

assert.match(src,/function cryoGpuDirToIndex\(/,'cryosphere renderer needs a canonical direction -> cube-cell inverse');
assert.match(src,/function cryoGpuProjectedSample\(/,'edge taps need direction-based projected sampling');
assert.match(src,/const x0=Math\.floor\(fx\),y0=Math\.floor\(fy\),x1=x0\+1,y1=y0\+1/,
  'bilinear corners must be allowed to leave the current face');
const bilerp=src.slice(src.indexOf('function cryoGpuBilerp'),src.indexOf('/* Seamless, seed-stable multi-scale perturbation'));
assert.doesNotMatch(bilerp,/Math\.max\(0,Math\.min\(N-1/,
  'bilerp must not clamp source corners to the current cube face');
assert.equal((bilerp.match(/cryoGpuProjectedSample/g)||[]).length,4,
  'all four bilinear taps must use seam-aware projected sampling');

function norm3(x,y,z){const q=Math.hypot(x,y,z)||1;return [x/q,y/q,z/q];}
function weatherFaceDir(face,u,v){
  if(face===0)return norm3( 1,v,-u);
  if(face===1)return norm3(-1,v, u);
  if(face===2)return norm3( u,1,-v);
  if(face===3)return norm3( u,-1,v);
  if(face===4)return norm3( u,v,1);
  return norm3(-u,v,-1);
}
const ctx={
  console,Math,Number,Date,Array,Float32Array,Uint8Array,
  performance:{now:()=>0},UNIFORM_NAMES:[],weatherFaceDir,
  weatherCoreCreate:()=>({}),weatherCoreStep:core=>core,
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'cryosphere-gpu.js'});

const N=8,count=6*N*N;
const core={N,count,seed:123,surfaceCryoFraction:new Float32Array(count),
  snowCoverFraction:new Float32Array(count),landIceCoverFraction:new Float32Array(count),
  seaIceConcentration:new Float32Array(count)};
let i=0;
for(let face=0;face<6;face++)for(let y=0;y<N;y++)for(let x=0;x<N;x++,i++){
  const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=weatherFaceDir(face,u,v);
  const value=Math.max(0,Math.min(1,0.48+0.21*d[0]+0.13*d[1]-0.11*d[2]));
  core.snowCoverFraction[i]=value;core.seaIceConcentration[i]=value;
}

/* Every off-face corner direction must land on the physically adjacent cube
   face instead of repeating the border cell of its origin face. Use edge
   midpoints rather than corners so the dominant face is unambiguous. */
const mid=Math.floor(N/2);
for(let face=0;face<6;face++){
  for(const [x,y] of [[-1,mid],[N,mid],[mid,-1],[mid,N]]){
    const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=weatherFaceDir(face,u,v);
    const idx=ctx.cryoGpuDirToIndex(core,d[0],d[1],d[2]);
    const mappedFace=Math.floor(idx/(N*N));
    assert.notEqual(mappedFace,face,`off-face tap ${face}:${x},${y} must cross onto an adjacent face`);
    assert.equal(ctx.cryoGpuProjectedSample(core,face,x,y,false),core.snowCoverFraction[idx],
      'projected land tap must read the adjacent canonical Weather Core cell');
  }
}

/* A bilinear sample just inside an edge must blend one neighbour-face corner
   with one current-face corner. This is the exact case that used to produce
   the long dark/bright great-circle seam in the rendered polar cap. */
const fx=-0.25,fy=mid-0.37,x0=Math.floor(fx),y0=Math.floor(fy),x1=x0+1,y1=y0+1;
const tx=fx-x0,ty=fy-y0;
const a=ctx.cryoGpuProjectedSample(core,0,x0,y0,false),b=ctx.cryoGpuProjectedSample(core,0,x1,y0,false);
const c=ctx.cryoGpuProjectedSample(core,0,x0,y1,false),d=ctx.cryoGpuProjectedSample(core,0,x1,y1,false);
const expected=(a+(b-a)*tx)+((c+(d-c)*tx)-(a+(b-a)*tx))*ty;
const actual=ctx.cryoGpuBilerp(core,0,fx,fy,false);
assert.ok(Math.abs(actual-expected)<1e-12,'seam-aware bilerp must preserve the four projected taps exactly');

console.log('cryosphere-seams.test.js: OK');
