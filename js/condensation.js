/* ============ 0.5.44: saturation + condensation + cloud condensate ============ */
/*
   Weather Core v6 closes the local vapor/cloud phase loop. Supersaturated
   air converts vaporColumn into persistent cloudWaterState (kg/m2); dry air
   can evaporate that condensate back to vapor. The phase exchange conserves
   local H2O exactly and applies a bounded latent-heat tendency to airTemp.

   The legacy weather-core cloudWater field used to be a 0..1 morphology
   proxy. Physical condensate is isolated in cloudWaterState so the old v1
   relaxation cannot destroy it. After every physics tick cloudWater mirrors
   the real kg/m2 state for compatibility/inspection.

   Precipitation is deliberately absent here. 0.5.45 will remove condensate
   from the atmospheric pair and return it to the surface water budget.
*/

const CONDENSATION_MODEL = 1;
const CONDENSE_TAU_SEC = 300.0;
const CLOUD_EVAP_TAU_SEC = 900.0;
const CLOUD_LATENT_HEAT_J_KG = 2.50e6;
const CLOUD_CP_AIR_J_KG_K = 1004.0;
const CLOUD_MAX_LATENT_DT_K = 4.0;
const CLOUD_ADVECT_EDGE_CFL = 0.22;
const CLOUD_ADVECT_MAX_OUTFLOW = 0.72;

function condClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function condAreaMeanTotal(core){
  if(!core||!core.vaporColumn) return NaN;
  let sw=0,sum=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    sw+=w;
    sum+=w*(Math.max(0,core.vaporColumn[i])+Math.max(0,core.cloudWaterState?.[i]||0));
  }
  return sum/Math.max(1e-12,sw);
}
function condMirrorCloudWater(core){
  if(!core?.cloudWaterState||!core.cloudWater) return;
  for(let i=0;i<core.count;i++) core.cloudWater[i]=core.cloudWaterState[i];
}

/* 0.5.43 normalized vapor alone because condensate did not yet exist. Once
   cloudWaterState exists, preserve the authoritative global atmospheric H2O
   reservoir as vapor + cloud condensate. */
const h2oNormalizeGlobalVaporBeforeCondensation=h2oNormalizeGlobalVapor;
h2oNormalizeGlobalVapor=function(core,climate){
  if(!core?.cloudWaterState) return h2oNormalizeGlobalVaporBeforeCondensation(core,climate);
  const target=h2oGlobalTargetColumnKgM2(climate);
  const mean=condAreaMeanTotal(core);
  if(!(target>1e-12)){
    core.vaporColumn.fill(0);core.cloudWaterState.fill(0);core.h2oTargetColumn=0;
    condMirrorCloudWater(core);return 0;
  }
  if(!(mean>1e-12)){
    core.vaporColumn.fill(target);core.cloudWaterState.fill(0);core.h2oTargetColumn=target;
    condMirrorCloudWater(core);return 1;
  }
  const scale=target/mean;
  for(let i=0;i<core.count;i++){
    core.vaporColumn[i]=Math.max(0,core.vaporColumn[i]*scale);
    core.cloudWaterState[i]=Math.max(0,core.cloudWaterState[i]*scale);
  }
  core.h2oTargetColumn=target;
  condMirrorCloudWater(core);
  return scale;
};

/* Condensed droplets are carried by the same resolved tangent wind as vapor.
   Reuse the precomputed H2O edge graph; only scalar mass flux is evaluated on
   each fixed weather tick. */
function condAdvectCloud(core,dtSec){
  if(!core?.h2oEdgeI?.length||!core.cloudWaterState) return 0;
  const nEdge=core.h2oEdgeI.length;
  if(!core.cloudEdgeFlux||core.cloudEdgeFlux.length!==nEdge){
    core.cloudEdgeFlux=new Float64Array(nEdge);
    core.cloudMassDelta=new Float64Array(core.count);
    core.cloudOutMass=new Float64Array(core.count);
  }
  const dt=Math.max(0,Number(dtSec)||0);
  const delta=core.cloudMassDelta,out=core.cloudOutMass,flux=core.cloudEdgeFlux;
  delta.fill(0);out.fill(0);flux.fill(0);
  const wu=core.windStateU||core.windU,wv=core.windStateV||core.windV;
  for(let e=0;e<nEdge;e++){
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e];
    const vi=wu[i]*core.h2oEdgeIE[e]+wv[i]*core.h2oEdgeIN[e];
    const vj=wu[j]*core.h2oEdgeJE[e]+wv[j]*core.h2oEdgeJN[e];
    const edgeV=0.5*(vi-vj);
    const frac=Math.min(CLOUD_ADVECT_EDGE_CFL,Math.abs(edgeV)*dt/Math.max(1,core.h2oEdgeDistance[e]));
    if(!(frac>0)) continue;
    const donor=edgeV>=0?i:j;
    const mass=Math.max(0,core.cloudWaterState[donor])*Math.max(1e-12,core.areaWeight?.[donor]||1);
    const signed=(edgeV>=0?1:-1)*mass*frac;
    flux[e]=signed;out[donor]+=Math.abs(signed);
  }
  for(let e=0;e<nEdge;e++){
    let dm=flux[e];if(dm===0) continue;
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e],donor=dm>0?i:j;
    const mass=Math.max(0,core.cloudWaterState[donor])*Math.max(1e-12,core.areaWeight?.[donor]||1);
    const scale=out[donor]>CLOUD_ADVECT_MAX_OUTFLOW*mass
      ? CLOUD_ADVECT_MAX_OUTFLOW*mass/Math.max(1e-30,out[donor]) : 1;
    dm*=scale;delta[i]-=dm;delta[j]+=dm;
  }
  let moved=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    moved+=Math.abs(delta[i]);
    core.cloudWaterState[i]=Math.max(0,(core.cloudWaterState[i]*w+delta[i])/w);
  }
  return moved*0.5;
}

