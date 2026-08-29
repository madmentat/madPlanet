/* ============ 0.5.56: bind physical fog cubemaps ============ */
let fogBoundProgram=null;
function fogBindForFrame(){
  if(!prog||typeof fogGpuEnsureCurrent!=='function')return;
  fogGpuEnsureCurrent();
  if(!fogGpuTex||!fogGpuTexPrev)return;
  gl.activeTexture(gl.TEXTURE0+FOG_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,fogGpuTex);
  gl.activeTexture(gl.TEXTURE0+FOG_TEX_PREV_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,fogGpuTexPrev);
  gl.activeTexture(gl.TEXTURE0);
  if(fogBoundProgram!==prog){
    gl.useProgram(prog);
    if(U.uFogTex!==null&&U.uFogTex!==undefined)gl.uniform1i(U.uFogTex,FOG_TEX_UNIT);
    if(U.uFogTexPrev!==null&&U.uFogTexPrev!==undefined)gl.uniform1i(U.uFogTexPrev,FOG_TEX_PREV_UNIT);
    fogBoundProgram=prog;
  }
  if(U.uFogBlend!==null&&U.uFogBlend!==undefined)gl.uniform1f(U.uFogBlend,fogGpuBlendAt(fogGpuNowMs()));
}
const drawFrameBeforeFogRender=drawFrame;
drawFrame=function(now){fogBindForFrame();drawFrameBeforeFogRender(now);};
