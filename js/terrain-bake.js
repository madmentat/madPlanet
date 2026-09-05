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
const TERRAIN_BAKE_MODEL=2;
const TERRAIN_BAKE_LINK_GRACE_MS=2500; /* without KHR_parallel_shader_compile: first LINK_STATUS query waits this long */
let terrainBakeProg=null,terrainBakeFailed=false,terrainBakeFbo=null,terrainBakeTex=null,terrainBakeTexN=0;
let terrainBakeLinking=null,terrainBakeLinkStartMs=0;
const terrainBakeU={};
/* state.sea is a per-frame derived value (water-budget.js), so it is quantised
   coarsely here; the exact value still reaches uSea. A 0.01 step is ~6 km of
   sea level, below the drainage cell size. */
function terrainBakeSignature(){
  if(typeof state==='undefined'||!state)return '';
  const w=(typeof world!=='undefined'&&world)?world:{};
  const seedS=Array.isArray(w.seedS)||ArrayBuffer.isView(w.seedS)?Array.from(w.seedS).map(v=>Number(v).toFixed(5)).join(','):'';
  return [state.seed|0,Number(state.sea).toFixed(2),Number(state.cont).toFixed(3),Number(state.tect).toFixed(3),
    Number(state.isle).toFixed(3),state.platesOn?1:0,w.plateN|0,seedS].join('|');
}
function terrainBakeAvailable(){
  return typeof gl!=='undefined'&&!!gl&&typeof TERRAIN_BAKE_FRAG==='string'&&typeof VERT==='string'&&!terrainBakeFailed;
}
function terrainBakeNowMs(){return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')?performance.now():Date.now();}
/* The link is started early and never queried synchronously before it can
   be complete: on ANGLE/D3D a terrain-bearing program can take seconds to
   link and a premature LINK_STATUS query freezes the tab (see gl-init.js). */
function terrainBakeStartLink(){
  if(terrainBakeProg||terrainBakeFailed||terrainBakeLinking||!terrainBakeAvailable())return;
  try{
    const p=gl.createProgram();
    gl.attachShader(p,compile(gl.VERTEX_SHADER,VERT));
    gl.attachShader(p,compile(gl.FRAGMENT_SHADER,TERRAIN_BAKE_FRAG));
    gl.linkProgram(p);
    terrainBakeLinking=p;terrainBakeLinkStartMs=terrainBakeNowMs();
  }catch(err){
    console.warn('[madPlanet] terrain bake unavailable:',err&&err.message);terrainBakeFailed=true;
  }
}
function terrainBakeEnsureProgram(){
  if(terrainBakeProg||terrainBakeFailed)return terrainBakeProg;
  if(!terrainBakeLinking){terrainBakeStartLink();if(!terrainBakeLinking)return null;}
  const p=terrainBakeLinking;
  const ext=(typeof parallelExt!=='undefined')?parallelExt:null;
  if(ext){if(gl.getProgramParameter(p,ext.COMPLETION_STATUS_KHR)!==true)return null;}
  else if(terrainBakeNowMs()-terrainBakeLinkStartMs<TERRAIN_BAKE_LINK_GRACE_MS)return null;
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){
    console.warn('[madPlanet] terrain bake link failed:',gl.getProgramInfoLog(p)||'');terrainBakeFailed=true;terrainBakeLinking=null;return null;
  }
  for(const n of ['uRotS','uSeedS','uCont','uSea','uIsle','uTect','uPlatesOn','uPlateN','uAxis','uCamDist','uDraft','uBakeFace','uBakeN'])terrainBakeU[n]=gl.getUniformLocation(p,n);
  terrainBakeU.uPlateP=gl.getUniformLocation(p,'uPlateP[0]');terrainBakeU.uPlateW=gl.getUniformLocation(p,'uPlateW[0]');
  terrainBakeProg=p;terrainBakeLinking=null;return p;
}
/* Start linking as soon as the page's GL exists (never inside the worker),
   so the first bake finds a finished program instead of blocking on it. */
if(typeof setTimeout==='function'&&!(typeof self!=='undefined'&&self.MP_WEATHER_WORKER===true)&&typeof document!=='undefined')setTimeout(terrainBakeStartLink,0);
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
  if(!ok){
    /* No RGBA8 target means no bake at all: flip to unavailable so the
       synoptic fallback owns the bridge instead of an empty river layer. */
    console.warn('[madPlanet] terrain bake framebuffer incomplete');
    gl.deleteTexture(terrainBakeTex);gl.deleteFramebuffer(terrainBakeFbo);terrainBakeTex=null;terrainBakeFbo=null;terrainBakeFailed=true;
  }
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
