/* ============ 0.5.45: precipitation + local landed water ============ */
/*
   Weather Core v7 removes mature condensate from cloudWaterState and returns
   it to the surface as rain or snow. Land precipitation is retained in local
   liquid/snow columns (kg/m2); precipitation over the macro-ocean immediately
   returns to the large condensed reservoir represented by the 0.5.37 one-box
   water budget.

   This is deliberately not soil/runoff physics. Local liquid water can
   re-evaporate and warm snow can melt so the new landing reservoir does not
   become a permanent numerical sink; soil infiltration/runoff is 0.5.47 and
   detailed snow/ice thermodynamics remains 0.5.59.

   The 0.5.37 atmospheric H2O target still provides the slow global closure.
   Once landed water exists on land, normalization assigns only the remainder
   of that mobile column to vapor+cloud. Thus precipitation cannot be silently
   refilled on top of retained surface water on the next weather tick.
*/

const PRECIPITATION_MODEL = 1;
const PRECIP_CLOUD_THRESHOLD_KG_M2 = 0.08;
const PRECIP_AUTOCONVERT_TAU_SEC = 2700.0;
const PRECIP_MAX_KG_M2_S = 0.0030;
const PRECIP_SNOW_COLD_K = 271.0;
const PRECIP_SNOW_WARM_K = 277.0;
const PRECIP_SURFACE_MELT_TAU_SEC = 6.0*3600;
const PRECIP_SURFACE_EVAP_TAU_SEC = 18.0*3600;
const PRECIP_SURFACE_EVAP_MAX_KG_M2_S = 4.0e-4;

function precipClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function precipSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=precipClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function precipAreaMeanStore(core){
  if(!core?.surfaceLiquidWater||!core?.surfaceSnowWater) return 0;
  let sw=0,sum=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    sw+=w;sum+=w*(Math.max(0,core.surfaceLiquidWater[i])+Math.max(0,core.surfaceSnowWater[i]));
  }
  return sum/Math.max(1e-12,sw);
}
function precipScaleSurfaceStore(core,scale){
  scale=Math.max(0,Number(scale)||0);
  if(!core?.surfaceLiquidWater) return;
  for(let i=0;i<core.count;i++){
    core.surfaceLiquidWater[i]=Math.max(0,core.surfaceLiquidWater[i]*scale);
    core.surfaceSnowWater[i]=Math.max(0,core.surfaceSnowWater[i]*scale);
  }
}

/* 0.5.44 normalized vapor+cloud to the full one-box atmospheric target.
   Retained land precipitation must occupy part of that mobile column or the
   following tick would recreate atmospheric water on top of the rain/snow. */
const h2oNormalizeGlobalVaporBeforePrecip=h2oNormalizeGlobalVapor;
h2oNormalizeGlobalVapor=function(core,climate){
  if(!core?.surfaceLiquidWater||!core?.cloudWaterState)
    return h2oNormalizeGlobalVaporBeforePrecip(core,climate);
  const totalTarget=Math.max(0,h2oGlobalTargetColumnKgM2(climate));
  let stored=precipAreaMeanStore(core);
  if(stored>totalTarget&&stored>1e-12){
    precipScaleSurfaceStore(core,totalTarget/stored);
    stored=totalTarget;
  }
  const atmosphericTarget=Math.max(0,totalTarget-stored);
  const mean=condAreaMeanTotal(core);
  if(!(atmosphericTarget>1e-12)){
    core.vaporColumn.fill(0);core.cloudWaterState.fill(0);
    core.h2oTargetColumn=totalTarget;core.precipAtmosphericTarget=0;
    condMirrorCloudWater(core);return 0;
  }
  if(!(mean>1e-12)){
    core.vaporColumn.fill(atmosphericTarget);core.cloudWaterState.fill(0);
    core.h2oTargetColumn=totalTarget;core.precipAtmosphericTarget=atmosphericTarget;
    condMirrorCloudWater(core);return 1;
  }
  const scale=atmosphericTarget/mean;
  for(let i=0;i<core.count;i++){
    core.vaporColumn[i]=Math.max(0,core.vaporColumn[i]*scale);
    core.cloudWaterState[i]=Math.max(0,core.cloudWaterState[i]*scale);
  }
  core.h2oTargetColumn=totalTarget;core.precipAtmosphericTarget=atmosphericTarget;
  condMirrorCloudWater(core);
  return scale;
};

