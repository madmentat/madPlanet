/* ============ 0.5.54: Weather Core -> GPU cloud influence cubemaps ============ */
/*
   Two RGBA8 cubemaps carry the inertial cloud influence field:
     R/G/B = signed low/mid/high growth/dispersal influence, -1..+1 encoded
             to 0..255 around neutral 127/128;
     A     = deep-convection state.

   Weather Core itself remains fixed-step. Every fixed tick publishes a new
   target cubemap, while the renderer blends previous -> current continuously
   until the next expected tick. Before accepting a new target, the CPU first
   collapses prev/current to the value that was actually visible at that exact
   instant. This preserves temporal continuity even with timer jitter.
*/

const WEATHER_CLOUD_GPU_MODEL=3;
const WEATHER_CLOUD_TEX_UNIT=3;
const WEATHER_CLOUD_TEX_PREV_UNIT=4;
const WEATHER_CLOUD_BLEND_DEFAULT_MS=900;
const WEATHER_CLOUD_BLEND_MIN_MS=250;
const WEATHER_CLOUD_BLEND_MAX_MS=1200;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uWeatherCloudTex','uWeatherCloudTexPrev','uWeatherCloudBlend'])
    if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}

let weatherCloudGpuTex=null;
let weatherCloudGpuTexPrev=null;
let weatherCloudGpuN=0;
let weatherCloudGpuFaces=[];
let weatherCloudGpuPrevFaces=[];
let weatherCloudGpuUploadCount=0;
let weatherCloudGpuLastTick=-1;
let weatherCloudGpuLastSeed=NaN;
let weatherCloudGpuHasFrame=false;
let weatherCloudGpuBlendStartMs=0;
let weatherCloudGpuBlendDurationMs=1;
let weatherCloudGpuLastUploadMs=NaN;

