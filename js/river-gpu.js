/* ============ 0.5.131 .. 0.5.146: physical rivers -> GPU cubemap ============ */
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
*/

const RIVER_GPU_MODEL=11;
const RIVER_TEX_UNIT=2;
const RIVER_GPU_UPSCALE=16;
const RIVER_BLEND_DEFAULT_MS=900;
const RIVER_BLEND_MIN_MS=250;
const RIVER_BLEND_MAX_MS=1200;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uRiverTex','uRiverBlend','uRiverPhysicsOn'])if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}

let riverGpuTex=null,riverGpuN=0,riverGpuFaces=[];
let riverGpuPrevRiver=[],riverGpuPrevLake=[],riverGpuCurrRiver=[],riverGpuCurrLake=[];
let riverGpuHasFrame=false,riverGpuLastSeed=NaN,riverGpuBlendStartMs=0,riverGpuBlendDurationMs=1,riverGpuLastUploadMs=NaN;
let riverGpuCoastMask=null,riverGpuCoastMaskN=0,riverGpuCoastMaskSig='';
const riverGpuCoastTmp={face:0,u:0,v:0};
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
function riverGpuEnsureCoastMask(core){
  const N=Math.max(32,Math.min(256,Math.round((Number(core?.N)||32)*4)));
  const sea=(typeof h2oSeaLevelProxy==='function')?h2oSeaLevelProxy():0;
  const sig=String(core?.h2oSurfaceSignature||core?.seed||'')+'|N='+N+'|sea='+Number(sea).toFixed(6);
  if(!riverGpuCoastMask||riverGpuCoastMaskN!==N||riverGpuCoastMaskSig!==sig){
    riverGpuCoastMask=new Uint8Array(6*N*N);riverGpuCoastMaskN=N;riverGpuCoastMaskSig=sig;
  }
  return sea;
}
/* Sample the continuous continent field at the actual spline point, not only
   at a coarse Weather Core cell centre. Results are memoized on a 4x coast
   mask so five-octave terrain noise is evaluated at most once per queried
   sub-cell. Once a channel hits ocean, its segment may not reappear ashore. */
function riverGpuDetailedLandAt(core,dx,dy,dz){
  if(typeof h2oMacroTerrainHeight==='function'&&typeof h2oSeaLevelProxy==='function'){
    const sea=riverGpuEnsureCoastMask(core),N=riverGpuCoastMaskN;
    riverGpuDirToFaceUV(dx,dy,dz,riverGpuCoastTmp);
    const x=riverGpuClamp(Math.floor((riverGpuCoastTmp.u+1)*0.5*N),0,N-1);
    const y=riverGpuClamp(Math.floor((1-(riverGpuCoastTmp.v+1)*0.5)*N),0,N-1);
    const k=(riverGpuCoastTmp.face*N+y)*N+x,cached=riverGpuCoastMask[k];
    if(cached)return cached===1;
    const land=h2oMacroTerrainHeight(dx,dy,dz)>sea;riverGpuCoastMask[k]=land?1:2;return land;
  }
  if(typeof windDirToIndex==='function'){
    const i=windDirToIndex(core,dx,dy,dz);return i>=0&&i<core.count&&!riverIsOcean(core,i);
  }
  return true;
}
function riverGpuEdgeHash(seed,i,j,salt){
  let x=(seed|0)^Math.imul((i+1)|0,0x45d9f3b)^Math.imul((j+1)|0,0x119de1f3)^salt;
  x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;
  return (x>>>0)/4294967296*2-1;
}

/* Build a cheap reverse link: one upstream parent per cell (first writer wins).
   Enough for Catmull-Rom context; full multi-parent fans are not needed. */
function riverGpuBuildUpstream(core){
  const n=core.count, up=new Int32Array(n);up.fill(-1);
  const ds=core.riverDownstream;if(!ds)return up;
  for(let i=0;i<n;i++){
    const j=ds[i]|0;if(j<0||j>=n)continue;
    if(up[j]<0)up[j]=i;
  }
  return up;
}

