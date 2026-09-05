/* ============ 0.5.160: river geometry from the rendered terrain ============ */
/*
   The synoptic Weather Core grid (~500 km cells on a macro continent field
   that has no tectonic belts) is far too coarse to decide WHERE a river
   runs: its D8 graph walked straight across mountain ranges, joined feeders
   as combs and grew continent-wide megastructures. Geometry now comes from
   the terrain the viewer actually sees. The main thread bakes terrain() into
   a cubed sphere of RDF_FACE_N cells per face (~40 km at a face centre), and
   this module:
     1. fills depressions with Priority-Flood (+epsilon), so every land cell
        drains monotonically to the sea and every pit becomes a lake;
     2. routes steepest-descent D8 flow on the filled surface (never uphill,
        never a cycle, one outlet per basin: no coast-to-coast canals);
     3. accumulates runoff-weighted contributing area, the only thing the
        Weather Core still decides: how wet a basin is;
     4. starts channels where that wet area passes a threshold and publishes
        source-to-mouth node chains (relaxed against the D8 staircase) as
        chords for the analytic renderer, plus the raster corridor and lakes.
   Rivers therefore dry out or freeze with the climate, but their courses are
   carved once into the landscape.
*/
const RDF_MODEL=1;
const RDF_FACE_N_DESKTOP=256;
const RDF_FACE_N_MOBILE=224;
const RDF_FLOOD_EPS=4e-6;
const RDF_Q_START_CELLS=40;      /* wet-weighted face-centre cell areas that start a channel */
const RDF_Q_FULL_CELLS=3000;     /* Amazon-class trunk */
const RDF_LAKE_MIN_DEPTH=0.006;  /* filled - h, terrain units */
const RDF_RUNOFF_REF=1.05e-5;    /* kg/m^2/s, ~331 mm/yr land mean */
const RDF_RELAX_MAX_CELL=0.45;
const RDF_HEAD_TAPER=0.40;
const RDF_PLANET_RADIUS_M=6371000;

let rdfDrainage=null;            /* {F,n,sig,h,filled,ds,order,orderCount,land,area,depth} */
let rdfTerrainPending=null;      /* {F,h,sig} waiting to be built */
let rdfCoarseCache=null;         /* {F,N,idx} */
let rdfSentSig='';               /* main thread: signature last handed to the worker */
let rdfWet=null,rdfAccQ=null,rdfPos=null;

function rdfFaceN(){
  const mobile=(typeof mobileDevice!=='undefined')?!!mobileDevice:
    ((typeof navigator!=='undefined'&&/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent||''))||false);
  return mobile?RDF_FACE_N_MOBILE:RDF_FACE_N_DESKTOP;
}
function rdfClamp(x,a,b){return x<a?a:(x>b?b:x);}
function rdfFaceDir(face,u,v,out){
  if(face===0){out[0]=1;out[1]=v;out[2]=-u;}
  else if(face===1){out[0]=-1;out[1]=v;out[2]=u;}
  else if(face===2){out[0]=u;out[1]=1;out[2]=-v;}
  else if(face===3){out[0]=u;out[1]=-1;out[2]=v;}
  else if(face===4){out[0]=u;out[1]=v;out[2]=1;}
  else{out[0]=-u;out[1]=v;out[2]=-1;}
  return out;
}
function rdfCellDir(F,i,out){
  const ff=F*F,face=(i/ff)|0,r=i-face*ff,y=(r/F)|0,x=r-y*F;
  rdfFaceDir(face,(x+0.5)*2/F-1,(y+0.5)*2/F-1,out);
  const q=Math.hypot(out[0],out[1],out[2])||1;out[0]/=q;out[1]/=q;out[2]/=q;return out;
}
function rdfDirToIndex(F,x,y,z){
  const ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z);let face,u,v;
  if(ax>=ay&&ax>=az){if(x>=0){face=0;u=-z/ax;v=y/ax;}else{face=1;u=z/ax;v=y/ax;}}
  else if(ay>=az){if(y>=0){face=2;u=x/ay;v=-z/ay;}else{face=3;u=x/ay;v=z/ay;}}
  else{if(z>=0){face=4;u=x/az;v=y/az;}else{face=5;u=-x/az;v=y/az;}}
  const cx=rdfClamp(Math.floor((u+1)*0.5*F),0,F-1),cy=rdfClamp(Math.floor((v+1)*0.5*F),0,F-1);
  return (face*F+cy)*F+cx;
}
const rdfTmpDir=[0,0,0];
/* Eight-neighbour on the cubed sphere. Inside a face this is plain index
   arithmetic; across an edge the out-of-range face coordinate is projected
   through the sphere onto the adjacent face. */
