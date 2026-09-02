/* ============ 0.5.130: resolved lifting -> physical cloud condensation ============ */
/*
   Earth-like cloud climatology cannot be reproduced by requiring an entire
   near-surface column to become supersaturated before any cloud can form.
   Mid-latitude fronts and cyclones routinely lift air that is only moderately
   humid at the surface; adiabatic cooling carries a fractional ascending
   parcel through its lifting-condensation level (LCL), creating cloud water.

   The dynamics needed for this already exist in Weather Core:
     - frontVerticalVelocity / frontStrength;
     - systemVerticalVelocity / cycloneStrength;
     - orographicVerticalVelocity / orographicRoughness.
   This module closes that missing microphysical link. It does NOT add a
   latitude cloud belt. Geography still comes entirely from resolved weather,
   moisture and terrain. Subtropical/anticyclonic subsidence suppresses the
   coupling, while overlap with deep convection is reduced to avoid double
   counting the plume microphysics in deep-convection-coupling.js.
*/

const RESOLVED_LIFT_CLOUD_MODEL=1;
const RLC_DRY_LAPSE_K_M=0.0098;
const RLC_MOIST_LAPSE_K_M=0.0060;
const RLC_RESIDENCE_SEC=2100.0;
const RLC_MAX_DEPTH_H=0.70;
const RLC_CONDENSE_TAU_SEC=1500.0;
const RLC_MAX_CONDENSE_KG_M2_S=3.5e-4;
const RLC_MIN_RH=0.40;

function rlcClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function rlcSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=rlcClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function rlcEnsureFields(core){
  if(!core?.count)return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['resolvedLiftCloudPotential','resolvedLiftCloudArea','resolvedLiftCloudDepthM','resolvedLiftCondensationRate'])f32(k);
  core.resolvedLiftCloudModel=RESOLVED_LIFT_CLOUD_MODEL;
  return core;
}
function rlcRelativeHumidity(core,i,climate){
  const direct=Number(core?.relativeHumidity?.[i]);
  if(Number.isFinite(direct))return rlcClamp(direct,0,2.5);
  const vapor=Math.max(0,Number(core?.vaporColumn?.[i])||0);
  const T=rlcClamp(core?.airTemp?.[i]??climate?.T??288.15,80,1400);
  const sat=(typeof h2oSaturationColumnKgM2==='function')?Math.max(1e-9,h2oSaturationColumnKgM2(T,climate)):1;
  return rlcClamp(vapor/sat,0,2.5);
}
function rlcScaleHeightM(core,i,climate){
  if(typeof verticalScaleHeightM==='function')return rlcClamp(verticalScaleHeightM(core,i,climate),500,120000);
  const direct=Number(core?.scaleHeight?.[i]);
  if(Number.isFinite(direct)&&direct>0)return rlcClamp(direct,500,120000);
  return 8400;
}
function rlcLclHeightM(T,rh,H){
  if(typeof verticalLclHeightM==='function')return rlcClamp(verticalLclHeightM(T,rh,H),0,1.8*H);
  /* Bolton/Magnus is already used by vertical-stability; this fallback keeps
     tests/older snapshots self-contained without introducing a second climate. */
  const tc=rlcClamp(T-273.15,-80,60),q=rlcClamp(rh,1e-6,1),a=17.625,b=243.04;
  const gamma=Math.log(q)+a*tc/(b+tc),td=b*gamma/(a-gamma);
  return rlcClamp(125*Math.max(0,T-(td+273.15)),0,1.8*H);
}
function rlcLiftGeometry(core,i,H){
  const frontW=Math.max(0,Number(core?.frontVerticalVelocity?.[i])||0);
  const systemW=Number(core?.systemVerticalVelocity?.[i])||0;
  const systemUp=Math.max(0,systemW),systemDown=Math.max(0,-systemW);
  const oroW=Math.max(0,Number(core?.orographicVerticalVelocity?.[i])||0);
  const front=rlcClamp(core?.frontStrength?.[i],0,1);
  const cyclone=rlcClamp(core?.cycloneStrength?.[i],0,1);
  const rough=rlcClamp(core?.orographicRoughness?.[i],0,1);

  const up=frontW+systemUp+oroW;
  const kinematic=up*RLC_RESIDENCE_SEC;
  const structural=H*(0.24*front+0.18*cyclone+0.10*Math.max(rough,rlcSmooth(0.02,0.65,oroW)));
  const depth=rlcClamp(Math.max(kinematic,structural),0,RLC_MAX_DEPTH_H*H);

  const frontArea=front>0.02?0.05+0.40*front:0;
  const cycloneArea=cyclone>0.02?0.03+0.28*cyclone:0;
  const oroSignal=Math.max(rough,rlcSmooth(0.02,0.70,oroW));
  const oroArea=oroSignal>0.03?0.02+0.17*oroSignal:0;
  let area=1-(1-frontArea)*(1-cycloneArea)*(1-oroArea);
  /* Persistent descent is the physical counterpart of clear subtropical high
     pressure: it erodes the fractional ascending area instead of applying a
     hard latitude mask. */
  const subsidence=rlcSmooth(0.03,0.50,systemDown);
  area*=1-0.90*subsidence;
  return {depth,area:rlcClamp(area,0,0.72),up,systemDown,front,cyclone,rough};
}
function rlcParcelTemperatureK(T,lcl,depth){
  const below=Math.min(Math.max(0,depth),Math.max(0,lcl));
  const above=Math.max(0,depth-below);
  return rlcClamp(T-RLC_DRY_LAPSE_K_M*below-RLC_MOIST_LAPSE_K_M*above,150,1400);
}

