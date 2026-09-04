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

/*
   0.5.157: VECTOR channels. Even at 16x a corridor texel is ~13 km on the
   desktop grid and ~60 km on a phone (6x of a 28-cell face), so the visible
   channel could only be an FBM crack gated by a blocky mask: sticks, combs and
   right angles. The same Catmull edges (with their node-anchored meanders)
   are now ALSO collected as short great-circle chords with a physical angular
   half-width, indexed per cubemap bin, and drawn by shaders/surface.glsl as
   an analytic distance field with pixel anti-aliasing and a small continuous
   domain warp for sub-grid meanders. Geometry is then texel-independent at
   every zoom. The raster corridor remains the WebGL1 fallback, the riparian
   halo and the cheap LOD gate for the vector loop.
*/
const RIVER_GPU_MODEL=17;
const RIVER_TEX_UNIT=2;
const RIVER_VEC_BIN_N=48;             /* bins per cubemap face edge */
const RIVER_VEC_TEX_W=2048;           /* data texture width in texels */
const RIVER_VEC_MAX_SEGMENTS=180000;
const RIVER_VEC_PIECES_PER_EDGE=6;    /* chords per coarse graph edge */
const RIVER_VEC_BIN_MARGIN_RAD=0.016; /* widest channel + shader warp + AA reach */
const RIVER_VEC_BIN_UNIT=13,RIVER_VEC_LIST_UNIT=14;
const RIVER_GPU_UPSCALE=16;
const RIVER_BLEND_DEFAULT_MS=900;
const RIVER_BLEND_MIN_MS=250;
const RIVER_BLEND_MAX_MS=1200;

if(typeof UNIFORM_NAMES!=='undefined'){
  for(const n of ['uRiverTex','uRiverBlend','uRiverPhysicsOn','uRiverBinTex','uRiverListTex','uRiverVecOn','uRiverBinN','uRiverTexW'])if(!UNIFORM_NAMES.includes(n))UNIFORM_NAMES.push(n);
}

/* ---------------- vector channel table ---------------- */
let riverVecSegments=new Float32Array(0),riverVecCount=0,riverVecSegCap=0;
let riverVecBins=new Float32Array(0),riverVecList=new Float32Array(0),riverVecListCount=0;
/* De-indexed copy of the bin lists: entry k carries the whole chord record
   of riverVecList[k], so the shader loop needs two fetches per chord and no
   dependent index read. */
let riverVecListChords=new Float32Array(0);
let riverVecDirty=false,riverVecVersion=0,riverVecCollectOn=false;
function riverVecReset(){
  if(riverVecSegCap<RIVER_VEC_MAX_SEGMENTS){riverVecSegCap=RIVER_VEC_MAX_SEGMENTS;riverVecSegments=new Float32Array(riverVecSegCap*8);}
  riverVecCount=0;riverVecCollectOn=true;
}
/* Angular half-width of the drawn channel. Deliberately exaggerated against
   hydraulic geometry (a 200 m creek is invisible from orbit), but monotonic
   in channel strength and physical width so trunks read wider than feeders. */
