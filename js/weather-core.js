/* ============ 0.5.39: persistent low-resolution Weather Core ============ */
/*
   CPU climate/weather state, deliberately decoupled from render FPS.

   v1 establishes the state container and deterministic fixed-step clock only.
   Local radiative balance, pressure-gradient dynamics, advection,
   condensation and precipitation physics are layered onto these fields by
   the following milestones. Procedural hashing below is only a tiny initial
   perturbation so an otherwise perfectly symmetric world has something for
   later physical instabilities to amplify; it is not a weather morphology.
*/

const WEATHER_CORE_MODEL = 1;
const WEATHER_CORE_DESKTOP_N = 48;
const WEATHER_CORE_DRAFT_N = 32;
const WEATHER_CORE_REAL_TICK_MS = 1000;
const WEATHER_CORE_FIXED_DT_SEC = 300; /* five simulated minutes per tick */

function weatherClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function weatherNorm3(x,y,z){
  const q=Math.hypot(x,y,z)||1;
  return [x/q,y/q,z/q];
}
function weatherFaceDir(face,u,v){
  /* One canonical cubed-sphere orientation. Adjacent faces share the same
     normalized edge positions; later transport can add explicit neighbour
     lookup without changing storage layout. */
  if(face===0) return weatherNorm3( 1, v,-u); /* +X */
  if(face===1) return weatherNorm3(-1, v, u); /* -X */
  if(face===2) return weatherNorm3( u, 1,-v); /* +Y */
  if(face===3) return weatherNorm3( u,-1, v); /* -Y */
  if(face===4) return weatherNorm3( u, v, 1); /* +Z */
  return weatherNorm3(-u, v,-1);              /* -Z */
}
function weatherHash01(seed,index){
  let x=(Math.imul((seed|0)^0x9e3779b9,(index+1)|0)+0x7f4a7c15)|0;
  x^=x>>>16; x=Math.imul(x,0x21f0aaad); x^=x>>>15; x=Math.imul(x,0x735a2d97); x^=x>>>15;
  return (x>>>0)/4294967296;
}
function weatherCoreRequestedResolution(){
  const mobile=(typeof matchMedia==='function') && matchMedia('(max-width:700px)').matches;
  return (mobile || state.draft) ? WEATHER_CORE_DRAFT_N : WEATHER_CORE_DESKTOP_N;
}
function weatherCoreAxis(){
  const a=(typeof world!=='undefined' && world && world.axis) ? world.axis : [0,1,0];
  return weatherNorm3(a[0],a[1],a[2]);
}
function weatherCoreClimateSnapshot(){
  const c=climateModel();
  return {
    T:weatherClamp(c.T,120,1200),
    pressureBar:Math.max(0,c.pressureBar||0),
    h2oBar:Math.max(0,c.partialPressures?.h2o||0),
    cloudCov:weatherClamp(c.cloudCov||0,0,1),
    iceArea:weatherClamp(c.iceArea||0,0,1),
    waterAvail:weatherClamp(c.waterAvail??1,0,1),
    S:Math.max(0,c.S||0),
    regime:c.regime||''
  };
}
function weatherCoreTargetsForCell(c,dx,dy,dz,axis,seed,index,out){
  const lat=Math.abs(dx*axis[0]+dy*axis[1]+dz*axis[2]);
  const thermalLat=38*Math.pow(lat,2.4);
  const perturb=(weatherHash01(seed,index)-0.5)*5.0;
  const surfaceTemp=weatherClamp(c.T-thermalLat+perturb,120,1200);
  out.surfaceTemp=surfaceTemp;
  out.airTemp=weatherClamp(surfaceTemp-6.0,110,1200);
  const thermalAnomaly=(surfaceTemp-c.T)/Math.max(80,c.T);
  out.pressurePa=Math.max(0,c.pressureBar*1e5*(1-0.12*thermalAnomaly));
  const vaporScale=weatherClamp((Math.log10(Math.max(1e-8,c.h2oBar))+5)/3.0,0,1);
  const polarDry=0.35+0.65*(1-Math.pow(lat,1.7));
  out.humidity=weatherClamp((0.18+0.72*vaporScale)*polarDry*c.waterAvail,0,1);
  out.cloudWater=weatherClamp(c.cloudCov*out.humidity*(0.75+0.25*weatherHash01(seed^0x51f15e,index)),0,1);
  return out;
}
function weatherCoreCreate(seed,N,climate,axis){
  N=Math.max(4,Math.min(96,Math.round(Number(N)||WEATHER_CORE_DRAFT_N)));
  const count=6*N*N;
  const core={
    model:WEATHER_CORE_MODEL,seed:seed|0,N,count,simSeconds:0,ticks:0,
    dirX:new Float32Array(count),dirY:new Float32Array(count),dirZ:new Float32Array(count),
    surfaceTemp:new Float32Array(count),airTemp:new Float32Array(count),
    pressure:new Float32Array(count),humidity:new Float32Array(count),
    cloudWater:new Float32Array(count),windU:new Float32Array(count),
    windV:new Float32Array(count),precipRate:new Float32Array(count)
  };
  const ax=weatherNorm3(axis[0],axis[1],axis[2]);
  const q={surfaceTemp:0,airTemp:0,pressurePa:0,humidity:0,cloudWater:0};
  let index=0;
  for(let face=0;face<6;face++) for(let y=0;y<N;y++) for(let x=0;x<N;x++,index++){
    const u=2*(x+0.5)/N-1, v=2*(y+0.5)/N-1;
    const d=weatherFaceDir(face,u,v),dx=d[0],dy=d[1],dz=d[2];
    core.dirX[index]=dx; core.dirY[index]=dy; core.dirZ[index]=dz;
    weatherCoreTargetsForCell(climate,dx,dy,dz,ax,core.seed,index,q);
    core.surfaceTemp[index]=q.surfaceTemp;
    core.airTemp[index]=q.airTemp;
    core.pressure[index]=q.pressurePa;
    core.humidity[index]=q.humidity;
    core.cloudWater[index]=q.cloudWater;
    core.windU[index]=0; core.windV[index]=0; core.precipRate[index]=0;
  }
  return core;
}
function weatherCoreStep(core,dtSec,climate,axis){
  if(!core || !core.count) return core;
  const dt=weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC);
  const ax=weatherNorm3(axis[0],axis[1],axis[2]);
  const aSurface=1-Math.exp(-dt/(6*3600));
  const aAir=1-Math.exp(-dt/(2*3600));
  const aPressure=1-Math.exp(-dt/(4*3600));
  const aHumidity=1-Math.exp(-dt/(1.5*3600));
  const aCloud=1-Math.exp(-dt/(45*60));
  const aWind=1-Math.exp(-dt/(2*3600));
  const q={surfaceTemp:0,airTemp:0,pressurePa:0,humidity:0,cloudWater:0};
  for(let i=0;i<core.count;i++){
    weatherCoreTargetsForCell(climate,core.dirX[i],core.dirY[i],core.dirZ[i],ax,core.seed,i,q);
    core.surfaceTemp[i]+=(q.surfaceTemp-core.surfaceTemp[i])*aSurface;
    core.airTemp[i]+=(q.airTemp-core.airTemp[i])*aAir;
    core.pressure[i]+=(q.pressurePa-core.pressure[i])*aPressure;
    core.humidity[i]+=(q.humidity-core.humidity[i])*aHumidity;
    core.cloudWater[i]+=(q.cloudWater-core.cloudWater[i])*aCloud;
    /* v1 has no momentum equation yet. Any future/user perturbation decays
       rather than becoming a permanent invented jet. */
    core.windU[i]+=(0-core.windU[i])*aWind;
    core.windV[i]+=(0-core.windV[i])*aWind;
    core.precipRate[i]=0;
  }
  core.simSeconds+=dt;
  core.ticks++;
  return core;
}
function weatherCoreFinite(core){
  if(!core) return false;
  const fields=['surfaceTemp','airTemp','pressure','humidity','cloudWater','windU','windV','precipRate'];
  for(const k of fields){
    const a=core[k];
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])) return false;
  }
  return true;
}
function weatherCoreMeans(core){
  if(!core||!core.count) return {T:NaN,RH:NaN,cloud:NaN};
  let T=0,RH=0,cloud=0;
  for(let i=0;i<core.count;i++){T+=core.airTemp[i];RH+=core.humidity[i];cloud+=core.cloudWater[i];}
  return {T:T/core.count,RH:RH/core.count,cloud:cloud/core.count};
}

