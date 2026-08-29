/* ============ 0.5.54: bind Weather Core cloud cubemap to full shader ============ */
let weatherCloudBoundProgram=null;
function weatherCloudBindForFrame(){
  if(!prog||typeof weatherCloudGpuEnsureCurrent!=='function')return;
  weatherCloudGpuEnsureCurrent();
  if(!weatherCloudGpuTex)return;
  gl.activeTexture(gl.TEXTURE0+WEATHER_CLOUD_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,weatherCloudGpuTex);
  gl.activeTexture(gl.TEXTURE0);
  if(U.uWeatherCloudTex!==null&&U.uWeatherCloudTex!==undefined&&weatherCloudBoundProgram!==prog){
    gl.useProgram(prog);
    gl.uniform1i(U.uWeatherCloudTex,WEATHER_CLOUD_TEX_UNIT);
    weatherCloudBoundProgram=prog;
  }
}

const drawFrameBeforeWeatherCloudRender=drawFrame;
drawFrame=function(now){
  weatherCloudBindForFrame();
  drawFrameBeforeWeatherCloudRender(now);
};
