/* ============ 0.5.147: Weather Core in a Web Worker ============ */
/*
   0.5.114..0.5.140 made the fixed weather tick cooperative: it waits for an
   idle slice, skips wall-clock opportunities under load and never replays
   missed time. That removes the worst collisions with pointer input, but a
   tick is still one indivisible 80..250 ms main-thread task (2 s for a new
   world), and 30 fps needs every task under ~16 ms. Measured on 0.5.145: 14
   long tasks in 20 s while idle, every one of them a dropped run of frames.

   This module moves the whole fixed step into a Web Worker. No physics
   module changes: the worker is built at runtime from the very same script
   text the page executes (document.currentScript) plus a small DOM / WebGL
   stub, so every module loads there harmlessly. The existing cooperative
   scheduler stays the cadence driver; weatherCoreTick() on the main thread
   now only posts a request. The worker runs weatherCoreStep(), reconstructs
   the dense cryosphere and river cubemaps there, and transfers a read-only
   MIRROR of the core (typed arrays, zero-copy) plus the quantised faces back.
   GPU bridges, diagnostics, telemetry and export keep reading the core through
   weatherCoreEnsure() exactly as before; the main thread only uploads bytes,
   spread over consecutive rendered frames.

   If the worker cannot start (no Worker, CSP, a runtime error inside it), the
   synchronous path is restored unchanged.
*/

const WEATHER_WORKER_MODEL=2;
const WEATHER_WORKER_BOOT_TIMEOUT_MS=15000;
const WEATHER_WORKER_RIVER_FACE_TICKS=4;
const MP_IS_WEATHER_WORKER=(typeof self!=='undefined'&&self.MP_WEATHER_WORKER===true);
const MP_BUNDLE_SOURCE=(!MP_IS_WEATHER_WORKER&&typeof document!=='undefined'&&document.currentScript&&typeof document.currentScript.textContent==='string')
  ?document.currentScript.textContent:'';

function weatherWorkerStubPreamble(env){
  /* Executed inside the worker before the application bundle. Everything the
     UI/render modules reach for at load time resolves to an inert proxy, and
     every timer is disabled so no scheduler runs on its own in the worker:
     the main thread is the only clock. */
  return `self.MP_WEATHER_WORKER=true;
function mpAnything(name){
  const fn=function(){return mpAnything(name+'()');};
  return new Proxy(fn,{
    get(t,p){
      if(p===Symbol.toPrimitive)return ()=>0;
      if(p==='then')return undefined;
      if(p==='length'||p==='width'||p==='height'||p==='clientWidth'||p==='clientHeight')return 1;
      if(p==='matches'||p==='hidden'||p==='checked'||p==='isConnected')return false;
      if(p==='value'||p==='textContent'||p==='hash'||p==='search'||p==='innerHTML'||p==='className')return '';
      if(p==='style'||p==='dataset'||p==='classList')return mpAnything(name+'.'+String(p));
      if(p==='children'||p==='childNodes')return [];
      /* DOM walkers such as while(el.firstChild) must terminate against the stub. */
      if(p==='firstChild'||p==='lastChild'||p==='nextSibling'||p==='previousSibling'||p==='firstElementChild'||p==='lastElementChild'||p==='nextElementSibling'||p==='previousElementSibling')return null;
      if(p==='hasChildNodes'||p==='contains')return ()=>false;
      if(p==='closest'||p==='getItem')return ()=>null;
      if(p==='querySelector'||p==='getElementById')return ()=>mpAnything(name+'.el');
      if(p==='querySelectorAll')return ()=>[];
      if(p==='getContext')return ()=>mpGl;
      if(p==='getParameter')return ()=>'worker-stub';
      if(p==='getShaderParameter'||p==='getProgramParameter')return ()=>true;
      if(p==='getUniformLocation'||p==='getAttribLocation')return ()=>({});
      if(p==='getExtension')return ()=>null;
      if(p==='getShaderInfoLog'||p==='getProgramInfoLog')return ()=>'';
      if(typeof p==='string'&&/^[A-Z0-9_]+$/.test(p))return 1;
      return mpAnything(name+'.'+String(p));
    },
    set(){return true;},
    apply(){return mpAnything(name+'()');}
  });
}
const mpGl=mpAnything('gl');
var window=self;
self.document=mpAnything('document');
self.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
self.history={replaceState(){},pushState(){}};
self.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});
self.screen={width:1920,height:1080};self.devicePixelRatio=1;self.innerWidth=1920;self.innerHeight=1080;
self.requestAnimationFrame=()=>0;self.cancelAnimationFrame=()=>{};
self.setInterval=()=>0;self.clearInterval=()=>{};
self.setTimeout=()=>0;self.clearTimeout=()=>{};
self.requestIdleCallback=undefined;self.cancelIdleCallback=undefined;
self.Image=function(){return mpAnything('img');};
self.ResizeObserver=function(){return {observe(){},disconnect(){}};};
try{Object.defineProperty(self.navigator,'userAgent',{value:${JSON.stringify(env.userAgent||'')}});}catch(_e){}
try{Object.defineProperty(self.navigator,'deviceMemory',{value:${Number(env.deviceMemory)||8}});}catch(_e){}
const __mpLog=console.log;console.log=function(){if(typeof arguments[0]==='string'&&arguments[0].indexOf('[madPlanet]')===0)return;__mpLog.apply(console,arguments);};
`;
}

