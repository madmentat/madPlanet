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

const RIVER_GPU_MODEL=14;
const RIVER_TEX_UNIT=2;
const RIVER_GPU_UPSCALE=16;
const RIVER_BLEND_DEFAULT_MS=900;
const RIVER_BLEND_MIN_MS=250;
const RIVER_BLEND_MAX_MS=1200;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uRiverTex','uRiverBlend','uRiverPhysicsOn','uRiverTexel'])if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
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


/* 0.5.154: display geometry.
   Drainage paths live on the 4-neighbour synoptic lattice (one cell ~500 km).
   0.5.153 corner-cut the staircase with Chaikin, which is exactly what made
   long straight diagonal "canals": a staircase averaged twice is a line. A
   real river meanders at every scale, so the smoothed polyline is now
   refined by seeded midpoint displacement (amplitude proportional to the
   segment length, three levels) before the Catmull-Rom trace. Junctions:
   the position of every painted node is remembered, a later chain that
   reaches an already painted cell snaps to that position and stops, and its
   last node is nudged downstream along the receiver so tributaries enter at
   an acute angle instead of as perpendicular comb teeth. Width is a
   one-texel ridge that grows only with discharge and physical width. */
const RIVER_GPU_CHAIKIN_ITERATIONS=2;
const RIVER_GPU_DISPLACE_LEVELS=3;
const RIVER_GPU_DISPLACE_AMP=0.19;
const RIVER_GPU_MAX_CHAIN=600;
let riverGpuNodePos=null,riverGpuNodePosN=0;
function riverGpuNorm(p){const q=Math.hypot(p.x,p.y,p.z)||1;p.x/=q;p.y/=q;p.z/=q;return p;}
function riverGpuLerpNode(a,b,t){
  return riverGpuNorm({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,s:a.s+(b.s-a.s)*t,w:a.w+(b.w-a.w)*t,k:(t<0.5?a.k:b.k)});
}
/* Chaikin corner cutting on the sphere; endpoints are kept. */
function riverGpuChaikin(pts,iterations){
  let cur=pts;
  for(let it=0;it<iterations;it++){
    if(cur.length<3)return cur;
    const out=[cur[0]];
    for(let k=0;k<cur.length-1;k++){out.push(riverGpuLerpNode(cur[k],cur[k+1],0.25));out.push(riverGpuLerpNode(cur[k],cur[k+1],0.75));}
    out.push(cur[cur.length-1]);cur=out;
  }
  return cur;
}
/* Seeded midpoint displacement: every level halves the segments and moves
   each new midpoint sideways by amp*length*hash. The hash is keyed by the
   lattice cell the point belongs to and the level, so the same physical edge
   always gets the same shape whichever chain paints it. */
function riverGpuDisplace(core,pts,levels,amp){
  let cur=pts;
  for(let lv=0;lv<levels;lv++){
    if(cur.length<2)return cur;
    const out=[cur[0]];
    for(let k=0;k<cur.length-1;k++){
      const a=cur[k],b=cur[k+1];
      const dot=riverGpuClamp(a.x*b.x+a.y*b.y+a.z*b.z,-1,1),len=Math.acos(dot);
      const m=riverGpuLerpNode(a,b,0.5);
      let nx=a.y*b.z-a.z*b.y,ny=a.z*b.x-a.x*b.z,nz=a.x*b.y-a.y*b.x;
      const nq=Math.hypot(nx,ny,nz);
      if(nq>1e-12&&len>1e-7){
        nx/=nq;ny/=nq;nz/=nq;
        const h=riverGpuEdgeHash(core.seed|0,(a.k|0)*7+lv,(b.k|0)*13+k,0x9e3779b1+lv*0x51f15e);
        const d=amp*len*h*Math.pow(0.62,lv);
        m.x+=nx*d;m.y+=ny*d;m.z+=nz*d;riverGpuNorm(m);
      }
      out.push(m);out.push(b);
    }
    cur=out;
  }
  return cur;
}
function riverGpuTrunkRadius(strength,widthM){
  const widthScale=riverGpuClamp(Math.log2(1+Math.max(0,widthM)/18)/7.0,0,1);
  /* radius in display texels (~13 km desktop, ~22 km phone) */
  return 0.28+0.55*Math.pow(riverGpuClamp(strength,0,1),1.3)+0.50*widthScale*widthScale;
}
/* Paint a smoothed, displaced polyline. Painting stops at the first
   fine-terrain ocean hit; node positions are recorded for junction snapping. */
