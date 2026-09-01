/* ============ 0.5.83 / 0.5.84 / 0.5.114: smooth frame pacing + compact live telemetry ============ */
/*
   0.5.83 fixed the worst landscape-tablet cadence mismatch. 0.5.84 follows
   the FPS counter evidence: close zoom still increases fragment cost, while
   the once-per-second Weather Core callback can still show up as a small hitch.

   The physics clock remains fixed-step and deterministic. On touch/mobile
   devices the visual/weather grid is now 24..28 cells per cubemap face rather
   than 32, and the particularly expensive 4x cryosphere reconstruction is
   published less often than cloud/fog state. Its scalar edge field is blended
   in time and then thresholded by the surface shader, so the ice EDGE moves
   smoothly without becoming translucent ice.

   Dynamic resolution is now allowed to react while dragging/pinching. 0.5.83
   froze quality during pointer interaction to avoid a framebuffer realloc,
   but that also prevented the renderer from responding exactly when a pinch
   made the planet fill the screen and fragment cost jumped. One occasional
   controlled scale change is less objectionable than sustained 20-30 fps.

   0.5.114 removes the remaining one-second cadence spike from the visible
   path. Weather integration stays fixed-step, but cloud/fog/cryosphere target
   publication is coalesced and drained in separate idle turns. Pointer/wheel
   activity gets priority over both physics and visual publication, so a mouse
   drag or pinch cannot be interrupted by a periodic weather callback. New
   seeds and first-frame textures still publish synchronously because showing
   stale fields from another world would be worse than a one-time setup cost.
*/

const SMOOTH_MOBILE_FRAME_MS = 18.0; /* ~56 fps target, with 60 Hz headroom */
const SMOOTH_DESKTOP_FRAME_MS = 16.7;
const SMOOTH_MOBILE_SCALE_MIN = deviceMemory <= 4 ? 0.60 : 0.68;
const SMOOTH_MOBILE_WEATHER_N = deviceMemory <= 4 ? 24 : 28;
const SMOOTH_MOBILE_CRYO_PUBLISH_MS = 2400;
const SMOOTH_DESKTOP_CRYO_PUBLISH_MS = 1800;
const SMOOTH_INTERACTION_GRACE_MS = 150;

/* Landscape tablets used to miss the <=700px media query and pay desktop
   Weather Core cost. Coarse pointer / mobile UA are the important signals. */
if(typeof weatherCoreRequestedResolution === 'function'){
  weatherCoreRequestedResolution = function(){
    const uaMobile = (typeof navigator!=='undefined') && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent||'');
    const coarse = (typeof matchMedia==='function') && matchMedia('(pointer: coarse)').matches;
    const compact = (typeof matchMedia==='function') && matchMedia('(max-width: 900px)').matches;
    return (uaMobile || coarse || compact) ? SMOOTH_MOBILE_WEATHER_N : WEATHER_CORE_DESKTOP_N;
  };
}

/* The smoother contour needs fewer brute-force display texels on mobile. */
if(typeof cryoGpuDisplayResolution === 'function'){
  cryoGpuDisplayResolution = function(coreN){
    const n=Math.max(4,Math.round(Number(coreN)||32));
    const upscale=mobileDevice?4:CRYO_GPU_UPSCALE;
    return Math.max(8,n*upscale);
  };
}

/* Fractional Weather Core coverage becomes a continuous edge FIELD here, not
   optical alpha. 0.5 is the material boundary. Dense ice and zero coverage
   still pin exactly to 1/0; sparse sea ice below the 15% display convention
   stays open water. */
if(typeof cryoGpuVisualCoverage === 'function'){
  cryoGpuVisualCoverage = function(raw,edgeNoise,sea){
    raw=Math.max(0,Math.min(1,Number(raw)||0));
    edgeNoise=Math.max(0,Math.min(1,Number(edgeNoise)||0.5));
    if(raw<=0.008)return 0;
    if(!sea && raw>=0.70)return 1;
    if(sea && raw>=0.985)return 1;
    if(typeof cryoDisplayTemperateTrimWeight==='function'){
      raw*=1-0.10*cryoDisplayTemperateTrimWeight(cryoDisplayMeanK);
    }
    if(sea && raw<0.15)return 0;
    const slope=sea?2.15:2.45;
    return Math.max(0,Math.min(1,0.5+(raw-edgeNoise)*slope));
  };
}