/* ---------------- worker side ---------------- */
if(MP_IS_WEATHER_WORKER){
  let wwStateJson='',wwClimate=null,wwAxis=[0,1,0],wwN=32,wwDisplayN=224,wwRiverN=512,wwTicksSinceRiver=1e9,wwRiverSeed=NaN;
  weatherCoreClimateSnapshot=function(){return wwClimate||{T:288,pressureBar:1,h2oBar:0.01,cloudCov:0.5,iceArea:0,waterAvail:1,S:1,regime:''};};
  weatherCoreAxis=function(){return wwAxis;};
  weatherCoreRequestedResolution=function(){return wwN;};
  if(typeof cryoGpuDisplayResolution==='function')cryoGpuDisplayResolution=function(){return wwDisplayN;};
  if(typeof riverGpuDisplayN==='function')riverGpuDisplayN=function(){return wwRiverN;};
  function wwApply(m){
    if(m.stateJson&&m.stateJson!==wwStateJson){
      wwStateJson=m.stateJson;
      try{Object.assign(state,JSON.parse(m.stateJson));}catch(_e){}
      try{if(typeof deriveWorld==='function')deriveWorld();}catch(_e){}
    }
    if(m.climate)wwClimate=m.climate;
    if(Array.isArray(m.axis)&&m.axis.length===3)wwAxis=m.axis;
    if(Number.isFinite(m.N))wwN=m.N;
    if(Number.isFinite(m.displayN))wwDisplayN=m.displayN;
    if(Number.isFinite(m.riverN))wwRiverN=m.riverN;
    if(m.terrain&&m.terrain.h&&typeof riverFineSetTerrain==='function'){
      if(riverFineSetTerrain(m.terrain.F,m.terrain.h,m.terrain.sig))wwTicksSinceRiver=1e9;
    }
  }
  function wwQuantizeFaces(faces){
    const out=[],transfer=[];
    for(const f of faces){const q=new Uint8Array(f.length);for(let i=0;i<f.length;i++)q[i]=Math.max(0,Math.min(255,Math.round(f[i]*255)));out.push(q);transfer.push(q.buffer);}
    return {out,transfer};
  }
  function wwMirror(core){
    const fields={},transfer=[];
    for(const k of Object.keys(core)){
      const v=core[k];
      if(v instanceof Float64Array)continue;
      if(ArrayBuffer.isView(v)){const c=v.slice();fields[k]=c;transfer.push(c.buffer);}
      else if(typeof v==='number'||typeof v==='string'||typeof v==='boolean')fields[k]=v;
      else if(Array.isArray(v)&&v.length<=16&&v.every(x=>typeof x==='number'))fields[k]=v.slice();
    }
    return {fields,transfer};
  }
  /* Dense cubemap reconstructions run here, not on the main thread. The
     bridges' own upload wrappers are timer-driven and therefore inert in the
     worker, so the base reconstruction is invoked directly. */
  function wwCryoFaces(core){
    if(typeof cryoGpuReadCurrent!=='function'||typeof cryoGpuEnsure!=='function')return null;
    cryoGpuEnsure(wwDisplayN);cryoGpuReadCurrent(core);
    const ql=wwQuantizeFaces(cryoGpuCurrLand),qs=wwQuantizeFaces(cryoGpuCurrSea);
    return {N:cryoGpuN,land:ql.out,sea:qs.out,transfer:ql.transfer.concat(qs.transfer)};
  }
  function wwRiverFaces(core,force){
    if(typeof riverGpuReadCurrent!=='function'||typeof riverGpuEnsure!=='function'||!core.riverChannelStrength)return null;
    wwTicksSinceRiver++;
    if(!force&&wwRiverSeed===(core.seed|0)&&wwTicksSinceRiver<WEATHER_WORKER_RIVER_FACE_TICKS)return null;
    wwTicksSinceRiver=0;wwRiverSeed=core.seed|0;
    riverGpuEnsure(wwRiverN);riverGpuReadCurrent(core);
    const qr=wwQuantizeFaces(riverGpuCurrRiver),ql=wwQuantizeFaces(riverGpuCurrLake);
    const vec=(typeof riverGpuVectorData==='function')?riverGpuVectorData():null;
    const transfer=qr.transfer.concat(ql.transfer);if(vec)transfer.push(...vec.transfer);
    const fine=(typeof riverFineDiagnostics==='function')?riverFineDiagnostics():null;
    return {N:riverGpuN,river:qr.out,lake:ql.out,vec:vec?{count:vec.count,binN:vec.binN,seg:vec.seg,bins:vec.bins,list:vec.list,chords:vec.chords,listCount:vec.listCount}:null,fine,transfer};
  }
  self.onmessage=function(e){
    const m=e.data;if(!m||m.type!=='tick')return;
    const t0=performance.now();
    try{
      wwApply(m);
      let core=weatherCoreEnsure();
      const created=!!core&&core.ticks===0&&!core.__wwSeen;
      if(core)core.__wwSeen=true;
      if(core&&m.step)weatherCoreStep(core,Number(m.dtSec)||WEATHER_CORE_FIXED_DT_SEC,wwClimate||weatherCoreClimateSnapshot(),wwAxis);
      core=weatherCoreEnsure();
      if(!core){self.postMessage({type:'core',ok:false,reason:'no core',requestId:m.requestId});return;}
      const mir=wwMirror(core);
      const cryo=wwCryoFaces(core);if(cryo)mir.transfer.push(...cryo.transfer);
      const river=wwRiverFaces(core,created);if(river)mir.transfer.push(...river.transfer);
      self.postMessage({type:'core',ok:true,fields:mir.fields,cryo:cryo?{N:cryo.N,land:cryo.land,sea:cryo.sea}:null,
        river:river?{N:river.N,river:river.river,lake:river.lake,vec:river.vec,fine:river.fine}:null,ms:performance.now()-t0,requestId:m.requestId},mir.transfer);
    }catch(err){
      self.postMessage({type:'core',ok:false,reason:String(err&&err.stack||err),requestId:m.requestId});
    }
  };
  self.postMessage({type:'ready'});
}