function riverVecHalfWidthRad(strength,widthM,visual){
  strength=riverGpuClamp(strength,0,1);
  if(visual)return 0.00035+0.00100*strength;
  const ws=riverGpuClamp(Math.log2(1+Math.max(0,widthM)/18)/7.0,0,1);
  return 0.00045+0.00220*Math.pow(strength,1.3)+0.00120*ws*ws;
}
function riverVecPush(ax,ay,az,bx,by,bz,strength,halfWidth){
  if(riverVecCount>=riverVecSegCap)return;
  const o=riverVecCount*8,g=riverVecSegments;
  g[o]=ax;g[o+1]=ay;g[o+2]=az;g[o+3]=strength;g[o+4]=bx;g[o+5]=by;g[o+6]=bz;g[o+7]=halfWidth;
  riverVecCount++;
}
function riverVecBinOf(x,y,z){
  const ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z);let face,u,v;
  if(ax>=ay&&ax>=az){if(x>=0){face=0;u=-z/ax;v=y/ax;}else{face=1;u=z/ax;v=y/ax;}}
  else if(ay>=az){if(y>=0){face=2;u=x/ay;v=-z/ay;}else{face=3;u=x/ay;v=z/ay;}}
  else{if(z>=0){face=4;u=x/az;v=y/az;}else{face=5;u=-x/az;v=y/az;}}
  const B=RIVER_VEC_BIN_N;
  const cx=Math.max(0,Math.min(B-1,Math.floor((u+1)*0.5*B))),cy=Math.max(0,Math.min(B-1,Math.floor((v+1)*0.5*B)));
  return (face*B+cy)*B+cx;
}
/* Every bin whose area comes within the margin of a chord must list it.
   Samples along the chord plus eight margin offsets in the local tangent
   plane cover that, including across cubemap face seams. Lists are sorted
   by strength so a capped shader loop always sees the trunks first. */
function riverVecBuildIndex(){
  const B=RIVER_VEC_BIN_N,nb=6*B*B,m=RIVER_VEC_BIN_MARGIN_RAD;
  const counts=new Int32Array(nb),perSeg=new Array(riverVecCount),seen=new Set(),g=riverVecSegments;
  for(let i=0;i<riverVecCount;i++){
    const o=i*8,ax=g[o],ay=g[o+1],az=g[o+2],bx=g[o+4],by=g[o+5],bz=g[o+6];
    seen.clear();
    const mx=ax+bx,my=ay+by,mz=az+bz,mq=Math.hypot(mx,my,mz)||1,nx=mx/mq,ny=my/mq,nz=mz/mq;
    let t1x,t1y,t1z;
    if(Math.abs(ny)<0.9){t1x=-nz;t1y=0;t1z=nx;}else{t1x=0;t1y=nz;t1z=-ny;}
    const q=Math.hypot(t1x,t1y,t1z)||1;t1x/=q;t1y/=q;t1z/=q;
    const t2x=ny*t1z-nz*t1y,t2y=nz*t1x-nx*t1z,t2z=nx*t1y-ny*t1x;
    for(let s=0;s<=3;s++){
      const t=s/3,px=ax+(bx-ax)*t,py=ay+(by-ay)*t,pz=az+(bz-az)*t;
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)
        seen.add(riverVecBinOf(px+(t1x*ox+t2x*oy)*m,py+(t1y*ox+t2y*oy)*m,pz+(t1z*ox+t2z*oy)*m));
    }
    const arr=Array.from(seen);perSeg[i]=arr;for(const b of arr)counts[b]++;
  }
  const starts=new Int32Array(nb);let acc=0;for(let b=0;b<nb;b++){starts[b]=acc;acc+=counts[b];}
  const list=new Float32Array(Math.max(1,acc)),fill=new Int32Array(nb);
  for(let i=0;i<riverVecCount;i++)for(const b of perSeg[i]){list[starts[b]+fill[b]]=i;fill[b]++;}
  for(let b=0;b<nb;b++){
    const n=counts[b];if(n<2)continue;
    const sub=Array.from(list.subarray(starts[b],starts[b]+n));
    sub.sort((p,r)=>g[r*8+3]-g[p*8+3]);list.set(sub,starts[b]);
  }
  const bins=new Float32Array(nb*2);for(let b=0;b<nb;b++){bins[2*b]=starts[b];bins[2*b+1]=counts[b];}
  const chords=new Float32Array(Math.max(1,acc)*8);
  for(let k=0;k<acc;k++){const o=list[k]*8;for(let c=0;c<8;c++)chords[k*8+c]=g[o+c];}
  riverVecBins=bins;riverVecList=list;riverVecListCount=acc;riverVecListChords=chords;
}
function riverVecFinish(){
  riverVecCollectOn=false;riverVecBuildIndex();riverVecDirty=true;riverVecVersion++;
}
/* Snapshot for the worker -> main transfer (copies, so the worker keeps its own). */
function riverGpuVectorData(){
  const seg=riverVecSegments.slice(0,riverVecCount*8),bins=riverVecBins.slice(),list=riverVecList.slice(0,Math.max(1,riverVecListCount));
  const chords=riverVecListChords.slice(0,Math.max(1,riverVecListCount)*8);
  return {count:riverVecCount,binN:RIVER_VEC_BIN_N,seg,bins,list,chords,listCount:riverVecListCount,transfer:[seg.buffer,bins.buffer,list.buffer,chords.buffer]};
}
function riverGpuVectorSet(data){
  if(!data||!data.seg||!data.bins||!data.list||!data.chords)return;
  riverVecSegments=data.seg;riverVecCount=data.count|0;riverVecSegCap=riverVecCount;
  riverVecBins=data.bins;riverVecList=data.list;riverVecListCount=data.listCount|0;riverVecListChords=data.chords;
  riverVecDirty=true;riverVecVersion++;
}
/* Data textures (WebGL2 only): bins RG32F (start,count) and the de-indexed
   chord list RGBA32F (two texels per entry: A.xyz+strength, B.xyz+half-width).
   texelFetch in the shader addresses them with a fixed RIVER_VEC_TEX_W. The
   samplers must be declared highp: a default-precision sampler returns fp16
   on mobile GPUs, which snaps unit-sphere endpoints to ~0.001 rad. */