function precipSnowFraction(core,i){
  const t=0.70*Math.max(80,core.airTemp[i])+0.30*Math.max(80,core.surfaceTemp[i]);
  return 1-precipSmooth(PRECIP_SNOW_COLD_K,PRECIP_SNOW_WARM_K,t);
}
function precipMeltSurfaceSnow(core,dtSec){
  if(!core?.surfaceSnowWater) return 0;
  const dt=Math.max(0,Number(dtSec)||0),base=1-Math.exp(-dt/PRECIP_SURFACE_MELT_TAU_SEC);
  let melted=0;
  for(let i=0;i<core.count;i++){
    const snow=Math.max(0,core.surfaceSnowWater[i]);
    const warm=precipSmooth(272,280,core.surfaceTemp[i]);
    const dm=Math.min(snow,snow*base*warm);
    core.surfaceMeltRate[i]=dt>0?dm/dt:0;
    if(dm>0){core.surfaceSnowWater[i]=snow-dm;core.surfaceLiquidWater[i]+=dm;melted+=dm*Math.max(1e-12,core.areaWeight?.[i]||1);}
  }
  return melted;
}

/* Add evaporation from newly landed liquid water. The pre-0.5.45 function
   still handles the large macro-ocean. This extra source is strictly a local
   transfer: every kilogram added to vapor is removed from the landed store. */
const h2oApplyEvaporationBeforePrecip=h2oApplyEvaporation;
h2oApplyEvaporation=function(core,dtSec,climate){
  let source=h2oApplyEvaporationBeforePrecip(core,dtSec,climate);
  if(!core?.surfaceLiquidWater) return source;
  const dt=Math.max(0,Number(dtSec)||0);
  if(!(dt>0)) return source;
  for(let i=0;i<core.count;i++){
    const store=Math.max(0,core.surfaceLiquidWater[i]);
    if(!(store>0)) continue;
    const land=1-precipClamp(core.surfaceWaterFraction?.[i]||0,0,1);
    if(!(land>1e-5)) continue;
    const T=core.surfaceTemp[i];
    const liquid=precipSmooth(258,278,T)*(1-precipSmooth(635,650,T));
    if(!(liquid>0)) continue;
    const sat=h2oSaturationColumnKgM2(T,climate);
    const target=H2O_EVAP_RH_TARGET*sat;
    const deficit=Math.max(0,target-core.vaporColumn[i]);
    if(!(deficit>0)) continue;
    const speed=Math.hypot(core.windStateU?.[i]??core.windU[i],core.windStateV?.[i]??core.windV[i]);
    const windBoost=0.55+0.75*precipClamp(speed/12,0,1.5);
    const rate=Math.min(PRECIP_SURFACE_EVAP_MAX_KG_M2_S,store/dt,
      land*liquid*deficit/Math.max(1,PRECIP_SURFACE_EVAP_TAU_SEC)*windBoost);
    if(rate>0){
      const dm=rate*dt;
      core.surfaceLiquidWater[i]=Math.max(0,store-dm);
      core.vaporColumn[i]+=dm;
      core.evaporationRate[i]+=rate;
      source+=rate*Math.max(1e-12,core.areaWeight?.[i]||1);
    }
  }
  return source;
};

function precipApply(core,dtSec,climate){
  if(!core?.cloudWaterState) return {mean:0,max:0,rain:0,snow:0,ocean:0};
  const dt=Math.max(0,Number(dtSec)||0);
  let sw=0,sum=0,max=0,rain=0,snow=0,ocean=0;
  for(let i=0;i<core.count;i++){
    const cloud=Math.max(0,core.cloudWaterState[i]);
    const excess=Math.max(0,cloud-PRECIP_CLOUD_THRESHOLD_KG_M2);
    let rate=Math.min(PRECIP_MAX_KG_M2_S,excess/Math.max(1,PRECIP_AUTOCONVERT_TAU_SEC));
    let dm=Math.min(cloud,rate*dt);
    if(!(dm>0)){rate=0;dm=0;}
    else rate=dm/Math.max(1,dt);

    const snowFrac=precipSnowFraction(core,i);
    const water=precipClamp(core.surfaceWaterFraction?.[i]||0,0,1);
    const land=1-water;
    const landDm=dm*land,oceanDm=dm-landDm;
    const rainDm=landDm*(1-snowFrac),snowDm=landDm*snowFrac;
    if(dm>0){
      core.cloudWaterState[i]=Math.max(0,cloud-dm);
      core.surfaceLiquidWater[i]+=rainDm;
      core.surfaceSnowWater[i]+=snowDm;
    }
    core.precipRate[i]=rate;
    core.rainRate[i]=rate*(1-snowFrac);
    core.snowRate[i]=rate*snowFrac;
    core.precipSnowFraction[i]=snowFrac;
    core.precipOceanReturnRate[i]=dt>0?oceanDm/dt:0;

    const w=Math.max(1e-12,core.areaWeight?.[i]||1);sw+=w;sum+=w*rate;
    rain+=w*core.rainRate[i];snow+=w*core.snowRate[i];ocean+=w*core.precipOceanReturnRate[i];
    if(rate>max)max=rate;
  }
  condMirrorCloudWater(core);
  h2oRefreshRelativeHumidity(core,climate);
  const d=Math.max(1e-12,sw);
  return {mean:sum/d,max,rain:rain/d,snow:snow/d,ocean:ocean/d};
}

