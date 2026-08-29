/* ============ 0.5.55: physical cloud radiative feedback ============ */
/*
   Cloud condensate now participates in the local Weather Core energy budget.
   The pre-existing one-box climateModel still supplies the slow planetary
   attractor, but local-energy is converted to a clear-sky/ice/aerosol baseline
   and this module adds cloud shortwave reflection and longwave trapping once
   per fixed Weather Core tick.

   Low/mid/high condensate masses are authoritative.  No visual noise, cloud
   slider morphology, requestAnimationFrame state or GPU texture is read here.
   The module changes only the local thermal budget (surfaceTemp + radiative
   diagnostics); it never creates/destroys H2O or changes pressure/wind.
*/

const CLOUD_RADIATIVE_MODEL=1;
const CLOUD_RAD_SIGMA=5.670374419e-8;
const CLOUD_RAD_LOW_SCALE_KG_M2=0.16;
const CLOUD_RAD_MID_SCALE_KG_M2=0.11;
const CLOUD_RAD_HIGH_SCALE_KG_M2=0.055;
const CLOUD_RAD_SW_LOW=0.56;
const CLOUD_RAD_SW_MID=0.43;
const CLOUD_RAD_SW_HIGH=0.26;
const CLOUD_RAD_LW_LOW=0.52;
const CLOUD_RAD_LW_MID=0.64;
const CLOUD_RAD_LW_HIGH=0.78;

function cloudRadClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function cloudRadCover(mass,scale){
  return cloudRadClamp(1-Math.exp(-Math.max(0,Number(mass)||0)/Math.max(1e-6,scale)),0,1);
}
function cloudRadClearGlobalAlbedo(c){
  const A=cloudRadClamp(c?.A??0.30,0.03,0.86);
  const cov=cloudRadClamp(c?.cloudCov??(typeof climateCloudCover==='function'?climateCloudCover():0),0,1);
  return cloudRadClamp(A-0.230*cov,0.03,0.86);
}
function cloudRadClearCellAlbedo(T,c){
  const globalClear=Number.isFinite(c?.clearSkyAlbedo)?cloudRadClamp(c.clearSkyAlbedo,0.03,0.86):cloudRadClearGlobalAlbedo(c);
  const globalIce=cloudRadClamp(c?.iceArea||0,0,0.98);
  const iceA=localEnergyIceAlbedo(c);
  const nonIce=cloudRadClamp((globalClear-globalIce*iceA)/Math.max(0.02,1-globalIce),0.04,0.72);
  const localIce=localEnergyIceFraction(T,c);
  return cloudRadClamp(nonIce*(1-localIce)+iceA*localIce,0.03,0.90);
}

/* Replace the 0.5.40 cloudWater perturbation.  From this point local-energy
   describes clear sky + surface/ice/aerosols only; physical layer condensate
   below owns all local cloud forcing. */
const localEnergyCellAlbedoBeforeCloudRadiative=localEnergyCellAlbedo;
localEnergyCellAlbedo=function(T,cloudWater,c){
  return cloudRadClearCellAlbedo(T,c);
};

const weatherCoreClimateSnapshotBeforeCloudRadiative=weatherCoreClimateSnapshot;
weatherCoreClimateSnapshot=function(){
  const s=weatherCoreClimateSnapshotBeforeCloudRadiative();
  const c=(typeof climateModel==='function')?climateModel():null;
  if(c){
    s.cloudCov=cloudRadClamp(c.cloudCov||0,0,1);
    s.iceArea=cloudRadClamp(c.iceArea||0,0,0.98);
    s.clearSkyAlbedo=cloudRadClearGlobalAlbedo(c);
  }
  return s;
};

