/* ============ 0.5.131 / 0.5.132 / 0.5.138 / 0.5.139: physical rivers -> GPU cubemap ============ */
/*
   R/G = previous river/lake support, B/A = current river/lake support.
   One RGBA8 cubemap keeps the bridge WebGL1-friendly; the texture is updated
   only on Weather Core fixed ticks, never per render frame.

   0.5.138 made the coarse physical graph control geometry instead of visible
   pixels. 0.5.139 adds basin-constrained visual tributaries: the conservative
   graph still owns water and outlets, while thin sub-cell branches follow the
   additional admissible paths produced by river-visual-tributaries.js. Their
   lateral displacement collapses to zero at confluences so tributaries merge
   cleanly into the physical trunk rather than ending beside it.
*/

const RIVER_GPU_MODEL=5;
const RIVER_TEX_UNIT=2;
const RIVER_GPU_UPSCALE=8;
const RIVER_BLEND_DEFAULT_MS=900;
const RIVER_BLEND_MIN_MS=250;
const RIVER_BLEND_MAX_MS=1200;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uRiverTex','uRiverBlend','uRiverPhysicsOn'])if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}

let riverGpuTex=null,riverGpuN=0,riverGpuFaces=[];
let riverGpuPrevRiver=[],riverGpuPrevLake=[],riverGpuCurrRiver=[],riverGpuCurrLake=[];
let riverGpuHasFrame=false,riverGpuLastSeed=NaN,riverGpuBlendStartMs=0,riverGpuBlendDurationMs=1,riverGpuLastUploadMs=NaN;
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
  const N=riverGpuN,r=Math.max(0.18,Number(radius)||0.18),rr=Math.ceil(r+0.55);
  for(let dy=-rr;dy<=rr;dy++)for(let dx=-rr;dx<=rr;dx++){
    const d=Math.hypot(dx,dy);if(d>r+0.55)continue;const x=cx+dx,y=cy+dy;
    if(x<0||x>=N||y<0||y>=N)continue;
    const fall=riverGpuClamp(1-d/(r+0.66),0,1);
    const q=riverGpuClamp(value*(0.12+0.88*fall),0,1),k=y*N+x;
    if(q>field[face][k])field[face][k]=q;
  }
}
function riverGpuPaintDir(field,dx,dy,dz,radius,value,tmp){
  const q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;riverGpuDirToFaceUV(dx,dy,dz,tmp);
  const N=riverGpuN,cx=riverGpuClamp(Math.round((tmp.u+1)*0.5*(N-1)),0,N-1);
  const cy=riverGpuClamp((N-1)-Math.round((tmp.v+1)*0.5*(N-1)),0,N-1);
  riverGpuPaint(field,tmp.face,cx,cy,radius,value);
}
function riverGpuEdgeHash(seed,i,j,salt){
  let x=(seed|0)^Math.imul((i+1)|0,0x45d9f3b)^Math.imul((j+1)|0,0x119de1f3)^salt;
  x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;
  return (x>>>0)/4294967296*2-1;
}
function riverGpuPaintEdge(core,i,j,tmp){
  const ix=core.dirX[i],iy=core.dirY[i],iz=core.dirZ[i];
  const jx=core.dirX[j],jy=core.dirY[j],jz=core.dirZ[j];
  const si=riverGpuClamp(core.riverChannelStrength?.[i]||0,0,1);
  const sj=riverIsOcean(core,j)?si:riverGpuClamp(core.riverChannelStrength?.[j]||0,0,1);
  const wi=Math.max(0,Number(core.riverWidthM?.[i])||0),wj=Math.max(0,Number(core.riverWidthM?.[j])||wi);
  const dot=riverGpuClamp(ix*jx+iy*jy+iz*jz,-1,1),ang=Math.acos(dot);
  let nx=iy*jz-iz*jy,ny=iz*jx-ix*jz,nz=ix*jy-iy*jx;
  const nq=Math.hypot(nx,ny,nz);if(nq>1e-9){nx/=nq;ny/=nq;nz/=nq;}else{nx=ny=nz=0;}
  const h1=riverGpuEdgeHash(core.seed|0,i,j,0x2c1b3c6d),h2=riverGpuEdgeHash(core.seed|0,i,j,0x165667b1);
  const steps=Math.max(5,Math.min(40,Math.ceil(ang*riverGpuN*1.55)));
  for(let s=0;s<=steps;s++){
    const t=s/steps,omt=1-t;
    let dx=ix*omt+jx*t,dy=iy*omt+jy*t,dz=iz*omt+jz*t;
    let q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
    const bend=Math.sin(ang)*(0.18*h1*Math.sin(Math.PI*t)+0.055*h2*Math.sin(2*Math.PI*t));
    dx+=nx*bend;dy+=ny*bend;dz+=nz*bend;q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
    const strength=si+(sj-si)*t,width=wi+(wj-wi)*t;
    const widthScale=riverGpuClamp(Math.log2(1+width/18)/5.5,0,1);
    const radius=0.26+0.56*Math.sqrt(strength)+0.50*widthScale;
    riverGpuPaintDir(riverGpuCurrRiver,dx,dy,dz,radius,0.18+0.82*strength,tmp);
  }
}