let riverVecBinTex=null,riverVecListTex=null,riverVecUploadedVersion=-1;
function riverVecUploadTexture(tex,unit,internal,format,channels,data,texelCount){
  const W=RIVER_VEC_TEX_W,rows=Math.max(1,Math.ceil(texelCount/W));
  const padded=new Float32Array(W*rows*channels);padded.set(data.subarray(0,Math.min(data.length,texelCount*channels)));
  gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,internal,W,rows,0,format,gl.FLOAT,padded);
  return rows;
}
function riverGpuVectorAvailable(){return typeof webglVersion==='number'&&webglVersion>=2&&typeof gl!=='undefined'&&!!gl;}
function riverGpuVectorUpload(){
  if(!riverGpuVectorAvailable()||!riverVecDirty||riverVecCount<1)return false;
  if(!riverVecListTex){riverVecBinTex=gl.createTexture();riverVecListTex=gl.createTexture();}
  riverVecUploadTexture(riverVecBinTex,RIVER_VEC_BIN_UNIT,gl.RG32F,gl.RG,2,riverVecBins,riverVecBins.length/2);
  riverVecUploadTexture(riverVecListTex,RIVER_VEC_LIST_UNIT,gl.RGBA32F,gl.RGBA,4,riverVecListChords,Math.max(1,riverVecListCount)*2);
  gl.activeTexture(gl.TEXTURE0);
  riverVecDirty=false;riverVecUploadedVersion=riverVecVersion;return true;
}
function riverGpuVectorBind(prog,U){
  if(!U)return;
  if(riverVecDirty)riverGpuVectorUpload();
  if(!riverVecListTex||!riverGpuVectorAvailable()){
    if(U.uRiverVecOn!==null&&U.uRiverVecOn!==undefined)gl.uniform1f(U.uRiverVecOn,0.0);return;
  }
  gl.activeTexture(gl.TEXTURE0+RIVER_VEC_BIN_UNIT);gl.bindTexture(gl.TEXTURE_2D,riverVecBinTex);
  gl.activeTexture(gl.TEXTURE0+RIVER_VEC_LIST_UNIT);gl.bindTexture(gl.TEXTURE_2D,riverVecListTex);
  gl.activeTexture(gl.TEXTURE0);
  if(U.uRiverBinTex!==null&&U.uRiverBinTex!==undefined)gl.uniform1i(U.uRiverBinTex,RIVER_VEC_BIN_UNIT);
  if(U.uRiverListTex!==null&&U.uRiverListTex!==undefined)gl.uniform1i(U.uRiverListTex,RIVER_VEC_LIST_UNIT);
  if(U.uRiverVecOn!==null&&U.uRiverVecOn!==undefined)gl.uniform1f(U.uRiverVecOn,1.0);
  if(U.uRiverBinN!==null&&U.uRiverBinN!==undefined)gl.uniform1f(U.uRiverBinN,RIVER_VEC_BIN_N);
  if(U.uRiverTexW!==null&&U.uRiverTexW!==undefined)gl.uniform1f(U.uRiverTexW,RIVER_VEC_TEX_W);
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
function riverGpuUseMipmaps(){return typeof webglVersion!=='undefined'&&webglVersion>=2;}
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
  /* 0.5.156: orbit views minify many corridor texels into one framebuffer
     pixel. Sampling only level zero aliases a one-texel river into a dotted or
     missing line. WebGL2 mipmaps preserve its fractional coverage without
     widening the level-zero corridor used by close views. */
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,riverGpuUseMipmaps()?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(webglVersion>=2)gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  for(let f=0;f<6;f++)gl.texImage2D(riverGpuFaceTarget(f),0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  if(riverGpuUseMipmaps())gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
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

/* Build one upstream handle per cell for Catmull-Rom context. Prefer the
   strongest contributing channel so the main stem, rather than an arbitrary
   side branch, controls the tangent through a confluence. */
function riverGpuBuildUpstream(core){
  const n=core.count, up=new Int32Array(n);up.fill(-1);
  const ds=core.riverDownstream,strength=core.riverChannelStrength;if(!ds)return up;
  for(let i=0;i<n;i++){
    const j=ds[i]|0;if(j<0||j>=n)continue;
    if(up[j]<0||(Number(strength?.[i])||0)>(Number(strength?.[up[j]])||0))up[j]=i;
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

/* 0.5.155: the cubemap is a narrow permission corridor again. Whole-chain
   Chaikin averaging made long D8 staircases into ruler-straight canals, while
   drawing its ridge directly in surface.glsl exposed every coarse turn. Work
   edge by edge with four-cell Catmull context, add a deterministic meander
   whose offset is exactly zero at both graph nodes, and let the sub-grid
   shader cut the visible channel inside this corridor. */
function riverGpuEdgeBend(core,i,j,t,cellAng,salt=0){
  const h1=riverGpuEdgeHash(core.seed|0,i,j,0x2c1b3c6d^salt);
  const h2=riverGpuEdgeHash(core.seed|0,i,j,0x165667b1^salt);
  const envelope=Math.sin(Math.PI*t);
  /* Squared envelope anchors both position and tangent at the graph nodes.
     The Catmull tangent can therefore carry a bend through a confluence
     without an edge-specific lateral derivative creating a visible corner. */
  const wave=envelope*envelope*(0.84*h1+0.16*h2*Math.sin(2*Math.PI*t));
  return cellAng*(0.10+0.05*Math.abs(h2))*wave;
}
function riverGpuCorridorRadius(strength,widthM){
  const widthScale=riverGpuClamp(Math.log2(1+Math.max(0,widthM)/18)/7.0,0,1);
  return 0.045+0.10*Math.pow(riverGpuClamp(strength,0,1),0.9)+0.22*widthScale*widthScale;
}
function riverGpuPaintSplineSegment(core,i0,i1,i2,i3,s0,s1,w0,w1,tmp,salt=0,visual=false){
  const p0={x:0,y:0,z:0},p1={x:0,y:0,z:0},p2={x:0,y:0,z:0},p3={x:0,y:0,z:0},d={x:0,y:0,z:0};
  riverGpuCellDir(core,i0,p0);riverGpuCellDir(core,i1,p1);
  riverGpuCellDir(core,i2,p2);riverGpuCellDir(core,i3,p3);
  const dot=riverGpuClamp(p1.x*p2.x+p1.y*p2.y+p1.z*p2.z,-1,1),ang=Math.acos(dot);
  let nx=p1.y*p2.z-p1.z*p2.y,ny=p1.z*p2.x-p1.x*p2.z,nz=p1.x*p2.y-p1.y*p2.x;
  const nq=Math.hypot(nx,ny,nz);if(nq>1e-9){nx/=nq;ny/=nq;nz/=nq;}else{nx=ny=nz=0;}
  const cellAng=2/Math.max(8,core.N||32);
  const steps=Math.max(16,Math.min(96,Math.ceil(Math.max(ang,cellAng)*riverGpuN*3.2)));
  /* Vector chords sample the same displaced spline at a coarser stride; the
     chain always starts on the node and ends either on the next node or at
     the first ocean sample so the mouth reaches the detailed coastline. */
  const vecEvery=Math.max(1,Math.round(steps/RIVER_VEC_PIECES_PER_EDGE));
  let vx=0,vy=0,vz=0,vs=0,vw=0,vHave=false;
  for(let q=0;q<=steps;q++){
    const t=q/steps;riverGpuCatmullDir(p0,p1,p2,p3,t,d);
    const bend=riverGpuEdgeBend(core,i1,i2,t,cellAng,salt)*(visual?0.88:1.0);
    let dx=d.x+nx*bend,dy=d.y+ny*bend,dz=d.z+nz*bend;
    const len=Math.hypot(dx,dy,dz)||1;dx/=len;dy/=len;dz/=len;
    const strength=s0+(s1-s0)*t,width=w0+(w1-w0)*t;
    if(!riverGpuDetailedLandAt(core,dx,dy,dz)){
      if(riverVecCollectOn&&vHave)riverVecPush(vx,vy,vz,dx,dy,dz,0.5*(vs+strength),riverVecHalfWidthRad(0.5*(vs+strength),0.5*(vw+width),visual));
      return false;
    }
    const radius=visual?(0.035+0.055*Math.sqrt(strength)):riverGpuCorridorRadius(strength,width);
    const value=visual?(0.16+0.50*strength):(0.22+0.78*strength);
    riverGpuPaintDir(riverGpuCurrRiver,dx,dy,dz,radius,value,tmp);
    if(riverVecCollectOn&&(q%vecEvery===0||q===steps)){
      if(vHave)riverVecPush(vx,vy,vz,dx,dy,dz,0.5*(vs+strength),riverVecHalfWidthRad(0.5*(vs+strength),0.5*(vw+width),visual));
      vx=dx;vy=dy;vz=dz;vs=strength;vw=width;vHave=true;
    }
  }
  return true;
}
function riverGpuPaintEdge(core,i,j,up,tmp){
  const ds=core.riverDownstream,i0=(up[i]>=0)?up[i]:i;
  const i3=(j>=0&&j<core.count&&(ds[j]|0)>=0&&(ds[j]|0)<core.count)?(ds[j]|0):j;
  const s0=riverGpuClamp(core.riverChannelStrength?.[i]||0,0,1);
  const s1=riverIsOcean(core,j)?s0:riverGpuClamp(core.riverChannelStrength?.[j]||0,0,1);
  const w0=Math.max(0,Number(core.riverWidthM?.[i])||0);
  const w1=Math.max(0,Number(core.riverWidthM?.[j])||w0);
  return riverGpuPaintSplineSegment(core,i0,i,j,i3,s0,s1,w0,w1,tmp,0,false);
}
function riverGpuPaintVisualEdge(core,branch,p,tmp){
  const cells=branch.cells,n=cells.length;
  const i0=cells[Math.max(0,p-1)]|0,i1=cells[p]|0,i2=cells[p+1]|0,i3=cells[Math.min(n-1,p+2)]|0;
  const base=riverGpuClamp(branch.strength||0.10,0.02,0.28);
  const s0=base*(0.35+0.65*p/Math.max(1,n-1));
  const s1=base*(0.35+0.65*(p+1)/Math.max(1,n-1));
  return riverGpuPaintSplineSegment(core,i0,i1,i2,i3,s0,s1,0,0,tmp,(branch.source|0)^((p+1)*0x7811),true);
}
function riverGpuPaintVisualBranch(core,branch,tmp){
  const cells=branch.cells;if(!Array.isArray(cells)||cells.length<2)return;
  for(let p=0;p<cells.length-1;p++)if(!riverGpuPaintVisualEdge(core,branch,p,tmp))break;
}
function riverGpuPaintVisualBranches(core,tmp){
  const branches=core?.riverVisualBranches;if(!Array.isArray(branches)||!branches.length)return;
  for(const branch of branches)riverGpuPaintVisualBranch(core,branch,tmp);
}

function riverGpuReadCurrent(core){
  for(let f=0;f<6;f++){riverGpuCurrRiver[f].fill(0);riverGpuCurrLake[f].fill(0);}
  const tmp={face:0,u:0,v:0};
  const up=riverGpuBuildUpstream(core);
  riverVecReset();
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
      riverGpuPaintDir(riverGpuCurrRiver,ix,iy,iz,riverGpuCorridorRadius(strength,core.riverWidthM?.[i]),0.22+0.78*strength,tmp);
      continue;
    }
    riverGpuPaintEdge(core,i,j,up,tmp);
  }
  riverVecFinish();
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
  if(riverGpuUseMipmaps())gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  gl.activeTexture(gl.TEXTURE0);
}
function riverGpuUpload(core){
  if(!core?.N||!core?.riverChannelStrength)return false;riverGpuEnsure(riverGpuDisplayN(core.N));
  const now=riverGpuNowMs(),seed=core.seed|0,seedChanged=Number.isFinite(riverGpuLastSeed)&&riverGpuLastSeed!==seed;
  if(!riverGpuHasFrame||seedChanged){riverGpuReadCurrent(core);for(let f=0;f<6;f++){riverGpuPrevRiver[f].set(riverGpuCurrRiver[f]);riverGpuPrevLake[f].set(riverGpuCurrLake[f]);}riverGpuBlendDurationMs=1;riverGpuBlendStartMs=now;riverGpuHasFrame=true;}
  else{riverGpuCollapseVisible(riverGpuBlendAt(now));riverGpuReadCurrent(core);const interval=Number.isFinite(riverGpuLastUploadMs)?Math.max(1,now-riverGpuLastUploadMs):RIVER_BLEND_DEFAULT_MS;riverGpuBlendDurationMs=Math.max(RIVER_BLEND_MIN_MS,Math.min(RIVER_BLEND_MAX_MS,interval));riverGpuBlendStartMs=now;}
  riverGpuPackUpload();riverGpuVectorUpload();riverGpuLastUploadMs=now;riverGpuLastSeed=seed;core.riverGpuModel=RIVER_GPU_MODEL;return true;
}
const weatherCoreCreateBeforeRiverGpu=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){const core=weatherCoreCreateBeforeRiverGpu(seed,N,climate,axis);riverGpuUpload(core);return core;};
const weatherCoreStepBeforeRiverGpu=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){weatherCoreStepBeforeRiverGpu(core,dtSec,climate,axis);riverGpuUpload(core);return core;};
function riverGpuEnsureCurrent(){
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;if(!core)return null;
  if(!riverGpuTex||riverGpuN!==riverGpuDisplayN(core.N)||riverGpuLastSeed!==(core.seed|0))riverGpuUpload(core);return core;
}