let weatherCore=null;
function weatherCoreEnsure(){
  if(typeof state==='undefined' || typeof climateModel!=='function') return null;
  const N=weatherCoreRequestedResolution();
  if(!weatherCore || weatherCore.N!==N || weatherCore.seed!==(state.seed|0))
    weatherCore=weatherCoreCreate(state.seed,N,weatherCoreClimateSnapshot(),weatherCoreAxis());
  return weatherCore;
}
function weatherCoreTick(){
  if(typeof document!=='undefined' && document.hidden) return false; /* no catch-up */
  const core=weatherCoreEnsure();
  if(!core) return false;
  weatherCoreStep(core,WEATHER_CORE_FIXED_DT_SEC,weatherCoreClimateSnapshot(),weatherCoreAxis());
  refreshWeatherCoreDiagnostics();
  return true;
}

function appendWeatherCoreRow(body,label,key){
  const row=document.createElement('div');
  row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
  const a=document.createElement('span');a.textContent=label;a.style.opacity='.62';
  const b=document.createElement('span');b.dataset.weathercore=key;b.style.textAlign='right';
  row.append(a,b);body.appendChild(row);
}
function refreshWeatherCoreDiagnostics(){
  if(typeof document==='undefined') return;
  const box=document.getElementById('weatherCoreDiag'); if(!box) return;
  const core=weatherCoreEnsure(); if(!core) return;
  const m=weatherCoreMeans(core);
  const set=(k,v)=>{const e=box.querySelector('[data-weathercore="'+k+'"]');if(e)e.textContent=v;};
  set('grid',core.N+'×'+core.N+'×6 · '+core.count.toLocaleString('ru-RU'));
  set('clock',(core.simSeconds/3600).toFixed(1)+' ч · '+core.ticks+' тиков');
  set('temp',m.T.toFixed(1)+' K');
  set('humidity',(100*m.RH).toFixed(0)+'%');
  set('cloud',(100*m.cloud).toFixed(1)+'%');
}
if(typeof createPanel==='function'){
  const createPanelBeforeWeatherCore=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeWeatherCore(group);
    if(group==='Погода'&&!el.querySelector('#weatherCoreDiag')){
      const body=el.querySelector('.p-body');
      const box=document.createElement('div');box.id='weatherCoreDiag';
      box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--txt)';
      appendWeatherCoreRow(box,'Weather Core','grid');
      appendWeatherCoreRow(box,'Модельное время','clock');
      appendWeatherCoreRow(box,'Средняя T воздуха','temp');
      appendWeatherCoreRow(box,'Средняя влажность','humidity');
      appendWeatherCoreRow(box,'Cloud water proxy','cloud');
      body.appendChild(box);refreshWeatherCoreDiagnostics();
    }
    return el;
  };
}

/* One fixed CPU tick per real second. It is intentionally not driven by
   requestAnimationFrame and hidden tabs simply skip work instead of replaying
   elapsed wall time on return. */
if(typeof window!=='undefined' && typeof document!=='undefined' && typeof setInterval==='function'){
  setInterval(weatherCoreTick,WEATHER_CORE_REAL_TICK_MS);
}
