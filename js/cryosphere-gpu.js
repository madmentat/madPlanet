/* ============ 0.5.60 / 0.5.70: physical cryosphere -> GPU cubemap ============ */
/*
   One RGBA8 cubemap carries both temporal endpoints to remain WebGL1-safe:
   R/G = previous land-cryosphere / sea-ice coverage,
   B/A = current  land-cryosphere / sea-ice coverage.
   The shader blends them with uCryosphereBlend; no texture upload runs on FPS.

   0.5.70 keeps the physical Weather Core coverage continuous for albedo,
   latent heat and H2O closure, but stops displaying that fraction literally as
   translucent white fog. The render cubemap is a cheap 2x reconstruction of
   the coarse physical grid. Bilinear reconstruction plus a narrow, slightly
   irregular coverage threshold makes dense polar ice read as a solid sheet
   with a crisp natural edge instead of a blurred cloud. Physics is untouched.
*/

const CRYO_GPU_MODEL=2;
const CRYO_TEX_UNIT=7;
const CRYO_GPU_UPSCALE=2;
/* A nearly-one-second crossfade meant the ice edge was permanently in a
   translucent intermediate state because Weather Core publishes once/second.
   Keep enough interpolation to avoid popping, but let the edge spend most of
   each tick as an actual opaque boundary. */
const CRYO_BLEND_DEFAULT_MS=360;
const CRYO_BLEND_MIN_MS=120;
const CRYO_BLEND_MAX_MS=560;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uCryosphereTex','uCryosphereBlend'])if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}

let cryoGpuTex=null,cryoGpuN=0;
let cryoGpuFaces=[],cryoGpuPrevLand=[],cryoGpuPrevSea=[],cryoGpuCurrLand=[],cryoGpuCurrSea=[];
let cryoGpuLastSeed=NaN,cryoGpuHasFrame=false,cryoGpuBlendStartMs=0,cryoGpuBlendDurationMs=1,cryoGpuLastUploadMs=NaN,cryoGpuUploads=0;
function cryoGpuNowMs(){return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')?performance.now():Date.now();}
function cryoGpuByte(x){x=Math.max(0,Math.min(1,Number(x)||0));return Math.max(0,Math.min(255,Math.round(x*255)));}
function cryoGpuFaceTarget(face){return gl.TEXTURE_CUBE_MAP_POSITIVE_X+face;}
function cryoGpuDisplayResolution(coreN){return Math.max(8,Math.round((Number(coreN)||32)*CRYO_GPU_UPSCALE));}
function cryoGpuSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);
}
function cryoGpuBlendAt(nowMs){
  if(!cryoGpuHasFrame)return 1;
  const t=Math.max(0,Math.min(1,(Number(nowMs)-cryoGpuBlendStartMs)/Math.max(1,cryoGpuBlendDurationMs)));
  return t*t*(3-2*t);
}
function cryoGpuEnsure(N){
  N=Math.max(4,Math.round(Number(N)||32));
  if(cryoGpuTex&&cryoGpuN===N)return;
  if(cryoGpuTex)gl.deleteTexture(cryoGpuTex);
  cryoGpuN=N;cryoGpuFaces=Array.from({length:6},()=>new Uint8Array(N*N*4));
  cryoGpuPrevLand=Array.from({length:6},()=>new Float32Array(N*N));
  cryoGpuPrevSea=Array.from({length:6},()=>new Float32Array(N*N));
  cryoGpuCurrLand=Array.from({length:6},()=>new Float32Array(N*N));
  cryoGpuCurrSea=Array.from({length:6},()=>new Float32Array(N*N));
  cryoGpuTex=gl.createTexture();gl.activeTexture(gl.TEXTURE0+CRYO_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,cryoGpuTex);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(webglVersion>=2)gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  for(let f=0;f<6;f++)gl.texImage2D(cryoGpuFaceTarget(f),0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);gl.activeTexture(gl.TEXTURE0);cryoGpuHasFrame=false;cryoGpuLastSeed=NaN;
}
function cryoGpuSourceLand(core,face,x,y){
  const N=core.N,base=face*N*N,i=base+y*N+x;
  return Math.max(Number(core.snowCoverFraction?.[i])||0,Number(core.landIceCoverFraction?.[i])||0);
}
function cryoGpuSourceSea(core,face,x,y){
  const N=core.N,base=face*N*N,i=base+y*N+x;
  return Math.max(0,Math.min(1,Number(core.seaIceConcentration?.[i])||0));
}
function cryoGpuBilerp(core,face,fx,fy,sea){
  const N=core.N;
  const x0=Math.max(0,Math.min(N-1,Math.floor(fx))),y0=Math.max(0,Math.min(N-1,Math.floor(fy)));
  const x1=Math.max(0,Math.min(N-1,x0+1)),y1=Math.max(0,Math.min(N-1,y0+1));
  const tx=Math.max(0,Math.min(1,fx-x0)),ty=Math.max(0,Math.min(1,fy-y0));
  const sample=sea?cryoGpuSourceSea:cryoGpuSourceLand;
  const a=sample(core,face,x0,y0),b=sample(core,face,x1,y0),c=sample(core,face,x0,y1),d=sample(core,face,x1,y1);
  const ab=a+(b-a)*tx,cd=c+(d-c)*tx;return ab+(cd-ab)*ty;
}
/* A broad seamless perturbation breaks the visible contour without inventing
   any new ice. It only moves the threshold inside cells where physical
   coverage is already transitional. Using the spherical direction avoids cube
   face seams and avoids the square vegetation problem in another disguise. */
