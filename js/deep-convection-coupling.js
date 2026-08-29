/* ============ 0.5.51: deep-convection microphysics/column coupling ============ */
/*
   Keep 0.5.51 modular: deep-convection.js owns CAPE/CIN and the persistent
   plume lifecycle, while this adapter lets that plume accelerate the already
   authoritative condensation/precipitation machinery and deepen the existing
   vertical cloud diagnosis.

   The coupling is conservative. Extra plume condensation transfers vapor to
   cloudWaterState; convective autoconversion transfers cloudWaterState to the
   same rain/snow/surface reservoirs used by 0.5.45. No new H2O source exists.
   Latent heating stays in condApplyLatentHeat().
*/

const DEEP_COUPLING_MODEL = 1;
const DEEP_PLUME_CONDENSE_TAU_SEC = 600.0;
const DEEP_PLUME_MAX_COOLING_K = 42.0;
const DEEP_PRECIP_THRESHOLD_KG_M2 = 0.055;
const DEEP_PRECIP_TAU_SEC = 1200.0;
const DEEP_PRECIP_MAX_EXTRA_KG_M2_S = 0.012;

function deepCoupleClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }

function deepConvectiveCondensationAssist(core,dtSec,climate){
  if(!core?.deepConvectiveState||!core?.cloudWaterState||!core?.vaporColumn)
    return {condensed:0,latentK:0};
  const dt=Math.max(0,Number(dtSec)||0);
  if(!(dt>0)) return {condensed:0,latentK:0};
  let condensed=0,latentK=0;
  const response=1-Math.exp(-dt/DEEP_PLUME_CONDENSE_TAU_SEC);
  for(let i=0;i<core.count;i++){
    const d=deepCoupleClamp(core.deepConvectiveState[i],0,1);
    if(d<0.035) continue;
    const H=deepScaleHeightM(core,i,climate);
    const lcl=deepCoupleClamp(core.deepConvectiveTopTargetM?.[i]>0
      ? deepLclHeightM(core.airTemp[i],deepRelativeHumidity(core,i),H) : 0,0,DEEP_MAX_TOP_SCALE*H);
    const top=deepCoupleClamp(core.deepConvectiveTopTargetM?.[i]||lcl,lcl,DEEP_MAX_TOP_SCALE*H);
    const depth=Math.max(0,top-lcl);
    if(depth<250) continue;
    /* Representative saturated plume temperature roughly three quarters of
       the way through the buoyant depth. This is sub-grid cooling, not a grid
       air-temperature tendency. */
    const cooling=Math.min(DEEP_PLUME_MAX_COOLING_K,0.75*DEEP_MOIST_LAPSE_K_M*depth);
    const plumeT=deepCoupleClamp(core.airTemp[i]-cooling,150,1400);
    const area=deepCoupleClamp(core.deepPlumeAreaFraction?.[i]||0,0,0.10);
    if(!(area>0)) continue;
    const vapor=Math.max(0,core.vaporColumn[i]);
    const plumeVapor=vapor*area;
    const plumeSat=Math.max(1e-9,h2oSaturationColumnKgM2(plumeT,climate))*area;
    const excess=Math.max(0,plumeVapor-plumeSat);
    const dm=Math.min(vapor,excess*response*d);
    if(!(dm>0)) continue;
    core.vaporColumn[i]=vapor-dm;
    core.cloudWaterState[i]=Math.max(0,core.cloudWaterState[i])+dm;
    condensed+=dm*Math.max(1e-12,core.areaWeight?.[i]||1);
    if(typeof condApplyLatentHeat==='function') latentK+=Math.abs(condApplyLatentHeat(core,i,dm,climate));
  }
  return {condensed,latentK};
}

/* Function declarations are looked up dynamically inside the older weather
   wrappers, so replacing condPhaseChange here affects the next fixed tick
   without rewriting the 0.5.44 source module. */
if(typeof condPhaseChange==='function'){
  const condPhaseChangeBeforeDeepCoupling=condPhaseChange;
  condPhaseChange=function(core,dtSec,climate){
    const base=condPhaseChangeBeforeDeepCoupling(core,dtSec,climate);
    const extra=deepConvectiveCondensationAssist(core,dtSec,climate);
    if(extra.condensed>0){
      base.condensed+=extra.condensed;
      base.latentK+=extra.latentK;
    }
    return base;
  };
}