/* 0.5.81's NEAREST override exposed the sampling grid. LINEAR is safe here
   because filtered values are edge coordinates, not optical transparency. */
if(typeof cryoGpuEnsure === 'function'){
  const cryoGpuEnsureBeforeSmoothContour=cryoGpuEnsure;
  cryoGpuEnsure=function(N){
    const out=cryoGpuEnsureBeforeSmoothContour(N);
    if(typeof gl!=='undefined'&&gl&&cryoGpuTex){
      gl.activeTexture(gl.TEXTURE0+CRYO_TEX_UNIT);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP,cryoGpuTex);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);
      gl.activeTexture(gl.TEXTURE0);
    }
    return out;
  };
}

/* The hard-edge release disabled all temporal cryosphere interpolation because
   blending two binary masks made grey milk. We no longer blend binary optical
   masks: we blend a scalar boundary coordinate, then the shader thresholds it.
   This safely turns a multi-second physical update into continuous edge motion. */
if(typeof cryoGpuBlendAt === 'function'){
  cryoGpuBlendAt=function(nowMs){
    if(!cryoGpuHasFrame)return 1;
    const base=Math.max(1,Number(cryoGpuBlendDurationMs)||1);
    const duration=mobileDevice?Math.max(850,Math.min(1900,base*5.0)):Math.max(420,Math.min(1500,base*2.6));
    const t=Math.max(0,Math.min(1,(Number(nowMs)-cryoGpuBlendStartMs)/duration));
    return t*t*(3-2*t);
  };
}

/* Cryosphere reconstruction is much more expensive than its 24/28-cell
   physics source because it builds a 4x display cubemap with seamless projected
   sampling. Ice does not need a brand-new visual target every real second.
   Clouds/fog keep their normal cadence; only this slow surface phase is
   published every ~2.4 s on mobile and ~1.8 s on desktop, with the smooth edge
   interpolation above. */
if(typeof cryoGpuUpload === 'function'){
  const cryoGpuUploadBeforeSmoothCadence=cryoGpuUpload;
  let smoothCryoLastPublishMs=-1e12;
  cryoGpuUpload=function(core){
    const now=(typeof cryoGpuNowMs==='function')?cryoGpuNowMs():((typeof performance!=='undefined')?performance.now():Date.now());
    const sameSeed=cryoGpuHasFrame && Number(cryoGpuLastSeed)===(core?.seed|0);
    const minInterval=mobileDevice?SMOOTH_MOBILE_CRYO_PUBLISH_MS:SMOOTH_DESKTOP_CRYO_PUBLISH_MS;
    if(sameSeed && now-smoothCryoLastPublishMs<minInterval)return false;
    const ok=cryoGpuUploadBeforeSmoothCadence(core);
    if(ok)smoothCryoLastPublishMs=now;
    return ok;
  };
}

/* ----- interaction priority ------------------------------------------------
   Pointer events already change camera targets independently of Weather Core.
   This small grace window tells the cooperative weather scheduler that the
   user is still interacting even between wheel events / immediately after a
   pointer-up. No preventDefault and no input semantics live here. */