function cryoGpuEdgeNoise(seed,face,x,y,N){
  if(typeof weatherFaceDir!=='function')return 0.5;
  const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=weatherFaceDir(face,u,v);
  const p=(seed|0)*0.000137;
  const a=Math.sin(d[0]*14.3+d[1]*11.7+d[2]*17.9+p);
  const b=Math.sin(d[0]*31.1-d[1]*23.7+d[2]*19.3-p*1.71);
  return Math.max(0,Math.min(1,0.5+0.27*a+0.13*b));
}
function cryoGpuVisualCoverage(raw,edgeNoise,sea){
  raw=Math.max(0,Math.min(1,Number(raw)||0));
  if(raw<=0.015)return 0;
  if(raw>=0.82)return 1;
  const shift=(edgeNoise-0.5)*(sea?0.11:0.13);
  const lo=(sea?0.16:0.18)+shift,hi=(sea?0.48:0.46)+shift;
  return cryoGpuSmooth(lo,hi,raw);
}
function cryoGpuReadCurrent(core){
  const srcN=core.N,N=cryoGpuN,scale=N/srcN,seed=core.seed|0;
  for(let face=0;face<6;face++){
    const land=cryoGpuCurrLand[face],sea=cryoGpuCurrSea[face];
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      const fx=(x+0.5)/scale-0.5,fy=(y+0.5)/scale-0.5;
      const rawLand=cryoGpuBilerp(core,face,fx,fy,false),rawSea=cryoGpuBilerp(core,face,fx,fy,true);
      const needsNoise=(rawLand>0.03&&rawLand<0.78)||(rawSea>0.03&&rawSea<0.78);
      const edge=needsNoise?cryoGpuEdgeNoise(seed,face,x,y,N):0.5;
      const dst=(N-1-y)*N+x;
      land[dst]=cryoGpuVisualCoverage(rawLand,edge,false);
      sea[dst]=cryoGpuVisualCoverage(rawSea,edge,true);
    }
  }
}
function cryoGpuCollapseVisible(blend){
  blend=Math.max(0,Math.min(1,Number(blend)||0));
  for(let f=0;f<6;f++){
    const pl=cryoGpuPrevLand[f],ps=cryoGpuPrevSea[f],cl=cryoGpuCurrLand[f],cs=cryoGpuCurrSea[f];
    for(let i=0;i<pl.length;i++){pl[i]+= (cl[i]-pl[i])*blend;ps[i]+=(cs[i]-ps[i])*blend;}
  }
}
function cryoGpuPackAndUpload(){
  const N=cryoGpuN;gl.activeTexture(gl.TEXTURE0+CRYO_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,cryoGpuTex);
  for(let f=0;f<6;f++){
    const pix=cryoGpuFaces[f],pl=cryoGpuPrevLand[f],ps=cryoGpuPrevSea[f],cl=cryoGpuCurrLand[f],cs=cryoGpuCurrSea[f];
    for(let i=0;i<pl.length;i++){const p=i*4;pix[p]=cryoGpuByte(pl[i]);pix[p+1]=cryoGpuByte(ps[i]);pix[p+2]=cryoGpuByte(cl[i]);pix[p+3]=cryoGpuByte(cs[i]);}
    gl.texSubImage2D(cryoGpuFaceTarget(f),0,0,0,N,N,gl.RGBA,gl.UNSIGNED_BYTE,pix);
  }
  gl.activeTexture(gl.TEXTURE0);
}
function cryoGpuUpload(core){
  if(!core?.N||!core?.surfaceCryoFraction)return false;
  cryoGpuEnsure(cryoGpuDisplayResolution(core.N));const now=cryoGpuNowMs(),seed=core.seed|0;
  const seedChanged=Number.isFinite(cryoGpuLastSeed)&&cryoGpuLastSeed!==seed;
  if(!cryoGpuHasFrame||seedChanged){
    cryoGpuReadCurrent(core);
    for(let f=0;f<6;f++){cryoGpuPrevLand[f].set(cryoGpuCurrLand[f]);cryoGpuPrevSea[f].set(cryoGpuCurrSea[f]);}
    cryoGpuBlendStartMs=now;cryoGpuBlendDurationMs=1;cryoGpuHasFrame=true;
  }else{
    cryoGpuCollapseVisible(cryoGpuBlendAt(now));cryoGpuReadCurrent(core);
    const interval=Number.isFinite(cryoGpuLastUploadMs)?Math.max(1,now-cryoGpuLastUploadMs):CRYO_BLEND_DEFAULT_MS;
    cryoGpuBlendDurationMs=Math.max(CRYO_BLEND_MIN_MS,Math.min(CRYO_BLEND_MAX_MS,interval*0.36));cryoGpuBlendStartMs=now;
  }
  cryoGpuPackAndUpload();cryoGpuLastUploadMs=now;cryoGpuLastSeed=seed;cryoGpuUploads++;
  core.cryoGpuModel=CRYO_GPU_MODEL;core.cryoGpuUploads=cryoGpuUploads;return true;
}
const weatherCoreCreateBeforeCryoGpu=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){const core=weatherCoreCreateBeforeCryoGpu(seed,N,climate,axis);cryoGpuUpload(core);return core;};
const weatherCoreStepBeforeCryoGpu=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){weatherCoreStepBeforeCryoGpu(core,dtSec,climate,axis);cryoGpuUpload(core);return core;};
function cryoGpuEnsureCurrent(){
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;if(!core)return null;
  if(!cryoGpuTex||cryoGpuN!==cryoGpuDisplayResolution(core.N)||cryoGpuLastSeed!==(core.seed|0))cryoGpuUpload(core);return core;
}
