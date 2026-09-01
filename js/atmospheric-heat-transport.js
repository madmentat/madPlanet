/* ============ 0.5.113: meridional atmospheric heat transport + seasonal bootstrap ============ */
/*
   The local energy balance (0.5.40+) integrates absorbed sunlight minus OLR
   into every cell, but nothing ever moved heat between cells except a weak
   mixed-layer diffusion inside the ocean. A polar cell therefore relaxed
   toward its own radiative equilibrium, which for a pole is close to the
   80 K clamp: net radiation at both poles sat around -80..-150 W m^-2 for the
   whole session and the caps grew without limit, at +22 C just as at +15 C,
   and equally in both hemispheres.

   On a real planet that deficit is paid by the atmosphere (and ocean) carrying
   heat poleward: about -100 W m^-2 of TOA imbalance at Earth's poles is
   balanced by ~5 PW of transport. The classic energy-balance model represents
   this as diffusion of temperature, C dT/dt = ASR - OLR + D laplacian(T) with
   D ~ 0.55 W m^-2 K^-1 on Earth. This module adds exactly that term on the
   existing cubed-sphere edge graph, conservatively, with the diffusivity
   scaled by the atmospheric column heat capacity cp p / g: a thick atmosphere
   flattens the equator-pole contrast (Venus), a thin one cannot.

   The same physics fixes the "identical caps" symptom: a cold winter pole
   and a mild summer pole only exist if the surface actually responds to the
   current declination. Land needs ~30 simulated days to do so, so at core
   creation the steady seasonal anomaly is bootstrapped from the daily-mean
   insolation of the current orbital phase relative to its annual mean.
*/

const AHT_MODEL=1;
const AHT_DIFFUSIVITY_M2_S=2.2e6;      /* D_earth * R_earth^2 / C_atm(1 bar), moist Earth */
const AHT_CP_J_KG_K=1004.0;
const AHT_EARTH_H2O_BAR=0.0019;        /* reference water-vapour partial pressure of the calibration */
const AHT_LATENT_SHARE=1.67;           /* (L/cp) dq_sat/dT on Earth: latent vs sensible transport */
const AHT_MOIST_MAX=4.0;               /* cap on the latent enhancement */
const AHT_MAX_EDGE_MIX=0.12;           /* explicit-step stability cap per edge */
const AHT_LAND_HEAT_CAPACITY=1.6e7;
const AHT_SOLAR_CONSTANT=1361.0;
const AHT_SEASON_PHASES=24;
const AHT_SEASON_LAND_RESPONSE=0.75;
const AHT_SEASON_SEA_RESPONSE=0.12;
const AHT_SEASON_TRANSPORT_DAMPING_WM2K=1.1;
const AHT_SEASON_MAX_K=24.0;

function ahtClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function ahtWater(core,i){return ahtClamp(core?.surfaceWaterFraction?.[i]||0,0,1);}
function ahtGravity(climate){
  if(typeof baricGravityMS2==='function')return baricGravityMS2(climate);
  return 9.80665;
}
function ahtRadiusM(climate){
  if(typeof windPlanetRadiusM==='function')return windPlanetRadiusM(climate);
  return 6371000;
}
/* Atmospheric column heat capacity, J m^-2 K^-1 (1e7 for Earth). */
function ahtColumnHeatCapacity(climate){
  const p=Math.max(0,Number(climate?.pressureBar)||0)*1e5;
  return AHT_CP_J_KG_K*p/Math.max(0.05,ahtGravity(climate));
}
/* Moist static energy is what the atmosphere really diffuses: on Earth the
   latent part is ~1.7x the sensible part, and it scales with the water-vapour
   partial pressure. A drier or colder atmosphere transports less, a warmer
   and wetter one more, which is the latent-heat half of polar amplification.
   Normalized so that the Earth reference reproduces AHT_DIFFUSIVITY_M2_S. */