function rdfNeighbour(F,i,dx,dy){
  const ff=F*F,face=(i/ff)|0,r=i-face*ff,y=(r/F)|0,x=r-y*F;
  const nx=x+dx,ny=y+dy;
  if(nx>=0&&nx<F&&ny>=0&&ny<F)return face*ff+ny*F+nx;
  rdfFaceDir(face,(nx+0.5)*2/F-1,(ny+0.5)*2/F-1,rdfTmpDir);
  return rdfDirToIndex(F,rdfTmpDir[0],rdfTmpDir[1],rdfTmpDir[2]);
}
function rdfCellArea(F,i){
  const ff=F*F,face=(i/ff)|0,r=i-face*ff,y=(r/F)|0,x=r-y*F;
  const u=(x+0.5)*2/F-1,v=(y+0.5)*2/F-1,s=1+u*u+v*v;
  return 1/(s*Math.sqrt(s));
}
const RDF_DX=[-1,0,1,-1,1,-1,0,1],RDF_DY=[-1,-1,-1,0,0,1,1,1];
const RDF_DIST=[Math.SQRT2,1,Math.SQRT2,1,1,Math.SQRT2,1,Math.SQRT2];

/* Binary min-heap of cell indices keyed by a Float32Array that never changes
   after a cell is pushed. */
function rdfHeapPush(heap,size,key,i){
  let k=size;heap[k]=i;
  while(k>0){const p=(k-1)>>1;if(key[heap[p]]<=key[heap[k]])break;const t=heap[p];heap[p]=heap[k];heap[k]=t;k=p;}
  return size+1;
}
function rdfHeapPop(heap,size,key){
  const top=heap[0];size--;if(size>0){heap[0]=heap[size];let k=0;
    for(;;){const l=2*k+1,r=l+1;let m=k;
      if(l<size&&key[heap[l]]<key[heap[m]])m=l;
      if(r<size&&key[heap[r]]<key[heap[m]])m=r;
      if(m===k)break;const t=heap[m];heap[m]=heap[k];heap[k]=t;k=m;}}
  return top;
}

/* Priority-Flood with epsilon, then steepest-descent D8 on the filled
   surface. order[] is the pop order (non-decreasing filled height), so its
   reverse is a topological order for accumulation. */