/* ---------------- main-thread side ---------------- */
let weatherWorker=null,weatherWorkerReady=false,weatherWorkerBusy=false,weatherWorkerFailed=false,weatherWorkerInstalled=false;
let weatherWorkerMirror=null,weatherWorkerPending=null,weatherWorkerRequestId=0,weatherWorkerTicks=0,weatherWorkerLastMs=0;
let weatherWorkerCryoFaces=null,weatherWorkerRiverFaces=null,weatherWorkerApplyStage=0;
const weatherWorkerOriginal={};

function weatherWorkerSnapshotState(){
  const out={};
  for(const k of Object.keys(state)){const v=state[k];if(typeof v==='number'||typeof v==='boolean'||typeof v==='string')out[k]=v;}
  return JSON.stringify(out);
}
function weatherWorkerTickSeconds(){
  const s=(typeof window!=='undefined'&&window.__madPlanetRuntime&&window.__madPlanetRuntime.settings)?Number(window.__madPlanetRuntime.settings.tickSeconds):NaN;
  return (Number.isFinite(s)&&s>0)?s:WEATHER_CORE_FIXED_DT_SEC;
}
function weatherWorkerMirrorMatches(){
  if(!weatherWorkerMirror)return false;
  return weatherWorkerMirror.seed===(state.seed|0)&&weatherWorkerMirror.N===weatherWorkerOriginal.requestedResolution();
}
function weatherWorkerRequest(step){
  if(!weatherWorker||!weatherWorkerReady||weatherWorkerBusy||weatherWorkerFailed)return false;
  if(typeof state==='undefined'||typeof weatherWorkerOriginal.climate!=='function')return false;
  const N=weatherWorkerOriginal.requestedResolution();
  let climate;try{climate=weatherWorkerOriginal.climate();}catch(_e){return false;}
  const axis=weatherWorkerOriginal.axis();
  const displayN=(typeof cryoGpuDisplayResolution==='function')?cryoGpuDisplayResolution(N):Math.max(8,N*7);
  const riverN=(typeof riverGpuDisplayN==='function')?riverGpuDisplayN(N):Math.max(8,N*16);
  weatherWorkerBusy=true;weatherWorkerRequestId++;
  /* 0.5.160: a fresh terrain bake rides along exactly once per signature. */
  let terrain=null;if(typeof riverFineTerrainForWorker==='function'){try{terrain=riverFineTerrainForWorker();}catch(_e){terrain=null;}}
  const msg={type:'tick',requestId:weatherWorkerRequestId,step:!!step,dtSec:weatherWorkerTickSeconds(),
    stateJson:weatherWorkerSnapshotState(),climate,axis:[axis[0],axis[1],axis[2]],N,displayN,riverN,terrain};
  if(terrain)weatherWorker.postMessage(msg,[terrain.h.buffer]);else weatherWorker.postMessage(msg);
  return true;
}
/* Apply a received core over consecutive macrotasks: mirror + cloud/fog
   requests at once, then the cryosphere cubemap, then rivers, then the
   diagnostics DOM. The pump is a short setTimeout chain rather than the
   render loop or a private rAF chain: later pacing modules replace loop()
   with captured drawFrame references, and rAF starves at low frame rates,
   so neither is a reliable clock for a pending update. The bridges' own
   deferred publication keeps working on top. */