/* Catmull-Rom on the sphere between P1 and P2, with P0/P3 as handles. */
function riverGpuCatmullDir(p0,p1,p2,p3,t,out){
  const t2=t*t,t3=t2*t;
  let x=0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3);
  let y=0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3);
  let z=0.5*((2*p1.z)+(-p0.z+p2.z)*t+(2*p0.z-5*p1.z+4*p2.z-p3.z)*t2+(-p0.z+3*p1.z-3*p2.z+p3.z)*t3);
  const q=Math.hypot(x,y,z)||1;out.x=x/q;out.y=y/q;out.z=z/q;return out;
}

function riverGpuCellDir(core,i,out){
  out.x=core.dirX[i];out.y=core.dirY[i];out.z=core.dirZ[i];
  const q=Math.hypot(out.x,out.y,out.z)||1;out.x/=q;out.y/=q;out.z/=q;return out;
}

function riverGpuPaintSplineSegment(core,i0,i1,i2,i3,s0,s1,w0,w1,tmp){
  const p0={x:0,y:0,z:0},p1={x:0,y:0,z:0},p2={x:0,y:0,z:0},p3={x:0,y:0,z:0},d={x:0,y:0,z:0};
  riverGpuCellDir(core,i0,p0);riverGpuCellDir(core,i1,p1);
  riverGpuCellDir(core,i2,p2);riverGpuCellDir(core,i3,p3);
  const dot=riverGpuClamp(p1.x*p2.x+p1.y*p2.y+p1.z*p2.z,-1,1);
  const ang=Math.acos(dot);
  let nx=p1.y*p2.z-p1.z*p2.y,ny=p1.z*p2.x-p1.x*p2.z,nz=p1.x*p2.y-p1.y*p2.x;
  const nq=Math.hypot(nx,ny,nz);if(nq>1e-9){nx/=nq;ny/=nq;nz/=nq;}else{nx=ny=nz=0;}
  const cellAng=2/Math.max(8,core.N||32);
  const h1=riverGpuEdgeHash(core.seed|0,i1,i2,0x2c1b3c6d);
  const h2=riverGpuEdgeHash(core.seed|0,i1,i2,0x165667b1);
  const phase0=riverGpuEdgeHash(core.seed|0,i1,i2,0x85ebca77)*Math.PI;
  const steps=Math.max(16,Math.min(96,Math.ceil(Math.max(ang,cellAng)*riverGpuN*3.2)));
  for(let s=0;s<=steps;s++){
    const t=s/steps;
    riverGpuCatmullDir(p0,p1,p2,p3,t,d);
    const wave=0.85*h1*Math.sin(Math.PI*t+phase0)+0.15*h2*Math.sin(2.1*Math.PI*t+phase0*1.3);
    const amp=cellAng*(0.12+0.06*Math.abs(h2))*(0.65+0.35*Math.sin(Math.PI*t));
    const bend=amp*wave;
    let dx=d.x+nx*bend,dy=d.y+ny*bend,dz=d.z+nz*bend;
    const q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
    if(!riverGpuDetailedLandAt(core,dx,dy,dz))return false;
    const strength=s0+(s1-s0)*t,width=w0+(w1-w0)*t;
    const widthScale=riverGpuClamp(Math.log2(1+width/18)/7.0,0,1);
    /* 0.5.148: radius in display texels (~13 km each). Ordinary stems stay a
       one-texel ridge; only physically wide channels (Amazon-class) reach
       two or three texels. */
    const radius=0.30+0.45*Math.pow(strength,0.9)+0.90*widthScale*widthScale;
    riverGpuPaintDir(riverGpuCurrRiver,dx,dy,dz,radius,0.22+0.78*strength,tmp);
  }
  return true;
}

function riverGpuPaintEdge(core,i,j,up,tmp){
  const ds=core.riverDownstream;
  const i0=(up[i]>=0)?up[i]:i;
  const i3=(j>=0&&j<core.count&&(ds[j]|0)>=0&&(ds[j]|0)<core.count)?(ds[j]|0):j;
  const s0=riverGpuClamp(core.riverChannelStrength?.[i]||0,0,1);
  const s1=riverIsOcean(core,j)?s0:riverGpuClamp(core.riverChannelStrength?.[j]||0,0,1);
  const w0=Math.max(0,Number(core.riverWidthM?.[i])||0);
  const w1=Math.max(0,Number(core.riverWidthM?.[j])||w0);
  riverGpuPaintSplineSegment(core,i0,i,j,i3,s0,s1,w0,w1,tmp);
}

