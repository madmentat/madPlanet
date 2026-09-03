/* ============ 0.5.140: frame-budget-aware Weather Core scheduler ============ */
/*
   A fixed weather tick is a long indivisible main-thread task. requestIdleCallback
   only says how much idle time remains; starting a 15 ms tick in a 5 ms slice
   guarantees a missed render frame. 0.5.140 uses the measured tick EWMA as an
   admission budget and is allowed to SKIP wall-clock opportunities under load.
   There is still no catch-up queue: visual smoothness wins over exact wall-time
   acceleration when the device cannot afford both.
*/
(function installWeatherFrameBudget(){
  if(typeof window==='undefined'||typeof weatherCoreRequestTick!=='function')return;

  const WEATHER_FRAME_BUDGET_MODEL=1;
  const WEATHER_FRAME_IDLE_MIN_MS=5;
  const WEATHER_FRAME_IDLE_MAX_MS=28;
  const WEATHER_FRAME_COST_MULT=1.28;
  const WEATHER_FRAME_RESERVE_MS=2.5;
  const WEATHER_FRAME_IDLE_TIMEOUT_MS=560;
  const WEATHER_FRAME_MAX_STALE_MS=1600;
  const WEATHER_FRAME_RETRY_MS=40;
  const WEATHER_FRAME_JANK_RETRY_MS=90;

  function weatherFrameNowMs(){
    return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')
      ?performance.now():Date.now();
  }
  function weatherFrameClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
  function weatherFrameEstimatedCostMs(){
    const ewma=(typeof weatherCoreCostEwmaMs==='number'&&Number.isFinite(weatherCoreCostEwmaMs))?weatherCoreCostEwmaMs:0;
    const last=(typeof weatherCoreLastCostMs==='number'&&Number.isFinite(weatherCoreLastCostMs))?weatherCoreLastCostMs:0;
    const cost=Math.max(ewma,last*0.72);
    return weatherFrameClamp(cost*WEATHER_FRAME_COST_MULT+WEATHER_FRAME_RESERVE_MS,
      WEATHER_FRAME_IDLE_MIN_MS,WEATHER_FRAME_IDLE_MAX_MS);
  }
  function weatherFrameRecentJank(nowMs){
    const p=window.__madPlanetPresentationClock;
    if(p&&typeof p.recentJank==='function'&&p.recentJank(nowMs))return true;
    const target=(window.__madPlanetRuntime&&window.__madPlanetRuntime.settings)
      ?1000/Math.max(24,Number(window.__madPlanetRuntime.settings.targetFps)||60)
      :((typeof mobileDevice!=='undefined'&&mobileDevice)?18:16.7);
    return typeof frameMsEwma==='number'&&Number.isFinite(frameMsEwma)&&frameMsEwma>target*1.55;
  }
  function weatherFrameStaleMs(nowMs){
    if(typeof weatherCoreLastWallTickMs!=='number'||!Number.isFinite(weatherCoreLastWallTickMs))return Infinity;
    return Math.max(0,nowMs-weatherCoreLastWallTickMs);
  }
  function weatherFrameScheduleRetry(ms){
    if(typeof weatherCoreSchedule==='function')weatherCoreSchedule(ms);
  }

  weatherCoreRequestTick=function(){
    if(typeof weatherCoreSchedulerTimer!=='undefined')weatherCoreSchedulerTimer=0;
    const now=weatherFrameNowMs();
    if(typeof weatherCoreSchedulerBlocked==='function'&&weatherCoreSchedulerBlocked(now)){
      weatherFrameScheduleRetry(72);return;
    }

    const run=()=>{
      const n=weatherFrameNowMs();
      if(typeof weatherCoreSchedulerBlocked==='function'&&weatherCoreSchedulerBlocked(n)){
        weatherFrameScheduleRetry(72);return;
      }
      const t1=weatherFrameNowMs();
      const stepped=(typeof weatherCoreTick==='function')?weatherCoreTick():false;
      const t2=weatherFrameNowMs();
      if(stepped){
        const cost=Math.max(0,t2-t1);
        if(typeof weatherCoreLastCostMs!=='undefined')weatherCoreLastCostMs=cost;
        if(typeof weatherCoreCostEwmaMs!=='undefined'){
          weatherCoreCostEwmaMs=weatherCoreCostEwmaMs>0
            ?weatherCoreCostEwmaMs*0.78+cost*0.22:cost;
        }
        if(typeof weatherCoreLastWallTickMs!=='undefined')weatherCoreLastWallTickMs=t2;
      }
      if(typeof weatherCoreSchedule==='function')weatherCoreSchedule();
    };

    if(typeof requestIdleCallback==='function'){
      if(typeof weatherCoreSchedulerIdle!=='undefined'){
        weatherCoreSchedulerIdle=requestIdleCallback((deadline)=>{
          weatherCoreSchedulerIdle=0;
          const n=weatherFrameNowMs();
          if(typeof weatherCoreSchedulerBlocked==='function'&&weatherCoreSchedulerBlocked(n)){
            weatherFrameScheduleRetry(72);return;
          }
          const need=weatherFrameEstimatedCostMs();
          const remain=Math.max(0,Number(deadline.timeRemaining())||0);
          const stale=weatherFrameStaleMs(n);
          const janky=weatherFrameRecentJank(n);

          if(!deadline.didTimeout&&remain<need){
            weatherFrameScheduleRetry(janky?WEATHER_FRAME_JANK_RETRY_MS:WEATHER_FRAME_RETRY_MS);
            return;
          }
          /* timeout is not permission to wreck a frame. Until the physical
             state is genuinely stale, continue yielding when pacing is poor. */
          if(deadline.didTimeout&&stale<WEATHER_FRAME_MAX_STALE_MS&&(janky||remain<need*0.55)){
            weatherFrameScheduleRetry(WEATHER_FRAME_JANK_RETRY_MS);
            return;
          }
          run();
        },{timeout:WEATHER_FRAME_IDLE_TIMEOUT_MS});
      }
    }else{
      setTimeout(()=>{
        const n=weatherFrameNowMs();
        if(weatherFrameRecentJank(n)&&weatherFrameStaleMs(n)<WEATHER_FRAME_MAX_STALE_MS){
          weatherFrameScheduleRetry(WEATHER_FRAME_JANK_RETRY_MS);return;
        }
        run();
      },0);
    }
  };

  window.__madPlanetWeatherFrameBudget={
    model:WEATHER_FRAME_BUDGET_MODEL,
    estimatedCostMs:weatherFrameEstimatedCostMs,
    recentJank:weatherFrameRecentJank,
    maxStaleMs:WEATHER_FRAME_MAX_STALE_MS
  };
})();
