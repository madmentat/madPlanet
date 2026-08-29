/* ============ 0.5.60: physical cryosphere -> GPU cubemap ============ */
/*
   One RGBA8 cubemap carries both temporal endpoints to remain WebGL1-safe:
   R/G = previous land-cryosphere / sea-ice coverage,
   B/A = current  land-cryosphere / sea-ice coverage.
   The shader blends them with uCryosphereBlend; no texture upload runs on FPS.
*/

const CRYO_GPU_MODEL=1;
const CRYO_TEX_UNIT=7;
const CRYO_BLEND_DEFAULT_MS=950;
const CRYO_BLEND_MIN_MS=250;
const CRYO_BLEND_MAX_MS=1200;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uCryosphereTex','uCryosphereBlend'])if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}

let cryoGpuTex=null,cryoGpuN=0;
let cryoGpuFaces=[],cryoGpuPrevLand=[],cryoGpuPrevSea=[],cryoGpuCurrLand=[],cryoGpuCurrSea=[];
let cryoGpuLastSeed=NaN,cryoGpuHasFrame=false,cryoGpuBlendStartMs=0,cryoGpuBlendDurationMs=1,cryoGpuLastUploadMs=NaN,cryoGpuUploads=0;
function cryoGpuNowMs(){return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')?performance.now():Date.now();}
function cryoGpuByte(x){x=Math.max(0,Math.min(1,Number(x)||0));return Math.max(0,Math.min(255,Math.round(x*255)));}
function cryoGpuFaceTarget(face){return gl.TEXTURE_CUBE_MAP_POSITIVE_X+face;}
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
function cryoGpuReadCurrent(core){
  const N=core.N;
  for(let face=0;face<6;face++){
    const base=face*N*N,land=cryoGpuCurrLand[face],sea=cryoGpuCurrSea[face];
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      const src=base+y*N+x,dst=(N-1-y)*N+x;
      const l=Math.max(Number(core.snowCoverFraction?.[src])||0,Number(core.landIceCoverFraction?.[src])||0);
      land[dst]=Math.max(0,Math.min(1,l));sea[dst]=Math.max(0,Math.min(1,Number(core.seaIceConcentration?.[src])||0));
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
  cryoGpuEnsure(core.N);const now=cryoGpuNowMs(),seed=core.seed|0;
  const seedChanged=Number.isFinite(cryoGpuLastSeed)&&cryoGpuLastSeed!==seed;
  if(!cryoGpuHasFrame||seedChanged){
    cryoGpuReadCurrent(core);
    for(let f=0;f<6;f++){cryoGpuPrevLand[f].set(cryoGpuCurrLand[f]);cryoGpuPrevSea[f].set(cryoGpuCurrSea[f]);}
    cryoGpuBlendStartMs=now;cryoGpuBlendDurationMs=1;cryoGpuHasFrame=true;
  }else{
    cryoGpuCollapseVisible(cryoGpuBlendAt(now));cryoGpuReadCurrent(core);
    const interval=Number.isFinite(cryoGpuLastUploadMs)?Math.max(1,now-cryoGpuLastUploadMs):CRYO_BLEND_DEFAULT_MS;
    cryoGpuBlendDurationMs=Math.max(CRYO_BLEND_MIN_MS,Math.min(CRYO_BLEND_MAX_MS,interval*0.92));cryoGpuBlendStartMs=now;
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
  if(!cryoGpuTex||cryoGpuN!==core.N||cryoGpuLastSeed!==(core.seed|0))cryoGpuUpload(core);return core;
}