function resolvedLiftCondensationAssist(core,dtSec,climate){
  if(!core?.cloudWaterState||!core?.vaporColumn||!core?.airTemp)return {condensed:0,latentK:0};
  rlcEnsureFields(core);
  const dt=rlcClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  core.resolvedLiftCondensationRate.fill(0);
  if(!(dt>0))return {condensed:0,latentK:0};
  const response=1-Math.exp(-dt/RLC_CONDENSE_TAU_SEC);
  let condensed=0,latentK=0;

  for(let i=0;i<core.count;i++){
    core.resolvedLiftCloudPotential[i]=0;core.resolvedLiftCloudArea[i]=0;core.resolvedLiftCloudDepthM[i]=0;
    const rh=rlcRelativeHumidity(core,i,climate);
    if(rh<RLC_MIN_RH)continue;
    const H=rlcScaleHeightM(core,i,climate),g=rlcLiftGeometry(core,i,H);
    if(g.area<0.01||g.depth<120)continue;
    const T=rlcClamp(core.airTemp[i],80,1400),lcl=rlcLclHeightM(T,rh,H);
    const reach=rlcSmooth(Math.max(80,lcl*0.55),Math.max(180,lcl+0.18*H),g.depth);
    if(reach<0.01)continue;

    const moisture=rlcSmooth(RLC_MIN_RH,0.78,rh);
    const deep=rlcClamp(core?.deepConvectiveState?.[i],0,1);
    const deepGate=1-0.68*deep;
    const area=rlcClamp(g.area*(0.22+0.78*moisture)*deepGate,0,0.66);
    if(area<0.005)continue;

    const parcelT=rlcParcelTemperatureK(T,lcl,g.depth);
    const vapor=Math.max(0,Number(core.vaporColumn[i])||0);
    const satLift=Math.max(1e-9,h2oSaturationColumnKgM2(parcelT,climate));
    const excess=Math.max(0,area*(vapor-satLift));
    const potential=rlcClamp(area*reach*moisture,0,1);
    core.resolvedLiftCloudPotential[i]=potential;
    core.resolvedLiftCloudArea[i]=area;
    core.resolvedLiftCloudDepthM[i]=g.depth;
    if(!(excess>0))continue;

    const dm=Math.min(vapor,RLC_MAX_CONDENSE_KG_M2_S*dt,excess*response*reach);
    if(!(dm>0))continue;
    core.vaporColumn[i]=vapor-dm;
    core.cloudWaterState[i]=Math.max(0,Number(core.cloudWaterState[i])||0)+dm;
    core.resolvedLiftCondensationRate[i]=dm/Math.max(1,dt);
    const aw=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
    condensed+=dm*aw;
    if(typeof condApplyLatentHeat==='function')latentK+=Math.abs(condApplyLatentHeat(core,i,dm,climate));
  }
  return {condensed,latentK};
}

/* The older condensation weather wrapper looks up condPhaseChange dynamically.
   We therefore extend the authoritative phase exchange without adding another
   weather tick or touching render FPS. */
if(typeof condPhaseChange==='function'){
  const condPhaseChangeBeforeResolvedLift=condPhaseChange;
  condPhaseChange=function(core,dtSec,climate){
    const base=condPhaseChangeBeforeResolvedLift(core,dtSec,climate);
    const extra=resolvedLiftCondensationAssist(core,dtSec,climate);
    if(extra.condensed>0){base.condensed+=extra.condensed;base.latentK+=extra.latentK;}
    return base;
  };
}

/* Keep the visual morphology coupled to the new physical diagnosis. This does
   not manufacture cloud pixels: it only prevents the deliberately slow visual
   response from immediately treating a dynamically lifting, physically cloudy
   cell as a dry disperser because its coarse-grid surface RH is below 0.78. */
if(typeof cloudVisualWeights==='function'){
  const cloudVisualWeightsBeforeResolvedLift=cloudVisualWeights;
  cloudVisualWeights=function(core,i){
    const w=cloudVisualWeightsBeforeResolvedLift(core,i);
    const p=rlcClamp(core?.resolvedLiftCloudPotential?.[i],0,1);
    const r=rlcClamp(core?.resolvedLiftCondensationRate?.[i],0,1);
    const active=Math.max(p,rlcSmooth(1e-7,4e-5,r));
    if(active<=0)return w;
    w.growth=rlcClamp(w.growth+0.30*active,0,1);
    w.diss=rlcClamp(w.diss*(1-0.58*active),0,1);
    w.moist=Math.max(w.moist,0.52*active);
    return w;
  };
}

const weatherCoreCreateBeforeResolvedLiftClouds=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeResolvedLiftClouds(seed,N,climate,axis);
  rlcEnsureFields(core);return core;
};
const weatherCoreFiniteBeforeResolvedLiftClouds=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeResolvedLiftClouds(core))return false;
  for(const k of ['resolvedLiftCloudPotential','resolvedLiftCloudArea','resolvedLiftCloudDepthM','resolvedLiftCondensationRate']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i])||a[i]<0)return false;
  }
  return true;
};

if(typeof window!=='undefined')window.__madPlanetResolvedLiftClouds={
  model:RESOLVED_LIFT_CLOUD_MODEL,
  assist:resolvedLiftCondensationAssist,
  liftGeometry:rlcLiftGeometry,
  parcelTemperatureK:rlcParcelTemperatureK
};
