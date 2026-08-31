/* ============ 0.5.83: smooth frame pacing + compact live telemetry ============ */
/*
   Two unrelated cadences used to read as one global "tick" on tablets:
   - render.js deliberately targeted about 32 fps on every mobile device;
   - Weather Core classified a landscape tablet as desktop unless CSS width was
     <=700 px, so a coarse-pointer tablet ran the 48x48x6 physics grid.

   This layer does not move physics onto render FPS. It keeps the fixed weather
   clock, but gives coarse-pointer/mobile devices the intended 32x32x6 grid and
   asks the dynamic renderer to favour motion (~50-60 fps) over excess internal
   resolution. Resolution changes are suppressed while a finger/mouse is
   actively dragging, because reallocating the framebuffer during interaction
   itself feels like a hitch.

   The cryosphere part fixes the visual side of the same problem. 0.5.81 forced
   NEAREST sampling to eliminate a translucent ice halo, exposing every render
   texel as a square. The surface shader now resolves the ice boundary as an
   opaque screen-space contour, so this module may safely restore LINEAR source
   sampling. Transitional physical coverage is encoded as a continuous signed
   edge field; the shader, not texture opacity, decides ice versus exposed
   ground/water.
*/

const SMOOTH_MOBILE_FRAME_MS = 18.0; /* ~56 fps target, with 60 Hz headroom */
const SMOOTH_DESKTOP_FRAME_MS = 16.7;
const SMOOTH_MOBILE_SCALE_MIN = deviceMemory <= 4 ? 0.62 : 0.70;

/* Landscape tablets used to miss the <=700px media query and pay desktop
   Weather Core cost. Coarse pointer / mobile UA are the important signals. */
if(typeof weatherCoreRequestedResolution === 'function'){
  weatherCoreRequestedResolution = function(){
    const uaMobile = (typeof navigator!=='undefined') && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent||'');
    const coarse = (typeof matchMedia==='function') && matchMedia('(pointer: coarse)').matches;
    const compact = (typeof matchMedia==='function') && matchMedia('(max-width: 900px)').matches;
    return (uaMobile || coarse || compact) ? WEATHER_CORE_DRAFT_N : WEATHER_CORE_DESKTOP_N;
  };
}

/* The smoother contour needs fewer brute-force display texels on mobile, which
   removes a sizeable chunk of the once-per-weather-tick CPU reconstruction. */
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
   stays open water. The surface shader thresholds this field with ~1px AA. */
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

/* 0.5.81's NEAREST override solved the wrong problem by exposing the sampling
   grid. LINEAR is safe again because fractional samples are interpreted only
   as edge coordinates; they are not used as kilometres-wide translucent ice. */
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

/* render.js's public helpers are function bindings, so tune the policy without
   duplicating the render loop. Keep expensive canvas reallocations away from
   active drags and make quality recovery deliberately slower than degradation. */
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
    if(typeof pointers!=='undefined'&&pointers&&pointers.size>0)return;
    const target=mobileDevice?SMOOTH_MOBILE_FRAME_MS:SMOOTH_DESKTOP_FRAME_MS;
    if(ms>target*1.10 && renderScale>(mobileDevice?SMOOTH_MOBILE_SCALE_MIN:SCALE_MIN)){
      const k=Math.max(0.78,Math.min(0.95,Math.sqrt(target/ms)*0.97));
      setRenderScale(renderScale*k);
      qualityCooldown=45;
    }else if(ms<target*0.64 && renderScale<SCALE_MAX){
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
});
