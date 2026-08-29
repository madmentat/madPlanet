/* ============ 0.5.57: physical diurnal cycle ============ */
/*
   Local Weather Core insolation is now instantaneous rather than permanently
   daily-mean. The physical sun lives in body-fixed coordinates and rotates
   around the real planetary spin axis with the real rotation period.

   This is deliberately an equinox-only milestone: solar declination is zero.
   Axial tilt will modulate declination in the later seasons stage. The visual
   uSunDir/light controls remain renderer-owned and cannot rewrite climate.

   The sphere-wide instantaneous mean of max(dot(n,sun),0) is still 1/4, so
   this redistributes the existing stellar energy in longitude/time rather than
   inventing extra global heating.
*/

const DIURNAL_CYCLE_MODEL=1;
const DIURNAL_TAU_MIN_SEC=600;
const DIURNAL_TAU_MAX_SEC=1.0e9;
let diurnalFluxContext=null;

function diurnalClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function diurnalNorm3(x,y,z,out){
  const q=Math.hypot(x,y,z)||1;out[0]=x/q;out[1]=y/q;out[2]=z/q;return out;
}
function diurnalRotationPeriodSec(climate){
  if(Number.isFinite(climate?.rotationPeriodSec)&&climate.rotationPeriodSec>0)
    return diurnalClamp(climate.rotationPeriodSec,DIURNAL_TAU_MIN_SEC,DIURNAL_TAU_MAX_SEC);
  if(typeof planetPhysics==='function'){
    const p=planetPhysics();
    if(Number.isFinite(p?.rotationHours)&&p.rotationHours>0)
      return diurnalClamp(p.rotationHours*3600,DIURNAL_TAU_MIN_SEC,DIURNAL_TAU_MAX_SEC);
  }
  return 86400;
}
function diurnalSeedPhase(seed){
  if(typeof weatherHash01==='function')return 2*Math.PI*weatherHash01((seed|0)^0x5d17a91,17);
  let x=((seed|0)^0x5d17a91)>>>0;x=(Math.imul(x^x>>>16,0x7feb352d))>>>0;x=(Math.imul(x^x>>>15,0x846ca68b))>>>0;x=(x^x>>>16)>>>0;
  return 2*Math.PI*(x/4294967296);
}
function diurnalBasis(axis,out){
  const a=[0,0,0];diurnalNorm3(axis[0],axis[1],axis[2],a);
  const rx=Math.abs(a[1])<0.92?0:1,ry=Math.abs(a[1])<0.92?1:0,rz=0;
  const x=ry*a[2]-rz*a[1],y=rz*a[0]-rx*a[2],z=rx*a[1]-ry*a[0];
  const e1=[0,0,0];diurnalNorm3(x,y,z,e1);
  const e2=[a[1]*e1[2]-a[2]*e1[1],a[2]*e1[0]-a[0]*e1[2],a[0]*e1[1]-a[1]*e1[0]];
  out.axis=a;out.e1=e1;out.e2=e2;return out;
}
function diurnalSunDirection(axis,seed,simSeconds,climate,out){
  const b={};diurnalBasis(axis,b);
  const period=diurnalRotationPeriodSec(climate);
  const phase=diurnalSeedPhase(seed)-2*Math.PI*(Number(simSeconds)||0)/period;
  const c=Math.cos(phase),s=Math.sin(phase);
  out=out||[0,0,0];
  out[0]=b.e1[0]*c+b.e2[0]*s;
  out[1]=b.e1[1]*c+b.e2[1]*s;
  out[2]=b.e1[2]*c+b.e2[2]*s;
  return out;
}
function diurnalInstantCosine(dx,dy,dz,sun){
  return Math.max(0,dx*sun[0]+dy*sun[1]+dz*sun[2]);
}
function diurnalSetFluxContext(core,simSeconds,climate,axis){
  const sun=[0,0,0];
  diurnalSunDirection(axis,core?.seed|0,simSeconds,climate,sun);
  diurnalFluxContext={core,sun,simSeconds:Number(simSeconds)||0};
  return diurnalFluxContext;
}
function diurnalClearFluxContext(){diurnalFluxContext=null;}

/* localEnergyFluxes calls this dynamically. During a Weather Core create/step
   the context is active and we return instantaneous illumination; elsewhere
   the old daily-mean helper remains a safe fallback for unrelated diagnostics. */
const localEnergyDailyMeanCosineBeforeDiurnal=localEnergyDailyMeanCosine;
localEnergyDailyMeanCosine=function(dx,dy,dz,axis){
  if(diurnalFluxContext?.sun)return diurnalInstantCosine(dx,dy,dz,diurnalFluxContext.sun);
  return localEnergyDailyMeanCosineBeforeDiurnal(dx,dy,dz,axis);
};

