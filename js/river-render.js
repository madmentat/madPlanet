/* ============ 0.5.131: bind physical river cubemap ============ */
let riverBoundProgram=null;
function riverBindForFrame(){
  if(!prog||typeof riverGpuEnsureCurrent!=='function')return;
  riverGpuEnsureCurrent();if(!riverGpuTex)return;
  gl.activeTexture(gl.TEXTURE0+RIVER_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverGpuTex);gl.activeTexture(gl.TEXTURE0);
  if(riverBoundProgram!==prog){
    gl.useProgram(prog);
    if(U.uRiverTex!==null&&U.uRiverTex!==undefined)gl.uniform1i(U.uRiverTex,RIVER_TEX_UNIT);
    riverBoundProgram=prog;
  }
  if(U.uRiverBlend!==null&&U.uRiverBlend!==undefined)gl.uniform1f(U.uRiverBlend,riverGpuBlendAt(riverGpuNowMs()));
  if(U.uRiverPhysicsOn!==null&&U.uRiverPhysicsOn!==undefined)gl.uniform1f(U.uRiverPhysicsOn,1.0);
}
const drawFrameBeforeRiverRender=drawFrame;
drawFrame=function(now){riverBindForFrame();drawFrameBeforeRiverRender(now);};