function rdfBuild(F,h,sig){
  const n=6*F*F,filled=new Float32Array(n),land=new Uint8Array(n),area=new Float32Array(n);
  const ds=new Int32Array(n).fill(-1),order=new Int32Array(n),visited=new Uint8Array(n),heap=new Int32Array(n);
  let size=0,count=0;
  for(let i=0;i<n;i++){land[i]=h[i]>0?1:0;area[i]=rdfCellArea(F,i);}
  for(let i=0;i<n;i++){
    if(land[i])continue;
    filled[i]=h[i];visited[i]=1;
    let coast=false;for(let k=0;k<8&&!coast;k++)if(land[rdfNeighbour(F,i,RDF_DX[k],RDF_DY[k])])coast=true;
    if(coast)size=rdfHeapPush(heap,size,filled,i);
  }
  while(size>0){
    const c=rdfHeapPop(heap,size,filled);size--;order[count++]=c;
    for(let k=0;k<8;k++){
      const nb=rdfNeighbour(F,c,RDF_DX[k],RDF_DY[k]);
      if(visited[nb])continue;visited[nb]=1;
      const f=filled[c]+RDF_FLOOD_EPS;filled[nb]=h[nb]>f?h[nb]:f;ds[nb]=c;
      size=rdfHeapPush(heap,size,filled,nb);
    }
  }
  /* Land not reached by the flood (a landlocked planet or a face of pure
     land) keeps ds=-1 and never accumulates; that is the honest answer. */
  for(let q=0;q<count;q++){
    const c=order[q];if(!land[c])continue;
    let best=ds[c],bestSlope=-1;
    const fc=filled[c];
    for(let k=0;k<8;k++){
      const nb=rdfNeighbour(F,c,RDF_DX[k],RDF_DY[k]);if(nb===c||!visited[nb])continue;
      const df=fc-filled[nb];if(df<=0)continue;
      const slope=df/RDF_DIST[k];if(slope>bestSlope){bestSlope=slope;best=nb;}
    }
    ds[c]=best;
  }
  const depth=new Float32Array(n);for(let i=0;i<n;i++)depth[i]=land[i]?Math.max(0,filled[i]-h[i]):0;
  return {F,n,sig,h,filled,ds,order,orderCount:count,land,area,depth};
}

function rdfEnsureCoarse(d,core){
  const N=core?.N|0;if(!N||typeof windDirToIndex!=='function')return null;
  if(rdfCoarseCache&&rdfCoarseCache.F===d.F&&rdfCoarseCache.N===N)return rdfCoarseCache.idx;
  const idx=new Int32Array(d.n),dir=[0,0,0];
  for(let i=0;i<d.n;i++){rdfCellDir(d.F,i,dir);idx[i]=windDirToIndex(core,dir[0],dir[1],dir[2]);}
  rdfCoarseCache={F:d.F,N,idx};return idx;
}
/* Wetness per fine cell: the basin's runoff from the Weather Core, relative
   to the Earth-like land mean. Missing physics degrades to uniform 1. */
function rdfWetness(d,core){
  if(!rdfWet||rdfWet.length!==d.n)rdfWet=new Float32Array(d.n);
  const idx=rdfEnsureCoarse(d,core),run=core?.riverRunoffMean;
  if(!idx||!run){rdfWet.fill(1);return rdfWet;}
  for(let i=0;i<d.n;i++){
    if(!d.land[i]){rdfWet[i]=0;continue;}
    const c=idx[i];const r=(c>=0&&c<run.length)?Number(run[c])||0:0;
    rdfWet[i]=rdfClamp(r/RDF_RUNOFF_REF,0,3);
  }
  return rdfWet;
}
function rdfAccumulate(d,wet){
  if(!rdfAccQ||rdfAccQ.length!==d.n)rdfAccQ=new Float32Array(d.n);
  const acc=rdfAccQ;acc.fill(0);
  for(let q=d.orderCount-1;q>=0;q--){
    const c=d.order[q];if(!d.land[c])continue;
    acc[c]+=d.area[c]*wet[c];const j=d.ds[c];if(j>=0)acc[j]+=acc[c];
  }
  return acc;
}
function rdfStrength(q){
  if(!(q>RDF_Q_START_CELLS))return 0;
  return rdfClamp(Math.log(q/RDF_Q_START_CELLS)/Math.log(RDF_Q_FULL_CELLS/RDF_Q_START_CELLS),0,1);
}
function rdfWidthM(F,q){
  const cellM2=Math.pow(2/F*RDF_PLANET_RADIUS_M,2),Q=q*cellM2*RDF_RUNOFF_REF*1e-3; /* m^3/s */
  return 7*Math.sqrt(Math.max(0,Q));
}
/* Chains: every channel cell belongs to exactly one chain as an interior or
   head node (its main-child lineage); tributaries end ON the junction cell
   of the chain they join, so node positions are shared exactly. */
