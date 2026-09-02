/* ============ камера и ввод ============ */
const cam = {yaw: 0.55, pitch: 0.12, dist: 2.65, tDist: 2.65, vyaw: 0, vpitch: 0};
let sunAz = 2.0, sunEl = 0.16;      /* ПКМ или режим «Звезда» вращает свет */
let orbitControlMode = 'planet';
function setOrbitControlMode(mode){
  orbitControlMode = mode === 'sun' ? 'sun' : 'planet';
  cam.vyaw = cam.vpitch = 0;
  return orbitControlMode;
}
function getOrbitControlMode(){ return orbitControlMode; }

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPIN = reduceMotion ? 0.004 : 0.02;             // рад/с вращения планеты

const pointers = new Map();
let pinchD = 0;
let canvasGestureScrollX=0,canvasGestureScrollY=0;

/* 0.5.127: input events are not render ticks. A very short mouse/finger flick
   can legitimately produce pointerdown + pointerup with no delivered
   pointermove between them, especially when Chromium coalesces motion while a
   frame is expensive. The old camera therefore lost the whole gesture.

   Keep pointer sampling lossless and render pacing separate:
     - every delivered/coalesced sample contributes to a pending angular delta;
     - pointerup ALWAYS contributes its final coordinates before release;
     - draw loop drains that delta in bounded chunks, so a delayed batch cannot
       teleport the camera by a huge angle in one frame;
     - inertia velocity is derived from event timestamps instead of assuming
       exactly 60 pointer events per second.
*/
const CAMERA_INPUT_MAX_STEP_RAD=0.16;       /* <=9.2 deg per rendered frame */
const CAMERA_INPUT_EPS=1e-6;
const CAMERA_EVENT_VELOCITY_MAX=8.0;        /* rad/s, guards timestamp spikes */
let cameraPendingYaw=0,cameraPendingPitch=0;
let cameraPendingSunAz=0,cameraPendingSunEl=0;

function cameraInputScale(){
  return 1/Math.max(1,Math.min(innerWidth,innerHeight))*3.2*Math.min(cam.dist-0.95,1.4);
}
function cameraEventStamp(e){
  const t=Number(e?.timeStamp);
  return Number.isFinite(t)&&t>=0?t:((typeof performance!=='undefined')?performance.now():Date.now());
}
function cameraClampVelocity(v){return Math.max(-CAMERA_EVENT_VELOCITY_MAX,Math.min(CAMERA_EVENT_VELOCITY_MAX,Number(v)||0));}
function cameraQueuePlanetDelta(p,dx,dy,stamp){
  const k=cameraInputScale(),dyaw=-dx*k,dpitch=dy*k;
  cameraPendingYaw+=dyaw;cameraPendingPitch+=dpitch;
  const dt=Math.max(1/240,Math.min(0.12,(stamp-(Number(p.t)||stamp))/1000||1/60));
  const vy=cameraClampVelocity(dyaw/dt),vp=cameraClampVelocity(dpitch/dt);
  cam.vyaw=cam.vyaw*0.42+vy*0.58;cam.vpitch=cam.vpitch*0.42+vp*0.58;
  p.t=stamp;
}
function cameraQueueSunDelta(dx,dy){
  cameraPendingSunAz-=dx*0.005;
  cameraPendingSunEl+=dy*0.005;
}
function cameraApplyPointerSample(sample,p){
  const x=Number(sample?.clientX),y=Number(sample?.clientY);
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const dx=x-p.x,dy=y-p.y,stamp=cameraEventStamp(sample);
  p.x=x;p.y=y;
  if(Math.abs(dx)+Math.abs(dy)<1e-9){p.t=stamp;return;}
  if(pointers.size===1){
    if(p.sun)cameraQueueSunDelta(dx,dy);
    else cameraQueuePlanetDelta(p,dx,dy,stamp);
  }else if(pointers.size===2){
    const [a,b]=[...pointers.values()];
    const d=Math.hypot(a.x-b.x,a.y-b.y);
    if(pinchD>0&&d>1)cam.tDist=clampDist(cam.tDist*pinchD/d);
    pinchD=d;
    p.t=stamp;
  }
}
function cameraProcessPointerEvent(e,withCoalesced){
  const p=pointers.get(e.pointerId);if(!p)return false;
  let lastX=NaN,lastY=NaN,lastT=NaN;
  if(withCoalesced&&typeof e.getCoalescedEvents==='function'){
    let batch=[];try{batch=e.getCoalescedEvents()||[];}catch(_err){batch=[];}
    for(const s of batch){
      cameraApplyPointerSample(s,p);lastX=Number(s.clientX);lastY=Number(s.clientY);lastT=cameraEventStamp(s);
    }
  }
  const ex=Number(e.clientX),ey=Number(e.clientY),et=cameraEventStamp(e);
  if(ex!==lastX||ey!==lastY||et!==lastT)cameraApplyPointerSample(e,p);
  return true;
}
function cameraInputPending(){
  return Math.abs(cameraPendingYaw)+Math.abs(cameraPendingPitch)+Math.abs(cameraPendingSunAz)+Math.abs(cameraPendingSunEl)>CAMERA_INPUT_EPS;
}
function cameraInputBusy(){return pointers.size>0||cameraInputPending();}
function cameraDrainPair(a,b,maxStep){
  const m=Math.hypot(a,b);if(!(m>CAMERA_INPUT_EPS))return [0,0,0];
  const f=Math.min(1,maxStep/m);return [a*f,b*f,f];
}
function cameraInputStep(){
  let moved=false;
  let q=cameraDrainPair(cameraPendingYaw,cameraPendingPitch,CAMERA_INPUT_MAX_STEP_RAD);
  if(q[2]>0){
    const ay=q[0],ap=q[1];cameraPendingYaw-=ay;cameraPendingPitch-=ap;
    cam.yaw+=ay;
    const wanted=cam.pitch+ap,clamped=Math.max(-1.35,Math.min(1.35,wanted));
    cam.pitch=clamped;
    if(clamped!==wanted)cameraPendingPitch=0;
    moved=true;
  }
  q=cameraDrainPair(cameraPendingSunAz,cameraPendingSunEl,CAMERA_INPUT_MAX_STEP_RAD);
  if(q[2]>0){
    cameraPendingSunAz-=q[0];cameraPendingSunEl-=q[1];sunAz+=q[0];
    const wanted=sunEl+q[1],clamped=Math.max(-1.2,Math.min(1.2,wanted));sunEl=clamped;
    if(clamped!==wanted)cameraPendingSunEl=0;
    moved=true;
  }
  if(Math.abs(cameraPendingYaw)<CAMERA_INPUT_EPS)cameraPendingYaw=0;
  if(Math.abs(cameraPendingPitch)<CAMERA_INPUT_EPS)cameraPendingPitch=0;
  if(Math.abs(cameraPendingSunAz)<CAMERA_INPUT_EPS)cameraPendingSunAz=0;
  if(Math.abs(cameraPendingSunEl)<CAMERA_INPUT_EPS)cameraPendingSunEl=0;
  return moved;
}