function condAirColumnKgM2(core,i,climate){
  const g=Math.max(0.05,h2oGravityMS2(climate));
  const p=Math.max(1,Number(core.pressure?.[i])||Math.max(1,Number(climate?.pressureBar)||0)*1e5);
  return p/g;
}
function condApplyLatentHeat(core,i,dmCondensed,climate){
  if(!dmCondensed) return 0;
  const airMass=Math.max(0.1,condAirColumnKgM2(core,i,climate));
  let dT=dmCondensed*CLOUD_LATENT_HEAT_J_KG/(airMass*CLOUD_CP_AIR_J_KG_K);
  dT=condClamp(dT,-CLOUD_MAX_LATENT_DT_K,CLOUD_MAX_LATENT_DT_K);
  core.airTemp[i]=condClamp(core.airTemp[i]+dT,80,1400);
  return dT;
}

function condPhaseChange(core,dtSec,climate){
  if(!core?.cloudWaterState) return {condensed:0,evaporated:0,latentK:0};
  const dt=Math.max(0,Number(dtSec)||0);
  const fc=1-Math.exp(-dt/Math.max(1,CONDENSE_TAU_SEC));
  const fe=1-Math.exp(-dt/Math.max(1,CLOUD_EVAP_TAU_SEC));
  let condensed=0,evaporated=0,latentK=0;
  for(let i=0;i<core.count;i++){
    const sat=Math.max(1e-9,h2oSaturationColumnKgM2(core.airTemp[i],climate));
    let vapor=Math.max(0,core.vaporColumn[i]);
    let cloud=Math.max(0,core.cloudWaterState[i]);
    let dm=0;
    if(vapor>sat){
      dm=(vapor-sat)*fc;
      vapor-=dm;cloud+=dm;condensed+=dm*Math.max(1e-12,core.areaWeight?.[i]||1);
      latentK+=Math.abs(condApplyLatentHeat(core,i,dm,climate));
    }else if(cloud>0&&vapor<sat){
      dm=Math.min(cloud,(sat-vapor)*fe);
      vapor+=dm;cloud-=dm;evaporated+=dm*Math.max(1e-12,core.areaWeight?.[i]||1);
      latentK+=Math.abs(condApplyLatentHeat(core,i,-dm,climate));
    }
    core.vaporColumn[i]=Math.max(0,vapor);
    core.cloudWaterState[i]=Math.max(0,cloud);
  }
  return {condensed,evaporated,latentK};
}

function condRefreshDiagnosticsFields(core,climate){
  h2oRefreshRelativeHumidity(core,climate);
  condMirrorCloudWater(core);
}

const weatherCoreCreateBeforeCondensation=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeCondensation(seed,N,climate,axis);
  core.condensationModel=CONDENSATION_MODEL;
  core.cloudWaterState=new Float32Array(core.count);
  core.condensationRate=new Float32Array(core.count);
  core.cloudEvaporationRate=new Float32Array(core.count);
  const beforeVapor=new Float32Array(core.vaporColumn);
  const phase=condPhaseChange(core,WEATHER_CORE_FIXED_DT_SEC,climate);
  const invDt=1/Math.max(1,WEATHER_CORE_FIXED_DT_SEC);
  for(let i=0;i<core.count;i++){
    const dv=beforeVapor[i]-core.vaporColumn[i];
    core.condensationRate[i]=Math.max(0,dv)*invDt;
    core.cloudEvaporationRate[i]=Math.max(0,-dv)*invDt;
  }
  core.cloudAdvectedMass=0;
  core.condensedMass=phase.condensed;
  core.cloudEvaporatedMass=phase.evaporated;
  condRefreshDiagnosticsFields(core,climate);
  return core;
};

