/* ============ 0.5.53 / 0.5.64: oscilloscope-style lightning screenshot trigger ============ */
/* Loaded after render.js. The trigger mirrors the flash-phase equations in
   shaders/lightning.glsl and samples them immediately after the normal frame.
   When the rising edge crosses the threshold, takeShot() re-renders a high-res
   frame with the SAME requestAnimationFrame timestamp, so the captured bolt is
   the bolt that actually triggered the event rather than a later guess.

   0.5.64 fixes two important blind spots. First, the trigger now uses the same
   nonlinear storm-rate/activity response as the renderer. Second, visibility
   means exactly what the user sees: every lightning centre on the hemisphere
   facing the camera is eligible, independent of camera distance. The old
   smooth dot-product attenuation effectively watched only the central part of
   the disc and ignored real flashes close to the limb. */

const SHOT_LIGHTNING_TRIGGER_THRESHOLD=0.015;
if(typeof lightningShotTrigger!=='undefined') lightningShotTrigger.threshold=SHOT_LIGHTNING_TRIGGER_THRESHOLD;

function shotLightningClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function shotLightningFrontVisibility(bodyX,bodyY,bodyZ,t){
  if(typeof m3axis!=='function'||typeof m3v!=='function'||!world?.axis)return 1;
  /* uRotS in the main renderer is world->body with the negative spin angle;
     this is its inverse, hence body->world with the positive angle. */
  const bodyToWorld=m3axis(world.axis,t*SPIN+world.surfOff);
  const p=m3v(bodyToWorld,[bodyX,bodyY,bodyZ]);
  const cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
  const eye=norm3([cam.dist*cp*Math.sin(cam.yaw),cam.dist*sp,cam.dist*cp*Math.cos(cam.yaw)]);
  const d=p[0]*eye[0]+p[1]*eye[1]+p[2]*eye[2];
  /* Binary hemisphere test. cam.dist deliberately cancels because eye is
     normalized: a visible storm remains trigger-visible from low orbit to a
     distant full-disc view. Include the mathematical limb itself. */
  return d>=-1e-6?1:0;
}
function shotLightningVisualScore(now){
  if(typeof fullShaderDone!=='undefined'&&!fullShaderDone)return 0;
  if(!state?.lowOn||Number(state.cloudLow)<0.05||!world?.cycB||!world?.cycA)return 0;
  const t=(Number(now)-t0)/1000;
  const lt=((t%900)+900)%900;
  const stormRate=shotLightningClamp(state.stormRate,0,1);
  const storm=shotLightningClamp(state.storm,0,1);
  const stormGlow=shotLightningClamp(state.stormGlow,0,1);
  /* Keep these equations in lock-step with shaders/lightning.glsl. */
  const rateScale=0.60+3.40*stormRate*stormRate;
  const activityScale=0.80+1.20*storm*storm;
  const amp=2.5+(18.0-2.5)*stormGlow*stormGlow;
  const glowScale=amp/18.0;
  let best=0;
  for(let i=0;i<5;i++){
    const o=i*4;
    const rate=Math.max(0,Number(world.cycB[o+1])||0)*rateScale;
    const intensity=shotLightningClamp((Number(world.cycB[o+2])||0)*activityScale,0,2.0);
    if(rate<0.005||intensity<0.006)continue;
    const phase=Number(world.cycB[o+3])||0;
    const ph=lt*rate+phase*37.0+i*5.17;
    const fr=ph-Math.floor(ph);
    const first=Math.exp(-fr*42.0);
    const second=0.70*Math.exp(-Math.abs(fr-0.105)*58.0);
    const win=Math.max(first,second);
    if(win<0.002)continue;
    const vis=shotLightningFrontVisibility(world.cycA[o],world.cycA[o+1],world.cycA[o+2],t);
    /* Trigger on the existence of a visible flash, not on its projected pixel
       size. Glow still matters so extremely faint electrical noise does not
       fire the capture, but there is no distance or centre-of-disc penalty. */
    best=Math.max(best,win*intensity*(0.35+0.65*glowScale)*vis);
  }
  return best;
}

const drawFrameBeforeShotTrigger=drawFrame;
drawFrame=function(now){
  drawFrameBeforeShotTrigger(now);
  if(typeof shotCaptureBusy!=='undefined'&&shotCaptureBusy)return;
  if(typeof lightningShotTrigger==='undefined'||!lightningShotTrigger.armed)return;
  const score=shotLightningVisualScore(now);
  const prev=Number(lightningShotTrigger.lastScore)||0;
  lightningShotTrigger.lastScore=score;
  const threshold=Number(lightningShotTrigger.threshold)||SHOT_LIGHTNING_TRIGGER_THRESHOLD;
  if(score>=threshold&&prev<threshold){
    const includeCard=lightningShotTrigger.includeCard;
    if(typeof shotTriggerFired==='function')shotTriggerFired();else lightningShotTrigger.armed=false;
    /* Synchronous high-res render starts immediately at the triggering
       timestamp; PNG encoding itself can finish asynchronously afterwards. */
    Promise.resolve(takeShot({now,includeCard,showPreview:true})).catch(e=>console.warn('[madPlanet] lightning screenshot failed',e));
  }
};