function diurnalEnsureFields(core){
  if(!core?.count)return core;
  const n=core.count;
  if(!core.solarZenithCos||core.solarZenithCos.length!==n)core.solarZenithCos=new Float32Array(n);
  if(!core.daylightFactor||core.daylightFactor.length!==n)core.daylightFactor=new Float32Array(n);
  if(!core.localSolarTimeHours||core.localSolarTimeHours.length!==n)core.localSolarTimeHours=new Float32Array(n);
  core.diurnalCycleModel=DIURNAL_CYCLE_MODEL;
  return core;
}
function diurnalRefreshFields(core,climate,axis){
  if(!core?.count)return core;
  diurnalEnsureFields(core);
  const sun=[0,0,0];diurnalSunDirection(axis,core.seed|0,core.simSeconds,climate,sun);
  core.diurnalSunDir=[sun[0],sun[1],sun[2]];
  core.rotationPeriodSec=diurnalRotationPeriodSec(climate);
  /* Build the spin-axis/equatorial basis once per fixed tick. Never allocate
     helper vectors inside the cell loop. */
  const ax=[0,0,0];diurnalNorm3(axis[0],axis[1],axis[2],ax);
  const ex=sun[0],ey=sun[1],ez=sun[2];
  const qx=ax[1]*ez-ax[2]*ey,qy=ax[2]*ex-ax[0]*ez,qz=ax[0]*ey-ax[1]*ex;
  for(let i=0;i<core.count;i++){
    const dx=core.dirX[i],dy=core.dirY[i],dz=core.dirZ[i];
    const mu=dx*ex+dy*ey+dz*ez;
    core.solarZenithCos[i]=mu;
    core.daylightFactor[i]=diurnalClamp((mu+0.035)/0.105,0,1);
    const east=dx*qx+dy*qy+dz*qz;
    const toward=mu;
    const h=Math.atan2(east,toward); /* 0 at local noon */
    let lst=12+h*12/Math.PI;if(lst<0)lst+=24;if(lst>=24)lst-=24;
    core.localSolarTimeHours[i]=lst;
  }
  return core;
}

const weatherCoreClimateSnapshotBeforeDiurnal=weatherCoreClimateSnapshot;
weatherCoreClimateSnapshot=function(){
  const s=weatherCoreClimateSnapshotBeforeDiurnal();
  s.rotationPeriodSec=diurnalRotationPeriodSec(s);
  s.diurnalCycleModel=DIURNAL_CYCLE_MODEL;
  return s;
};

const weatherCoreCreateBeforeDiurnal=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  /* Initial energy diagnostics describe the actual starting local time rather
     than a permanently averaged day. */
  const stub={seed:seed|0};
  diurnalSetFluxContext(stub,0,climate,axis);
  let core;
  try{core=weatherCoreCreateBeforeDiurnal(seed,N,climate,axis);}finally{diurnalClearFluxContext();}
  diurnalEnsureFields(core);diurnalRefreshFields(core,climate,axis);return core;
};

const weatherCoreStepBeforeDiurnal=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core?.count)return core;
  const dt=diurnalClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  /* Midpoint solar phase integrates the fixed thermal step without a systematic
     dawn/dusk phase bias. The wrapped local-energy step advances simSeconds. */
  diurnalSetFluxContext(core,(Number(core.simSeconds)||0)+0.5*dt,climate,axis);
  try{weatherCoreStepBeforeDiurnal(core,dtSec,climate,axis);}finally{diurnalClearFluxContext();}
  diurnalRefreshFields(core,climate,axis);
  return core;
};

const weatherCoreFiniteBeforeDiurnal=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeDiurnal(core))return false;
  for(const k of ['solarZenithCos','daylightFactor','localSolarTimeHours']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  return Array.isArray(core?.diurnalSunDir)&&core.diurnalSunDir.length===3&&core.diurnalSunDir.every(Number.isFinite);
};
function diurnalDiagnostics(core){
  if(!core?.solarZenithCos)return {day:NaN,night:NaN,meanMu:NaN,periodH:NaN};
  let ws=0,day=0,mu=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);ws+=w;
    if(core.solarZenithCos[i]>0)day+=w;
    mu+=w*Math.max(0,core.solarZenithCos[i]);
  }
  ws=Math.max(1e-12,ws);
  return {day:day/ws,night:1-day/ws,meanMu:mu/ws,periodH:(core.rotationPeriodSec||86400)/3600};
}
if(typeof createPanel==='function'){
  const createPanelBeforeDiurnal=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeDiurnal(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-diurnal="cycle"]')){
        appendWeatherCoreRow(box,'Сутки / day side','diurnal-cycle');
        const a=box.lastElementChild?.querySelector('[data-weathercore="diurnal-cycle"]');if(a){delete a.dataset.weathercore;a.dataset.diurnal='cycle';}
        appendWeatherCoreRow(box,'Средний cos(SZA)','diurnal-mu');
        const b=box.lastElementChild?.querySelector('[data-weathercore="diurnal-mu"]');if(b){delete b.dataset.weathercore;b.dataset.diurnal='mu';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeDiurnal=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeDiurnal();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.solarZenithCos)return;
    const d=diurnalDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-diurnal="'+k+'"]');if(e)e.textContent=v;};
    set('cycle',d.periodH.toFixed(d.periodH<48?1:0)+' ч · '+(100*d.day).toFixed(0)+'% day');
    set('mu',d.meanMu.toFixed(3)+' (sphere ≈ 0.250)');
  };
}