function riverGpuPaintPolyline(core,pts,seedA,seedB,valueFn,radiusFn,tmp,recordNodes){
  if(pts.length<2)return;
  const sm=riverGpuDisplace(core,riverGpuChaikin(pts,RIVER_GPU_CHAIKIN_ITERATIONS),RIVER_GPU_DISPLACE_LEVELS,RIVER_GPU_DISPLACE_AMP);
  const d={x:0,y:0,z:0};
  for(let k=0;k<sm.length-1;k++){
    const p0=sm[Math.max(0,k-1)],p1=sm[k],p2=sm[k+1],p3=sm[Math.min(sm.length-1,k+2)];
    const dot=riverGpuClamp(p1.x*p2.x+p1.y*p2.y+p1.z*p2.z,-1,1),ang=Math.acos(dot);
    const steps=Math.max(3,Math.min(48,Math.ceil(ang*riverGpuN*2.4)));
    for(let q=0;q<=steps;q++){
      const t=q/steps;riverGpuCatmullDir(p0,p1,p2,p3,t,d);
      if(!riverGpuDetailedLandAt(core,d.x,d.y,d.z))return;
      const st=p1.s+(p2.s-p1.s)*t,w=p1.w+(p2.w-p1.w)*t;
      riverGpuPaintDir(riverGpuCurrRiver,d.x,d.y,d.z,radiusFn(st,w),valueFn(st),tmp);
    }
  }
  if(recordNodes)for(const p of pts)if(p.k>=0&&riverGpuNodePos&&!riverGpuNodePos.has(p.k))riverGpuNodePos.set(p.k,{x:p.x,y:p.y,z:p.z});
}
function riverGpuTrunkNode(core,i,out){
  riverGpuCellDir(core,i,out);
  out.s=riverGpuClamp(core.riverChannelStrength?.[i]||0,0,1);
  out.w=Math.max(0,Number(core.riverWidthM?.[i])||0);
  out.k=i;
  return out;
}
/* Tributary mouth: enter the receiver heading downstream. The last node is
   pulled 40% of the way from the receiver toward its own downstream cell, so
   the confluence is acute and reads as a river joining a river. */
