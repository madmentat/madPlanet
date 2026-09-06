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

const RIVER_GPU_MODEL=10;
const RIVER_TEX_UNIT=2;
const RIVER_LOOP_TEX_UNIT=8;
const RIVER_LOOP_FILTER_MODEL=1;
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

/* 0.5.178 loop filter.
   The historic 0.5.147 visible river is a zero-contour of a procedural scalar.
   On the sphere those contours are naturally closed. We do NOT redraw them.
   Instead, once per generated surface, a coarse cubemap classifies only the
   contour components that are closed entirely on land. Those components get
   a local kill mask; every coast/lake-connected component remains byte-for-byte
   the old 0.5.147 artwork in surface.glsl. */
let riverLoopTex=null,riverLoopN=0,riverLoopFaces=[];
let riverLoopReady=false,riverLoopSupported=false,riverLoopSignature='';

function riverLoopFract(x){return x-Math.floor(x);}
function riverLoopMix(a,b,t){return a+(b-a)*t;}
function riverLoopHash33(x,y,z,out){
  x=riverLoopFract(x*0.1031);y=riverLoopFract(y*0.1030);z=riverLoopFract(z*0.0973);
  const d=x*(y+33.33)+y*(x+33.33)+z*(z+33.33);x+=d;y+=d;z+=d;
  out[0]=riverLoopFract((x+y)*z);
  out[1]=riverLoopFract((x+x)*y);
  out[2]=riverLoopFract((y+x)*x);
  return out;
}
function riverLoopNoise3(x,y,z){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const fx=x-ix,fy=y-iy,fz=z-iz;
  const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy),uz=fz*fz*(3-2*fz);
  const h=[0,0,0],dot=(ox,oy,oz)=>{
    riverLoopHash33(ix+ox,iy+oy,iz+oz,h);
    return (h[0]-0.5)*(fx-ox)+(h[1]-0.5)*(fy-oy)+(h[2]-0.5)*(fz-oz);
  };
  const a=dot(0,0,0),b=dot(1,0,0),c=dot(0,1,0),d=dot(1,1,0);
  const e=dot(0,0,1),g=dot(1,0,1),hh=dot(0,1,1),k=dot(1,1,1);
  const z0=riverLoopMix(riverLoopMix(a,b,ux),riverLoopMix(c,d,ux),uy);
  const z1=riverLoopMix(riverLoopMix(e,g,ux),riverLoopMix(hh,k,ux),uy);
  return 2*riverLoopMix(z0,z1,uz);
}
function riverLoopFbm(x,y,z,oct){
  let a=0.5,s=0;
  for(let i=0;i<oct;i++){
    s+=a*riverLoopNoise3(x,y,z);
    const nx=(-0.80*y-0.60*z)*2.03+3.1;
    const ny=( 0.80*x+0.36*y-0.48*z)*2.03+3.1;
    const nz=( 0.60*x-0.48*y+0.64*z)*2.03+3.1;
    x=nx;y=ny;z=nz;a*=0.5;
  }
  return s;
}
function riverLoopScalar(dx,dy,dz,seedS){
  const sx=Number(seedS?.[0])||0,sy=Number(seedS?.[1])||0,sz=Number(seedS?.[2])||0;
  const wx=riverLoopFbm(dx*3.1+sx,dy*3.1+sy,dz*3.1+sz,3);
  const wy=riverLoopFbm(dx*3.1+sx+7.7,dy*3.1+sy+7.7,dz*3.1+sz+7.7,3);
  return riverLoopFbm(dx*5.2+sx*1.9+0.5*wx,
                      dy*5.2+sy*1.9+0.5*wy,
                      dz*5.2+sz*1.9,4);
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
function riverLoopWaterAt(core,dx,dy,dz){
  if(typeof windDirToIndex!=='function')return false;
  const i=windDirToIndex(core,dx,dy,dz);
  if(!(i>=0&&i<core.count))return false;
  if(typeof riverIsOcean==='function'&&riverIsOcean(core,i))return true;
  if((Number(core.riverLakeFraction?.[i])||0)>0.045)return true;
  return (Number(core.surfaceWaterFraction?.[i])||0)>0.55;
}
function riverLoopEnsureTexture(N){
  const maxUnits=Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))||8;
  riverLoopSupported=maxUnits>RIVER_LOOP_TEX_UNIT;
  if(!riverLoopSupported){riverLoopReady=false;return false;}
  if(riverLoopTex&&riverLoopN===N)return true;
  if(riverLoopTex)gl.deleteTexture(riverLoopTex);
  riverLoopN=N;riverLoopFaces=Array.from({length:6},()=>new Uint8Array(N*N*4));
  riverLoopTex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE0+RIVER_LOOP_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverLoopTex);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(webglVersion>=2)gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  for(let f=0;f<6;f++)gl.texImage2D(riverGpuFaceTarget(f),0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);gl.activeTexture(gl.TEXTURE0);
  riverLoopReady=false;return true;
}
function riverLoopBuildMask(core){
  if(!core?.N||!world?.seedS)return false;
  const N=Math.max(RIVER_LOOP_MIN_N,Math.min(RIVER_LOOP_MAX_N,Math.round(core.N*5)));
  if(!riverLoopEnsureTexture(N))return false;
  const sig=(core.seed|0)+'|'+String(core.h2oSurfaceSignature||'')+'|'+world.seedS.map(v=>Number(v).toFixed(5)).join(',');
  if(riverLoopReady&&riverLoopSignature===sig)return true;

  const facePix=N*N,total=6*facePix;
  const active=new Uint8Array(total),water=new Uint8Array(total),visited=new Uint8Array(total);
  const keep=new Uint8Array(total);keep.fill(255);
  const corners=Array.from({length:6},()=>new Float32Array((N+1)*(N+1)));
  const d=[0,0,0];

  /* Marching-squares occupancy of the same rn=0 contour used by 0.5.147.
     Width is deliberately ignored: component topology belongs to the zero
     contour, while the original shader remains the owner of visible width. */
  for(let f=0;f<6;f++){
    const cv=corners[f];
    for(let y=0;y<=N;y++)for(let x=0;x<=N;x++){
      riverLoopFaceDir(f,x,y,N,d);
      cv[y*(N+1)+x]=riverLoopScalar(d[0],d[1],d[2],world.seedS);
    }
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      const a=cv[y*(N+1)+x],b=cv[y*(N+1)+x+1],c=cv[(y+1)*(N+1)+x],e=cv[(y+1)*(N+1)+x+1];
      const lo=Math.min(a,b,c,e),hi=Math.max(a,b,c,e),idx=riverLoopIndex(f,x,y,N);
      if(lo<=0&&hi>=0)active[idx]=1;
      riverLoopFaceDir(f,x+0.5,y+0.5,N,d);
      if(riverLoopWaterAt(core,d[0],d[1],d[2]))water[idx]=1;
    }
  }

  const queue=new Int32Array(total),cell={face:0,x:0,y:0},uv={face:0,u:0,v:0},nd=[0,0,0];
  let head=0,tail=0,removedComponents=0,removedPixels=0;
  const dirs=[-1,-1,0,-1,1,-1,-1,0,1,0,-1,1,0,1,1,1];

  for(let seed=0;seed<total;seed++){
    if(!active[seed]||water[seed]||visited[seed])continue;
    const start=tail;queue[tail++]=seed;visited[seed]=1;let anchored=false;
    while(head<tail){
      const idx=queue[head++];riverLoopIndexToCell(idx,N,cell);
      for(let k=0;k<dirs.length;k+=2){
        const ni=riverLoopNeighborIndex(cell.face,cell.x,cell.y,dirs[k],dirs[k+1],N,nd,uv);
        if(!active[ni])continue;
        if(water[ni]){anchored=true;continue;}
        if(!visited[ni]){visited[ni]=1;queue[tail++]=ni;}
      }
    }
    if(anchored)continue;

    /* This entire land-only component is a closed procedural contour. Kill
       only a one-pixel neighbourhood around it. Everywhere else keep=255, so
       coast-connected 0.5.147 rivers are visually untouched. */
    removedComponents++;
    for(let q=start;q<tail;q++){
      const idx=queue[q];if(keep[idx]){keep[idx]=0;removedPixels++;}
      riverLoopIndexToCell(idx,N,cell);
      for(let k=0;k<dirs.length;k+=2){
        const ni=riverLoopNeighborIndex(cell.face,cell.x,cell.y,dirs[k],dirs[k+1],N,nd,uv);
        keep[ni]=0;
      }
    }
  }

  for(let f=0;f<6;f++){
    const pix=riverLoopFaces[f],off=f*facePix;
    for(let i=0;i<facePix;i++){
      const v=keep[off+i],p=i*4;pix[p]=v;pix[p+1]=v;pix[p+2]=v;pix[p+3]=255;
    }
  }
  gl.activeTexture(gl.TEXTURE0+RIVER_LOOP_TEX_UNIT);gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverLoopTex);
  for(let f=0;f<6;f++)gl.texSubImage2D(riverGpuFaceTarget(f),0,0,0,N,N,gl.RGBA,gl.UNSIGNED_BYTE,riverLoopFaces[f]);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);gl.activeTexture(gl.TEXTURE0);

  riverLoopSignature=sig;riverLoopReady=true;
  core.riverLoopFilterModel=RIVER_LOOP_FILTER_MODEL;
  core.riverLoopRemovedComponents=removedComponents;
  core.riverLoopRemovedPixels=removedPixels;
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
    const strength=s0+(s1-s0)*t,width=w0+(w1-w0)*t;
    const widthScale=riverGpuClamp(Math.log2(1+width/18)/7.0,0,1);
    const radius=0.045+0.10*Math.pow(strength,0.9)+0.22*widthScale*widthScale;
    riverGpuPaintDir(riverGpuCurrRiver,dx,dy,dz,radius,0.22+0.78*strength,tmp);
  }
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