function riverGpuVisualNode(core,branch,p,out){
  const cells=branch.cells,i=cells[p]|0;
  return riverGpuCellDir(core,i,out);
}

function riverGpuPaintVisualEdge(core,branch,p,tmp){
  const cells=branch.cells;if(!Array.isArray(cells)||cells.length<2)return;
  const n=cells.length;
  const base=riverGpuClamp(branch.strength||0.10,0.02,0.28);
  const i0=cells[Math.max(0,p-1)]|0,i1=cells[p]|0,i2=cells[p+1]|0,i3=cells[Math.min(n-1,p+2)]|0;
  const t0=p/Math.max(1,n-1),t1=(p+1)/Math.max(1,n-1);
  const s0=base*(0.35+0.65*t0),s1=base*(0.35+0.65*t1);
  const p0={x:0,y:0,z:0},p1={x:0,y:0,z:0},p2={x:0,y:0,z:0},p3={x:0,y:0,z:0},d={x:0,y:0,z:0};
  riverGpuCellDir(core,i0,p0);riverGpuCellDir(core,i1,p1);riverGpuCellDir(core,i2,p2);riverGpuCellDir(core,i3,p3);
  const dot=riverGpuClamp(p1.x*p2.x+p1.y*p2.y+p1.z*p2.z,-1,1),ang=Math.acos(dot);
  let nx=p1.y*p2.z-p1.z*p2.y,ny=p1.z*p2.x-p1.x*p2.z,nz=p1.x*p2.y-p1.y*p2.x;
  const nq=Math.hypot(nx,ny,nz);if(nq>1e-9){nx/=nq;ny/=nq;nz/=nq;}else{nx=ny=nz=0;}
  const cellAng=2/Math.max(8,core.N||32),h=riverGpuEdgeHash(core.seed|0,branch.source|0,i1,0x7811+p*53);
  const h2=riverGpuEdgeHash(core.seed|0,branch.source|0,i1,0x3c6ef372),phase0=h*Math.PI;
  const steps=Math.max(12,Math.min(64,Math.ceil(Math.max(ang,cellAng)*riverGpuN*3.0)));
  for(let s=0;s<=steps;s++){
    const t=s/steps;riverGpuCatmullDir(p0,p1,p2,p3,t,d);
    const wave=0.80*h*Math.sin(Math.PI*t+phase0)+0.20*h2*Math.sin(2.0*Math.PI*t+phase0*1.1);
    const amp=cellAng*(0.10+0.05*Math.abs(branch.phase||0))*(0.70+0.30*Math.sin(Math.PI*t));
    let dx=d.x+nx*amp*wave,dy=d.y+ny*amp*wave,dz=d.z+nz*amp*wave;
    const q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
    if(!riverGpuDetailedLandAt(core,dx,dy,dz))return false;
    const strength=s0+(s1-s0)*t,radius=0.25+0.35*Math.sqrt(strength);
    riverGpuPaintDir(riverGpuCurrRiver,dx,dy,dz,radius,0.16+0.50*strength,tmp);
  }
  return true;
}

function riverGpuPaintVisualBranch(core,branch,tmp){
  const cells=branch.cells;if(!Array.isArray(cells)||cells.length<2)return;
  for(let p=0;p<cells.length-1;p++)if(riverGpuPaintVisualEdge(core,branch,p,tmp)===false)break;
}

function riverGpuPaintVisualBranches(core,tmp){
  const branches=core?.riverVisualBranches;if(!Array.isArray(branches)||!branches.length)return;
  for(const branch of branches)riverGpuPaintVisualBranch(core,branch,tmp);
}

