/* ============ 0.5.56 / 0.5.66: physical fog + surface state -> GPU cubemaps ============ */
/*
   Double-buffered RGBA8 cubemaps mirror low-resolution Weather Core state.
   R = fog optical depth, G = normalized fog depth.

   0.5.66 repurposes the previously renderer-unused B/A diagnostic channels:
   B = physical soil wetness (soilMoisture / soilCapacity, ocean=1),
   A = Weather Core surface temperature mapped from 180..380 K to 0..1.
   CPU fog formation/dissipation diagnostics remain available in their arrays;
   they simply no longer consume scarce WebGL1 texture channels. This gives the
   surface shader dynamic drought/freeze context without allocating a ninth
   fragment texture unit on implementations that expose only the WebGL1 minimum.

   Fixed ticks publish targets; render interpolates previous -> current
   continuously so fog and biome-state colours cannot jump at weather cadence.
*/

const FOG_GPU_MODEL=2;
const FOG_TEX_UNIT=5;
const FOG_TEX_PREV_UNIT=6;
const FOG_BLEND_DEFAULT_MS=900;
const FOG_BLEND_MIN_MS=250;
const FOG_BLEND_MAX_MS=1200;
const SURFACE_TEMP_GPU_MIN_K=180;
const SURFACE_TEMP_GPU_MAX_K=380;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uFogTex','uFogTexPrev','uFogBlend'])if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}

let fogGpuTex=null,fogGpuTexPrev=null,fogGpuN=0;
let fogGpuFaces=[],fogGpuPrevFaces=[];
let fogGpuLastTick=-1,fogGpuLastSeed=NaN,fogGpuHasFrame=false;
let fogGpuBlendStartMs=0,fogGpuBlendDurationMs=1,fogGpuLastUploadMs=NaN,fogGpuUploadCount=0;