let smoothInteractionUntilMs=0;
function smoothMotionNowMs(){
  return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')
    ?performance.now():Date.now();
}
function smoothMarkInteraction(extraMs=SMOOTH_INTERACTION_GRACE_MS){
  smoothInteractionUntilMs=Math.max(smoothInteractionUntilMs,smoothMotionNowMs()+Math.max(0,Number(extraMs)||0));
}
function weatherCoreInteractionBusy(nowMs){
  const now=Number.isFinite(Number(nowMs))?Number(nowMs):smoothMotionNowMs();
  if(typeof document!=='undefined'&&document.hidden)return true;
  if(typeof state!=='undefined'&&state&&state.paused)return true;
  if(typeof pointers!=='undefined'&&pointers&&pointers.size>0)return true;
  return now<smoothInteractionUntilMs;
}
if(typeof canvas!=='undefined'&&canvas&&typeof canvas.addEventListener==='function'){
  canvas.addEventListener('pointerdown',()=>smoothMarkInteraction(220),{passive:true});
  canvas.addEventListener('pointermove',()=>{
    if(typeof pointers!=='undefined'&&pointers&&pointers.size>0)smoothMarkInteraction(140);
  },{passive:true});
  canvas.addEventListener('pointerup',()=>smoothMarkInteraction(180),{passive:true});
  canvas.addEventListener('pointercancel',()=>smoothMarkInteraction(180),{passive:true});
  canvas.addEventListener('wheel',()=>smoothMarkInteraction(260),{passive:true});
}

/* ----- fixed-tick -> visual publication queue ------------------------------
   weather-cloud-gpu.js, fog-gpu.js and cryosphere-gpu.js intentionally call
   their upload functions from the final fixed-step wrapper. Rebinding those
   function names here changes only WHEN the target is published; the physics
   arrays and the upload algorithms remain untouched. First frame, seed change
   and texture-size change stay synchronous. Normal fixed ticks only coalesce a
   latest target and schedule one idle publication at a time. */
let smoothWeatherCloudGpuUploadNow=null;
let smoothFogGpuUploadNow=null;
let smoothCryoGpuUploadNow=null;
const smoothVisualPending={cloud:null,fog:null,cryo:null};
let smoothVisualIdleHandle=0;
let smoothVisualWakeTimer=0;

function smoothVisualHasPending(){
  return !!(smoothVisualPending.cloud||smoothVisualPending.fog||smoothVisualPending.cryo);
}
function smoothScheduleVisualPublish(delayMs=0){
  if(!smoothVisualHasPending())return;
  if(smoothVisualIdleHandle||smoothVisualWakeTimer)return;
  const delay=Math.max(0,Number(delayMs)||0);
  if(delay>0){
    smoothVisualWakeTimer=setTimeout(()=>{
      smoothVisualWakeTimer=0;
      smoothScheduleVisualPublish(0);
    },delay);
    return;
  }
  const run=(deadline)=>{
    smoothVisualIdleHandle=0;
    smoothVisualWakeTimer=0;
    smoothDrainVisualPublish(deadline);
  };
  if(typeof requestIdleCallback==='function'){
    smoothVisualIdleHandle=requestIdleCallback(run,{timeout:700});
  }else{
    /* One task after the current turn rather than three uploads in the weather
       callback. Subsequent channels are scheduled in separate turns. */
    smoothVisualWakeTimer=setTimeout(()=>run(null),16);
  }
}
function smoothDrainVisualPublish(deadline){
  if(!smoothVisualHasPending())return;
  const now=smoothMotionNowMs();
  if(weatherCoreInteractionBusy(now)){
    smoothScheduleVisualPublish(90);
    return;
  }
  if(deadline&&!deadline.didTimeout&&deadline.timeRemaining()<3){
    smoothScheduleVisualPublish(24);
    return;
  }

  /* Publish cheap moving-atmosphere targets first. Each branch returns so the
     next target lands in another idle turn instead of rebuilding every texture
     in one long task. */
  if(smoothVisualPending.cloud&&smoothWeatherCloudGpuUploadNow){
    const core=smoothVisualPending.cloud;
    smoothVisualPending.cloud=null;
    smoothWeatherCloudGpuUploadNow(core);
    smoothScheduleVisualPublish(0);
    return;
  }
  if(smoothVisualPending.fog&&smoothFogGpuUploadNow){
    const core=smoothVisualPending.fog;
    smoothVisualPending.fog=null;
    smoothFogGpuUploadNow(core);
    smoothScheduleVisualPublish(0);
    return;
  }
  if(smoothVisualPending.cryo&&smoothCryoGpuUploadNow){
    /* Cryosphere reconstruction is the expensive publication. If recent frame
       pacing is already poor, wait for a calmer turn unless idle timeout says
       we have postponed long enough. */
    const frameHealthy=(typeof frameMsEwma!=='number')||frameMsEwma<(mobileDevice?27:22);
    if(!frameHealthy&&deadline&&!deadline.didTimeout){
      smoothScheduleVisualPublish(120);
      return;
    }
    const core=smoothVisualPending.cryo;
    const ok=smoothCryoGpuUploadNow(core);
    if(ok!==false)smoothVisualPending.cryo=null;
    smoothScheduleVisualPublish(ok===false?180:0);
  }
}