const weatherCoreStepBeforeCondensation=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  /* Old weather-core may write its historical cloud proxy into core.cloudWater.
     cloudWaterState is the authoritative physical condensate and survives it. */
  weatherCoreStepBeforeCondensation(core,dtSec,climate,axis);
  const dt=weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC);
  core.cloudAdvectedMass=condAdvectCloud(core,dt);
  const beforeVapor=new Float32Array(core.vaporColumn);
  const phase=condPhaseChange(core,dt,climate);
  const invDt=1/Math.max(1,dt);
  for(let i=0;i<core.count;i++){
    const dv=beforeVapor[i]-core.vaporColumn[i];
    core.condensationRate[i]=Math.max(0,dv)*invDt;
    core.cloudEvaporationRate[i]=Math.max(0,-dv)*invDt;
  }
  core.condensedMass=phase.condensed;
  core.cloudEvaporatedMass=phase.evaporated;
  /* Phase exchange and cloud advection conserve atmospheric H2O exactly.
     Renormalization only removes tiny numerical/global drift and keeps the
     0.5.37 reservoir authoritative until precipitation is added in 0.5.45. */
  h2oNormalizeGlobalVapor(core,climate);
  condRefreshDiagnosticsFields(core,climate);
  return core;
};

const weatherCoreFiniteBeforeCondensation=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeCondensation(core)) return false;
  for(const k of ['cloudWaterState','condensationRate','cloudEvaporationRate']){
    const a=core?.[k];if(!a||a.length!==core.count) return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])||a[i]<0) return false;
  }
  return true;
};

const weatherCoreMeansBeforeCondensation=weatherCoreMeans;
weatherCoreMeans=function(core){
  const m=weatherCoreMeansBeforeCondensation(core);
  if(!core?.cloudWaterState) return m;
  m.cloud=h2oAreaMean(core,core.cloudWaterState);
  return m;
};

function condensationDiagnostics(core,climate){
  if(!core?.cloudWaterState) return {cloud:NaN,cloudMax:NaN,cond:NaN,evap:NaN,total:NaN,target:NaN};
  let sw=0,cloud=0,cloudMax=0,cond=0,evap=0,total=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);sw+=w;
    const c=core.cloudWaterState[i];cloud+=w*c;if(c>cloudMax)cloudMax=c;
    cond+=w*core.condensationRate[i];evap+=w*core.cloudEvaporationRate[i];
    total+=w*(core.vaporColumn[i]+c);
  }
  const d=Math.max(1e-12,sw);
  return {cloud:cloud/d,cloudMax,cond:cond/d,evap:evap/d,total:total/d,target:h2oGlobalTargetColumnKgM2(climate)};
}

if(typeof createPanel==='function'){
  const createPanelBeforeCondensation=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeCondensation(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-cond="cloud"]')){
        appendWeatherCoreRow(box,'Cloud water mean / max','cond-cloud');
        const a=box.lastElementChild?.querySelector('[data-weathercore="cond-cloud"]');if(a){delete a.dataset.weathercore;a.dataset.cond='cloud';}
        appendWeatherCoreRow(box,'Конденсация','cond-rate');
        const b=box.lastElementChild?.querySelector('[data-weathercore="cond-rate"]');if(b){delete b.dataset.weathercore;b.dataset.cond='rate';}
        appendWeatherCoreRow(box,'Испарение облака','cond-evap');
        const c=box.lastElementChild?.querySelector('[data-weathercore="cond-evap"]');if(c){delete c.dataset.weathercore;c.dataset.cond='evap';}
      }
      const legacy=box?.querySelector('[data-weathercore="cloud"]');
      if(legacy&&legacy.previousElementSibling) legacy.previousElementSibling.textContent='Cloud water';
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeCondensation=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeCondensation();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag');if(!box) return;
    const core=weatherCoreEnsure();if(!core?.cloudWaterState) return;
    const climate=weatherCoreClimateSnapshot();
    const d=condensationDiagnostics(core,climate);
    const set=(k,v)=>{const e=box.querySelector('[data-cond="'+k+'"]');if(e)e.textContent=v;};
    const legacy=box.querySelector('[data-weathercore="cloud"]');if(legacy) legacy.textContent=d.cloud.toFixed(3)+' кг/м²';
    set('cloud',d.cloud.toFixed(3)+' / '+d.cloudMax.toFixed(3)+' кг/м²');
    set('rate',(d.cond*86400).toFixed(3)+' кг/м²/сут');
    set('evap',(d.evap*86400).toFixed(3)+' кг/м²/сут');
  };
}
