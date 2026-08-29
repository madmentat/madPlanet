/* ============ 0.5.53: oscilloscope-style lightning screenshot trigger ============ */
/* Loaded after render.js. The trigger mirrors the flash-phase equations in
   shaders/lightning.glsl and samples them immediately after the normal frame.
   When the rising edge crosses the threshold, takeShot() re-renders a high-res
   frame with the SAME requestAnimationFrame timestamp, so the captured bolt is
   the bolt that actually triggered the event rather than a later guess. */

function shotLightningClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function shotLightningFrontVisibility(bodyX,bodyY,bodyZ,t){
  if(typeof m3axis!=='function'||typeof m3v!=='function'||!world?.axis)return 1;
  const inv=m3axis(world.axis,t*SPIN+world.surfOff);
  const p=m3v(inv,[bodyX,bodyY,bodyZ]);
  const cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
  const eye=norm3([cam.dist*cp*Math.sin(cam.yaw),cam.dist*sp,cam.dist*cp*Math.cos(cam.yaw)]);
  const d=p[0]*eye[0]+p[1]*eye[1]+p[2]*eye[2];
  return shotLightningClamp((d+0.03)/0.35,0,1);
}
function shotLightningVisualScore(now){
  if(typeof fullShaderDone!=='undefined'&&!fullShaderDone)return 0;
  if(!state?.lowOn||Number(state.cloudLow)<0.05||!world?.cycB||!world?.cycA)return 0;
  const t=(Number(now)-t0)/1000;
  const lt=((t%900)+900)%900;
  const rateScale=0.55+(1.65-0.55)*shotLightningClamp(state.stormRate,0,1);
  const activityScale=0.72+(1.28-0.72)*shotLightningClamp(state.storm,0,1);
  const glowScale=0.35+0.65*shotLightningClamp(state.stormGlow,0,1);
  let best=0;
  for(let i=0;i<5;i++){
    const o=i*4;
    const rate=Math.max(0,Number(world.cycB[o+1])||0)*rateScale;
    const intensity=shotLightningClamp((Number(world.cycB[o+2])||0)*activityScale,0,1.4);
    if(rate<0.005||intensity<0.006)continue;
    const phase=Number(world.cycB[o+3])||0;
    const ph=lt*rate+phase*37.0+i*5.17;
    const fr=ph-Math.floor(ph);
    const first=Math.exp(-fr*42.0);
    const second=0.70*Math.exp(-Math.abs(fr-0.105)*58.0);
    const win=Math.max(first,second);
    const vis=shotLightningFrontVisibility(world.cycA[o],world.cycA[o+1],world.cycA[o+2],t);
    best=Math.max(best,win*intensity*glowScale*vis);
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
  if(score>=lightningShotTrigger.threshold&&prev<lightningShotTrigger.threshold){
    const includeCard=lightningShotTrigger.includeCard;
    if(typeof shotTriggerFired==='function')shotTriggerFired();else lightningShotTrigger.armed=false;
    /* Synchronous high-res render starts immediately at the triggering
       timestamp; PNG encoding itself can finish asynchronously afterwards. */
    Promise.resolve(takeShot({now,includeCard,showPreview:true})).catch(e=>console.warn('[madPlanet] lightning screenshot failed',e));
  }
};
