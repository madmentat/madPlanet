/* ============ 0.5.55: physical cloud radiative feedback ============ */
/*
   Weather Core clouds now affect the same local energy budget that drives
   surface temperature. The 0.5.40 local-energy layer supplies a cloud-free
   (but ice/aerosol/Rayleigh-aware) baseline. This module applies cloud
   shortwave reflection and longwave trapping from the authoritative physical
   low/mid/high condensate columns after condensation/precipitation/vertical
   physics has finished for the fixed weather tick.

   No render-frame coupling exists here. No H2O mass is changed. The only
   prognostic tendency is the radiative surface-temperature increment.
*/

const CLOUD_RADIATIVE_MODEL=1;
const CLOUD_RAD_LOW_SCALE_KG_M2=0.16;
const CLOUD_RAD_MID_SCALE_KG_M2=0.11;
const CLOUD_RAD_HIGH_SCALE_KG_M2=0.055;
const CLOUD_RAD_SW_LOW_MAX=0.47;
const CLOUD_RAD_SW_MID_MAX=0.52;
const CLOUD_RAD_SW_HIGH_MAX=0.30;
const CLOUD_RAD_LW_LOW_MAX=0.055;
const CLOUD_RAD_LW_MID_MAX=0.135;
const CLOUD_RAD_LW_HIGH_MAX=0.30;
const CLOUD_RAD_MAX_LW_BLOCK=0.48;

function cloudRadClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function cloudRadOptical(mass,scale){
  mass=Math.max(0,Number(mass)||0);scale=Math.max(1e-6,Number(scale)||1);
  return cloudRadClamp(1-Math.exp(-mass/scale),0,1);
}
function cloudRadEnsureFields(core){
  if(!core?.count)return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['cloudOpticalLow','cloudOpticalMid','cloudOpticalHigh',
    'cloudShortwaveForcing','cloudLongwaveForcing','cloudNetForcing',
    'cloudEffectiveAlbedo','cloudLongwaveBlock'])f32(k);
  core.cloudRadiativeModel=CLOUD_RADIATIVE_MODEL;
  return core;
}
function cloudRadCombinedReflectance(low,mid,high){
  const tl=1-CLOUD_RAD_SW_LOW_MAX*cloudRadClamp(low,0,1);
  const tm=1-CLOUD_RAD_SW_MID_MAX*cloudRadClamp(mid,0,1);
  const th=1-CLOUD_RAD_SW_HIGH_MAX*cloudRadClamp(high,0,1);
  return cloudRadClamp(1-tl*tm*th,0,0.92);
}
function cloudRadLongwaveBlock(low,mid,high,deep){
  /* High cold anvils are the strongest LW blanket; low warm clouds mostly
     reflect sunlight. Deep convection adds only a modest enhancement and
     only where a high cloud layer physically exists. */
  const bl=CLOUD_RAD_LW_LOW_MAX*cloudRadClamp(low,0,1);
  const bm=CLOUD_RAD_LW_MID_MAX*cloudRadClamp(mid,0,1);
  const bh=CLOUD_RAD_LW_HIGH_MAX*cloudRadClamp(high,0,1)*(1+0.16*cloudRadClamp(deep,0,1));
  return cloudRadClamp(1-(1-bl)*(1-bm)*(1-bh),0,CLOUD_RAD_MAX_LW_BLOCK);
}
function cloudRadApply(core,dtSec,climate){
  if(!core?.count)return core;
  cloudRadEnsureFields(core);
  const dt=cloudRadClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  const heatCap=(typeof localEnergyHeatCapacity==='function')?Math.max(1e5,localEnergyHeatCapacity(climate)):3.0e7;
  for(let i=0;i<core.count;i++){
    const low=cloudRadOptical(core.cloudLowMass?.[i],CLOUD_RAD_LOW_SCALE_KG_M2);
    const mid=cloudRadOptical(core.cloudMidMass?.[i],CLOUD_RAD_MID_SCALE_KG_M2);
    const high=cloudRadOptical(core.cloudHighMass?.[i],CLOUD_RAD_HIGH_SCALE_KG_M2);
    const deep=cloudRadClamp(core.deepConvectiveState?.[i],0,1);
    core.cloudOpticalLow[i]=low;core.cloudOpticalMid[i]=mid;core.cloudOpticalHigh[i]=high;

    const ins=Math.max(0,Number(core.insolation?.[i])||0);
    const baseA=cloudRadClamp(core.localAlbedo?.[i],0.01,0.95);
    const clearAbs=Math.max(0,Number(core.absorbedSolar?.[i])||ins*(1-baseA));
    const reflect=cloudRadCombinedReflectance(low,mid,high);
    const effectiveA=cloudRadClamp(baseA+(1-baseA)*reflect,baseA,0.97);
    const cloudyAbs=ins*(1-effectiveA);
    const sw=cloudyAbs-clearAbs; /* <= 0: cloud shortwave cooling */

    const clearOlr=Math.max(0,Number(core.outgoingLongwave?.[i])||0);
    const lwBlock=cloudRadLongwaveBlock(low,mid,high,deep);
    const cloudyOlr=clearOlr*(1-lwBlock);
    const lw=clearOlr-cloudyOlr; /* >= 0: reduced OLR warms the column */
    const net=sw+lw;

    core.cloudShortwaveForcing[i]=sw;
    core.cloudLongwaveForcing[i]=lw;
    core.cloudNetForcing[i]=net;
    core.cloudEffectiveAlbedo[i]=effectiveA;
    core.cloudLongwaveBlock[i]=lwBlock;

    core.localAlbedo[i]=effectiveA;
    core.absorbedSolar[i]=cloudyAbs;
    core.outgoingLongwave[i]=cloudyOlr;
    core.netRadiation[i]=(Number(core.netRadiation?.[i])||0)+net;
    if(dt>0)core.surfaceTemp[i]=cloudRadClamp(core.surfaceTemp[i]+net*dt/heatCap,80,1600);
  }
  return core;
}