/* 0.5.78: some Android Chromium builds still expose a small layout/visual
   viewport pan even when the canvas itself has touch-action:none. This is a
   fixed full-screen application, so scrolling the root is never meaningful.
   Lock overscroll on both roots and restore the gesture-start scroll position
   while a captured canvas pointer is active. Panel gestures are handled on
   their own DOM path and never enter this camera lock. */
canvas.style.touchAction='none';
canvas.style.overscrollBehavior='none';
document.documentElement.style.overscrollBehavior='none';
document.documentElement.style.overscrollBehaviorX='none';
document.body.style.overscrollBehavior='none';
document.body.style.overscrollBehaviorX='none';
function ownCanvasPointer(e){
  if((e.pointerType==='touch'||e.pointerType==='pen')&&e.cancelable)e.preventDefault();
}
function restoreCanvasViewport(){
  if(!pointers.size)return;
  if(window.scrollX!==canvasGestureScrollX||window.scrollY!==canvasGestureScrollY)
    window.scrollTo(canvasGestureScrollX,canvasGestureScrollY);
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  ownCanvasPointer(e);
  if(pointers.size===0){canvasGestureScrollX=window.scrollX;canvasGestureScrollY=window.scrollY;}
  canvas.setPointerCapture(e.pointerId);
  const rotateSun=e.button===2||(e.button===0&&orbitControlMode==='sun');
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,t:cameraEventStamp(e),sun:rotateSun});
  if(pointers.size===2){
    const [a,b]=[...pointers.values()];pinchD=Math.hypot(a.x-b.x,a.y-b.y);
  }
  cam.vyaw=cam.vpitch=0;
  canvas.classList.add('grab');restoreCanvasViewport();
},{passive:false});
canvas.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  ownCanvasPointer(e);restoreCanvasViewport();cameraProcessPointerEvent(e,true);
},{passive:false});
function endPointer(e,applyFinal=true){
  ownCanvasPointer(e);restoreCanvasViewport();
  /* Critical short-flick guarantee: pointerup may be the first event carrying
     a coordinate different from pointerdown. Account for it before deletion. */
  if(applyFinal)cameraProcessPointerEvent(e,false);
  pointers.delete(e.pointerId);
  if(pointers.size<2)pinchD=0;
  if(pointers.size===0)canvas.classList.remove('grab');
}
canvas.addEventListener('pointerup',e=>endPointer(e,true),{passive:false});
canvas.addEventListener('pointercancel',e=>endPointer(e,false),{passive:false});
canvas.addEventListener('lostpointercapture',e=>{
  if(pointers.has(e.pointerId))endPointer(e,false);
},{passive:false});
/* Pointer Events should be sufficient, but Chromium's history/overscroll path
   may still dispatch legacy TouchEvents on a captured canvas. Cancel those too
   without touching sliders or panel scrolling elsewhere in the document. */
canvas.addEventListener('touchstart',e=>{if(e.cancelable)e.preventDefault();},{passive:false});
canvas.addEventListener('touchmove',e=>{if(e.cancelable)e.preventDefault();restoreCanvasViewport();},{passive:false});
window.addEventListener('scroll',restoreCanvasViewport,{passive:true});
canvas.addEventListener('wheel',e=>{
  e.preventDefault();cam.tDist=clampDist(cam.tDist*Math.exp(e.deltaY*0.0011));
},{passive:false});
function clampDist(d){return Math.max(1.16,Math.min(6.4,d));}

window.__madPlanetCameraInput={
  pending:cameraInputPending,busy:cameraInputBusy,step:cameraInputStep,
  get queued(){return {yaw:cameraPendingYaw,pitch:cameraPendingPitch,sunAz:cameraPendingSunAz,sunEl:cameraPendingSunEl};}
};
