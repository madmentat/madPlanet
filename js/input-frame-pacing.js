/* ============ 0.5.127 / 0.5.128: lossless input + motion-first frame pacing ============ */
/*
   Rendering can be late; input must not disappear because of that. camera.js
   owns lossless/coalesced pointer sampling. This late layer connects its queue
   to the fully wrapped drawFrame chain and gives pending browser input priority
   over Weather Core / deferred visual publication.

   A low FPS value is preferable to a large spatial discontinuity. We therefore
   drain the queued motion through cameraInputStep(frameSpan), letting the final
   pacing layer choose a smaller time-aware angular budget on slow frames.
*/
(function installInputFramePacing(){
  if(typeof drawFrame!=='function')return;

  function browserInputPending(){
    try{
      const fn=typeof navigator!=='undefined'&&navigator.scheduling&&navigator.scheduling.isInputPending;
      return typeof fn==='function'&&!!fn.call(navigator.scheduling,{includeContinuous:true});
    }catch(_e){return false;}
  }
  window.__madPlanetInputPending=browserInputPending;

  /* Scheduler hook is resolved at execution time, so installing this after the
     Weather Core and smooth-motion modules still protects future idle tasks. */
  if(typeof weatherCoreInteractionBusy==='function'){
    const beforeInteractionBusy=weatherCoreInteractionBusy;
    weatherCoreInteractionBusy=function(nowMs){
      if(browserInputPending())return true;
      if(typeof cameraInputBusy==='function'&&cameraInputBusy())return true;
      return beforeInteractionBusy(nowMs);
    };
  }
  if(typeof weatherCoreSchedulerBlocked==='function'){
    const beforeSchedulerBlocked=weatherCoreSchedulerBlocked;
    weatherCoreSchedulerBlocked=function(nowMs){
      return browserInputPending()||beforeSchedulerBlocked(nowMs);
    };
  }
  if(typeof smoothDrainVisualPublish==='function'){
    const beforeDrainVisualPublish=smoothDrainVisualPublish;
    smoothDrainVisualPublish=function(deadline){
      if(browserInputPending()||(typeof cameraInputBusy==='function'&&cameraInputBusy())){
        if(typeof smoothScheduleVisualPublish==='function')smoothScheduleVisualPublish(48);
        return;
      }
      return beforeDrainVisualPublish(deadline);
    };
  }

  let lastFrameNow=NaN;
  const beforeDrawFrame=drawFrame;
  drawFrame=function(now){
    const n=Number(now);
    const span=Number.isFinite(lastFrameNow)&&Number.isFinite(n)?Math.max(0,Math.min(250,n-lastFrameNow)):16.7;
    if(Number.isFinite(n))lastFrameNow=n;

    /* Drain before the underlying draw computes camera matrices. This makes a
       pointerup-only flick visible on the very next rendered frame. The frame
       span is passed through so slow frames use a smaller spatial step rather
       than looking like camera teleports. */
    if(typeof cameraInputStep==='function')cameraInputStep(span);

    const interacting=(typeof cameraMotionActive==='function')?cameraMotionActive():
      ((typeof cameraInputBusy==='function')?cameraInputBusy():
        (typeof pointers!=='undefined'&&pointers&&pointers.size>0));
    if(interacting&&span>28&&typeof fullShaderDone==='boolean'&&fullShaderDone&&
       typeof tuneRenderScale==='function'&&typeof qualityCooldown==='number'&&qualityCooldown<=0){
      /* One controlled degradation after a real long frame. The final pacing
         policy clamps the size of each backing-store change so quality cannot
         visibly pop by 20-25% in one frame. */
      const observed=Math.max(span,(typeof frameMsEwma==='number'?frameMsEwma:span));
      tuneRenderScale(observed);
    }
    return beforeDrawFrame(now);
  };

  window.__madPlanetInputFramePacing={
    inputPending:browserInputPending,
    cameraBusy:()=>typeof cameraMotionActive==='function'?cameraMotionActive():
      (typeof cameraInputBusy==='function'&&cameraInputBusy())
  };
})();
