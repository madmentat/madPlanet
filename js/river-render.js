/* ============ 0.5.131: bind physical river cubemap ============ */
let riverBoundProgram=null;
/* 0.5.159 diagnostic: ",rivvec=0" in the URL hash keeps the raster corridor
   path so the analytic channel's frame cost can be compared on a device. */
let riverVectorHashOff=false;
function riverVectorHashCheck(){try{riverVectorHashOff=/(^|[#,&;])rivvec=0(?=[,&;]|$)/.test(String(location.hash||''));}catch(_e){riverVectorHashOff=false;}}
riverVectorHashCheck();
if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('hashchange',riverVectorHashCheck);
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
  if(typeof riverGpuVectorBind==='function')riverGpuVectorBind(prog,U,!riverVectorHashOff);
}
const drawFrameBeforeRiverRender=drawFrame;
drawFrame=function(now){riverBindForFrame();drawFrameBeforeRiverRender(now);};