function fogGpuNowMs(){
  return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')?performance.now():Date.now();
}
function fogGpuByte01(x){x=Math.max(0,Math.min(1,Number(x)||0));return Math.max(0,Math.min(255,Math.round(x*255)));}
function fogGpuFaceTarget(face){return gl.TEXTURE_CUBE_MAP_POSITIVE_X+face;}
function fogGpuBlendAt(nowMs){
  if(!fogGpuHasFrame)return 1;
  const t=Math.max(0,Math.min(1,(Number(nowMs)-fogGpuBlendStartMs)/Math.max(1,fogGpuBlendDurationMs)));
  return t*t*(3-2*t);
}
function fogGpuAllocTexture(unit,N){
  const tex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_CUBE_MAP,tex);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(webglVersion>=2)gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  for(let face=0;face<6;face++)gl.texImage2D(fogGpuFaceTarget(face),0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  return tex;
}
function fogGpuEnsure(N){
  N=Math.max(4,Math.round(Number(N)||32));
  if(fogGpuTex&&fogGpuTexPrev&&fogGpuN===N)return;
  if(fogGpuTex)gl.deleteTexture(fogGpuTex);if(fogGpuTexPrev)gl.deleteTexture(fogGpuTexPrev);
  fogGpuN=N;fogGpuFaces=Array.from({length:6},()=>new Uint8Array(N*N*4));
  fogGpuPrevFaces=Array.from({length:6},()=>new Uint8Array(N*N*4));
  fogGpuTex=fogGpuAllocTexture(FOG_TEX_UNIT,N);fogGpuTexPrev=fogGpuAllocTexture(FOG_TEX_PREV_UNIT,N);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);gl.activeTexture(gl.TEXTURE0);
  fogGpuHasFrame=false;fogGpuLastSeed=NaN;fogGpuLastUploadMs=NaN;
}
function fogGpuSoilWetness(core,i){
  const water=Math.max(0,Math.min(1,Number(core.surfaceWaterFraction?.[i])||0));
  if(water>0.5)return 1;
  const cap=Math.max(0,Number(core.soilCapacity?.[i])||0);
  if(!(cap>1e-6))return 0;
  return Math.max(0,Math.min(1,(Number(core.soilMoisture?.[i])||0)/cap));
}
function fogGpuSurfaceTemp01(core,i){
  const T=Number(core.surfaceTemp?.[i]);
  const k=Number.isFinite(T)?T:273.15;
  return Math.max(0,Math.min(1,(k-SURFACE_TEMP_GPU_MIN_K)/(SURFACE_TEMP_GPU_MAX_K-SURFACE_TEMP_GPU_MIN_K)));
}
function fogGpuPackFace(core,face){
  const N=core.N,pix=fogGpuFaces[face],base=face*N*N;
  for(let y=0;y<N;y++){
    const dstY=N-1-y;
    for(let x=0;x<N;x++){
      const src=base+y*N+x,dst=(dstY*N+x)*4;
      pix[dst]=fogGpuByte01(core.fogOpticalDepth?.[src]);
      pix[dst+1]=fogGpuByte01((Number(core.fogDepthM?.[src])||0)/900);
      pix[dst+2]=fogGpuByte01(fogGpuSoilWetness(core,src));
      pix[dst+3]=fogGpuByte01(fogGpuSurfaceTemp01(core,src));
    }
  }
  return pix;
}
function fogGpuCollapseVisible(blend){
  blend=Math.max(0,Math.min(1,Number(blend)||0));
  for(let face=0;face<6;face++){
    const prev=fogGpuPrevFaces[face],curr=fogGpuFaces[face];
    for(let i=0;i<curr.length;i++)prev[i]=Math.round(prev[i]+(curr[i]-prev[i])*blend);
  }
}
function fogGpuUploadFaces(tex,unit,faces,N){
  gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_CUBE_MAP,tex);
  for(let face=0;face<6;face++)gl.texSubImage2D(fogGpuFaceTarget(face),0,0,0,N,N,gl.RGBA,gl.UNSIGNED_BYTE,faces[face]);
}
function fogGpuUpload(core){
  if(!core?.N||!core?.count||!core.fogOpticalDepth)return false;
  fogGpuEnsure(core.N);
  const now=fogGpuNowMs(),seed=core.seed|0;
  const seedChanged=Number.isFinite(fogGpuLastSeed)&&fogGpuLastSeed!==seed;
  if(!fogGpuHasFrame||seedChanged){
    for(let face=0;face<6;face++){const curr=fogGpuPackFace(core,face);fogGpuPrevFaces[face].set(curr);}
    fogGpuUploadFaces(fogGpuTexPrev,FOG_TEX_PREV_UNIT,fogGpuPrevFaces,core.N);
    fogGpuUploadFaces(fogGpuTex,FOG_TEX_UNIT,fogGpuFaces,core.N);
    fogGpuBlendStartMs=now;fogGpuBlendDurationMs=1;fogGpuHasFrame=true;
  }else{
    fogGpuCollapseVisible(fogGpuBlendAt(now));
    fogGpuUploadFaces(fogGpuTexPrev,FOG_TEX_PREV_UNIT,fogGpuPrevFaces,core.N);
    for(let face=0;face<6;face++)fogGpuPackFace(core,face);
    fogGpuUploadFaces(fogGpuTex,FOG_TEX_UNIT,fogGpuFaces,core.N);
    const interval=Number.isFinite(fogGpuLastUploadMs)?Math.max(1,now-fogGpuLastUploadMs):FOG_BLEND_DEFAULT_MS;
    fogGpuBlendDurationMs=Math.max(FOG_BLEND_MIN_MS,Math.min(FOG_BLEND_MAX_MS,interval*0.92));
    fogGpuBlendStartMs=now;
  }
  gl.activeTexture(gl.TEXTURE0);fogGpuLastUploadMs=now;fogGpuLastTick=core.ticks|0;fogGpuLastSeed=seed;fogGpuUploadCount++;
  core.fogGpuModel=FOG_GPU_MODEL;core.fogGpuUploads=fogGpuUploadCount;return true;
}

const weatherCoreCreateBeforeFogGpu=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeFogGpu(seed,N,climate,axis);fogGpuUpload(core);return core;
};
const weatherCoreStepBeforeFogGpu=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeFogGpu(core,dtSec,climate,axis);fogGpuUpload(core);return core;
};
function fogGpuEnsureCurrent(){
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
  if(!core)return null;
  if(!fogGpuTex||!fogGpuTexPrev||fogGpuN!==core.N||fogGpuLastSeed!==(core.seed|0))fogGpuUpload(core);
  return core;
}
