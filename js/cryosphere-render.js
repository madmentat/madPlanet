/* ============ 0.5.60: bind physical cryosphere cubemap ============ */
let cryoBoundProgram=null;
function cryoBindForFrame(){
  if(!prog||typeof cryoGpuEnsureCurrent!=='function')return;
  cryoGpuEnsureCurrent();if(!cryoGpuTex)return;
  gl.activeTexture(gl.TEXTURE0+CRYO_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,cryoGpuTex);gl.activeTexture(gl.TEXTURE0);
  if(cryoBoundProgram!==prog){
    gl.useProgram(prog);
    if(U.uCryosphereTex!==null&&U.uCryosphereTex!==undefined)gl.uniform1i(U.uCryosphereTex,CRYO_TEX_UNIT);
    cryoBoundProgram=prog;
  }
  if(U.uCryosphereBlend!==null&&U.uCryosphereBlend!==undefined)gl.uniform1f(U.uCryosphereBlend,cryoGpuBlendAt(cryoGpuNowMs()));
}
const drawFrameBeforeCryosphereRender=drawFrame;
drawFrame=function(now){cryoBindForFrame();drawFrameBeforeCryosphereRender(now);};