function rdfChains(d,acc){
  const n=d.n,isChan=new Uint8Array(n),mainChild=new Int32Array(n).fill(-1),bestQ=new Float32Array(n);
  for(let i=0;i<n;i++)if(d.land[i]&&acc[i]>=RDF_Q_START_CELLS)isChan[i]=1;
  for(let i=0;i<n;i++){
    if(!isChan[i])continue;const j=d.ds[i];
    if(j>=0&&isChan[j]&&acc[i]>bestQ[j]){bestQ[j]=acc[i];mainChild[j]=i;}
  }
  const chains=[];
  for(let i=0;i<n;i++){
    if(!isChan[i]||mainChild[i]>=0)continue;
    const cells=[i];let c=i,mouth=null;
    for(let guard=0;guard<n;guard++){
      const j=d.ds[c];if(j<0)break;
      if(!d.land[j]){
        const hl=d.h[c],ho=d.h[j],t=rdfClamp(hl/Math.max(1e-9,hl-ho),0.05,1);
        const a=rdfCellDir(d.F,c,[0,0,0]),b=rdfCellDir(d.F,j,[0,0,0]);
        const mx=a[0]+(b[0]-a[0])*t,my=a[1]+(b[1]-a[1])*t,mz=a[2]+(b[2]-a[2])*t,mq=Math.hypot(mx,my,mz)||1;
        mouth=[mx/mq,my/mq,mz/mq];break;
      }
      if(!isChan[j])break;
      cells.push(j);
      if(mainChild[j]!==c)break;
      c=j;
    }
    chains.push({cells:Int32Array.from(cells),mouth});
  }
  return {chains,isChan};
}
/* Two Jacobi passes pull interior nodes toward their chain neighbours'
   midpoint with a bounded displacement, so the D8 staircase reads as a curve.
   Heads, junction ends and mouths stay put. */
function rdfRelax(d,chains){
  const n=d.n;if(!rdfPos||rdfPos.length!==n*3)rdfPos=new Float32Array(n*3);
  const pos=rdfPos,dir=[0,0,0],maxMove=RDF_RELAX_MAX_CELL*2/d.F;
  for(const ch of chains)for(let k=0;k<ch.cells.length;k++){const c=ch.cells[k];rdfCellDir(d.F,c,dir);pos[c*3]=dir[0];pos[c*3+1]=dir[1];pos[c*3+2]=dir[2];}
  const src=new Float32Array(n*3);
  for(let pass=0;pass<2;pass++){
    for(const ch of chains)for(let k=0;k<ch.cells.length;k++){const c=ch.cells[k]*3;src[c]=pos[c];src[c+1]=pos[c+1];src[c+2]=pos[c+2];}
    for(const ch of chains){
      const cells=ch.cells,m=cells.length;
      for(let k=1;k<m-1;k++){
        const c=cells[k],a=cells[k-1]*3,b=cells[k+1]*3,o=c*3;
        let x=0.5*src[o]+0.25*(src[a]+src[b]),y=0.5*src[o+1]+0.25*(src[a+1]+src[b+1]),z=0.5*src[o+2]+0.25*(src[a+2]+src[b+2]);
        let q=Math.hypot(x,y,z)||1;x/=q;y/=q;z/=q;
        rdfCellDir(d.F,c,dir);
        const dist=Math.hypot(x-dir[0],y-dir[1],z-dir[2]);
        if(dist>maxMove){const s=maxMove/dist;x=dir[0]+(x-dir[0])*s;y=dir[1]+(y-dir[1])*s;z=dir[2]+(z-dir[2])*s;q=Math.hypot(x,y,z)||1;x/=q;y/=q;z/=q;}
        pos[o]=x;pos[o+1]=y;pos[o+2]=z;
      }
    }
  }
  return pos;
}

