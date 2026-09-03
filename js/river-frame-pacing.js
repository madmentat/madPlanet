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
