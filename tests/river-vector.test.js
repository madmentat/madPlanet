'use strict';
/* 0.5.157: analytic vector rivers. The spline painter must publish the same
   displaced Catmull path as short chords with a strength-sorted bin index,
   the worker must transfer that table, and the shader must draw it only on
   the WebGL2 path while the raster corridor stays the fallback. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const gpu=read('js/river-gpu.js');
const render=read('js/river-render.js');
const worker=read('js/weather-worker.js');
const shader=read('shaders/surface.glsl');
const header=read('shaders/header.glsl');

assert.match(gpu,/RIVER_GPU_MODEL=17/,'vector river display model must be active');
assert.match(gpu,/riverVecReset\(\);\s*riverGpuPaintVisualBranches/,'chord collection must start before any painter runs');
assert.match(gpu,/riverGpuPaintEdge\(core,i,j,up,tmp\);\s*\}\s*riverVecFinish\(\);/,'chord index must be built after the last edge');
assert.match(gpu,/if\(riverVecCollectOn&&vHave\)riverVecPush\(vx,vy,vz,dx,dy,dz/,'a mouth chord must reach the first ocean sample');
assert.match(gpu,/sub\.sort\(\(p,r\)=>g\[r\*8\+3\]-g\[p\*8\+3\]\)/,'bin lists must be strength-sorted so a capped loop keeps trunks');
assert.match(gpu,/riverGpuPackUpload\(\);riverGpuVectorUpload\(\);/,'chord textures must publish with the corridor');
assert.match(gpu,/webglVersion>=2/,'chord textures are WebGL2-only');
assert.ok(!gpu.includes('requestAnimationFrame'),'chord table must not be rebuilt from render FPS');
assert.match(render,/riverGpuVectorBind\(prog,U\)/,'renderer must bind the chord tables every frame');
assert.match(worker,/riverGpuVectorData\(\)/,'worker must snapshot the chord table');
assert.match(worker,/seg:vec\.seg,bins:vec\.bins,list:vec\.list,chords:vec\.chords/,'worker must transfer chord table buffers');
assert.match(worker,/riverGpuVectorSet\(m\.river\.vec\)/,'main thread must adopt the transferred chord table');
for(const u of ['uRiverBinTex','uRiverListTex'])
  assert.match(header,new RegExp('uniform highp sampler2D '+u+';'),'vector river data sampler '+u+' must be highp (fp16 samplers snap chords on mobile GPUs)');
for(const u of ['uRiverVecOn','uRiverBinN','uRiverTexW'])assert.ok(header.includes(u),'missing vector river uniform '+u);
assert.doesNotMatch(header,/uRiverSegTex/,'the indirect chord index texture is retired');
assert.match(shader,/#if __VERSION__ >= 300\s*vec4 riverVecFetch/,'chord fetch must be compiled only for GLSL ES 3.00');
assert.match(shader,/vec3 riverVectorNearest\(vec3 p, float stopInside\)/,'nearest-chord distance field missing');
assert.match(shader,/vec4 A = riverVecFetch\(uRiverListTex, base \+ float\(2\*k\)\);/,'chords must be read directly from the de-indexed list');
assert.match(shader,/float score = d - B\.w;/,'nearest chord must be measured to the bank so trunks own confluences');
assert.match(shader,/textureLod\(uRiverTex, normalize\(sN\), 2\.0\)/,'the corridor mip must gate the chord loop');
assert.match(shader,/riverGeom = mix\(riverGeom, vecCov, vecOn\);/,'vector coverage must replace the FBM crack when available');
assert.match(shader,/riverCoverage = mix\(riverCoverage, 1\.0, vecOn\);/,'vector channels carry their own pixel coverage');
assert.match(shader,/float hwEff = max\(hw, 0\.60\*pixAng\);/,'a sub-pixel channel must keep a hairline');
assert.match(shader,/float warpAmp = 0\.0034\*ss\(0\.003, 0\.028, h\);/,'sub-grid meander warp must fade at the coast');
assert.match(shader,/riverHydroTex\s*=\s*texture\(uRiverTex, normalize\(sN\)\)/,'the raster corridor stays unwarped');

/* Numeric behaviour on a synthetic three-cell chain. */
const ctx={console,Math,Number,Date,Array,Map,Set,Float32Array,Float64Array,Int32Array,Int16Array,Uint8Array,
  UNIFORM_NAMES:[],weatherCoreCreate:()=>({count:1}),weatherCoreStep:c=>c};
vm.createContext(ctx);vm.runInContext(gpu,ctx,{filename:'river-gpu.js'});
ctx.riverIsOcean=(core,i)=>core.surfaceWaterFraction[i]>=0.5;
ctx.gl={TEXTURE_CUBE_MAP:1,TEXTURE_CUBE_MAP_POSITIVE_X:10,TEXTURE0:20,RGBA:30,UNSIGNED_BYTE:40,
  TEXTURE_MIN_FILTER:50,TEXTURE_MAG_FILTER:51,TEXTURE_WRAP_S:52,TEXTURE_WRAP_T:53,TEXTURE_WRAP_R:54,
  LINEAR:60,LINEAR_MIPMAP_LINEAR:61,CLAMP_TO_EDGE:62,
  createTexture:()=>({}),deleteTexture:()=>{},activeTexture:()=>{},bindTexture:()=>{},
  texParameteri:()=>{},texImage2D:()=>{},texSubImage2D:()=>{},generateMipmap:()=>{}};