/* ---------- publication into the display bridge ---------- */
function rdfPaintChord(ax,ay,az,bx,by,bz,strength,widthM,tmp){
  const len=Math.hypot(bx-ax,by-ay,bz-az),texel=2/Math.max(8,riverGpuN||8);
  const steps=Math.max(1,Math.ceil(len/(0.7*texel)));
  const radius=riverGpuCorridorRadius(strength,widthM),value=0.22+0.78*strength;
  for(let s=0;s<=steps;s++){
    const t=s/steps;riverGpuPaintDir(riverGpuCurrRiver,ax+(bx-ax)*t,ay+(by-ay)*t,az+(bz-az)*t,radius,value,tmp);
  }
}
function rdfPublish(d,acc,chains,pos,tmp){
  const F=d.F,p0={x:0,y:0,z:0},p1={x:0,y:0,z:0},p2={x:0,y:0,z:0},p3={x:0,y:0,z:0},mid={x:0,y:0,z:0};
  const at=(ch,k,out)=>{
    const m=ch.cells.length;
    if(k>=m){if(ch.mouth){out.x=ch.mouth[0];out.y=ch.mouth[1];out.z=ch.mouth[2];return out;}k=m-1;}
    if(k<0)k=0;const c=ch.cells[k]*3;out.x=pos[c];out.y=pos[c+1];out.z=pos[c+2];return out;
  };
  let chords=0;
  for(const ch of chains){
    const m=ch.cells.length,edges=m-1+(ch.mouth?1:0);
    for(let k=0;k<edges;k++){
      at(ch,k-1,p0);at(ch,k,p1);at(ch,k+1,p2);at(ch,k+2,p3);
      const c0=ch.cells[k],c1=ch.cells[Math.min(m-1,k+1)];
      let s0=rdfStrength(acc[c0]),s1=rdfStrength(acc[c1]);
      if(k===0)s0*=RDF_HEAD_TAPER;
      const w0=rdfWidthM(F,acc[c0]),w1=rdfWidthM(F,acc[c1]);
      riverGpuCatmullDir(p0,p1,p2,p3,0.5,mid);
      const sm=0.5*(s0+s1),wm=0.5*(w0+w1);
      riverVecPush(p1.x,p1.y,p1.z,mid.x,mid.y,mid.z,0.5*(s0+sm),riverVecHalfWidthRad(0.5*(s0+sm),0.5*(w0+wm),false));
      riverVecPush(mid.x,mid.y,mid.z,p2.x,p2.y,p2.z,0.5*(sm+s1),riverVecHalfWidthRad(0.5*(sm+s1),0.5*(wm+w1),false));
      rdfPaintChord(p1.x,p1.y,p1.z,mid.x,mid.y,mid.z,0.5*(s0+sm),0.5*(w0+wm),tmp);
      rdfPaintChord(mid.x,mid.y,mid.z,p2.x,p2.y,p2.z,0.5*(sm+s1),0.5*(wm+w1),tmp);
      chords+=2;
    }
  }
  /* lakes: filled depressions, painted as lake support for the noise shoreline */
  const dir=[0,0,0],lakeRadius=Math.max(0.6,0.55*(riverGpuN||8)/F);
  let lakes=0;
  for(let i=0;i<d.n;i++){
    const dep=d.depth[i];if(dep<RDF_LAKE_MIN_DEPTH)continue;
    rdfCellDir(F,i,dir);riverGpuPaintDir(riverGpuCurrLake,dir[0],dir[1],dir[2],lakeRadius,rdfClamp(0.30+dep/0.03,0.30,1),tmp);lakes++;
  }
  return {chords,lakes,chains:chains.length};
}

