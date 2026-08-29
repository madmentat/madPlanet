/* ============ 0.5.54: Weather Core -> GPU cloud cubemap ============ */
/*
   One RGBA8 cubemap mirrors the 6xNxN body-fixed Weather Core grid:
     R low cloud condensate, G mid, B high, A deep-convection state.
   Upload happens only after a fixed weather tick (or core creation), never
   from requestAnimationFrame. Procedural cloud noise remains shader detail.
*/

const WEATHER_CLOUD_GPU_MODEL=1;
const WEATHER_CLOUD_TEX_UNIT=3;
const WEATHER_CLOUD_LOW_SCALE_KG_M2=0.16;
const WEATHER_CLOUD_MID_SCALE_KG_M2=0.11;
const WEATHER_CLOUD_HIGH_SCALE_KG_M2=0.055;

/* UNIFORM_NAMES is a mutable array created by gl-init.js. The full shader is
   adopted only from the render loop, after this module has executed. */
if(typeof UNIFORM_NAMES!=='undefined'&&!UNIFORM_NAMES.includes('uWeatherCloudTex'))
  UNIFORM_NAMES.push('uWeatherCloudTex');

let weatherCloudGpuTex=null;
let weatherCloudGpuN=0;
let weatherCloudGpuFaces=[];
let weatherCloudGpuUploadCount=0;
let weatherCloudGpuLastTick=-1;
let weatherCloudGpuLastSeed=NaN;

function weatherCloudByte01(x){
  x=Math.max(0,Math.min(1,Number(x)||0));
  return Math.max(0,Math.min(255,Math.round(x*255)));
}
function weatherCloudMassToByte(mass,scale){
  mass=Math.max(0,Number(mass)||0);scale=Math.max(1e-6,Number(scale)||1);
  return weatherCloudByte01(1-Math.exp(-mass/scale));
}
function weatherCloudFaceTarget(face){
  return gl.TEXTURE_CUBE_MAP_POSITIVE_X+face;
}
function weatherCloudGpuEnsure(N){
  N=Math.max(4,Math.round(Number(N)||32));
  if(weatherCloudGpuTex&&weatherCloudGpuN===N)return;
  if(weatherCloudGpuTex)gl.deleteTexture(weatherCloudGpuTex);
  weatherCloudGpuTex=gl.createTexture();weatherCloudGpuN=N;
  weatherCloudGpuFaces=Array.from({length:6},()=>new Uint8Array(N*N*4));
  gl.activeTexture(gl.TEXTURE0+WEATHER_CLOUD_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,weatherCloudGpuTex);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(webglVersion>=2)gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  for(let face=0;face<6;face++)
    gl.texImage2D(weatherCloudFaceTarget(face),0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);
  gl.activeTexture(gl.TEXTURE0);
}
function weatherCloudGpuPackFace(core,face){
  const N=core.N,pix=weatherCloudGpuFaces[face],base=face*N*N;
  const low=core.cloudLowMass,mid=core.cloudMidMass,high=core.cloudHighMass,deep=core.deepConvectiveState;
  /* Cube sampling uses t=-v for all six canonical weatherFaceDir mappings.
     Flip only the row order; x/u orientation already matches OpenGL faces. */
  for(let y=0;y<N;y++){
    const dstY=N-1-y;
    for(let x=0;x<N;x++){
      const src=base+y*N+x,dst=(dstY*N+x)*4;
      pix[dst]=weatherCloudMassToByte(low?.[src],WEATHER_CLOUD_LOW_SCALE_KG_M2);
      pix[dst+1]=weatherCloudMassToByte(mid?.[src],WEATHER_CLOUD_MID_SCALE_KG_M2);
      pix[dst+2]=weatherCloudMassToByte(high?.[src],WEATHER_CLOUD_HIGH_SCALE_KG_M2);
      pix[dst+3]=weatherCloudByte01(deep?.[src]);
    }
  }
  return pix;
}
function weatherCloudGpuUpload(core){
  if(!core||!core.N||!core.count)return false;
  weatherCloudGpuEnsure(core.N);
  gl.activeTexture(gl.TEXTURE0+WEATHER_CLOUD_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,weatherCloudGpuTex);
  for(let face=0;face<6;face++){
    const pix=weatherCloudGpuPackFace(core,face);
    gl.texSubImage2D(weatherCloudFaceTarget(face),0,0,0,core.N,core.N,gl.RGBA,gl.UNSIGNED_BYTE,pix);
  }
  gl.activeTexture(gl.TEXTURE0);
  weatherCloudGpuUploadCount++;
  weatherCloudGpuLastTick=core.ticks|0;
  weatherCloudGpuLastSeed=core.seed|0;
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
  if(!weatherCloudGpuTex||weatherCloudGpuN!==core.N||weatherCloudGpuLastSeed!==(core.seed|0))
    weatherCloudGpuUpload(core);
  return core;
}
