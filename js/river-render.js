/* Bind the Weather Core lake texture and the independent integer
   drainage atlas. WebGL rejects *different sampler types* on the same
   texture unit even when uRiverLoopOn=0, so an RGBA32UI fallback texture
   MUST occupy its own spare unit whenever the real atlas is unavailable. */
const RIVER_LOOP_FALLBACK_TEX_UNIT=1;
let riverBoundProgram=null,riverBoundSamplerUnit=-1,riverLoopFallbackTex=null;
function riverEnsureFallbackTexture(){
  if(webglVersion<2)return null; // WebGL1 uses the independent compat shader
  if(riverLoopFallbackTex)return riverLoopFallbackTex;
  const tex=gl.createTexture();
  if(!tex)return null;
  gl.activeTexture(gl.TEXTURE0+RIVER_LOOP_FALLBACK_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,tex);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  const zeros=new Uint32Array(4);
  for(let face=0;face<6;face++)
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+face,0,
      gl.RGBA32UI,1,1,0,gl.RGBA_INTEGER,gl.UNSIGNED_INT,zeros);
  const error=gl.getError();
  gl.activeTexture(gl.TEXTURE0);
  if(error!==gl.NO_ERROR){
    gl.deleteTexture(tex);
    console.warn('[madPlanet] Integer river fallback cubemap failed:',error);
    return null;
  }
  riverLoopFallbackTex=tex;
  return tex;
}
function riverBindForFrame(){
  if(!prog||typeof riverGpuEnsureCurrent!=='function')return;
  riverGpuEnsureCurrent();if(!riverGpuTex)return;
  const realAtlas=!!(riverLoopSupported&&riverLoopReady&&riverLoopTex);
  const atlasUnit=realAtlas?RIVER_LOOP_TEX_UNIT:RIVER_LOOP_FALLBACK_TEX_UNIT;
  gl.activeTexture(gl.TEXTURE0+RIVER_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverGpuTex);
  if(webglVersion>=2){
    if(realAtlas){
      gl.activeTexture(gl.TEXTURE0+RIVER_LOOP_TEX_UNIT);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverLoopTex);
    }else{
      const empty=riverEnsureFallbackTexture();
      gl.activeTexture(gl.TEXTURE0+RIVER_LOOP_FALLBACK_TEX_UNIT);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP,empty);
    }
  }
  gl.activeTexture(gl.TEXTURE0);
  const programChanged=riverBoundProgram!==prog;
  if(programChanged){
    gl.useProgram(prog);
    if(U.uRiverTex!=null)gl.uniform1i(U.uRiverTex,RIVER_TEX_UNIT);
    riverBoundProgram=prog;
    riverBoundSamplerUnit=-1;
  }
  if(U.uRiverLoopTex!=null&&riverBoundSamplerUnit!==atlasUnit){
    gl.uniform1i(U.uRiverLoopTex,atlasUnit);
    riverBoundSamplerUnit=atlasUnit;
  }
  if(U.uRiverBlend!=null)gl.uniform1f(U.uRiverBlend,riverGpuBlendAt(riverGpuNowMs()));
  if(U.uRiverPhysicsOn!=null)gl.uniform1f(U.uRiverPhysicsOn,1.0);
  if(U.uRiverLoopOn!=null)gl.uniform1f(U.uRiverLoopOn,realAtlas?1.0:0.0);
}
const drawFrameBeforeRiverRender=drawFrame;
drawFrame=function(now){riverBindForFrame();drawFrameBeforeRiverRender(now);};