function weatherCloudNowMs(){
  return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')
    ?performance.now():Date.now();
}
function weatherCloudByte01(x){
  x=Math.max(0,Math.min(1,Number(x)||0));
  return Math.max(0,Math.min(255,Math.round(x*255)));
}
function weatherCloudSignedToByte(x){
  x=Math.max(-1,Math.min(1,Number(x)||0));
  return weatherCloudByte01(0.5+0.5*x);
}
function weatherCloudByteToSigned(b){
  return Math.max(-1,Math.min(1,(Math.max(0,Math.min(255,Number(b)||0))/255)*2-1));
}
function weatherCloudFaceTarget(face){return gl.TEXTURE_CUBE_MAP_POSITIVE_X+face;}
function weatherCloudGpuBlendAt(nowMs){
  if(!weatherCloudGpuHasFrame)return 1;
  const raw=Math.max(0,Math.min(1,(Number(nowMs)-weatherCloudGpuBlendStartMs)/Math.max(1,weatherCloudGpuBlendDurationMs)));
  return raw*raw*(3-2*raw);
}
function weatherCloudGpuAllocTexture(unit,N){
  const tex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE0+unit);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,tex);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(webglVersion>=2)gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  for(let face=0;face<6;face++)
    gl.texImage2D(weatherCloudFaceTarget(face),0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  return tex;
}
function weatherCloudGpuEnsure(N){
  N=Math.max(4,Math.round(Number(N)||32));
  if(weatherCloudGpuTex&&weatherCloudGpuTexPrev&&weatherCloudGpuN===N)return;
  if(weatherCloudGpuTex)gl.deleteTexture(weatherCloudGpuTex);
  if(weatherCloudGpuTexPrev)gl.deleteTexture(weatherCloudGpuTexPrev);
  weatherCloudGpuN=N;
  weatherCloudGpuFaces=Array.from({length:6},()=>new Uint8Array(N*N*4));
  weatherCloudGpuPrevFaces=Array.from({length:6},()=>new Uint8Array(N*N*4));
  weatherCloudGpuTex=weatherCloudGpuAllocTexture(WEATHER_CLOUD_TEX_UNIT,N);
  weatherCloudGpuTexPrev=weatherCloudGpuAllocTexture(WEATHER_CLOUD_TEX_PREV_UNIT,N);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);
  gl.activeTexture(gl.TEXTURE0);
  weatherCloudGpuHasFrame=false;
  weatherCloudGpuLastSeed=NaN;
  weatherCloudGpuLastUploadMs=NaN;
}
function weatherCloudGpuPackFace(core,face){
  const N=core.N,pix=weatherCloudGpuFaces[face],base=face*N*N;
  const low=core.cloudVisualLow,mid=core.cloudVisualMid,high=core.cloudVisualHigh,deep=core.deepConvectiveState;
  for(let y=0;y<N;y++){
    const dstY=N-1-y;
    for(let x=0;x<N;x++){
      const src=base+y*N+x,dst=(dstY*N+x)*4;
      pix[dst]=weatherCloudSignedToByte(low?.[src]);
      pix[dst+1]=weatherCloudSignedToByte(mid?.[src]);
      pix[dst+2]=weatherCloudSignedToByte(high?.[src]);
      pix[dst+3]=weatherCloudByte01(deep?.[src]);
    }
  }
  return pix;
}
function weatherCloudGpuCollapseVisible(blend){
  blend=Math.max(0,Math.min(1,Number(blend)||0));
  for(let face=0;face<6;face++){
    const prev=weatherCloudGpuPrevFaces[face],curr=weatherCloudGpuFaces[face];
    for(let i=0;i<curr.length;i++) prev[i]=Math.round(prev[i]+(curr[i]-prev[i])*blend);
  }
}
function weatherCloudGpuUploadFaces(tex,unit,faces,N){
  gl.activeTexture(gl.TEXTURE0+unit);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,tex);
  for(let face=0;face<6;face++)
    gl.texSubImage2D(weatherCloudFaceTarget(face),0,0,0,N,N,gl.RGBA,gl.UNSIGNED_BYTE,faces[face]);
}
function weatherCloudGpuUpload(core){
  if(!core||!core.N||!core.count)return false;
  weatherCloudGpuEnsure(core.N);
  const now=weatherCloudNowMs();
  const seed=core.seed|0;
  const seedChanged=Number.isFinite(weatherCloudGpuLastSeed)&&weatherCloudGpuLastSeed!==seed;

  if(!weatherCloudGpuHasFrame||seedChanged){
    for(let face=0;face<6;face++){
      const curr=weatherCloudGpuPackFace(core,face);
      weatherCloudGpuPrevFaces[face].set(curr);
    }
    weatherCloudGpuUploadFaces(weatherCloudGpuTexPrev,WEATHER_CLOUD_TEX_PREV_UNIT,weatherCloudGpuPrevFaces,core.N);
    weatherCloudGpuUploadFaces(weatherCloudGpuTex,WEATHER_CLOUD_TEX_UNIT,weatherCloudGpuFaces,core.N);
    weatherCloudGpuBlendStartMs=now;
    weatherCloudGpuBlendDurationMs=1;
    weatherCloudGpuHasFrame=true;
  }else{
    /* Preserve the exact field visible immediately before this fixed tick. */
    weatherCloudGpuCollapseVisible(weatherCloudGpuBlendAt(now));
    weatherCloudGpuUploadFaces(weatherCloudGpuTexPrev,WEATHER_CLOUD_TEX_PREV_UNIT,weatherCloudGpuPrevFaces,core.N);
    for(let face=0;face<6;face++)weatherCloudGpuPackFace(core,face);
    weatherCloudGpuUploadFaces(weatherCloudGpuTex,WEATHER_CLOUD_TEX_UNIT,weatherCloudGpuFaces,core.N);
    const interval=Number.isFinite(weatherCloudGpuLastUploadMs)?Math.max(1,now-weatherCloudGpuLastUploadMs):WEATHER_CLOUD_BLEND_DEFAULT_MS;
    weatherCloudGpuBlendDurationMs=Math.max(WEATHER_CLOUD_BLEND_MIN_MS,Math.min(WEATHER_CLOUD_BLEND_MAX_MS,interval*0.92));
    weatherCloudGpuBlendStartMs=now;
  }

  gl.activeTexture(gl.TEXTURE0);
  weatherCloudGpuLastUploadMs=now;
  weatherCloudGpuUploadCount++;
  weatherCloudGpuLastTick=core.ticks|0;
  weatherCloudGpuLastSeed=seed;
  core.weatherCloudGpuModel=WEATHER_CLOUD_GPU_MODEL;
  core.weatherCloudGpuUploads=weatherCloudGpuUploadCount;
  return true;
}

const weatherCoreCreateBeforeCloudGpu=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeCloudGpu(seed,N,climate,axis);
  weatherCloudGpuUpload(core);
  return core;
};
const weatherCoreStepBeforeCloudGpu=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeCloudGpu(core,dtSec,climate,axis);
  weatherCloudGpuUpload(core);
  return core;
};

function weatherCloudGpuEnsureCurrent(){
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
  if(!core)return null;
  if(!weatherCloudGpuTex||!weatherCloudGpuTexPrev||weatherCloudGpuN!==core.N||weatherCloudGpuLastSeed!==(core.seed|0))
    weatherCloudGpuUpload(core);
  return core;
}