let weatherWorkerPumpTimer=0;
function weatherWorkerPump(){
  weatherWorkerPumpTimer=0;
  if(!weatherWorkerPending)return;
  weatherWorkerApplyStep();
  if(weatherWorkerPending)weatherWorkerPumpTimer=setTimeout(weatherWorkerPump,16);
}
function weatherWorkerApplyStep(){
  const m=weatherWorkerPending;if(!m)return;
  if(weatherWorkerApplyStage===0){
    const mirror=m.fields;mirror.__mirror=true;
    weatherWorkerMirror=mirror;weatherCore=mirror;
    if(m.cryo)weatherWorkerCryoFaces=m.cryo;
    if(m.river){weatherWorkerRiverFaces=m.river;if(m.river.vec&&typeof riverGpuVectorSet==='function')riverGpuVectorSet(m.river.vec);if(m.river.fine&&typeof riverFineSetRemoteDiagnostics==='function')riverFineSetRemoteDiagnostics(m.river.fine);}
    if(typeof weatherCloudGpuUpload==='function')try{weatherCloudGpuUpload(mirror);}catch(_e){}
    if(typeof fogGpuUpload==='function')try{fogGpuUpload(mirror);}catch(_e){}
    weatherWorkerApplyStage=1;
  }else if(weatherWorkerApplyStage===1){
    if(typeof cryoGpuUpload==='function'&&weatherWorkerCryoFaces)try{cryoGpuUpload(weatherWorkerMirror);}catch(_e){}
    weatherWorkerApplyStage=2;
  }else if(weatherWorkerApplyStage===2){
    if(m.river&&typeof riverGpuUpload==='function')try{riverGpuUpload(weatherWorkerMirror);}catch(_e){}
    weatherWorkerApplyStage=3;
  }else{
    try{refreshWeatherCoreDiagnostics();}catch(_e){}
    weatherWorkerPending=null;weatherWorkerApplyStage=0;
  }
}
function weatherWorkerOnMessage(e){
  const m=e.data;if(!m)return;
  if(m.type==='ready'){weatherWorkerReady=true;weatherWorkerRequest(false);return;}
  if(m.type!=='core')return;
  weatherWorkerBusy=false;
  if(!m.ok){console.warn('[madPlanet] weather worker tick failed, falling back to main thread:',m.reason);weatherWorkerFallback();return;}
  weatherWorkerTicks++;weatherWorkerLastMs=Number(m.ms)||0;
  /* Only the newest physical state is worth uploading: supersede, never queue. */
  weatherWorkerPending=m;weatherWorkerApplyStage=0;
  if(!weatherWorkerPumpTimer)weatherWorkerPumpTimer=setTimeout(weatherWorkerPump,0);
}
function weatherWorkerTickHook(){
  if(typeof document!=='undefined'&&document.hidden)return false;
  if(typeof state!=='undefined'&&state&&state.paused)return false;
  if(!weatherWorker||weatherWorkerFailed)return weatherWorkerOriginal.tick?weatherWorkerOriginal.tick():false;
  weatherWorkerRequest(weatherWorkerMirrorMatches());
  return true;
}
function weatherWorkerFallback(){
  weatherWorkerFailed=true;
  if(weatherWorker){try{weatherWorker.terminate();}catch(_e){}weatherWorker=null;}
  if(weatherWorkerOriginal.ensure)weatherCoreEnsure=weatherWorkerOriginal.ensure;
  if(weatherWorkerOriginal.step)weatherCoreStep=weatherWorkerOriginal.step;
  if(weatherWorkerOriginal.tick)weatherCoreTick=weatherWorkerOriginal.tick;
  if(weatherWorkerOriginal.cryoReadCurrent)cryoGpuReadCurrent=weatherWorkerOriginal.cryoReadCurrent;
  if(weatherWorkerOriginal.riverReadCurrent)riverGpuReadCurrent=weatherWorkerOriginal.riverReadCurrent;
  if(weatherWorkerMirror&&weatherWorkerMirror.__mirror){weatherCore=null;weatherWorkerMirror=null;}
}
function weatherWorkerDiagnostics(){
  return {model:WEATHER_WORKER_MODEL,active:!!weatherWorker&&!weatherWorkerFailed,ready:weatherWorkerReady,installed:weatherWorkerInstalled,ticks:weatherWorkerTicks,lastMs:weatherWorkerLastMs};
}
/* Installed from a macrotask so it lands after every microtask-deferred late
   hook (runtime-settings) and wraps the final bindings. */