function ahtMoistFactor(climate){
  const r=ahtClamp((Number(climate?.h2oBar)||0)/AHT_EARTH_H2O_BAR,0,AHT_MOIST_MAX);
  return (1+AHT_LATENT_SHARE*r)/(1+AHT_LATENT_SHARE);
}
function ahtEnsure(core){
  if(!core?.count)return core;
  if(!core.ahtHeatDelta||core.ahtHeatDelta.length!==core.count)core.ahtHeatDelta=new Float64Array(core.count);
  if(!core.ahtSeasonAnomalyK||core.ahtSeasonAnomalyK.length!==core.count)core.ahtSeasonAnomalyK=new Float32Array(core.count);
  core.atmosphericHeatTransportModel=AHT_MODEL;
  return core;
}
/* Conservative diffusive exchange of surface heat along every edge. The edge
   conductance is kappa * C_atm (W K^-1) for the near-square cubed-sphere
   cells; the received energy is shared by the land skin and ocean mixed layer
   of a cell in proportion to their area, so total heat is exactly conserved. */
function ahtDiffuse(core,dtSec,climate){
  const edges=core?.h2oEdgeI?.length||0;
  if(!edges||!core.surfaceTemp)return 0;
  ahtEnsure(core);
  const dt=ahtClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  if(!(dt>0))return 0;
  const cAtm=ahtColumnHeatCapacity(climate);
  if(cAtm<=0)return 0;
  const R=ahtRadiusM(climate);
  let areaSum=0;
  for(let i=0;i<core.count;i++)areaSum+=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
  const sphere=4*Math.PI*R*R,delta=core.ahtHeatDelta;delta.fill(0);
  const conductance=AHT_DIFFUSIVITY_M2_S*ahtMoistFactor(climate)*cAtm*dt;  /* J K^-1 per step */
  let moved=0;
  for(let e=0;e<edges;e++){
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e];
    const dT=core.surfaceTemp[i]-core.surfaceTemp[j];
    if(Math.abs(dT)<1e-9)continue;
    const ai=sphere*Math.max(1e-12,Number(core.areaWeight?.[i])||1)/areaSum;
    const aj=sphere*Math.max(1e-12,Number(core.areaWeight?.[j])||1)/areaSum;
    const wi=ahtWater(core,i),wj=ahtWater(core,j);
    const ci=(AHT_LAND_HEAT_CAPACITY*(1-wi)+Math.max(1e6,Number(core.oceanHeatCapacity?.[i])||1.4e8)*wi)*ai;
    const cj=(AHT_LAND_HEAT_CAPACITY*(1-wj)+Math.max(1e6,Number(core.oceanHeatCapacity?.[j])||1.4e8)*wj)*aj;
    const q=dT*Math.min(conductance,AHT_MAX_EDGE_MIX*Math.min(ci,cj));
    delta[i]-=q;delta[j]+=q;moved+=Math.abs(q);
  }
  for(let i=0;i<core.count;i++){
    const d=delta[i];if(d===0)continue;
    const a=sphere*Math.max(1e-12,Number(core.areaWeight?.[i])||1)/areaSum;
    const perArea=d/a,w=ahtWater(core,i);
    if(core.landSurfaceTemp&&w<0.999)core.landSurfaceTemp[i]=ahtClamp(core.landSurfaceTemp[i]+perArea/AHT_LAND_HEAT_CAPACITY,80,1600);
    if(core.seaSurfaceTemp&&w>0.001)core.seaSurfaceTemp[i]=ahtClamp(core.seaSurfaceTemp[i]+perArea/Math.max(1e6,Number(core.oceanHeatCapacity?.[i])||1.4e8),80,1600);
    if(!core.landSurfaceTemp&&!core.seaSurfaceTemp)core.surfaceTemp[i]=ahtClamp(core.surfaceTemp[i]+perArea/AHT_LAND_HEAT_CAPACITY,80,1600);
  }
  return 0.5*moved;
}

