/* ============ 0.5.128: perceptual frame-pacing polish ============ */
/*
   0.5.127 made pointer sampling lossless, but lossless input can still LOOK
   jerky when a delayed batch is allowed to move the camera by 0.16 rad (~9.2
   degrees) in one visible frame. Keep small gestures immediate, but drain large
   queued gestures with a time-aware spatial budget and cap release inertia.

   Fixed-step weather fields are also low-pass visual signals. Their physical
   targets remain discrete/deterministic; only the GPU interpolation horizon is
   lengthened so a delayed publication changes velocity rather than position.
*/
const FRAME_PACING_POLISH_MODEL=1;
const CAMERA_PACED_SPEED_RAD_S=2.15;
const CAMERA_PACED_STEP_MIN_RAD=0.020;
const CAMERA_PACED_STEP_MAX_RAD=0.068;
const CAMERA_PACED_INERTIA_MAX_RAD_S=1.65;
const FRAME_PACING_INERTIA_BUSY_RAD_S=0.025;
const FRAME_PACING_ZOOM_BUSY=0.0015;

function framePacingClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function cameraMotionActive(){
  if(typeof pointers!=='undefined'&&pointers&&pointers.size>0)return true;
  if(typeof cameraInputPending==='function'&&cameraInputPending())return true;
  if(typeof cam!=='undefined'&&cam){
    if(Math.abs(Number(cam.vyaw)||0)+Math.abs(Number(cam.vpitch)||0)>FRAME_PACING_INERTIA_BUSY_RAD_S)return true;
    if(Math.abs((Number(cam.tDist)||0)-(Number(cam.dist)||0))>FRAME_PACING_ZOOM_BUSY)return true;
  }
  return false;
}

/* Replace only the queue DRAIN policy. Event sampling, coalesced events,
   pointerup final-coordinate handling and pinch semantics stay in camera.js. */
if(typeof cameraInputStep==='function'&&typeof cameraDrainPair==='function'){
  cameraInputStep=function(frameMs=16.7){
    const dt=framePacingClamp(frameMs,8,55)/1000;
    const maxStep=framePacingClamp(CAMERA_PACED_SPEED_RAD_S*dt,
      CAMERA_PACED_STEP_MIN_RAD,CAMERA_PACED_STEP_MAX_RAD);
    let moved=false;
    let q=cameraDrainPair(cameraPendingYaw,cameraPendingPitch,maxStep);
    if(q[2]>0){
      const ay=q[0],ap=q[1];cameraPendingYaw-=ay;cameraPendingPitch-=ap;
      cam.yaw+=ay;
      const wanted=cam.pitch+ap,clamped=Math.max(-1.35,Math.min(1.35,wanted));
      cam.pitch=clamped;if(clamped!==wanted)cameraPendingPitch=0;moved=true;
    }
    q=cameraDrainPair(cameraPendingSunAz,cameraPendingSunEl,maxStep);
    if(q[2]>0){
      cameraPendingSunAz-=q[0];cameraPendingSunEl-=q[1];sunAz+=q[0];
      const wanted=sunEl+q[1],clamped=Math.max(-1.2,Math.min(1.2,wanted));
      sunEl=clamped;if(clamped!==wanted)cameraPendingSunEl=0;moved=true;
    }
    if(Math.abs(cameraPendingYaw)<CAMERA_INPUT_EPS)cameraPendingYaw=0;
    if(Math.abs(cameraPendingPitch)<CAMERA_INPUT_EPS)cameraPendingPitch=0;
    if(Math.abs(cameraPendingSunAz)<CAMERA_INPUT_EPS)cameraPendingSunAz=0;
    if(Math.abs(cameraPendingSunEl)<CAMERA_INPUT_EPS)cameraPendingSunEl=0;
    if(pointers.size===0&&!cameraInputPending()&&
       (Math.abs(cameraReleaseVYaw)+Math.abs(cameraReleaseVPitch)>CAMERA_INPUT_EPS)){
      cam.vyaw=framePacingClamp(cameraReleaseVYaw,-CAMERA_PACED_INERTIA_MAX_RAD_S,CAMERA_PACED_INERTIA_MAX_RAD_S);
      cam.vpitch=framePacingClamp(cameraReleaseVPitch,-CAMERA_PACED_INERTIA_MAX_RAD_S,CAMERA_PACED_INERTIA_MAX_RAD_S);
      cameraReleaseVYaw=cameraReleaseVPitch=0;
    }
    return moved;
  };
}

