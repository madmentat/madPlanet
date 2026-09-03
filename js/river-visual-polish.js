/* ============ 0.5.142: river visual polish + mobile river budget ============ */
/*
   0.5.141 proved that the physical drainage graph can support a visible
   dendritic network, but two display problems remained:
     - side feeders were accepted at adjacent synoptic receivers and read as
       parallel comb teeth rather than tributaries;
     - weak fine branches needed a second shadeSurface wrapper to stay visible.
       That wrapper duplicated expensive cubemap sampling on mobile GPUs.

   Keep the conservative drainage graph untouched. This late display layer
   prunes neighbouring feeder receivers, makes fine paths narrower but stores a
   stronger centre-line value in uRiverTex, and lowers only the MOBILE display
   cubemap reconstruction from 8x to 6x Weather Core resolution. The physical
   runoff/Q/basin topology and desktop 8x reconstruction are unchanged.
*/
(function installRiverVisualPolish(){
  if(typeof riverVisualBuildBranches!=='function'||typeof riverGpuPaintVisualEdge!=='function')return;

  const RIVER_VISUAL_POLISH_MODEL=1;
  const mobile=(typeof mobileDevice!=='undefined')?!!mobileDevice:
    ((typeof navigator!=='undefined'&&/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent||''))||
     (typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches));

  /* 8x is useful on desktop close-ups. On a mobile screen 6x still gives a
     sub-synoptic one-texel river while cutting cubemap area, packing work and
     persistent CPU-side float buffers to 56.25% of the 8x version. */
  if(typeof riverGpuDisplayN==='function'){
    const displayBefore=riverGpuDisplayN;
    riverGpuDisplayN=function(coreN){
      const n=Math.max(4,Math.round(Number(coreN)||28));
      return mobile?Math.max(8,n*6):displayBefore(coreN);
    };
  }

  function markNearbyReceiver(core,claimed,i){
    if(i<0||i>=core.count)return;
    claimed[i]=1;
    if(typeof riverVisualNeighbourCandidates!=='function')return;
    riverVisualNeighbourCandidates(core,i,j=>{
      if(j>=0&&j<core.count&&typeof riverVisualIsReceiver==='function'&&riverVisualIsReceiver(core,j))claimed[j]=1;
    });
  }

  /* Post-process the display graph only. One feeder per neighbouring trunk
     segment removes the rake/comb pattern without touching real channel cells.
     Long source->trunk tributaries are retained; short one-cell feeder stubs are
     discarded because at synoptic scale they look like square teeth. */
  const buildBefore=riverVisualBuildBranches;
  riverVisualBuildBranches=function(core){
    const outCore=buildBefore(core);
    if(!core?.count||!Array.isArray(core.riverVisualBranches))return outCore;
    const raw=core.riverVisualBranches,clean=[];
    const claimedReceiver=new Uint8Array(core.count);
    const feederLimit=mobile
      ?Math.max(18,Math.min(84,Math.floor(core.count*0.018)))
      :Math.max(30,Math.min(168,Math.floor(core.count*0.028)));
    let feeders=0;
    for(const b of raw){
      const cells=b?.cells;
      if(!Array.isArray(cells)||cells.length<2)continue;
      if(b.kind==='feeder'){
        if(cells.length<3||feeders>=feederLimit)continue;
        const receiver=cells[cells.length-1]|0;
        if(receiver<0||receiver>=core.count||claimedReceiver[receiver])continue;
        b.strength=Math.max(0.075,Math.min(0.26,(Number(b.strength)||0.16)*(mobile?0.64:0.72)));
        b.phase=(Number(b.phase)||0)*1.28;
        clean.push(b);feeders++;
        markNearbyReceiver(core,claimedReceiver,receiver);
      }else{
        b.strength=Math.max(0.10,Math.min(0.42,(Number(b.strength)||0.18)*0.88));
        b.phase=(Number(b.phase)||0)*1.10;
        clean.push(b);
      }
    }
    core.riverVisualBranches=clean;
    core.riverVisualBranchCount=clean.length;
    core.riverVisualFeederCount=feeders;
    core.riverVisualPolishModel=RIVER_VISUAL_POLISH_MODEL;
    return outCore;
  };

  /* Fine display branches use a narrow high-confidence centre line. The old
     0.5.139 raster used a broad low-amplitude brush; after LINEAR filtering it
     became a fat blue groove, while the legacy surface width gate could still
     erase its centre. A stronger one-texel-ish core survives that gate without
     broadening the river corridor. Two deterministic harmonics prevent nearby
     feeders from looking like parallel ruler strokes. */
  riverGpuPaintVisualEdge=function(core,branch,p,tmp,a,b){
    riverGpuVisualNode(core,branch,p,a);riverGpuVisualNode(core,branch,p+1,b);
    const dot=riverGpuClamp(a.x*b.x+a.y*b.y+a.z*b.z,-1,1),ang=Math.acos(dot);
    let nx=a.y*b.z-a.z*b.y,ny=a.z*b.x-a.x*b.z,nz=a.x*b.y-a.y*b.x;
    const nq=Math.hypot(nx,ny,nz);if(nq>1e-9){nx/=nq;ny/=nq;nz/=nq;}else{nx=ny=nz=0;}
    const cells=branch.cells,last=Math.max(1,cells.length-1);
    const h1=riverGpuEdgeHash(core.seed|0,branch.source|0,cells[p]|0,0x7811+p*53);
    const h2=riverGpuEdgeHash(core.seed|0,branch.source|0,cells[p+1]|0,0x31a7+p*79);
    const steps=Math.max(5,Math.min(34,Math.ceil(ang*riverGpuN*1.85)));
    const feeder=branch.kind==='feeder';
    for(let s=0;s<=steps;s++){
      const t=s/steps,omt=1-t;
      let dx=a.x*omt+b.x*t,dy=a.y*omt+b.y*t,dz=a.z*omt+b.z*t;
      let q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
      const wave=0.105*h1*Math.sin(Math.PI*t)+0.040*h2*Math.sin(2*Math.PI*t);
      const bend=Math.sin(ang)*wave*(feeder?1.18:1.0);
      dx+=nx*bend;dy+=ny*bend;dz+=nz*bend;q=Math.hypot(dx,dy,dz)||1;dx/=q;dy/=q;dz/=q;
      const progress=(p+t)/last;
      const strength=riverGpuClamp((Number(branch.strength)||0.12)*(0.60+0.40*progress),0.04,0.42);
      const radius=feeder?(0.105+0.115*Math.sqrt(strength)):(0.120+0.145*Math.sqrt(strength));
      const value=feeder?(0.46+0.36*strength):(0.50+0.40*strength);
      riverGpuPaintDir(riverGpuCurrRiver,dx,dy,dz,radius,value,tmp);
    }
  };

  /* If Weather Core was initialized unusually early, rebuild only the display
     graph once so the first subsequent river upload uses the polished network. */
  try{
    if(typeof weatherCore!=='undefined'&&weatherCore?.count)riverVisualBuildBranches(weatherCore);
  }catch(_e){}

  if(typeof window!=='undefined')window.__madPlanetRiverVisualPolish={
    model:RIVER_VISUAL_POLISH_MODEL,mobile,
    get displayN(){try{return typeof weatherCore!=='undefined'&&weatherCore?riverGpuDisplayN(weatherCore.N):0;}catch(_e){return 0;}}
  };
})();