if(typeof weatherCloudGpuUpload==='function'){
  smoothWeatherCloudGpuUploadNow=weatherCloudGpuUpload;
  weatherCloudGpuUpload=function(core){
    if(!core?.N)return false;
    const seed=core.seed|0;
    const immediate=!weatherCloudGpuHasFrame||!weatherCloudGpuTex||!weatherCloudGpuTexPrev||
      weatherCloudGpuN!==core.N||weatherCloudGpuLastSeed!==seed;
    if(immediate)return smoothWeatherCloudGpuUploadNow(core);
    smoothVisualPending.cloud=core;
    smoothScheduleVisualPublish(0);
    return true;
  };
}
if(typeof fogGpuUpload==='function'){
  smoothFogGpuUploadNow=fogGpuUpload;
  fogGpuUpload=function(core){
    if(!core?.N)return false;
    const seed=core.seed|0;
    const immediate=!fogGpuHasFrame||!fogGpuTex||!fogGpuTexPrev||fogGpuN!==core.N||fogGpuLastSeed!==seed;
    if(immediate)return smoothFogGpuUploadNow(core);
    smoothVisualPending.fog=core;
    smoothScheduleVisualPublish(0);
    return true;
  };
}
if(typeof cryoGpuUpload==='function'){
  smoothCryoGpuUploadNow=cryoGpuUpload;
  cryoGpuUpload=function(core){
    if(!core?.N)return false;
    const seed=core.seed|0;
    const targetN=(typeof cryoGpuDisplayResolution==='function')?cryoGpuDisplayResolution(core.N):cryoGpuN;
    const immediate=!cryoGpuHasFrame||!cryoGpuTex||cryoGpuN!==targetN||cryoGpuLastSeed!==seed;
    if(immediate)return smoothCryoGpuUploadNow(core);
    smoothVisualPending.cryo=core;
    smoothScheduleVisualPublish(0);
    return true;
  };
}

/* render.js's public helpers are function bindings, so tune the policy without
   duplicating the render loop. Quality recovery stays much slower than
   degradation, preventing resize oscillation. */
if(typeof setRenderScale === 'function'){
  setRenderScale=function(next){
    const lo=mobileDevice?SMOOTH_MOBILE_SCALE_MIN:SCALE_MIN;
    next=Math.max(lo,Math.min(SCALE_MAX,Number(next)||lo));
    next=Math.round(next*100)/100;
    if(Math.abs(next-renderScale)<0.009)return;
    renderScale=next;
    requestCanvasFit();
  };
}
if(typeof tuneRenderScale === 'function'){
  tuneRenderScale=function(ms){
    if(!Number.isFinite(ms)||ms<=0||document.hidden)return;
    if(qualityCooldown>0)return;
    const target=mobileDevice?SMOOTH_MOBILE_FRAME_MS:SMOOTH_DESKTOP_FRAME_MS;
    const interacting=(typeof pointers!=='undefined'&&pointers&&pointers.size>0);
    if(ms>target*(interacting?1.06:1.10) && renderScale>(mobileDevice?SMOOTH_MOBILE_SCALE_MIN:SCALE_MIN)){
      const k=Math.max(0.76,Math.min(0.94,Math.sqrt(target/ms)*0.965));
      setRenderScale(renderScale*k);
      qualityCooldown=interacting?72:45;
    }else if(!interacting && ms<target*0.64 && renderScale<SCALE_MAX){
      setRenderScale(renderScale*1.020);
      qualityCooldown=120;
    }
  };
}

