/* Ordinary RGBA8 lake and river cubemaps. Both uniforms are samplerCube:
   no integer texture fallback, no incompatible texture sampler aliasing. */
let riverBoundProgram=null,riverBoundSamplerUnit=-1;
function riverBindForFrame(){
  if(!prog||typeof riverGpuEnsureCurrent!=='function')return;
  riverGpuEnsureCurrent();
  if(!riverGpuTex)return;
  const realAtlas=!!(riverLoopSupported&&riverLoopReady&&riverLoopTex);
  const atlasUnit=realAtlas?RIVER_LOOP_TEX_UNIT:RIVER_TEX_UNIT;
  gl.activeTexture(gl.TEXTURE0+RIVER_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverGpuTex);
  if(realAtlas){
    gl.activeTexture(gl.TEXTURE0+RIVER_LOOP_TEX_UNIT);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverLoopTex);
  }
  gl.activeTexture(gl.TEXTURE0);
  const changed=riverBoundProgram!==prog;
  if(changed){
    gl.useProgram(prog);
    if(U.uRiverTex!=null)gl.uniform1i(U.uRiverTex,RIVER_TEX_UNIT);
    riverBoundProgram=prog;riverBoundSamplerUnit=-1;
  }
  if(U.uRiverLoopTex!=null&&riverBoundSamplerUnit!==atlasUnit){
    gl.uniform1i(U.uRiverLoopTex,atlasUnit);
    riverBoundSamplerUnit=atlasUnit;
  }
  if(U.uRiverBlend!=null)gl.uniform1f(U.uRiverBlend,riverGpuBlendAt(riverGpuNowMs()));
  if(U.uRiverPhysicsOn!=null)gl.uniform1f(U.uRiverPhysicsOn,1.0);
  // Diagnostic only: isolate river-mask defects from tectonic ridges and
  // blurred terrain shorelines without changing any geometry/seed/camera.
  const visible=typeof window==='undefined'||window.madPlanetHideRivers!==true;
  if(U.uRiverLoopOn!=null)gl.uniform1f(U.uRiverLoopOn,realAtlas&&visible?1.0:0.0);
}
const drawFrameBeforeRiverRender=drawFrame;
drawFrame=function(now){riverBindForFrame();drawFrameBeforeRiverRender(now);};
