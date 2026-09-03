/* ============ 0.5.140: hitch-resistant presentation clock ============ */
/*
   requestAnimationFrame timestamps are correct wall time, but a single long
   main-thread task turns that correctness into a visible teleport: at x4 a
   70 ms missed frame advances the rotating planet by 280 ms in one picture.
   Stable 30 fps is visually fine; isolated frame gaps are the problem.

   This presentation clock leaves ordinary 30/45/60 Hz cadence untouched. Only
   a frame that is much longer than the recent cadence is clipped for DISPLAY,
   and the resulting small time debt is paid back over subsequent frames. The
   physical Weather Core keeps its own deterministic clock and is not modified.
*/
(function installPresentationClock(){
  if(typeof window==='undefined'||typeof drawFrame!=='function')return;

  const PRESENTATION_CLOCK_MODEL=1;
  const PRESENTATION_HITCH_MIN_MS=46;
  const PRESENTATION_HITCH_MULT=1.75;
  const PRESENTATION_HITCH_STEP_MULT=1.35;
  const PRESENTATION_CATCHUP_FRACTION=0.28;
  const PRESENTATION_RESET_GAP_MS=500;
  const PRESENTATION_JANK_HOLD_MS=320;

  let sourceLast=NaN;
  let presentNow=NaN;
  let cadenceEwmaMs=16.7;
  let lastRawFrameMs=16.7;
  let presentationDebtMs=0;
  let jankEwmaMs=0;
  let recentJankUntilMs=0;

  function presentationClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
  function presentationReset(now){
    sourceLast=now;presentNow=now;presentationDebtMs=0;
    cadenceEwmaMs=16.7;lastRawFrameMs=16.7;jankEwmaMs=0;recentJankUntilMs=0;
    return presentNow;
  }
  function presentationClockStep(now){
    now=Number(now);
    if(!Number.isFinite(now))return now;
    if(typeof state!=='undefined'&&state&&state.paused)return presentationReset(now);
    if(!Number.isFinite(sourceLast)||!Number.isFinite(presentNow))return presentationReset(now);

    const rawGap=now-sourceLast;
    sourceLast=now;
    /* Hidden tabs and debugger stops should resume at current time. Catching up
       seconds of debt would be far worse than one intentional resume jump. */
    if(rawGap<0||rawGap>PRESENTATION_RESET_GAP_MS)return presentationReset(now);

    const rawDt=presentationClamp(rawGap,0,250);
    const cadence= presentationClamp(cadenceEwmaMs,12,42);
    const hitchThreshold=Math.max(PRESENTATION_HITCH_MIN_MS,cadence*PRESENTATION_HITCH_MULT);
    const gapToTarget=Math.max(0,now-presentNow);
    let advance=rawDt;
    const jank=Math.max(0,rawDt-hitchThreshold);

    if(rawDt>hitchThreshold){
      /* Do not turn one scheduler/texture stall into a spatial jump. */
      advance=Math.min(rawDt,cadence*PRESENTATION_HITCH_STEP_MULT);
      recentJankUntilMs=now+PRESENTATION_JANK_HOLD_MS;
    }else if(gapToTarget>rawDt+0.25){
      /* Repay debt slowly. Stable 30 fps therefore stays exactly 30-fps motion
         instead of being mistaken for a hitch and filtered into slow motion. */
      const debtBefore=Math.max(0,gapToTarget-rawDt);
      const catchup=Math.min(debtBefore,Math.max(0.75,cadence*PRESENTATION_CATCHUP_FRACTION));
      advance+=catchup;
    }

    presentNow=Math.min(now,presentNow+Math.max(0,advance));
    presentationDebtMs=Math.max(0,now-presentNow);
    lastRawFrameMs=rawDt;
    const cadenceSample=Math.min(rawDt,cadence*2.0);
    cadenceEwmaMs+=(cadenceSample-cadenceEwmaMs)*0.08;
    jankEwmaMs+=(jank-jankEwmaMs)*0.12;
    if(jank<=0)jankEwmaMs*=0.985;
    return presentNow;
  }
  function presentationRecentJank(nowMs){
    const now=Number.isFinite(Number(nowMs))?Number(nowMs):
      ((typeof performance!=='undefined'&&performance&&typeof performance.now==='function')?performance.now():Date.now());
    return now<recentJankUntilMs||jankEwmaMs>4.5;
  }

  const drawFrameBeforePresentationClock=drawFrame;
  drawFrame=function(now){
    return drawFrameBeforePresentationClock(presentationClockStep(now));
  };

  window.__madPlanetPresentationClock={
    model:PRESENTATION_CLOCK_MODEL,
    step:presentationClockStep,
    reset:presentationReset,
    recentJank:presentationRecentJank,
    get debtMs(){return presentationDebtMs;},
    get lastFrameMs(){return lastRawFrameMs;},
    get cadenceMs(){return cadenceEwmaMs;},
    get jankEwmaMs(){return jankEwmaMs;}
  };
})();
