/* ============ 0.5.54: Weather Core -> GPU cloud influence cubemap ============ */
/*
   One RGBA8 cubemap mirrors the 6xNxN body-fixed Weather Core grid, but it is
   deliberately NOT a cloud-visibility mask anymore:
     R/G/B = inertial signed visual response for low/mid/high layers,
             encoded from -1..+1 to 0..255 (127/128 = neutral)
     A     = deep-convection state.
   The shader uses these channels only to move the formation threshold of the
   continuous 0.5.53 morphology.  Zero physical condensate therefore does not
   hard-clip the rendered cloud body at a Weather Core texel boundary.
   Upload happens only after a fixed weather tick (or core creation), never
   from requestAnimationFrame.
*/

const WEATHER_CLOUD_GPU_MODEL=2;
const WEATHER_CLOUD_TEX_UNIT=3;

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
function weatherCloudSignedToByte(x){
  x=Math.max(-1,Math.min(1,Number(x)||0));
  return weatherCloudByte01(0.5+0.5*x);
}
function weatherCloudByteToSigned(b){
  return Math.max(-1,Math.min(1,(Math.max(0,Math.min(255,Number(b)||0))/255)*2-1));
}
function weatherCloudFaceTarget(face){return gl.TEXTURE_CUBE_MAP_POSITIVE_X+face;}
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
  const low=core.cloudVisualLow,mid=core.cloudVisualMid,high=core.cloudVisualHigh,deep=core.deepConvectiveState;
  /* Cube sampling uses t=-v for all six canonical weatherFaceDir mappings. */
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
