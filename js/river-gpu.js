/* Weather Core lake cubemap + one simple prepainted river mask. */
/*
   R/G = previous river/lake support, B/A = current river/lake support.
   One RGBA8 cubemap keeps the bridge WebGL1-friendly; the texture is updated
   only on Weather Core fixed ticks, never per render frame.

   0.5.145: trunks are drawn as Catmull-Rom splines through a 4-cell window
   (upstream, i, j, downstream) so the corridor is a smooth curve, not a D8
   polyline; visual branches use the same spline treatment.

   0.5.146: this cubemap is a CORRIDOR MASK for surface.glsl, never a brush.
   One texel is ~50 km on the desktop grid, so anything painted here and shown
   as water directly is a 50..400 km wide river. The shader now keeps its thin
   sub-grid channel geometry and uses this map only to decide where channels
   exist, where the dominant trunk runs and where lakes are stored. Meander
   amplitude is reduced accordingly: a corridor must follow the graph, the
   visible wiggles belong to the sub-grid channel.

   Since 0.5.180 this legacy weather texture supplies lake storage only.
   Surface rivers are analytic segments from the finer terrain drainage graph.
*/

const RIVER_GPU_MODEL=11;
const RIVER_TEX_UNIT=2;
const RIVER_LOOP_TEX_UNIT=1;
const RIVER_LOOP_FILTER_MODEL=8;
const RIVER_LOOP_MIN_N=96;
const RIVER_LOOP_MAX_N=192;
const RIVER_GPU_UPSCALE=16;
const RIVER_BLEND_DEFAULT_MS=900;
const RIVER_BLEND_MIN_MS=250;
const RIVER_BLEND_MAX_MS=1200;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uRiverTex','uRiverBlend','uRiverPhysicsOn','uRiverLoopTex','uRiverLoopOn'])if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}

let riverGpuTex=null,riverGpuN=0,riverGpuFaces=[];
let riverGpuPrevRiver=[],riverGpuPrevLake=[],riverGpuCurrRiver=[],riverGpuCurrLake=[];
let riverGpuHasFrame=false,riverGpuLastSeed=NaN,riverGpuBlendStartMs=0,riverGpuBlendDurationMs=1,riverGpuLastUploadMs=NaN;

/* Static, painted river mask aligned to displayed terrain. */
let riverLoopTex=null,riverLoopN=0,riverLoopFaces=[];
let riverLoopReady=false,riverLoopSupported=false,riverLoopSignature='';
let riverLoopSampler=null;
let riverLoopSamplerFailed=false;
let riverDrainageGridCache=null;

/* Sample the renderer's terrain, lakes and moisture in GPU precision. The
   Weather Core macroTerrain still uses a different, coarse noise basis and
   cannot classify visible shorelines. A private tiny context keeps this bake
   from disturbing the planet renderer's VAO, textures or asynchronous link. */