const weatherCoreCreateBeforePrecip=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforePrecip(seed,N,climate,axis);
  core.precipitationModel=PRECIPITATION_MODEL;
  core.surfaceLiquidWater=new Float32Array(core.count);
  core.surfaceSnowWater=new Float32Array(core.count);
  core.rainRate=new Float32Array(core.count);
  core.snowRate=new Float32Array(core.count);
  core.precipSnowFraction=new Float32Array(core.count);
  core.precipOceanReturnRate=new Float32Array(core.count);
  core.surfaceMeltRate=new Float32Array(core.count);
  core.precipAtmosphericTarget=h2oGlobalTargetColumnKgM2(climate);
  core.precipMeanRate=0;core.precipMaxRate=0;core.precipMeltedMass=0;
  return core;
};

const weatherCoreStepBeforePrecip=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforePrecip(core,dtSec,climate,axis);
  const dt=weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC);
  core.precipMeltedMass=precipMeltSurfaceSnow(core,dt);
  const p=precipApply(core,dt,climate);
  core.precipMeanRate=p.mean;core.precipMaxRate=p.max;
  return core;
};

const weatherCoreFiniteBeforePrecip=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforePrecip(core)) return false;
  for(const k of ['surfaceLiquidWater','surfaceSnowWater','rainRate','snowRate','precipSnowFraction','precipOceanReturnRate','surfaceMeltRate']){
    const a=core?.[k];if(!a||a.length!==core.count) return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])||a[i]<0) return false;
  }
  for(let i=0;i<core.precipSnowFraction.length;i++) if(core.precipSnowFraction[i]>1.000001) return false;
  return true;
};

function precipDiagnostics(core,climate){
  if(!core?.surfaceLiquidWater) return {mean:NaN,max:NaN,rain:NaN,snow:NaN,liquid:NaN,snowStore:NaN,closure:NaN,target:NaN};
  let sw=0,pr=0,max=0,rain=0,snow=0,liquid=0,snowStore=0,atm=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);sw+=w;
    const p=core.precipRate[i];pr+=w*p;if(p>max)max=p;
    rain+=w*core.rainRate[i];snow+=w*core.snowRate[i];
    liquid+=w*core.surfaceLiquidWater[i];snowStore+=w*core.surfaceSnowWater[i];
    atm+=w*(core.vaporColumn[i]+core.cloudWaterState[i]);
  }
  const d=Math.max(1e-12,sw),target=h2oGlobalTargetColumnKgM2(climate);
  return {mean:pr/d,max,rain:rain/d,snow:snow/d,liquid:liquid/d,snowStore:snowStore/d,
    closure:(atm+liquid+snowStore)/d,target};
}

if(typeof createPanel==='function'){
  const createPanelBeforePrecip=createPanel;
  createPanel=function(group){
    const el=createPanelBeforePrecip(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-precip="rate"]')){
        appendWeatherCoreRow(box,'Осадки mean / max','precip-rate');
        const a=box.lastElementChild?.querySelector('[data-weathercore="precip-rate"]');if(a){delete a.dataset.weathercore;a.dataset.precip='rate';}
        appendWeatherCoreRow(box,'Дождь / снег','precip-phase');
        const b=box.lastElementChild?.querySelector('[data-weathercore="precip-phase"]');if(b){delete b.dataset.weathercore;b.dataset.precip='phase';}
        appendWeatherCoreRow(box,'Вода на суше / снег','precip-store');
        const c=box.lastElementChild?.querySelector('[data-weathercore="precip-store"]');if(c){delete c.dataset.weathercore;c.dataset.precip='store';}
        appendWeatherCoreRow(box,'Mobile H₂O closure','precip-closure');
        const d=box.lastElementChild?.querySelector('[data-weathercore="precip-closure"]');if(d){delete d.dataset.weathercore;d.dataset.precip='closure';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforePrecip=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforePrecip();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag');if(!box) return;
    const core=weatherCoreEnsure();if(!core?.surfaceLiquidWater) return;
    const d=precipDiagnostics(core,weatherCoreClimateSnapshot());
    const set=(k,v)=>{const e=box.querySelector('[data-precip="'+k+'"]');if(e)e.textContent=v;};
    set('rate',(d.mean*86400).toFixed(2)+' / '+(d.max*86400).toFixed(1)+' мм/сут');
    set('phase',(d.rain*86400).toFixed(2)+' / '+(d.snow*86400).toFixed(2)+' мм/сут');
    set('store',d.liquid.toFixed(2)+' / '+d.snowStore.toFixed(2)+' кг/м²');
    set('closure',d.closure.toFixed(2)+' / '+d.target.toFixed(2)+' кг/м²');
  };
}
