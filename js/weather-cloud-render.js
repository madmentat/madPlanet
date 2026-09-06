/* ============ 0.5.54: bind double-buffered Weather Core cloud influence ============ */
let weatherCloudBoundProgram=null;
function weatherCloudBindForFrame(now){
  if(!prog||typeof weatherCloudGpuEnsureCurrent!=='function')return;
  weatherCloudGpuEnsureCurrent();
  if(!weatherCloudGpuTex||!weatherCloudGpuTexPrev)return;

  gl.activeTexture(gl.TEXTURE0+WEATHER_CLOUD_TEX_PREV_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,weatherCloudGpuTexPrev);
  gl.activeTexture(gl.TEXTURE0+WEATHER_CLOUD_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,weatherCloudGpuTex);
  gl.activeTexture(gl.TEXTURE0);

  if(weatherCloudBoundProgram!==prog){
    gl.useProgram(prog);
    if(U.uWeatherCloudTex!==null&&U.uWeatherCloudTex!==undefined)
      gl.uniform1i(U.uWeatherCloudTex,WEATHER_CLOUD_TEX_UNIT);
    if(U.uWeatherCloudTexPrev!==null&&U.uWeatherCloudTexPrev!==undefined)
      gl.uniform1i(U.uWeatherCloudTexPrev,WEATHER_CLOUD_TEX_PREV_UNIT);
    weatherCloudBoundProgram=prog;
  }
  if(U.uWeatherCloudBlend!==null&&U.uWeatherCloudBlend!==undefined){
    gl.useProgram(prog);
    gl.uniform1f(U.uWeatherCloudBlend,weatherCloudGpuBlendAt(Number(now)||weatherCloudNowMs()));
  }
}

const drawFrameBeforeWeatherCloudRender=drawFrame;
drawFrame=function(now){
  weatherCloudBindForFrame(now);
  drawFrameBeforeWeatherCloudRender(now);
};