function riverLoopSampleSurface(N){
  if(typeof document==='undefined'||typeof FRAG!=='string')return null;
  if(riverLoopSamplerFailed)return null;
  if(!riverLoopSampler&&typeof pendingProgram!=='undefined'&&pendingProgram)return {pending:true};
  try{
    if(!riverLoopSampler){
      const canvas=document.createElement('canvas');
      const g=canvas.getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});
      if(!g)return null;
      const end=FRAG.indexOf('#define lowCover');
      if(end<0)return null;
      const fragment=FRAG.slice(0,end)+`
uniform float sampleN;
uniform int sampleFace;
vec3 sampleDir(vec2 p){
  vec2 uv=2.0*p/sampleN-1.0;float u=uv.x,v=-uv.y;
  if(sampleFace==0)return normalize(vec3(1.0,v,-u));
  if(sampleFace==1)return normalize(vec3(-1.0,v,u));
  if(sampleFace==2)return normalize(vec3(u,1.0,-v));
  if(sampleFace==3)return normalize(vec3(u,-1.0,v));
  if(sampleFace==4)return normalize(vec3(u,v,1.0));
  return normalize(vec3(-u,v,-1.0));
}
void main(){
  vec3 c=sampleDir(gl_FragCoord.xy);
  float rock,mount,lee;float h=terrain(c,rock,mount,lee);
  float code=floor(clamp(h*0.5+0.5,0.0,1.0)*65535.0+0.5);
  float lakeN=fbm(c*3.4+uSeedS*3.7+vec3(53.0),4);
  float lth=mix(0.46,0.20,uLake);
  float lake=ss(lth,lth+0.07,lakeN)*(1.0-ss(0.05,0.14,h))*ss(0.02,0.10,uLake);
  float water=(h<0.0||lake>0.65)?1.0:0.0;
  float moisture=0.5+0.5*fbm(c*2.4+uSeedS*1.3+vec3(17.0),4);
  fragColor=vec4(floor(code/256.0)/255.0,mod(code,256.0)/255.0,water,moisture);
}`;
      const program=g.createProgram();
      for(const [type,source] of [[g.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'],[g.FRAGMENT_SHADER,fragment]]){
        const shader=g.createShader(type);g.shaderSource(shader,source);g.compileShader(shader);
        g.attachShader(program,shader);g.deleteShader(shader);
      }
      g.linkProgram(program);
      riverLoopSampler={canvas,g,program,parallel:g.getExtension('KHR_parallel_shader_compile'),ready:false};
    }
    const {canvas,g,program}=riverLoopSampler;
    if(!riverLoopSampler.ready){
      const ext=riverLoopSampler.parallel;
      if(ext&&!g.getProgramParameter(program,ext.COMPLETION_STATUS_KHR))return {pending:true};
      if(!g.getProgramParameter(program,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(program));
      riverLoopSampler.ready=true;
    }
    canvas.width=canvas.height=N;g.viewport(0,0,N,N);g.disable(g.DITHER);g.useProgram(program);
    const loc=name=>g.getUniformLocation(program,name);
    g.uniform1f(loc('sampleN'),N);
    g.uniformMatrix3fv(loc('uRotS'),false,[1,0,0,0,1,0,0,0,1]);
    g.uniform3fv(loc('uSeedS'),world.seedS);
    for(const [name,key] of [['uCont','cont'],['uSea','sea'],['uTect','tect'],['uIsle','isle'],['uLake','lake']])g.uniform1f(loc(name),Number(state[key])||0);
    g.uniform1f(loc('uDraft'),1);g.uniform1f(loc('uCamDist'),4);
    g.uniform1i(loc('uPlateN'),world.plateN);
    g.uniform4fv(loc('uPlateP'),world.plateP);g.uniform4fv(loc('uPlateW'),world.plateW);
    const height=new Float32Array(6*N*N),moisture=new Float32Array(6*N*N);
    const water=new Uint8Array(6*N*N),pixels=new Uint8Array(N*N*4);
    for(let f=0;f<6;f++){
      g.uniform1i(loc('sampleFace'),f);g.drawArrays(g.TRIANGLES,0,3);
      g.readPixels(0,0,N,N,g.RGBA,g.UNSIGNED_BYTE,pixels);
      for(let k=0;k<N*N;k++){
        const i=f*N*N+k,p=k*4;height[i]=(pixels[p]*256+pixels[p+1])/65535*2-1;
        water[i]=pixels[p+2]>127?1:0;moisture[i]=pixels[p+3]/255;
      }
    }
    return {height,water,moisture};
  }catch(error){
    riverLoopSamplerFailed=true;
    console.warn('[madPlanet] River surface sampling failed; surface rivers unavailable',error);
    return null;
  }
}

function riverLoopFaceDir(face,px,py,N,out){
  const u=2*px/N-1,v=1-2*py/N;let x=0,y=0,z=0;
  if(face===0){x= 1;y=v;z=-u;}
  else if(face===1){x=-1;y=v;z= u;}
  else if(face===2){x= u;y=1;z=-v;}
  else if(face===3){x= u;y=-1;z=v;}
  else if(face===4){x= u;y=v;z=1;}
  else{x=-u;y=v;z=-1;}
  const q=Math.hypot(x,y,z)||1;out[0]=x/q;out[1]=y/q;out[2]=z/q;return out;
}
function riverLoopIndex(face,x,y,N){return face*N*N+y*N+x;}
function riverLoopIndexToCell(idx,N,out){
  const face=Math.floor(idx/(N*N)),r=idx-face*N*N,y=Math.floor(r/N),x=r-y*N;
  out.face=face;out.x=x;out.y=y;return out;
}
function riverLoopNeighborIndex(face,x,y,dx,dy,N,tmpDir,tmpUv){
  const nx=x+dx,ny=y+dy;
  if(nx>=0&&nx<N&&ny>=0&&ny<N)return riverLoopIndex(face,nx,ny,N);
  riverLoopFaceDir(face,nx+0.5,ny+0.5,N,tmpDir);
  riverGpuDirToFaceUV(tmpDir[0],tmpDir[1],tmpDir[2],tmpUv);
  const xx=riverGpuClamp(Math.floor((tmpUv.u+1)*0.5*N),0,N-1);
  const yy=riverGpuClamp(Math.floor((1-(tmpUv.v+1)*0.5)*N),0,N-1);
  return riverLoopIndex(tmpUv.face,xx,yy,N);
}
/* One ordinary, linearly filtered RGBA8 cubemap: the RED channel is a
   prepainted river mask. No integer samplers, second-slot encoding, or
   fragment shader segment search. Rebuild only when geography changes. */
function riverLoopEnsureTexture(N){
  const maxUnits=Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))||8;
  // Unit 1 is reserved for painted rivers, unit 2 for lakes. This also
  // works on WebGL2 mobile GPUs exposing the minimum eight texture units.
  riverLoopSupported=!riverLoopSamplerFailed&&webglVersion>=2&&maxUnits>RIVER_LOOP_TEX_UNIT;
  if(!riverLoopSupported){riverLoopReady=false;return false;}
  if(riverLoopTex&&riverLoopN===N)return true;
  if(riverLoopTex)gl.deleteTexture(riverLoopTex);
  riverLoopN=N;
  riverLoopTex=gl.createTexture();
  if(!riverLoopTex){riverLoopReady=false;riverLoopSupported=false;return false;}
  gl.activeTexture(gl.TEXTURE0+RIVER_LOOP_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverLoopTex);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  for(let f=0;f<6;f++)
    gl.texImage2D(riverGpuFaceTarget(f),0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  const err=gl.getError();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);gl.activeTexture(gl.TEXTURE0);
  if(err!==gl.NO_ERROR){
    gl.deleteTexture(riverLoopTex);riverLoopTex=null;riverLoopN=0;
    riverLoopSupported=false;riverLoopReady=false;riverLoopSamplerFailed=true;
    console.warn('[madPlanet] Simple painted river texture unavailable:',err);
    return false;
  }
  riverLoopReady=false;
  return true;
}
function riverLoopBuildMask(core){
  if(!core?.N||!world?.seedS)return false;
  const N=Math.max(RIVER_LOOP_MIN_N,Math.min(RIVER_LOOP_MAX_N,Math.round(core.N*5)));
  // Fixed geographical detail: mobile uses a smaller atlas, but the same
  // normalized river widths and shapes, never the current camera zoom.
  const mobile=typeof mobileDevice!=='undefined'&&mobileDevice;
  // The 384/576 atlas visibly blurred the banks at regional zoom.
  // One-time geography bake, not an ongoing per-frame GPU cost.
  const M=mobile?640:1024;
  if(!riverLoopEnsureTexture(M))return false;
  const sig=[RIVER_LOOP_FILTER_MODEL,N,...world.seedS,state.cont,
    Number(state.sea).toFixed(3),state.tect,state.isle,state.lake,M].join('|');
  if(riverLoopReady&&riverLoopSignature===sig)return true;
  const sampled=riverLoopSampleSurface(N);
  if(!sampled||sampled.pending){riverLoopReady=false;return false;}
  if(!riverDrainageGridCache||riverDrainageGridCache.N!==N)
    riverDrainageGridCache=riverDrainageGrid(N);
  const grid=riverDrainageGridCache;
  const network=riverDrainageBuild(sampled.height,sampled.water,sampled.moisture,
    grid.neighbors,grid.area,{
      // A drainage area of just two cells created dozens of short,
      // almost parallel coast-facing rivers (the screenshot 'rake').
      // Retain only established watersheds and their side tributaries.
      sourceArea:28*(N/160)**2,
      sourceInset:Math.max(4,Math.round(N/28))
    });
  const raster=riverDrainageRaster(grid,network,M);riverLoopFaces=raster.faces;
  gl.activeTexture(gl.TEXTURE0+RIVER_LOOP_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverLoopTex);
  for(let f=0;f<6;f++)
    gl.texSubImage2D(riverGpuFaceTarget(f),0,0,0,M,M,
      gl.RGBA,gl.UNSIGNED_BYTE,riverLoopFaces[f]);
  const err=gl.getError();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);gl.activeTexture(gl.TEXTURE0);
  if(err!==gl.NO_ERROR){
    riverLoopReady=false;riverLoopSupported=false;riverLoopSamplerFailed=true;
    console.warn('[madPlanet] Simple river texture upload failed:',err);
    return false;
  }
  riverLoopSignature=sig;riverLoopReady=true;
  core.riverLoopFilterModel=RIVER_LOOP_FILTER_MODEL;
  core.riverLoopSampling='painted-rgba8';
  core.riverDrainageSegments=raster.segments;
  core.riverDrainagePainted=raster.painted;
  core.riverDrainageAudit=riverDrainageDiagnostics(network);
  return true;
}
function riverGpuNowMs(){return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')?performance.now():Date.now();}
function riverGpuClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function riverGpuByte(x){return Math.max(0,Math.min(255,Math.round(riverGpuClamp(x,0,1)*255)));}
function riverGpuFaceTarget(f){return gl.TEXTURE_CUBE_MAP_POSITIVE_X+f;}
function riverGpuDisplayN(coreN){return Math.max(8,Math.round((Number(coreN)||32)*RIVER_GPU_UPSCALE));}
function riverGpuBlendAt(now){
  if(!riverGpuHasFrame)return 1;const t=riverGpuClamp((Number(now)-riverGpuBlendStartMs)/Math.max(1,riverGpuBlendDurationMs),0,1);return t*t*(3-2*t);
}
function riverGpuEnsure(N){
  N=Math.max(8,Math.round(N));if(riverGpuTex&&riverGpuN===N)return;
  if(riverGpuTex)gl.deleteTexture(riverGpuTex);riverGpuN=N;
  riverGpuFaces=Array.from({length:6},()=>new Uint8Array(N*N*4));
  riverGpuPrevRiver=Array.from({length:6},()=>new Float32Array(N*N));
  riverGpuPrevLake=Array.from({length:6},()=>new Float32Array(N*N));
  riverGpuCurrRiver=Array.from({length:6},()=>new Float32Array(N*N));
  riverGpuCurrLake=Array.from({length:6},()=>new Float32Array(N*N));
  riverGpuTex=gl.createTexture();gl.activeTexture(gl.TEXTURE0+RIVER_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverGpuTex);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(webglVersion>=2)gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  for(let f=0;f<6;f++)gl.texImage2D(riverGpuFaceTarget(f),0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);gl.activeTexture(gl.TEXTURE0);riverGpuHasFrame=false;riverGpuLastSeed=NaN;
}

function riverGpuDirToFaceUV(dx,dy,dz,out){
  const ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz);let a;
  if(ax>=ay&&ax>=az){
    if(dx>=0){out.face=0;a=Math.max(1e-12,dx);out.u=-dz/a;out.v=dy/a;}
    else{out.face=1;a=Math.max(1e-12,-dx);out.u=dz/a;out.v=dy/a;}
  }else if(ay>=az){
    if(dy>=0){out.face=2;a=Math.max(1e-12,dy);out.u=dx/a;out.v=-dz/a;}
    else{out.face=3;a=Math.max(1e-12,-dy);out.u=dx/a;out.v=dz/a;}
  }else{
    if(dz>=0){out.face=4;a=Math.max(1e-12,dz);out.u=dx/a;out.v=dy/a;}
    else{out.face=5;a=Math.max(1e-12,-dz);out.u=-dx/a;out.v=dy/a;}
  }
  return out;
}
function riverGpuPaint(field,face,cx,cy,radius,value){
  const N=riverGpuN,r=Math.max(0.08,Number(radius)||0.08),rr=Math.ceil(r+0.40);
  for(let dy=-rr;dy<=rr;dy++)for(let dx=-rr;dx<=rr;dx++){
    const d=Math.hypot(dx,dy);if(d>r+0.40)continue;const x=cx+dx,y=cy+dy;
    if(x<0||x>=N||y<0||y>=N)continue;
    const fall=riverGpuClamp(1-d/(r+0.45),0,1);
    const q=riverGpuClamp(value*(0.06+0.94*fall*fall*fall),0,1),k=y*N+x;
    if(q>field[face][k])field[face][k]=q;
  }
}
function riverGpuPaintDir(field,dx,dy,dz,radius,value,tmp){
  const q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;riverGpuDirToFaceUV(dx,dy,dz,tmp);
  const N=riverGpuN,cx=riverGpuClamp(Math.round((tmp.u+1)*0.5*(N-1)),0,N-1);
  const cy=riverGpuClamp((N-1)-Math.round((tmp.v+1)*0.5*(N-1)),0,N-1);
  riverGpuPaint(field,tmp.face,cx,cy,radius,value);
}
/* Weather Core supplies G/A lake channels only. Static rivers use a separate mask. */
function riverGpuReadCurrent(core){
  // Legacy river arrays stay zero after allocation; only lakes are dynamic.
  for(let f=0;f<6;f++)riverGpuCurrLake[f].fill(0);
  const tmp={face:0,u:0,v:0};
  for(let i=0;i<core.count;i++){
    const lake=riverGpuClamp(core.riverLakeFraction?.[i]||0,0,1);
    if(lake<=0.02)continue;
    const lr=0.95+3.2*Math.sqrt(lake);
    riverGpuPaintDir(riverGpuCurrLake,core.dirX[i],core.dirY[i],core.dirZ[i],
      lr,0.24+0.76*lake,tmp);
  }
}

