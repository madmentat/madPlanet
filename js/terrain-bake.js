/* ============ 0.5.160: bake terrain() into a height cubemap ============ */
/*
   River geometry needs the terrain the viewer sees, tectonic belts included,
   at a resolution far above the Weather Core grid. Porting terrain() to JS
   would drift from the GPU (fp32 hash noise) and cost seconds per world; the
   GPU evaluates it for six 256x256 faces in milliseconds. This module links
   a terrain-only program (header + noise + terrain + terrain-bake.glsl),
   draws each face into an RGBA8 target and reads back 24-bit fixed-point
   heights. Baking happens only when a parameter that shapes the terrain
   changes (seed, sea level, continents, tectonics, islands, plates).
*/
const TERRAIN_BAKE_MODEL=1;
let terrainBakeProg=null,terrainBakeFailed=false,terrainBakeFbo=null,terrainBakeTex=null,terrainBakeTexN=0;
const terrainBakeU={};
function terrainBakeSignature(){
  if(typeof state==='undefined'||!state)return '';
  const w=(typeof world!=='undefined'&&world)?world:{};
  const seedS=Array.isArray(w.seedS)||ArrayBuffer.isView(w.seedS)?Array.from(w.seedS).map(v=>Number(v).toFixed(5)).join(','):'';
  return [state.seed|0,Number(state.sea).toFixed(4),Number(state.cont).toFixed(4),Number(state.tect).toFixed(4),
    Number(state.isle).toFixed(4),state.platesOn?1:0,w.plateN|0,seedS].join('|');
}
function terrainBakeAvailable(){
  return typeof gl!=='undefined'&&!!gl&&typeof TERRAIN_BAKE_FRAG==='string'&&typeof VERT==='string'&&!terrainBakeFailed;
}
function terrainBakeEnsureProgram(){
  if(terrainBakeProg||terrainBakeFailed)return terrainBakeProg;
  try{
    const p=gl.createProgram();
    gl.attachShader(p,compile(gl.VERTEX_SHADER,VERT));
    gl.attachShader(p,compile(gl.FRAGMENT_SHADER,TERRAIN_BAKE_FRAG));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('terrain bake link: '+(gl.getProgramInfoLog(p)||''));
    for(const n of ['uRotS','uSeedS','uCont','uSea','uIsle','uTect','uPlatesOn','uPlateN','uAxis','uCamDist','uDraft','uBakeFace','uBakeN'])terrainBakeU[n]=gl.getUniformLocation(p,n);
    terrainBakeU.uPlateP=gl.getUniformLocation(p,'uPlateP[0]');terrainBakeU.uPlateW=gl.getUniformLocation(p,'uPlateW[0]');
    terrainBakeProg=p;
  }catch(err){
    console.warn('[madPlanet] terrain bake unavailable:',err&&err.message);terrainBakeFailed=true;terrainBakeProg=null;
  }
  return terrainBakeProg;
}
function terrainBakeEnsureTarget(F){
  if(terrainBakeTex&&terrainBakeTexN===F)return true;
  if(terrainBakeTex)gl.deleteTexture(terrainBakeTex);if(terrainBakeFbo)gl.deleteFramebuffer(terrainBakeFbo);
  terrainBakeTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,terrainBakeTex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,F,F,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindTexture(gl.TEXTURE_2D,null);
  terrainBakeFbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,terrainBakeFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,terrainBakeTex,0);
  const ok=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  terrainBakeTexN=ok?F:0;return ok;
}
/* Returns Float32Array(6*F*F) of sea-relative heights indexed
   (face*F + y)*F + x with y up, or null when the GPU path is unavailable. */
function terrainBakeHeights(F){
  if(!terrainBakeAvailable())return null;
  const p=terrainBakeEnsureProgram();if(!p)return null;
  if(!terrainBakeEnsureTarget(F))return null;
  const w=(typeof world!=='undefined'&&world)?world:{},Uu=terrainBakeU;
  const prevProg=(typeof prog!=='undefined')?prog:null;
  gl.useProgram(p);
  gl.uniformMatrix3fv(Uu.uRotS,false,new Float32Array([1,0,0,0,1,0,0,0,1]));
  gl.uniform3fv(Uu.uSeedS,w.seedS||new Float32Array(3));
  gl.uniform1f(Uu.uCont,Number(state.cont)||0);gl.uniform1f(Uu.uSea,Number(state.sea)||0);
  gl.uniform1f(Uu.uIsle,Number(state.isle)||0);gl.uniform1f(Uu.uTect,Number(state.tect)||0);
  gl.uniform1f(Uu.uPlatesOn,state.platesOn?1:0);gl.uniform1i(Uu.uPlateN,w.plateN|0);
  if(w.plateP)gl.uniform4fv(Uu.uPlateP,w.plateP);if(w.plateW)gl.uniform4fv(Uu.uPlateW,w.plateW);
  const axis=w.axis||[0,1,0];gl.uniform3f(Uu.uAxis,axis[0],axis[1],axis[2]);
  gl.uniform1f(Uu.uCamDist,10.0);gl.uniform1f(Uu.uDraft,1.0);gl.uniform1f(Uu.uBakeN,F);
  gl.bindFramebuffer(gl.FRAMEBUFFER,terrainBakeFbo);
  gl.viewport(0,0,F,F);gl.disable(gl.BLEND);
  const out=new Float32Array(6*F*F),pix=new Uint8Array(F*F*4);
  for(let f=0;f<6;f++){
    gl.uniform1f(Uu.uBakeFace,f);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.readPixels(0,0,F,F,gl.RGBA,gl.UNSIGNED_BYTE,pix);
    const base=f*F*F;
    for(let i=0;i<F*F;i++){
      const e=(pix[i*4]+pix[i*4+1]/255+pix[i*4+2]/65025)/255;
      out[base+i]=e*4-2;
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  if(typeof canvas!=='undefined'&&canvas)gl.viewport(0,0,canvas.width,canvas.height);
  if(prevProg)gl.useProgram(prevProg);
  return out;
}