function riverGpuPaintVisualBranch(core,branch,tmp){
  const cells=branch.cells;if(!Array.isArray(cells)||cells.length<2)return;
  const n=cells.length;
  const base=riverGpuClamp(branch.strength||0.10,0.02,0.28);
  for(let p=0;p<n-1;p++){
    const i0=cells[Math.max(0,p-1)]|0;
    const i1=cells[p]|0;
    const i2=cells[p+1]|0;
    const i3=cells[Math.min(n-1,p+2)]|0;
    const t0=p/Math.max(1,n-1),t1=(p+1)/Math.max(1,n-1);
    const s0=base*(0.35+0.65*t0),s1=base*(0.35+0.65*t1);
    const p0={x:0,y:0,z:0},p1={x:0,y:0,z:0},p2={x:0,y:0,z:0},p3={x:0,y:0,z:0},d={x:0,y:0,z:0};
    riverGpuCellDir(core,i0,p0);riverGpuCellDir(core,i1,p1);
    riverGpuCellDir(core,i2,p2);riverGpuCellDir(core,i3,p3);
    const dot=riverGpuClamp(p1.x*p2.x+p1.y*p2.y+p1.z*p2.z,-1,1);
    const ang=Math.acos(dot);
    let nx=p1.y*p2.z-p1.z*p2.y,ny=p1.z*p2.x-p1.x*p2.z,nz=p1.x*p2.y-p1.y*p2.x;
    const nq=Math.hypot(nx,ny,nz);if(nq>1e-9){nx/=nq;ny/=nq;nz/=nq;}else{nx=ny=nz=0;}
    const cellAng=2/Math.max(8,core.N||32);
    const h=riverGpuEdgeHash(core.seed|0,branch.source|0,i1,0x7811+p*53);
    const h2=riverGpuEdgeHash(core.seed|0,branch.source|0,i1,0x3c6ef372);
    const phase0=h*Math.PI;
    const steps=Math.max(12,Math.min(64,Math.ceil(Math.max(ang,cellAng)*riverGpuN*3.0)));
    for(let s=0;s<=steps;s++){
      const t=s/steps;
      riverGpuCatmullDir(p0,p1,p2,p3,t,d);
      const wave=0.80*h*Math.sin(Math.PI*t+phase0)+0.20*h2*Math.sin(2.0*Math.PI*t+phase0*1.1);
      const amp=cellAng*(0.10+0.05*Math.abs(branch.phase||0))*(0.70+0.30*Math.sin(Math.PI*t));
      let dx=d.x+nx*amp*wave,dy=d.y+ny*amp*wave,dz=d.z+nz*amp*wave;
      const q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
      const strength=s0+(s1-s0)*t;
      const radius=0.035+0.055*Math.sqrt(strength);
      riverGpuPaintDir(riverGpuCurrRiver,dx,dy,dz,radius,0.16+0.50*strength,tmp);
    }
  }
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
      riverGpuPaintDir(riverGpuCurrRiver,ix,iy,iz,0.045+0.10*Math.pow(strength,0.9)+0.22*ws*ws,0.22+0.78*strength,tmp);
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
  riverLoopBuildMask(core);
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

if(typeof window!=='undefined')window.__madPlanetRiverLoopFilter={
  model:RIVER_LOOP_FILTER_MODEL,
  rebuild:()=>{riverLoopReady=false;const c=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;return c?riverLoopBuildMask(c):false;},
  get ready(){return riverLoopReady;},
  get supported(){return riverLoopSupported;},
  get resolution(){return riverLoopN;}
};