function riverGpuVisualNode(core,branch,p,out){
  const cells=branch.cells,i=cells[p]|0,last=cells.length-1;
  let dx=core.dirX[i],dy=core.dirY[i],dz=core.dirZ[i];
  const q0=Math.hypot(dx,dy,dz)||1;dx/=q0;dy/=q0;dz/=q0;
  const progress=last>0?p/last:1;
  if(p<last&&!riverIsOcean(core,i)){
    const a=cells[Math.max(0,p-1)]|0,b=cells[Math.min(last,p+1)]|0;
    let tx=core.dirX[b]-core.dirX[a],ty=core.dirY[b]-core.dirY[a],tz=core.dirZ[b]-core.dirZ[a];
    const along=tx*dx+ty*dy+tz*dz;tx-=along*dx;ty-=along*dy;tz-=along*dz;
    let sx=dy*tz-dz*ty,sy=dz*tx-dx*tz,sz=dx*ty-dy*tx;
    const sq=Math.hypot(sx,sy,sz);
    if(sq>1e-9){
      sx/=sq;sy/=sq;sz/=sq;
      const cellAng=2/Math.max(8,core.N||32);
      const sign=riverGpuEdgeHash(core.seed|0,branch.source|0,i,0x5317+p*97);
      const amp=cellAng*(0.09+0.07*Math.abs(branch.phase||0))*Math.pow(Math.max(0,1-progress),0.72)*sign;
      dx+=sx*amp;dy+=sy*amp;dz+=sz*amp;
      const q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
    }
  }
  out.x=dx;out.y=dy;out.z=dz;return out;
}
function riverGpuPaintVisualEdge(core,branch,p,tmp,a,b){
  riverGpuVisualNode(core,branch,p,a);riverGpuVisualNode(core,branch,p+1,b);
  const dot=riverGpuClamp(a.x*b.x+a.y*b.y+a.z*b.z,-1,1),ang=Math.acos(dot);
  let nx=a.y*b.z-a.z*b.y,ny=a.z*b.x-a.x*b.z,nz=a.x*b.y-a.y*b.x;
  const nq=Math.hypot(nx,ny,nz);if(nq>1e-9){nx/=nq;ny/=nq;nz/=nq;}else{nx=ny=nz=0;}
  const cells=branch.cells,last=Math.max(1,cells.length-1);
  const h=riverGpuEdgeHash(core.seed|0,branch.source|0,cells[p]|0,0x7811+p*53);
  const steps=Math.max(4,Math.min(30,Math.ceil(ang*riverGpuN*1.65)));
  for(let s=0;s<=steps;s++){
    const t=s/steps,omt=1-t;
    let dx=a.x*omt+b.x*t,dy=a.y*omt+b.y*t,dz=a.z*omt+b.z*t;
    let q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
    const bend=Math.sin(ang)*0.075*h*Math.sin(Math.PI*t);
    dx+=nx*bend;dy+=ny*bend;dz+=nz*bend;q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
    const progress=(p+t)/last;
    const strength=riverGpuClamp((branch.strength||0.12)*(0.64+0.36*progress),0.04,0.42);
    const radius=0.18+0.28*Math.sqrt(strength);
    const value=0.105+0.56*strength;
    riverGpuPaintDir(riverGpuCurrRiver,dx,dy,dz,radius,value,tmp);
  }
}
function riverGpuPaintVisualBranches(core,tmp){
  const branches=core?.riverVisualBranches;if(!Array.isArray(branches)||!branches.length)return;
  const a={x:0,y:0,z:0},b={x:0,y:0,z:0};
  for(const branch of branches){
    const cells=branch?.cells;if(!Array.isArray(cells)||cells.length<2)continue;
    for(let p=0;p<cells.length-1;p++)riverGpuPaintVisualEdge(core,branch,p,tmp,a,b);
  }
}
function riverGpuReadCurrent(core){
  for(let f=0;f<6;f++){riverGpuCurrRiver[f].fill(0);riverGpuCurrLake[f].fill(0);}
  const tmp={face:0,u:0,v:0};

  /* Thin secondary tributaries first; authoritative trunk pixels painted below
     win at every confluence through the max compositor. */
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
      const width=Math.max(0,Number(core.riverWidthM?.[i])||0),ws=riverGpuClamp(Math.log2(1+width/18)/5.5,0,1);
      riverGpuPaintDir(riverGpuCurrRiver,ix,iy,iz,0.26+0.56*Math.sqrt(strength)+0.50*ws,0.18+0.82*strength,tmp);
      continue;
    }
    riverGpuPaintEdge(core,i,j,tmp);
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
