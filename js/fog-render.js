/* ============ 0.5.56 / 0.5.72 bind physical fog + render-only visibility ============ */
/* New display switches are declared by the full shader after gl-init has
   already adopted the compact program. Extend the shared uniform list here and
   immediately rebind the current program; later full-program adoption will use
   the same augmented list automatically. */
for(const n of ['uFogOn','uLightningOn','uAtmoVisualOn']){
  if(typeof UNIFORM_NAMES!=='undefined'&&!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}
if(typeof prog!=='undefined'&&prog&&typeof bindUniforms==='function')bindUniforms(prog);

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
function atmosphereVisibilityBindForFrame(){
  if(!prog)return;
  gl.useProgram(prog);
  if(U.uFogOn!==null&&U.uFogOn!==undefined)gl.uniform1f(U.uFogOn,state.fogOn===false?0:1);
  if(U.uLightningOn!==null&&U.uLightningOn!==undefined)gl.uniform1f(U.uLightningOn,state.lightningOn===false?0:1);
  if(U.uAtmoVisualOn!==null&&U.uAtmoVisualOn!==undefined)gl.uniform1f(U.uAtmoVisualOn,state.atmoVisualOn===false?0:1);
}
const drawFrameBeforeFogRender=drawFrame;
drawFrame=function(now){fogBindForFrame();atmosphereVisibilityBindForFrame();drawFrameBeforeFogRender(now);};