const weatherCoreCreateBeforeCloudRadiation=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeCloudRadiation(seed,N,climate,axis);
  cloudRadEnsureFields(core);
  /* Populate diagnostics/fluxes without inventing an extra creation-time
     temperature step. */
  cloudRadApply(core,0,climate);
  return core;
};
const weatherCoreStepBeforeCloudRadiation=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core?.count)return core;
  weatherCoreStepBeforeCloudRadiation(core,dtSec,climate,axis);
  cloudRadApply(core,dtSec,climate);
  return core;
};

const weatherCoreFiniteBeforeCloudRadiation=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeCloudRadiation(core))return false;
  const fields=['cloudOpticalLow','cloudOpticalMid','cloudOpticalHigh',
    'cloudShortwaveForcing','cloudLongwaveForcing','cloudNetForcing',
    'cloudEffectiveAlbedo','cloudLongwaveBlock'];
  for(const k of fields){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  return true;
};

function cloudRadDiagnostics(core){
  if(!core?.cloudNetForcing)return {sw:NaN,lw:NaN,net:NaN,maxCooling:NaN,maxWarming:NaN};
  let sw=0,lw=0,net=0,ws=0,min=Infinity,max=-Infinity;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,Number(core.areaWeight?.[i])||1),n=core.cloudNetForcing[i];
    ws+=w;sw+=w*core.cloudShortwaveForcing[i];lw+=w*core.cloudLongwaveForcing[i];net+=w*n;
    if(n<min)min=n;if(n>max)max=n;
  }
  const d=Math.max(1e-12,ws);
  return {sw:sw/d,lw:lw/d,net:net/d,maxCooling:min,maxWarming:max};
}

if(typeof createPanel==='function'){
  const createPanelBeforeCloudRadiation=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeCloudRadiation(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-cloudrad="forcing"]')){
        appendWeatherCoreRow(box,'Облака SW / LW','cloud-rad-flux');
        const a=box.lastElementChild?.querySelector('[data-weathercore="cloud-rad-flux"]');if(a){delete a.dataset.weathercore;a.dataset.cloudrad='flux';}
        appendWeatherCoreRow(box,'Cloud radiative forcing','cloud-rad-forcing');
        const b=box.lastElementChild?.querySelector('[data-weathercore="cloud-rad-forcing"]');if(b){delete b.dataset.weathercore;b.dataset.cloudrad='forcing';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeCloudRadiation=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeCloudRadiation();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.cloudNetForcing)return;
    const d=cloudRadDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-cloudrad="'+k+'"]');if(e)e.textContent=v;};
    set('flux',d.sw.toFixed(1)+' / +'+d.lw.toFixed(1)+' Вт/м²');
    set('forcing',(d.net>=0?'+':'')+d.net.toFixed(1)+' Вт/м² · '+d.maxCooling.toFixed(0)+'…+'+Math.max(0,d.maxWarming).toFixed(0));
  };
}