function cloudRadEnsureFields(core){
  if(!core?.count)return core;
  const n=core.count;
  const ensure=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['clearSkyAlbedo','cloudRadiativeCover','cloudShortwaveForcing','cloudLongwaveForcing','cloudNetForcing'])ensure(k);
  core.cloudRadiativeModel=CLOUD_RADIATIVE_MODEL;
  return core;
}
function cloudRadLayerTemperature(core,i,zM,climate){
  const Ts=cloudRadClamp(core.surfaceTemp?.[i]??climate?.T??288.15,80,1600);
  const Ta=cloudRadClamp(core.airTemp?.[i]??Ts-6,75,1600);
  let lapse=Number(core.environmentLapseKPerKm?.[i]);
  if(!Number.isFinite(lapse))lapse=6.5;
  /* A temperature inversion must not make an elevated cloud hotter than the
     local surface for this compact TOA proxy. */
  lapse=cloudRadClamp(lapse,1.5,10.0);
  return cloudRadClamp(Ta-lapse*Math.max(0,zM)/1000,120,Ts);
}
function cloudRadLayerHeights(core,i,climate,out){
  let H=Number(core.scaleHeight?.[i]);
  if(!(H>0)&&typeof verticalScaleHeightM==='function')H=verticalScaleHeightM(core,i,climate);
  H=cloudRadClamp(H||8500,500,120000);
  const base=cloudRadClamp(core.cloudBaseHeightM?.[i]||0,0,1.8*H);
  const top=cloudRadClamp(core.cloudTopHeightM?.[i]||Math.max(base,0.75*H),base,1.8*H);
  out.low=cloudRadClamp(Math.max(base+350,Math.min(top,0.20*H)),250,top||250);
  out.mid=cloudRadClamp(Math.max(0.32*H,base+700),out.low,Math.max(out.low,top));
  out.high=cloudRadClamp(Math.max(0.78*H,base+1200),out.mid,Math.max(out.mid,top));
  if(top>0){out.low=Math.min(out.low,top);out.mid=Math.min(out.mid,top);out.high=Math.min(out.high,top);}
  return out;
}
function cloudRadCellForcing(core,i,climate,out){
  const low=cloudRadCover(core.cloudLowMass?.[i],CLOUD_RAD_LOW_SCALE_KG_M2);
  const mid=cloudRadCover(core.cloudMidMass?.[i],CLOUD_RAD_MID_SCALE_KG_M2);
  const high=cloudRadCover(core.cloudHighMass?.[i],CLOUD_RAD_HIGH_SCALE_KG_M2);
  const deep=cloudRadClamp(core.deepConvectiveState?.[i],0,1);

  /* Random-overlap approximation for reflected shortwave. Low optically thick
     decks reflect most, high ice cloud least. The residual factor (1-Aclear)
     prevents clouds from reflecting energy already removed by the clear-sky
     surface/atmosphere baseline. */
  const rLow=CLOUD_RAD_SW_LOW*low;
  const rMid=CLOUD_RAD_SW_MID*mid;
  const rHigh=CLOUD_RAD_SW_HIGH*high;
  const cloudReflect=1-(1-rLow)*(1-rMid)*(1-rHigh);
  const Aclear=cloudRadClamp(localEnergyCellAlbedo(core.surfaceTemp[i],0,climate),0.03,0.90);
  const deltaA=(1-Aclear)*cloudRadClamp(cloudReflect,0,0.82);
  const sw=-Math.max(0,Number(core.insolation?.[i])||0)*deltaA;

  /* Longwave: colder, higher cloud tops have a larger greenhouse effect.
     Dense background atmospheres close the IR window, so cloud LW forcing is
     attenuated as gaseous optical depth rises. */
  const z={low:0,mid:0,high:0};cloudRadLayerHeights(core,i,climate,z);
  const Ts=cloudRadClamp(core.surfaceTemp[i],80,1600);
  const Ts4=Math.pow(Ts,4);
  const Tl=cloudRadLayerTemperature(core,i,z.low,climate);
  const Tm=cloudRadLayerTemperature(core,i,z.mid,climate);
  const Th=cloudRadLayerTemperature(core,i,z.high,climate);
  const dLow=Math.max(0,CLOUD_RAD_SIGMA*(Ts4-Math.pow(Tl,4)));
  const dMid=Math.max(0,CLOUD_RAD_SIGMA*(Ts4-Math.pow(Tm,4)));
  const dHigh=Math.max(0,CLOUD_RAD_SIGMA*(Ts4-Math.pow(Th,4)));
  const tau=Math.max(0,Number(climate?.tau)||0);
  const irWindow=cloudRadClamp(1/(1+0.55*tau),0.08,1.0);
  let lw=irWindow*(CLOUD_RAD_LW_LOW*low*dLow+CLOUD_RAD_LW_MID*mid*dMid+CLOUD_RAD_LW_HIGH*high*dHigh);
  lw*=1+0.14*deep*high;
  const clearOlr=Math.max(0,Number(core.outgoingLongwave?.[i])||0);
  lw=Math.min(lw,clearOlr*0.72);

  out.low=low;out.mid=mid;out.high=high;out.cover=1-(1-low)*(1-mid)*(1-high);
  out.clearAlbedo=Aclear;out.deltaAlbedo=deltaA;out.sw=sw;out.lw=lw;out.net=sw+lw;
  return out;
}
function cloudRadApply(core,dtSec,climate){
  if(!core?.count)return core;
  cloudRadEnsureFields(core);
  const dt=cloudRadClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  const heatCap=localEnergyHeatCapacity(climate);
  const f={low:0,mid:0,high:0,cover:0,clearAlbedo:0,deltaAlbedo:0,sw:0,lw:0,net:0};
  for(let i=0;i<core.count;i++){
    /* local-energy has already stored clear-sky fluxes for this same tick. */
    cloudRadCellForcing(core,i,climate,f);
    core.clearSkyAlbedo[i]=f.clearAlbedo;
    core.cloudRadiativeCover[i]=f.cover;
    core.cloudShortwaveForcing[i]=f.sw;
    core.cloudLongwaveForcing[i]=f.lw;
    core.cloudNetForcing[i]=f.net;

    core.surfaceTemp[i]=weatherClamp(core.surfaceTemp[i]+f.net*dt/Math.max(1e6,heatCap),80,1600);
    core.localAlbedo[i]=cloudRadClamp(f.clearAlbedo+f.deltaAlbedo,0.03,0.96);
    core.absorbedSolar[i]=Math.max(0,(Number(core.absorbedSolar[i])||0)+f.sw);
    core.outgoingLongwave[i]=Math.max(0,(Number(core.outgoingLongwave[i])||0)-f.lw);
    core.netRadiation[i]=core.absorbedSolar[i]-core.outgoingLongwave[i];
  }
  return core;
}