function riverGpuReadCurrent(core){
  for(let f=0;f<6;f++){riverGpuCurrRiver[f].fill(0);riverGpuCurrLake[f].fill(0);}
  const tmp={face:0,u:0,v:0};
  const up=riverGpuBuildUpstream(core);

  riverGpuPaintVisualBranches(core,tmp);

  for(let i=0;i<core.count;i++){
    const strength=riverGpuClamp(core.riverChannelStrength?.[i]||0,0,1);
    const lake=riverGpuClamp(core.riverLakeFraction?.[i]||0,0,1);
    const ix=core.dirX[i],iy=core.dirY[i],iz=core.dirZ[i];
    if(lake>0.02){
      const lr=0.95+3.2*Math.sqrt(lake);riverGpuPaintDir(riverGpuCurrLake,ix,iy,iz,lr,0.24+0.76*lake,tmp);
    }
    if(strength<0.008)continue;
    const j=core.riverDownstream?.[i]|0;
    if(j<0||j>=core.count){
      const width=Math.max(0,Number(core.riverWidthM?.[i])||0),ws=riverGpuClamp(Math.log2(1+width/18)/7.0,0,1);
      riverGpuPaintDir(riverGpuCurrRiver,ix,iy,iz,0.30+0.45*Math.pow(strength,0.9)+0.90*ws*ws,0.22+0.78*strength,tmp);
      continue;
    }
    riverGpuPaintEdge(core,i,j,up,tmp);
  }
}
function riverGpuCollapseVisible(blend){
  for(let f=0;f<6;f++){
    const pr=riverGpuPrevRiver[f],pl=riverGpuPrevLake[f],cr=riverGpuCurrRiver[f],cl=riverGpuCurrLake[f];
    for(let i=0;i<pr.length;i++){pr[i]+=(cr[i]-pr[i])*blend;pl[i]+=(cl[i]-pl[i])*blend;}
  }
}
function riverGpuPackUpload(){
  const N=riverGpuN;gl.activeTexture(gl.TEXTURE0+RIVER_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverGpuTex);
  for(let f=0;f<6;f++){
    const pix=riverGpuFaces[f],pr=riverGpuPrevRiver[f],pl=riverGpuPrevLake[f],cr=riverGpuCurrRiver[f],cl=riverGpuCurrLake[f];
    for(let i=0;i<pr.length;i++){const p=i*4;pix[p]=riverGpuByte(pr[i]);pix[p+1]=riverGpuByte(pl[i]);pix[p+2]=riverGpuByte(cr[i]);pix[p+3]=riverGpuByte(cl[i]);}
    gl.texSubImage2D(riverGpuFaceTarget(f),0,0,0,N,N,gl.RGBA,gl.UNSIGNED_BYTE,pix);
  }
  gl.activeTexture(gl.TEXTURE0);
}
function riverGpuUpload(core){
  if(!core?.N||!core?.riverChannelStrength)return false;riverGpuEnsure(riverGpuDisplayN(core.N));
  const now=riverGpuNowMs(),seed=core.seed|0,seedChanged=Number.isFinite(riverGpuLastSeed)&&riverGpuLastSeed!==seed;
  if(!riverGpuHasFrame||seedChanged){riverGpuReadCurrent(core);for(let f=0;f<6;f++){riverGpuPrevRiver[f].set(riverGpuCurrRiver[f]);riverGpuPrevLake[f].set(riverGpuCurrLake[f]);}riverGpuBlendDurationMs=1;riverGpuBlendStartMs=now;riverGpuHasFrame=true;}
  else{riverGpuCollapseVisible(riverGpuBlendAt(now));riverGpuReadCurrent(core);const interval=Number.isFinite(riverGpuLastUploadMs)?Math.max(1,now-riverGpuLastUploadMs):RIVER_BLEND_DEFAULT_MS;riverGpuBlendDurationMs=Math.max(RIVER_BLEND_MIN_MS,Math.min(RIVER_BLEND_MAX_MS,interval));riverGpuBlendStartMs=now;}
  riverGpuPackUpload();riverGpuLastUploadMs=now;riverGpuLastSeed=seed;core.riverGpuModel=RIVER_GPU_MODEL;return true;
}
const weatherCoreCreateBeforeRiverGpu=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){const core=weatherCoreCreateBeforeRiverGpu(seed,N,climate,axis);riverGpuUpload(core);return core;};
const weatherCoreStepBeforeRiverGpu=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){weatherCoreStepBeforeRiverGpu(core,dtSec,climate,axis);riverGpuUpload(core);return core;};
function riverGpuEnsureCurrent(){
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;if(!core)return null;
  if(!riverGpuTex||riverGpuN!==riverGpuDisplayN(core.N)||riverGpuLastSeed!==(core.seed|0))riverGpuUpload(core);return core;
}