function riverGpuAcuteMouth(core,pts,receiver){
  const ds=core.riverDownstream;if(!ds||pts.length<2)return;
  const j=ds[receiver]|0;if(j<0||j>=core.count||riverIsOcean(core,j))return;
  const last=pts[pts.length-1];
  const target=riverGpuNodePos&&riverGpuNodePos.get(j);
  const b={x:0,y:0,z:0};
  if(target){b.x=target.x;b.y=target.y;b.z=target.z;}else riverGpuCellDir(core,j,b);
  const m=riverGpuLerpNode({x:last.x,y:last.y,z:last.z,s:last.s,w:last.w,k:last.k},{x:b.x,y:b.y,z:b.z,s:last.s,w:last.w,k:last.k},0.40);
  last.x=m.x;last.y=m.y;last.z=m.z;
}
function riverGpuPaintTrunkChains(core,up,tmp){
  const n=core.count,strength=core.riverChannelStrength,ds=core.riverDownstream;
  if(!strength||!ds)return;
  const isChannel=i=>i>=0&&i<n&&riverGpuClamp(strength[i]||0,0,1)>=0.008&&!riverIsOcean(core,i);
  const heads=[];
  for(let i=0;i<n;i++){
    if(!isChannel(i))continue;
    const u=up[i];if(u>=0&&isChannel(u))continue;
    let len=0,j=i;while(isChannel(j)&&len<RIVER_GPU_MAX_CHAIN){len++;j=ds[j]|0;}
    heads.push([len,i]);
  }
  heads.sort((a,b)=>b[0]-a[0]);
  const painted=new Uint8Array(n);
  for(const [,head] of heads){
    const pts=[];let j=head,receiver=-1;
    while(j>=0&&j<n&&pts.length<RIVER_GPU_MAX_CHAIN){
      const node=riverGpuTrunkNode(core,j,{x:0,y:0,z:0,s:0,w:0,k:j});
      if(painted[j]){
        /* join an already painted stem at its actual drawn position */
        const pos=riverGpuNodePos.get(j);if(pos){node.x=pos.x;node.y=pos.y;node.z=pos.z;}
        pts.push(node);receiver=j;break;
      }
      pts.push(node);painted[j]=1;
      if(riverIsOcean(core,j))break;
      const nx=ds[j]|0;if(nx<0||nx>=n||nx===j)break;
      if(!isChannel(nx)){
        if(riverIsOcean(core,nx))pts.push(riverGpuTrunkNode(core,nx,{x:0,y:0,z:0,s:0,w:0,k:-1}));
        break;
      }
      j=nx;
    }
    if(receiver>=0)riverGpuAcuteMouth(core,pts,receiver);
    if(pts.length>=2)riverGpuPaintPolyline(core,pts,head,0x71,st=>0.22+0.78*st,riverGpuTrunkRadius,tmp,true);
    else if(pts.length===1)riverGpuPaintDir(riverGpuCurrRiver,pts[0].x,pts[0].y,pts[0].z,riverGpuTrunkRadius(pts[0].s,pts[0].w),0.22+0.78*pts[0].s,tmp);
  }
}
function riverGpuPaintVisualBranch(core,branch,tmp){
  const cells=branch.cells;if(!Array.isArray(cells)||cells.length<2)return;
  const n=cells.length,base=riverGpuClamp(branch.strength||0.10,0.02,0.28),pts=[];
  for(let p=0;p<n;p++){
    const i=cells[p]|0,node={x:0,y:0,z:0,s:0,w:0,k:i};riverGpuCellDir(core,i,node);
    node.s=base*(0.35+0.65*p/Math.max(1,n-1));
    /* branch nodes that coincide with painted stems snap to the drawn stem */
    const pos=riverGpuNodePos&&riverGpuNodePos.get(i);if(pos){node.x=pos.x;node.y=pos.y;node.z=pos.z;}
    pts.push(node);
  }
  riverGpuAcuteMouth(core,pts,cells[n-1]|0);
  riverGpuPaintPolyline(core,pts,branch.source|0,0x3c6e,st=>0.16+0.50*st,st=>0.26+0.45*Math.sqrt(st),tmp,false);
}
function riverGpuPaintVisualBranches(core,tmp){
  const branches=core?.riverVisualBranches;if(!Array.isArray(branches)||!branches.length)return;
  for(const branch of branches)riverGpuPaintVisualBranch(core,branch,tmp);
}

function riverGpuReadCurrent(core){
  for(let f=0;f<6;f++){riverGpuCurrRiver[f].fill(0);riverGpuCurrLake[f].fill(0);}
  const tmp={face:0,u:0,v:0};
  const up=riverGpuBuildUpstream(core);
  riverGpuNodePos=new Map();riverGpuNodePosN=core.count;
  for(let i=0;i<core.count;i++){
    const lake=riverGpuClamp(core.riverLakeFraction?.[i]||0,0,1);
    if(lake>0.02){
      const lr=0.95+3.2*Math.sqrt(lake);riverGpuPaintDir(riverGpuCurrLake,core.dirX[i],core.dirY[i],core.dirZ[i],lr,0.24+0.76*lake,tmp);
    }
  }
  /* stems first so tributaries and visual branches can snap to drawn nodes */
  riverGpuPaintTrunkChains(core,up,tmp);
  riverGpuPaintVisualBranches(core,tmp);
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