function weatherWorkerInstall(){
  if(weatherWorkerInstalled||!weatherWorker)return;
  weatherWorkerInstalled=true;
  weatherWorkerOriginal.ensure=weatherCoreEnsure;
  weatherWorkerOriginal.step=weatherCoreStep;
  weatherWorkerOriginal.tick=weatherCoreTick;
  weatherWorkerOriginal.requestedResolution=weatherCoreRequestedResolution;
  weatherWorkerOriginal.axis=weatherCoreAxis;
  weatherWorkerOriginal.climate=weatherCoreClimateSnapshot;
  weatherWorkerOriginal.cryoReadCurrent=(typeof cryoGpuReadCurrent==='function')?cryoGpuReadCurrent:null;
  weatherWorkerOriginal.riverReadCurrent=(typeof riverGpuReadCurrent==='function')?riverGpuReadCurrent:null;

  weatherCoreTick=weatherWorkerTickHook;
  weatherCoreEnsure=function(){
    /* A stale mirror is better than nothing while the worker rebuilds a new
       seed: GPU bridges keep the previous textures instead of flashing. */
    if(!weatherWorkerMirror){
      /* First core of the session: still built synchronously on the first
         rendered frame (as 0.5.134 does) so the first picture has physical
         clouds, fog, temperature and ice; the worker takes over from there. */
      let boot=null;try{boot=weatherWorkerOriginal.ensure();}catch(_e){boot=null;}
      if(boot){boot.__mirror=true;weatherWorkerMirror=boot;}
    }
    return weatherWorkerMirror;
  };
  weatherCoreStep=function(core,dtSec,climate,axis){
    if(core&&core.__mirror)return core;
    return weatherWorkerOriginal.step(core,dtSec,climate,axis);
  };
  if(typeof cryoGpuReadCurrent==='function'){
    cryoGpuReadCurrent=function(core){
      const f=weatherWorkerCryoFaces;
      if(core&&core.__mirror&&f&&f.N===cryoGpuN&&f.land&&f.land.length===6){
        for(let face=0;face<6;face++){
          const land=cryoGpuCurrLand[face],sea=cryoGpuCurrSea[face],ql=f.land[face],qs=f.sea[face];
          for(let i=0;i<land.length;i++){land[i]=ql[i]/255;sea[i]=qs[i]/255;}
        }
        return;
      }
      if(weatherWorkerOriginal.cryoReadCurrent)weatherWorkerOriginal.cryoReadCurrent(core);
    };
  }
  if(typeof riverGpuReadCurrent==='function'){
    riverGpuReadCurrent=function(core){
      const f=weatherWorkerRiverFaces;
      if(core&&core.__mirror&&f&&f.N===riverGpuN&&f.river&&f.river.length===6){
        for(let face=0;face<6;face++){
          const r=riverGpuCurrRiver[face],l=riverGpuCurrLake[face],qr=f.river[face],ql=f.lake[face];
          for(let i=0;i<r.length;i++){r[i]=qr[i]/255;l[i]=ql[i]/255;}
        }
        return;
      }
      if(weatherWorkerOriginal.riverReadCurrent)weatherWorkerOriginal.riverReadCurrent(core);
    };
  }
  if(typeof drawFrame==='function'){
    const drawFrameBeforeWeatherWorker=drawFrame;
    drawFrame=function(now){
      if(weatherCoreTick!==weatherWorkerTickHook&&!weatherWorkerFailed){weatherWorkerOriginal.tick=weatherCoreTick;weatherCoreTick=weatherWorkerTickHook;}
      drawFrameBeforeWeatherWorker(now);
    };
  }
}

