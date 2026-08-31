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
  const rotateSun = e.button === 2 || (e.button === 0 && orbitControlMode === 'sun');
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY, sun:rotateSun});
  if(pointers.size === 2){
    const [a,b] = [...pointers.values()];
    pinchD = Math.hypot(a.x-b.x, a.y-b.y);
  }
  cam.vyaw = cam.vpitch = 0;
  canvas.classList.add('grab');
  restoreCanvasViewport();
},{passive:false});
canvas.addEventListener('pointermove', e => {
  if(!pointers.has(e.pointerId)) return;
  ownCanvasPointer(e);
  restoreCanvasViewport();
  const p = pointers.get(e.pointerId);
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if(pointers.size === 1){
    if(p.sun){
      /* ПКМ на десктопе или обычный drag в режиме «Звезда»: вращаем
         одновременно источник освещения и видимую звезду в sky pass. */
      sunAz -= dx*0.005;
      sunEl = Math.max(-1.2, Math.min(1.2, sunEl + dy*0.005));
      return;
    }
    const k = 1/Math.min(innerWidth, innerHeight) * 3.2 * Math.min(cam.dist-0.95, 1.4);
    cam.yaw   -= dx*k;
    cam.pitch += dy*k;
    cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
    cam.vyaw = -dx*k*60; cam.vpitch = dy*k*60;
  } else if(pointers.size === 2){
    const [a,b] = [...pointers.values()];
    const d = Math.hypot(a.x-b.x, a.y-b.y);
    if(pinchD > 0) cam.tDist = clampDist(cam.tDist * pinchD/d);
    pinchD = d;
  }
},{passive:false});
function endPointer(e){
  ownCanvasPointer(e);
  restoreCanvasViewport();
  pointers.delete(e.pointerId);
  if(pointers.size < 2) pinchD = 0;
  if(pointers.size === 0) canvas.classList.remove('grab');
}
canvas.addEventListener('pointerup', endPointer,{passive:false});
canvas.addEventListener('pointercancel', endPointer,{passive:false});
/* Pointer Events should be sufficient, but Chromium's history/overscroll path
   may still dispatch legacy TouchEvents on a captured canvas. Cancel those too
   without touching sliders or panel scrolling elsewhere in the document. */
canvas.addEventListener('touchstart',e=>{if(e.cancelable)e.preventDefault();},{passive:false});
canvas.addEventListener('touchmove',e=>{if(e.cancelable)e.preventDefault();restoreCanvasViewport();},{passive:false});
window.addEventListener('scroll',restoreCanvasViewport,{passive:true});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.tDist = clampDist(cam.tDist * Math.exp(e.deltaY*0.0011));
}, {passive:false});
function clampDist(d){ return Math.max(1.16, Math.min(6.4, d)); }