const weatherCoreCreateBeforeCloudRadiative=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeCloudRadiative(seed,N,climate,axis);
  cloudRadEnsureFields(core);
  /* Do not apply an extra thermal step at t=0; populate diagnostics only. */
  const f={low:0,mid:0,high:0,cover:0,clearAlbedo:0,deltaAlbedo:0,sw:0,lw:0,net:0};
  for(let i=0;i<core.count;i++){
    cloudRadCellForcing(core,i,climate,f);
    core.clearSkyAlbedo[i]=f.clearAlbedo;core.cloudRadiativeCover[i]=f.cover;
    core.cloudShortwaveForcing[i]=f.sw;core.cloudLongwaveForcing[i]=f.lw;core.cloudNetForcing[i]=f.net;
    core.localAlbedo[i]=cloudRadClamp(f.clearAlbedo+f.deltaAlbedo,0.03,0.96);
    core.absorbedSolar[i]=Math.max(0,(Number(core.absorbedSolar[i])||0)+f.sw);
    core.outgoingLongwave[i]=Math.max(0,(Number(core.outgoingLongwave[i])||0)-f.lw);
    core.netRadiation[i]=core.absorbedSolar[i]-core.outgoingLongwave[i];
  }
  return core;
};
const weatherCoreStepBeforeCloudRadiative=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeCloudRadiative(core,dtSec,climate,axis);
  return cloudRadApply(core,dtSec,climate);
};

const weatherCoreFiniteBeforeCloudRadiative=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeCloudRadiative(core))return false;
  for(const k of ['clearSkyAlbedo','cloudRadiativeCover','cloudShortwaveForcing','cloudLongwaveForcing','cloudNetForcing']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  return true;
};
function cloudRadDiagnostics(core){
  if(!core?.cloudNetForcing)return {cover:NaN,sw:NaN,lw:NaN,net:NaN};
  let ws=0,c=0,sw=0,lw=0,net=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);ws+=w;
    c+=w*core.cloudRadiativeCover[i];sw+=w*core.cloudShortwaveForcing[i];
    lw+=w*core.cloudLongwaveForcing[i];net+=w*core.cloudNetForcing[i];
  }
  ws=Math.max(1e-12,ws);return {cover:c/ws,sw:sw/ws,lw:lw/ws,net:net/ws};
}
if(typeof createPanel==='function'){
  const createPanelBeforeCloudRadiative=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeCloudRadiative(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-cloudrad="forcing"]')){
        appendWeatherCoreRow(box,'Cloud SW / LW forcing','cloudrad-forcing');
        const a=box.lastElementChild?.querySelector('[data-weathercore="cloudrad-forcing"]');if(a){delete a.dataset.weathercore;a.dataset.cloudrad='forcing';}
        appendWeatherCoreRow(box,'Cloud net / cover','cloudrad-net');
        const b=box.lastElementChild?.querySelector('[data-weathercore="cloudrad-net"]');if(b){delete b.dataset.weathercore;b.dataset.cloudrad='net';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeCloudRadiative=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeCloudRadiative();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.cloudNetForcing)return;
    const d=cloudRadDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-cloudrad="'+k+'"]');if(e)e.textContent=v;};
    set('forcing',d.sw.toFixed(1)+' / +'+d.lw.toFixed(1)+' Вт/м²');
    set('net',(d.net>=0?'+':'')+d.net.toFixed(1)+' Вт/м² · '+(100*d.cover).toFixed(0)+'%');
  };
}