ctx.webglVersion=1;
function chain(n){
  const c={count:n,N:8,seed:11,dirX:new Float32Array(n),dirY:new Float32Array(n),dirZ:new Float32Array(n),
    surfaceWaterFraction:new Float32Array(n),riverDownstream:new Int32Array(n),riverChannelStrength:new Float32Array(n),
    riverWidthM:new Float32Array(n),riverLakeFraction:new Float32Array(n),riverVisualBranches:[]};
  for(let i=0;i<n;i++){
    const a=0.2+i*0.06;c.dirX[i]=Math.cos(a);c.dirY[i]=0.1;c.dirZ[i]=Math.sin(a);
    const q=Math.hypot(c.dirX[i],c.dirY[i],c.dirZ[i]);c.dirX[i]/=q;c.dirY[i]/=q;c.dirZ[i]/=q;
    c.riverDownstream[i]=i<n-1?i+1:-1;c.riverChannelStrength[i]=0.2+0.3*i;c.riverWidthM[i]=50+400*i;
  }
  c.surfaceWaterFraction[n-1]=1;c.riverChannelStrength[n-1]=0;
  return c;
}
const core=chain(4);
ctx.riverGpuEnsure(64);
ctx.riverGpuReadCurrent(core);
const g=expr=>vm.runInContext(expr,ctx);
const count=g('riverVecCount'),seg=g('riverVecSegments');
assert.ok(count>=12,'three graph edges must yield several chords each, got '+count);
for(let i=0;i<count;i++){
  const o=i*8;
  assert.ok(Math.abs(Math.hypot(seg[o],seg[o+1],seg[o+2])-1)<1e-5,'chord start must lie on the unit sphere');
  assert.ok(Math.abs(Math.hypot(seg[o+4],seg[o+5],seg[o+6])-1)<1e-5,'chord end must lie on the unit sphere');
  const len=Math.hypot(seg[o]-seg[o+4],seg[o+1]-seg[o+5],seg[o+2]-seg[o+6]);
  assert.ok(len>0&&len<0.06,'chords must be short great-circle pieces, got '+len);
  assert.ok(seg[o+7]>0&&seg[o+7]<0.006,'half-width must stay a thin line, got '+seg[o+7]);
}
let joins=0;
for(let i=1;i<count;i++){
  const p=(i-1)*8,o=i*8;
  if(Math.abs(seg[p+4]-seg[o])<1e-9&&Math.abs(seg[p+5]-seg[o+1])<1e-9&&Math.abs(seg[p+6]-seg[o+2])<1e-9)joins++;
}
assert.ok(joins>=count-4,'consecutive chords of one path must share endpoints exactly, joins='+joins+' of '+count);
const mouth=seg.subarray((count-1)*8,count*8);
const sea=core.dirX[3]*mouth[4]+core.dirY[3]*mouth[5]+core.dirZ[3]*mouth[6];
assert.ok(sea>Math.cos(0.065),'the last chord must end at the ocean cell rather than one node earlier');
assert.ok(ctx.riverVecHalfWidthRad(0.9,3000,false)>ctx.riverVecHalfWidthRad(0.2,50,false),'wider stronger trunks must draw wider');
assert.ok(ctx.riverVecHalfWidthRad(0.3,0,true)<ctx.riverVecHalfWidthRad(0.3,0,false),'visual feeders must stay narrower than trunks');

/* Every chord must be listed in the bin that contains its midpoint, and each
   list must be sorted by descending strength. */
const B=g('RIVER_VEC_BIN_N'),bins=g('riverVecBins'),list=g('riverVecList');
for(let i=0;i<count;i++){
  const o=i*8,b=ctx.riverVecBinOf(0.5*(seg[o]+seg[o+4]),0.5*(seg[o+1]+seg[o+5]),0.5*(seg[o+2]+seg[o+6]));
  const start=bins[2*b],n=bins[2*b+1];let found=false;
  for(let k=0;k<n;k++)if(list[start+k]===i)found=true;
  assert.ok(found,'chord '+i+' missing from its own bin');
}
for(let b=0;b<6*B*B;b++){
  const start=bins[2*b],n=bins[2*b+1];
  for(let k=1;k<n;k++)assert.ok(seg[list[start+k-1]*8+3]>=seg[list[start+k]*8+3],'bin lists must be strength-sorted');
}
const chords=g('riverVecListChords');
for(let k=0;k<g('riverVecListCount');k++)for(let c=0;c<8;c++)assert.equal(chords[k*8+c],seg[list[k]*8+c],'de-indexed list entry must equal its chord record');
const data=ctx.riverGpuVectorData();
assert.equal(data.count,count);assert.equal(data.transfer.length,4,'four buffers must be transferable');
ctx.riverGpuVectorSet({count:data.count,binN:data.binN,seg:data.seg,bins:data.bins,list:data.list,chords:data.chords,listCount:data.listCount});
assert.equal(g('riverVecCount'),count,'main thread must adopt the transferred chord count');
assert.equal(ctx.riverGpuVectorUpload(),false,'WebGL1 must never upload chord textures');
const U={uRiverVecOn:{}};const calls=[];ctx.gl.uniform1f=(loc,v)=>calls.push([loc,v]);
ctx.riverGpuVectorBind({},U);
assert.ok(calls.some(c=>c[0]===U.uRiverVecOn&&c[1]===0),'WebGL1 must switch the shader to the raster fallback');

console.log('river-vector.test.js: OK');