function riverGpuCollapseVisible(blend){
  for(let f=0;f<6;f++){
    const pl=riverGpuPrevLake[f],cl=riverGpuCurrLake[f];
    for(let i=0;i<pl.length;i++)pl[i]+=(cl[i]-pl[i])*blend;
  }
}
function riverGpuPackUpload(){
  const N=riverGpuN;gl.activeTexture(gl.TEXTURE0+RIVER_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverGpuTex);
  for(let f=0;f<6;f++){
    const pix=riverGpuFaces[f],pl=riverGpuPrevLake[f],cl=riverGpuCurrLake[f];
    for(let i=0;i<pl.length;i++){
      const p=i*4;
      // R/B are retired (zero); do not convert them at every weather tick.
      pix[p]=0;pix[p+1]=riverGpuByte(pl[i]);
      pix[p+2]=0;pix[p+3]=riverGpuByte(cl[i]);
    }
    gl.texSubImage2D(riverGpuFaceTarget(f),0,0,0,N,N,gl.RGBA,gl.UNSIGNED_BYTE,pix);
  }
  gl.activeTexture(gl.TEXTURE0);
}
function riverGpuUpload(core){
  if(!core?.N||!core?.riverChannelStrength)return false;riverGpuEnsure(riverGpuDisplayN(core.N));
  riverLoopBuildMask(core);
  const now=riverGpuNowMs(),seed=core.seed|0,seedChanged=Number.isFinite(riverGpuLastSeed)&&riverGpuLastSeed!==seed;
  if(!riverGpuHasFrame||seedChanged){riverGpuReadCurrent(core);for(let f=0;f<6;f++){riverGpuPrevLake[f].set(riverGpuCurrLake[f]);}riverGpuBlendDurationMs=1;riverGpuBlendStartMs=now;riverGpuHasFrame=true;}
  else{riverGpuCollapseVisible(riverGpuBlendAt(now));riverGpuReadCurrent(core);const interval=Number.isFinite(riverGpuLastUploadMs)?Math.max(1,now-riverGpuLastUploadMs):RIVER_BLEND_DEFAULT_MS;riverGpuBlendDurationMs=Math.max(RIVER_BLEND_MIN_MS,Math.min(RIVER_BLEND_MAX_MS,interval));riverGpuBlendStartMs=now;}
  riverGpuPackUpload();riverGpuLastUploadMs=now;riverGpuLastSeed=seed;core.riverGpuModel=RIVER_GPU_MODEL;return true;
}
const weatherCoreCreateBeforeRiverGpu=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){const core=weatherCoreCreateBeforeRiverGpu(seed,N,climate,axis);riverGpuUpload(core);return core;};
const weatherCoreStepBeforeRiverGpu=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){weatherCoreStepBeforeRiverGpu(core,dtSec,climate,axis);riverGpuUpload(core);return core;};
/* A newly allocated cubemap may be empty while the full planet shader is
   compiling. Weather ticks are not guaranteed to run immediately afterwards:
   retry terrain sampling once the compiler is free, in a browser idle turn.
   Never rebuild the terrain in each drawFrame. */