/* ---------- lifecycle ---------- */
function riverFineSetTerrain(F,h,sig){
  if(!(F>=8)||!h||h.length!==6*F*F)return false;
  rdfTerrainPending={F,h,sig:String(sig||'')};return true;
}
function riverFineSignature(){
  return (typeof terrainBakeSignature==='function')?terrainBakeSignature():'';
}
/* Main thread without a worker: bake and build locally (one hitch per world). */
function riverFineEnsureLocal(){
  if(typeof terrainBakeHeights!=='function')return false;
  const sig=riverFineSignature();
  if(rdfDrainage&&rdfDrainage.sig===sig)return true;
  if(rdfTerrainPending&&rdfTerrainPending.sig===sig)return true;
  const F=rdfFaceN(),h=terrainBakeHeights(F);if(!h)return false;
  return riverFineSetTerrain(F,h,sig);
}
/* Main thread with a worker: hand a fresh bake over exactly once per signature. */
function riverFineTerrainForWorker(){
  if(typeof terrainBakeHeights!=='function')return null;
  const sig=riverFineSignature();if(!sig||sig===rdfSentSig)return null;
  const F=rdfFaceN(),h=terrainBakeHeights(F);if(!h)return null;
  rdfSentSig=sig;return {F,h,sig};
}
function riverFineEnsureBuilt(){
  if(rdfTerrainPending){
    const t=rdfTerrainPending;rdfTerrainPending=null;
    rdfDrainage=rdfBuild(t.F,t.h,t.sig);
  }
  return rdfDrainage;
}
function riverFineWorkerOwns(){
  return typeof weatherWorker!=='undefined'&&!!weatherWorker&&typeof weatherWorkerFailed!=='undefined'&&!weatherWorkerFailed;
}
function riverFineActive(core){
  if(!core)return false;
  const isWorker=(typeof MP_IS_WEATHER_WORKER!=='undefined'&&MP_IS_WEATHER_WORKER);
  /* The main thread bakes and builds only when no worker will: a local
     build is a one-off hitch of seconds and must not run at boot. */
  if(!isWorker&&!riverFineWorkerOwns())riverFineEnsureLocal();
  return !!(rdfDrainage||rdfTerrainPending);
}
function riverFineReadCurrent(core){
  const d=riverFineEnsureBuilt();if(!d)return false;
  const tmp={face:0,u:0,v:0};
  const wet=rdfWetness(d,core),acc=rdfAccumulate(d,wet),ch=rdfChains(d,acc),pos=rdfRelax(d,ch.chains);
  const stats=rdfPublish(d,acc,ch.chains,pos,tmp);
  core.riverFineModel=RDF_MODEL;core.riverFineChords=stats.chords;core.riverFineChains=stats.chains;core.riverFineLakes=stats.lakes;core.riverFineF=d.F;
  return true;
}
function riverFineDiagnostics(){
  const d=rdfDrainage;if(!d)return {model:RDF_MODEL,built:false};
  let land=0,chan=0,wetSum=0,wetPos=0,accMax=0,lakes=0;
  for(let i=0;i<d.n;i++){
    if(!d.land[i])continue;land++;
    if(d.depth[i]>=RDF_LAKE_MIN_DEPTH)lakes++;
    if(rdfWet){wetSum+=rdfWet[i];if(rdfWet[i]>0.05)wetPos++;}
    if(rdfAccQ){if(rdfAccQ[i]>=RDF_Q_START_CELLS)chan++;if(rdfAccQ[i]>accMax)accMax=rdfAccQ[i];}
  }
  return {model:RDF_MODEL,built:true,F:d.F,cells:d.n,land,lakeCells:lakes,channelCells:chan,wetMean:land?wetSum/land:0,wetFraction:land?wetPos/land:0,accMax,sig:d.sig};
}
let rdfRemoteDiag=null;
function riverFineSetRemoteDiagnostics(d){rdfRemoteDiag=d||null;}
if(typeof window!=='undefined')window.__madPlanetRiverFine={get diagnostics(){return rdfDrainage?riverFineDiagnostics():(rdfRemoteDiag||riverFineDiagnostics());},get faceN(){return rdfFaceN();}};