if(!MP_IS_WEATHER_WORKER&&typeof Worker==='function'&&typeof Blob==='function'&&typeof URL!=='undefined'&&typeof URL.createObjectURL==='function'
   &&MP_BUNDLE_SOURCE.length>10000&&typeof weatherCoreEnsure==='function'&&typeof weatherCoreStep==='function'&&typeof weatherCoreTick==='function'){
  try{
    const env={userAgent:(typeof navigator!=='undefined'&&navigator.userAgent)||'',deviceMemory:(typeof navigator!=='undefined'&&navigator.deviceMemory)||8};
    const blob=new Blob([weatherWorkerStubPreamble(env),'\n',MP_BUNDLE_SOURCE,'\n'],{type:'text/javascript'});
    weatherWorker=new Worker(URL.createObjectURL(blob));
    weatherWorker.onmessage=weatherWorkerOnMessage;
    weatherWorker.onerror=function(err){console.warn('[madPlanet] weather worker error, falling back:',err&&err.message);weatherWorkerFallback();};
  }catch(err){console.warn('[madPlanet] weather worker unavailable:',err&&err.message);weatherWorker=null;}
  if(weatherWorker){
    setTimeout(weatherWorkerInstall,0);
    setTimeout(function(){if(weatherWorker&&!weatherWorkerReady&&!weatherWorkerFailed){console.warn('[madPlanet] weather worker did not start in time, falling back');weatherWorkerFallback();}},WEATHER_WORKER_BOOT_TIMEOUT_MS);
  }
}