let riverLoopRetryScheduled=false,riverLoopLastRetryMs=-1e12;
function riverLoopMaybeRetry(core){
  if(riverLoopReady||riverLoopSamplerFailed||!riverLoopSupported||riverLoopRetryScheduled)return;
  if(typeof pendingProgram!=='undefined'&&pendingProgram)return;
  const now=riverGpuNowMs();
  if(now-riverLoopLastRetryMs<900)return;
  riverLoopLastRetryMs=now;riverLoopRetryScheduled=true;
  const run=()=>{
    riverLoopRetryScheduled=false;
    if(riverLoopReady||riverLoopSamplerFailed)return;
    const current=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():core;
    if(!current?.N)return;
    if(typeof pendingProgram!=='undefined'&&pendingProgram)return;
    const ready=riverLoopBuildMask(current);
    if(ready&&typeof console!=='undefined')
      console.info('[madPlanet] Terrain rivers ready:',current.riverDrainageSegments,'segments');
  };
  if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:1500});
  else setTimeout(run,80);
}
function riverGpuEnsureCurrent(){
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
  if(!core)return null;
  if(!riverGpuTex||riverGpuN!==riverGpuDisplayN(core.N)||riverGpuLastSeed!==(core.seed|0))
    riverGpuUpload(core);
  riverLoopMaybeRetry(core);
  return core;
}

if(typeof window!=='undefined')window.__madPlanetRiverLoopFilter={
  model:RIVER_LOOP_FILTER_MODEL,
  rebuild:()=>{riverLoopReady=false;const c=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;return c?riverLoopBuildMask(c):false;},
  get ready(){return riverLoopReady;},
  get supported(){return riverLoopSupported;},
  get resolution(){return riverLoopN;},
  get failed(){return riverLoopSamplerFailed;},
  get segments(){return Number((typeof weatherCore!=='undefined'&&weatherCore)?.riverDrainageSegments)||0;},
  get painted(){return Number((typeof weatherCore!=='undefined'&&weatherCore)?.riverDrainagePainted)||0;},
  get diagnostics(){return (typeof weatherCore!=='undefined'&&weatherCore)?.riverDrainageAudit||null;},
  get shaderActive(){return !!(typeof U!=='undefined'&&U?.uRiverLoopOn!=null);}
};
