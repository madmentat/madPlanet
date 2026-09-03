/* ============ 0.5.140: asynchronous river texture publication ============ */
/*
   0.5.139 raised the visible river cubemap to 8x Weather Core resolution. The
   physical river graph is cheap enough to update on a weather tick, but packing
   and uploading ~hundreds of thousands of cubemap pixels is not. At x4 that
   publication was requested roughly four times per second and could dominate
   frame pacing even while the average FPS counter still looked acceptable.

   Keep the newest physical river state only, publish it in an idle turn, and
   cap wall-clock publication cadence. Rivers evolve slowly enough that this is
   visually lossless once the existing prev/current interpolation is applied.
*/
(function installRiverFramePacing(){
  if(typeof window==='undefined'||typeof riverGpuUpload!=='function')return;

  const RIVER_FRAME_PACING_MODEL=1;
  const RIVER_PUBLISH_MIN_DESKTOP_MS=1200;
  const RIVER_PUBLISH_MIN_MOBILE_MS=1550;
  const RIVER_PUBLISH_FORCE_MS=3200;
  const RIVER_PUBLISH_IDLE_TIMEOUT_MS=900;
  const RIVER_PUBLISH_RETRY_MS=80;

  const riverGpuUploadImmediate=riverGpuUpload;
  let riverPublishPending=null;
  let riverPublishTimer=0;
  let riverPublishIdle=0;
  let riverPublishLastMs=-1e12;
  let riverPublishLastCostMs=0;
  let riverPublishCostEwmaMs=0;

  function riverPacingNowMs(){
    return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')
      ?performance.now():Date.now();
  }
  function riverPacingClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
  function riverPacingMinIntervalMs(){
    return (typeof mobileDevice!=='undefined'&&mobileDevice)?RIVER_PUBLISH_MIN_MOBILE_MS:RIVER_PUBLISH_MIN_DESKTOP_MS;
  }
  function riverPacingImmediateRequired(core){
    if(!core?.N)return true;
    const targetN=(typeof riverGpuDisplayN==='function')?riverGpuDisplayN(core.N):riverGpuN;
    return !riverGpuHasFrame||!riverGpuTex||riverGpuN!==targetN||riverGpuLastSeed!==(core.seed|0);
  }
  function riverPacingBusy(nowMs){
    if(typeof document!=='undefined'&&document.hidden)return true;
    if(typeof state!=='undefined'&&state&&state.paused)return true;
    if(typeof cameraMotionActive==='function'&&cameraMotionActive())return true;
    if(typeof cameraInputBusy==='function'&&cameraInputBusy())return true;
    const p=window.__madPlanetPresentationClock;
    return !!(p&&typeof p.recentJank==='function'&&p.recentJank(nowMs));
  }
  function riverPacingNeededIdleMs(){
    const cost=Math.max(riverPublishCostEwmaMs,riverPublishLastCostMs*0.72);
    return riverPacingClamp(cost*1.25+2.0,4,32);
  }
  function riverPacingRecordPublish(core){
    const t1=riverPacingNowMs();
    const ok=riverGpuUploadImmediate(core);
    const t2=riverPacingNowMs();
    if(ok!==false){
      riverPublishLastCostMs=Math.max(0,t2-t1);
      riverPublishCostEwmaMs=riverPublishCostEwmaMs>0
        ?riverPublishCostEwmaMs*0.78+riverPublishLastCostMs*0.22:riverPublishLastCostMs;
      riverPublishLastMs=t2;
    }
    return ok;
  }
  function riverPacingSchedule(delayMs=0){
    if(!riverPublishPending||riverPublishTimer||riverPublishIdle)return;
    const delay=Math.max(0,Number(delayMs)||0);
    if(delay>0){
      riverPublishTimer=setTimeout(()=>{riverPublishTimer=0;riverPacingSchedule(0);},delay);
      return;
    }
    const run=(deadline)=>{
      riverPublishIdle=0;riverPublishTimer=0;
      if(!riverPublishPending)return;
      const now=riverPacingNowMs(),stale=now-riverPublishLastMs;
      const minWait=riverPacingMinIntervalMs()-stale;
      if(minWait>0){riverPacingSchedule(minWait);return;}
      if(riverPacingBusy(now)&&stale<RIVER_PUBLISH_FORCE_MS){
        riverPacingSchedule(RIVER_PUBLISH_RETRY_MS);return;
      }
      const need=riverPacingNeededIdleMs();
      if(deadline&&!deadline.didTimeout&&deadline.timeRemaining()<need){
        riverPacingSchedule(RIVER_PUBLISH_RETRY_MS);return;
      }
      if(deadline&&deadline.didTimeout&&stale<RIVER_PUBLISH_FORCE_MS&&
         ((window.__madPlanetPresentationClock?.recentJank?.(now))||deadline.timeRemaining()<need*0.45)){
        riverPacingSchedule(RIVER_PUBLISH_RETRY_MS);return;
      }
      const core=riverPublishPending;riverPublishPending=null;
      riverPacingRecordPublish(core);
      if(riverPublishPending)riverPacingSchedule(0);
    };
    if(typeof requestIdleCallback==='function'){
      riverPublishIdle=requestIdleCallback(run,{timeout:RIVER_PUBLISH_IDLE_TIMEOUT_MS});
    }else{
      riverPublishTimer=setTimeout(()=>run(null),24);
    }
  }

  riverGpuUpload=function(core){
    if(!core?.N)return false;
    if(riverPacingImmediateRequired(core))return riverPacingRecordPublish(core);
    riverPublishPending=core; /* coalesce: newest mutable Weather Core wins */
    riverPacingSchedule(0);
    return true;
  };

  window.__madPlanetRiverFramePacing={
    model:RIVER_FRAME_PACING_MODEL,
    flush(){
      if(!riverPublishPending)return false;
      const core=riverPublishPending;riverPublishPending=null;
      return riverPacingRecordPublish(core);
    },
    get pending(){return !!riverPublishPending;},
    get lastCostMs(){return riverPublishLastCostMs;},
    get costEwmaMs(){return riverPublishCostEwmaMs;},
    get lastPublishMs(){return riverPublishLastMs;},
    get minIntervalMs(){return riverPacingMinIntervalMs();}
  };
})();

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