/* ----- top-left live telemetry ----- */
let smoothTelemetryFrames=0;
let smoothTelemetryLastMs=(typeof performance!=='undefined'?performance.now():Date.now());
let smoothTelemetryFps=0;
let smoothTelemetryBox=null;
let smoothTelemetryValues={fps:null,temp:null,star:null,dist:null};

function smoothTelemetryEnsure(){
  if(typeof document==='undefined')return null;
  if(smoothTelemetryBox&&smoothTelemetryBox.isConnected)return smoothTelemetryBox;
  const mark=document.querySelector('.mark');if(!mark)return null;
  const box=document.createElement('div');
  box.id='liveTelemetry';
  box.style.cssText='margin-top:6px;display:grid;grid-template-columns:auto auto;column-gap:12px;row-gap:2px;width:max-content;font-family:var(--mono);font-size:8px;line-height:1.35;letter-spacing:.08em;color:rgba(180,194,216,.72);text-shadow:0 1px 8px rgba(0,0,0,.75)';
  const add=(key,label)=>{
    const a=document.createElement('span');a.textContent=label;a.style.opacity='.72';
    const b=document.createElement('b');b.dataset.live=key;b.textContent='—';b.style.cssText='font-weight:500;color:rgba(226,235,248,.88);text-align:right;font-variant-numeric:tabular-nums';
    box.append(a,b);smoothTelemetryValues[key]=b;
  };
  add('fps','FPS');
  add('temp','T̄');
  add('star','ЗВЕЗДА');
  add('dist','ОРБИТА');
  mark.appendChild(box);smoothTelemetryBox=box;return box;
}
function smoothTelemetryText(el,text){if(el&&el.textContent!==text)el.textContent=text;}
function smoothTelemetryUpdate(now){
  smoothTelemetryFrames++;
  const span=Math.max(1,now-smoothTelemetryLastMs);
  if(span<400)return;
  const rawFps=smoothTelemetryFrames*1000/span;
  smoothTelemetryFps=smoothTelemetryFps>0?smoothTelemetryFps*0.62+rawFps*0.38:rawFps;
  smoothTelemetryFrames=0;smoothTelemetryLastMs=now;
  if(!smoothTelemetryEnsure())return;
  let tempC=NaN,cls='—',au=NaN;
  try{const c=climateModel();tempC=Number(c?.C);}catch(_e){}
  try{cls=String(starLabel(state.star)||'—');}catch(_e){}
  try{au=Number(distanceInfo(state.distance)?.au);}catch(_e){}
  smoothTelemetryText(smoothTelemetryValues.fps,String(Math.max(0,Math.round(smoothTelemetryFps))));
  smoothTelemetryText(smoothTelemetryValues.temp,Number.isFinite(tempC)?((tempC>=0?'+':'')+tempC.toFixed(1)+' °C'):'—');
  smoothTelemetryText(smoothTelemetryValues.star,cls);
  smoothTelemetryText(smoothTelemetryValues.dist,Number.isFinite(au)?au.toFixed(2)+' AU':'—');
}

smoothTelemetryEnsure();
if(typeof drawFrame === 'function'){
  const drawFrameBeforeSmoothTelemetry=drawFrame;
  drawFrame=function(now){
    drawFrameBeforeSmoothTelemetry(now);
    smoothTelemetryUpdate(Number(now)||((typeof performance!=='undefined')?performance.now():Date.now()));
  };
}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{
  smoothTelemetryFrames=0;
  smoothTelemetryLastMs=(typeof performance!=='undefined'?performance.now():Date.now());
  if(!document.hidden&&smoothVisualHasPending())smoothScheduleVisualPublish(40);
});