/* Daily-mean top-of-atmosphere insolation for latitude/declination. */
function ahtDailyMeanInsolation(S0,latRad,decRad){
  const t=-Math.tan(latRad)*Math.tan(decRad);
  let H;if(t<=-1)H=Math.PI;else if(t>=1)H=0;else H=Math.acos(t);
  return Math.max(0,S0/Math.PI*(H*Math.sin(latRad)*Math.sin(decRad)+Math.cos(latRad)*Math.cos(decRad)*Math.sin(H)));
}
function ahtSeasonBootstrap(core,climate,axis){
  if(!core?.count||typeof seasonAxialTiltDeg!=='function'||typeof seasonOrbitPhaseRad!=='function'||typeof seasonDeclinationRadForPhase!=='function')return core;
  ahtEnsure(core);
  const tilt=seasonAxialTiltDeg(climate);
  const anomaly=core.ahtSeasonAnomalyK;anomaly.fill(0);
  if(!(tilt>0.05))return core;
  const S0=AHT_SOLAR_CONSTANT*Math.max(0,Number(climate?.S)||0);
  if(!(S0>0))return core;
  const phase=seasonOrbitPhaseRad(core.seed|0,core.simSeconds||0,climate);
  const decNow=seasonDeclinationRadForPhase(phase,tilt);
  const decs=[];for(let k=0;k<AHT_SEASON_PHASES;k++)decs.push(seasonDeclinationRadForPhase(2*Math.PI*(k+0.5)/AHT_SEASON_PHASES,tilt));
  const q=Math.hypot(axis[0],axis[1],axis[2])||1,ax=[axis[0]/q,axis[1]/q,axis[2]/q];
  /* Feedback of the resolved field plus the damping a hemispheric anomaly
     receives from the diffusive transport above. */
  let sa=0,so=0,st=0;
  for(let i=0;i<core.count;i++){
    const a=Math.max(1e-12,Number(core.areaWeight?.[i])||1),olr=Number(core.outgoingLongwave?.[i]),T=Number(core.surfaceTemp?.[i]);
    if(Number.isFinite(olr)&&Number.isFinite(T)&&T>0){sa+=a;so+=a*olr;st+=a*T;}
  }
  const lambda=(sa>0&&st>0?ahtClamp(4*(so/sa)/(st/sa),1,12):3.3)+AHT_SEASON_TRANSPORT_DAMPING_WM2K;
  for(let i=0;i<core.count;i++){
    const s=ahtClamp(core.dirX[i]*ax[0]+core.dirY[i]*ax[1]+core.dirZ[i]*ax[2],-1,1),lat=Math.asin(s);
    const now=ahtDailyMeanInsolation(S0,lat,decNow);
    let annual=0;for(let k=0;k<AHT_SEASON_PHASES;k++)annual+=ahtDailyMeanInsolation(S0,lat,decs[k]);
    annual/=AHT_SEASON_PHASES;
    const absorbed=(1-ahtClamp(Number(core.localAlbedo?.[i])||0.3,0.03,0.96))*(now-annual);
    const eq=ahtClamp(absorbed/lambda,-AHT_SEASON_MAX_K,AHT_SEASON_MAX_K);
    const w=ahtWater(core,i);
    const landK=eq*AHT_SEASON_LAND_RESPONSE,seaK=eq*AHT_SEASON_SEA_RESPONSE;
    if(core.landSurfaceTemp&&w<0.999)core.landSurfaceTemp[i]=ahtClamp(core.landSurfaceTemp[i]+landK,80,1600);
    if(core.seaSurfaceTemp&&w>0.001)core.seaSurfaceTemp[i]=ahtClamp(core.seaSurfaceTemp[i]+seaK,80,1600);
    const mixed=landK*(1-w)+seaK*w;
    if(core.airTemp)core.airTemp[i]=ahtClamp(core.airTemp[i]+mixed,75,1600);
    anomaly[i]=mixed;
  }
  core.ahtSeasonDeclinationDeg=decNow*180/Math.PI;
  return core;
}
function ahtPublish(core){
  if(typeof oceanPublishSurface==='function')oceanPublishSurface(core);
  if(typeof cryoRefreshCovers==='function')cryoRefreshCovers(core);
  return core;
}

const weatherCoreCreateBeforeAtmosphericTransport=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeAtmosphericTransport(seed,N,climate,axis);
  if(core?.count){ahtEnsure(core);ahtSeasonBootstrap(core,climate,axis||[0,1,0]);ahtPublish(core);}
  return core;
};
const weatherCoreStepBeforeAtmosphericTransport=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeAtmosphericTransport(core,dtSec,climate,axis);
  if(!core?.count)return core;
  ahtEnsure(core);
  core.ahtHeatMovedJ=ahtDiffuse(core,dtSec,climate);
  ahtPublish(core);
  return core;
};
const weatherCoreFiniteBeforeAtmosphericTransport=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeAtmosphericTransport(core))return false;
  const a=core?.ahtSeasonAnomalyK;if(!a||a.length!==core.count)return false;
  for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  return Number.isFinite(core.ahtHeatMovedJ||0);
};