function deepConvectivePrecipAssist(core,dtSec,climate){
  if(!core?.deepConvectiveState||!core?.cloudWaterState||!core?.surfaceLiquidWater)
    return 0;
  const dt=Math.max(0,Number(dtSec)||0);
  if(!(dt>0)) return 0;
  let extraMass=0;
  for(let i=0;i<core.count;i++){
    const d=deepCoupleClamp(core.deepConvectiveState[i],0,1);
    if(d<0.06) continue;
    let cloud=Math.max(0,core.cloudWaterState[i]);
    const threshold=DEEP_PRECIP_THRESHOLD_KG_M2*(1-0.45*d);
    const excess=Math.max(0,cloud-threshold);
    if(!(excess>0)) continue;
    const tau=Math.max(240,DEEP_PRECIP_TAU_SEC/(1+4*d));
    let rate=Math.min(DEEP_PRECIP_MAX_EXTRA_KG_M2_S*d,excess/tau*(0.65+1.85*d));
    let dm=Math.min(cloud,rate*dt);
    if(!(dm>0)) continue;
    rate=dm/Math.max(1,dt);

    const snowFrac=(typeof precipSnowFraction==='function')?precipSnowFraction(core,i):0;
    const water=deepCoupleClamp(core.surfaceWaterFraction?.[i]||0,0,1),land=1-water;
    const landDm=dm*land,oceanDm=dm-landDm;
    const rainDm=landDm*(1-snowFrac),snowDm=landDm*snowFrac;
    cloud-=dm;
    core.cloudWaterState[i]=Math.max(0,cloud);
    core.surfaceLiquidWater[i]+=rainDm;
    core.surfaceSnowWater[i]+=snowDm;
    core.precipRate[i]+=rate;
    core.rainRate[i]+=rate*(1-snowFrac);
    core.snowRate[i]+=rate*snowFrac;
    core.precipOceanReturnRate[i]+=oceanDm/Math.max(1,dt);
    extraMass+=dm*Math.max(1e-12,core.areaWeight?.[i]||1);
  }
  if(typeof condMirrorCloudWater==='function') condMirrorCloudWater(core);
  if(typeof h2oRefreshRelativeHumidity==='function') h2oRefreshRelativeHumidity(core,climate);
  return extraMass;
}

function deepPrecipStats(core){
  let sw=0,sum=0,max=0,rain=0,snow=0,ocean=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1),p=Math.max(0,core.precipRate[i]);sw+=w;sum+=w*p;
    rain+=w*Math.max(0,core.rainRate[i]);snow+=w*Math.max(0,core.snowRate[i]);
    ocean+=w*Math.max(0,core.precipOceanReturnRate[i]);if(p>max)max=p;
  }
  const den=Math.max(1e-12,sw);
  return {mean:sum/den,max,rain:rain/den,snow:snow/den,ocean:ocean/den};
}

if(typeof precipApply==='function'){
  const precipApplyBeforeDeepCoupling=precipApply;
  precipApply=function(core,dtSec,climate){
    const base=precipApplyBeforeDeepCoupling(core,dtSec,climate);
    const extra=deepConvectivePrecipAssist(core,dtSec,climate);
    if(!(extra>0)) return base;
    return deepPrecipStats(core);
  };
}

function deepCoupleVerticalColumn(core,climate){
  if(!core?.deepConvectiveState||!core?.cloudTopHeightM||typeof verticalPartitionCloud!=='function') return core;
  for(let i=0;i<core.count;i++){
    const d=deepCoupleClamp(core.deepConvectiveState[i],0,1);
    if(d<0.01) continue;
    const H=deepScaleHeightM(core,i,climate);
    const base=deepCoupleClamp(core.cloudBaseHeightM[i],0,DEEP_MAX_TOP_SCALE*H);
    const target=deepCoupleClamp(core.deepConvectiveTopTargetM[i],base,DEEP_MAX_TOP_SCALE*H);
    const oldTop=deepCoupleClamp(core.cloudTopHeightM[i],base,DEEP_MAX_TOP_SCALE*H);
    const top=Math.max(oldTop,base+(target-base)*(0.42+0.58*d));
    core.cloudTopHeightM[i]=top;
    core.convectiveIndex[i]=Math.max(core.convectiveIndex[i],deepCoupleClamp(0.22+0.78*d,0,1));
    core.bulkStabilityIndex[i]=Math.min(core.bulkStabilityIndex[i],deepCoupleClamp(1-0.82*d,0,1));
    const p0=Math.max(1,Number(core.pressure?.[i])||Math.max(1,Number(climate?.pressureBar)||1)*1e5);
    core.cloudTopPressurePa[i]=p0*Math.exp(-top/H);
    verticalPartitionCloud(core,i,{H,base,top});
  }
  return core;
}

const weatherCoreCreateBeforeDeepCoupling=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeDeepCoupling(seed,N,climate,axis);
  core.deepConvectionCouplingModel=DEEP_COUPLING_MODEL;
  deepCoupleVerticalColumn(core,climate);
  return core;
};

const weatherCoreStepBeforeDeepCoupling=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeDeepCoupling(core,dtSec,climate,axis);
  deepCoupleVerticalColumn(core,climate);
  return core;
};

const weatherCoreFiniteBeforeDeepCoupling=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeDeepCoupling(core)) return false;
  for(let i=0;i<core.count;i++){
    const layers=core.cloudLowMass[i]+core.cloudMidMass[i]+core.cloudHighMass[i];
    if(Math.abs(layers-Math.max(0,core.cloudWaterState[i]))>2e-4) return false;
  }
  return true;
};