/* Do not start a CPU Weather Core tick or a deferred texture publication while
   the camera is visibly coasting. This extends the old pointer-only priority
   by only a few hundred milliseconds because render.js damps inertia rapidly. */
if(typeof weatherCoreInteractionBusy==='function'){
  const weatherCoreInteractionBusyBeforePacing=weatherCoreInteractionBusy;
  weatherCoreInteractionBusy=function(nowMs){
    return cameraMotionActive()||weatherCoreInteractionBusyBeforePacing(nowMs);
  };
}

/* Small quality changes are less objectionable than a single 20-25% backing
   store resize. React sooner under sustained load but move renderScale in small
   steps; recover still much more slowly and never while the camera is moving. */
if(typeof tuneRenderScale==='function'&&typeof setRenderScale==='function'){
  tuneRenderScale=function(ms){
    if(!Number.isFinite(ms)||ms<=0||document.hidden)return;
    if(qualityCooldown>0)return;
    const target=mobileDevice?SMOOTH_MOBILE_FRAME_MS:SMOOTH_DESKTOP_FRAME_MS;
    const moving=cameraMotionActive();
    if(ms>target*(moving?1.05:1.10)&&renderScale>(mobileDevice?SMOOTH_MOBILE_SCALE_MIN:SCALE_MIN)){
      const desired=renderScale*Math.max(0.76,Math.min(0.97,Math.sqrt(target/ms)*0.975));
      const maxDrop=moving?0.055:0.085;
      setRenderScale(Math.max(desired,renderScale-maxDrop));
      qualityCooldown=moving?14:26;
    }else if(!moving&&ms<target*0.62&&renderScale<SCALE_MAX){
      setRenderScale(Math.min(SCALE_MAX,renderScale+0.025));
      qualityCooldown=100;
    }
  };
}

/* Cloud/fog targets normally arrive about once a second. Blend a little longer
   than that cadence so timer jitter or interaction-priority deferral cannot
   create a freeze-then-move rhythm. Position remains exactly continuous because
   upload code still collapses prev/current to the value visible at publication. */
if(typeof weatherCloudGpuBlendAt==='function'){
  weatherCloudGpuBlendAt=function(nowMs){
    if(!weatherCloudGpuHasFrame)return 1;
    const duration=Math.max(1,Math.min(2300,weatherCloudGpuBlendDurationMs*1.55));
    const t=Math.max(0,Math.min(1,(Number(nowMs)-weatherCloudGpuBlendStartMs)/duration));
    return t*t*(3-2*t);
  };
}
if(typeof fogGpuBlendAt==='function'){
  fogGpuBlendAt=function(nowMs){
    if(!fogGpuHasFrame)return 1;
    const duration=Math.max(1,Math.min(2300,fogGpuBlendDurationMs*1.55));
    const t=Math.max(0,Math.min(1,(Number(nowMs)-fogGpuBlendStartMs)/duration));
    return t*t*(3-2*t);
  };
}
if(typeof cryoGpuBlendAt==='function'){
  cryoGpuBlendAt=function(nowMs){
    if(!cryoGpuHasFrame)return 1;
    const base=Math.max(1,Number(cryoGpuBlendDurationMs)||1);
    const duration=mobileDevice
      ?Math.max(1200,Math.min(2900,base*6.0))
      :Math.max(850,Math.min(2300,base*3.8));
    const t=Math.max(0,Math.min(1,(Number(nowMs)-cryoGpuBlendStartMs)/duration));
    return t*t*(3-2*t);
  };
}

window.__madPlanetFramePacingPolish={
  model:FRAME_PACING_POLISH_MODEL,
  cameraMotionActive,
  maxCameraStepRad:CAMERA_PACED_STEP_MAX_RAD,
  maxInertiaRadS:CAMERA_PACED_INERTIA_MAX_RAD_S
};
