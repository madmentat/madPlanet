/* ============ 0.5.60: physical snow / land ice / sea ice ============ */
/*
   The cryosphere is now a persistent Weather Core state rather than a latitude
   mask in the surface shader. Snowfall already lands in surfaceSnowWater;
   this module owns its melt, slow conversion to persistent land ice, freezing
   of landed liquid water and sea-ice growth/melt from SST with latent heat.

   Albedo feedback uses the previous fixed-tick cryosphere state during the
   next radiative step (operator split). No renderer value can create ice.
*/

const CRYOSPHERE_MODEL=1;
const CRYO_FREEZE_K=273.15;
const CRYO_SEA_FREEZE_K=271.35;
const CRYO_LATENT_HEAT_FUSION=3.34e5;        /* J kg^-1 */
const CRYO_ICE_DENSITY=917.0;                /* kg m^-3 */
const CRYO_SNOW_OPAQUE_SCALE_KG_M2=12.0;
const CRYO_LAND_ICE_COVER_SCALE_KG_M2=180.0;
const CRYO_LAND_ICE_COMPACT_TAU_SEC=28*86400;
const CRYO_LAND_ICE_COMPACT_MIN_SNOW=55.0;
const CRYO_SEA_ICE_MAX_M=6.0;
const CRYO_SEA_ICE_GROW_M_DAY=0.14;
const CRYO_SEA_ICE_MELT_M_DAY=0.32;
const CRYO_SEA_ICE_COVER_SCALE_M=0.075;

function cryoClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function cryoSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=cryoClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function cryoWaterFraction(core,i){return cryoClamp(core?.surfaceWaterFraction?.[i]||0,0,1);}
function cryoLandFraction(core,i){return 1-cryoWaterFraction(core,i);}
function cryoSnowCover(m){return cryoClamp(1-Math.exp(-Math.max(0,Number(m)||0)/CRYO_SNOW_OPAQUE_SCALE_KG_M2),0,1);}
function cryoLandIceCover(m){return cryoClamp(1-Math.exp(-Math.max(0,Number(m)||0)/CRYO_LAND_ICE_COVER_SCALE_KG_M2),0,1);}
function cryoSeaIceCover(h){return cryoClamp(1-Math.exp(-Math.max(0,Number(h)||0)/CRYO_SEA_ICE_COVER_SCALE_M),0,1);}

function cryoEnsureFields(core){
  if(!core?.count)return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['landIceWater','snowCoverFraction','landIceCoverFraction','seaIceThicknessM','seaIceConcentration','surfaceCryoFraction'])f32(k);
  if(!core.cryoOpenWaterScratch||core.cryoOpenWaterScratch.length!==n)core.cryoOpenWaterScratch=new Float32Array(n);
  core.cryosphereModel=CRYOSPHERE_MODEL;
  return core;
}
function cryoRefreshCovers(core){
  for(let i=0;i<core.count;i++){
    const snow=cryoSnowCover(core.surfaceSnowWater?.[i]);
    const landIce=cryoLandIceCover(core.landIceWater[i]);
    const seaIce=cryoSeaIceCover(core.seaIceThicknessM[i]);
    core.snowCoverFraction[i]=snow;
    core.landIceCoverFraction[i]=landIce;
    core.seaIceConcentration[i]=seaIce;
    const w=cryoWaterFraction(core,i);
    core.surfaceCryoFraction[i]=cryoClamp((1-w)*Math.max(snow,landIce)+w*seaIce,0,1);
  }
  return core;
}
function cryoInitialize(core){
  if(!core?.count)return core;
  cryoEnsureFields(core);
  /* Do not paint a precomputed polar cap on creation. The world starts from
     its current hydrological stores and the cryosphere grows with real model
     time. This deliberately avoids the old instant latitude mask. */
  core.landIceWater.fill(0);core.seaIceThicknessM.fill(0);
  cryoRefreshCovers(core);
  core.cryoSnowMeltKg=0;core.cryoLandIceMeltKg=0;core.cryoSeaIceMean=0;
  return core;
}

/* 0.5.45's temperature-timescale snow melt becomes obsolete once latent heat
   is resolved here. Precipitation still owns snowfall accumulation. */
if(typeof precipMeltSurfaceSnow==='function'){
  precipMeltSurfaceSnow=function(core,dtSec){
    if(core?.surfaceMeltRate)core.surfaceMeltRate.fill(0);
    return 0;
  };
}

/* Persistent land ice is part of the landed H2O store. Extend the mobile H2O
   closure dynamically without changing precipitation's ownership of rain/snow. */
if(typeof precipAreaMeanStore==='function'){
  precipAreaMeanStore=function(core){
    if(!core?.surfaceLiquidWater||!core?.surfaceSnowWater)return 0;
    let sw=0,sum=0;
    for(let i=0;i<core.count;i++){
      const w=Math.max(1e-12,core.areaWeight?.[i]||1);sw+=w;
      sum+=w*(Math.max(0,core.surfaceLiquidWater[i])+Math.max(0,core.surfaceSnowWater[i])+Math.max(0,core.landIceWater?.[i]||0));
    }
    return sum/Math.max(1e-12,sw);
  };
}
if(typeof precipScaleSurfaceStore==='function'){
  precipScaleSurfaceStore=function(core,scale){
    scale=Math.max(0,Number(scale)||0);if(!core?.surfaceLiquidWater)return;
    for(let i=0;i<core.count;i++){
      core.surfaceLiquidWater[i]=Math.max(0,core.surfaceLiquidWater[i]*scale);
      core.surfaceSnowWater[i]=Math.max(0,core.surfaceSnowWater[i]*scale);
      if(core.landIceWater)core.landIceWater[i]=Math.max(0,core.landIceWater[i]*scale);
    }
  };
}

/* Sea ice blocks evaporation from the covered fraction. Temporarily expose an
   open-water fraction to the existing evaporation chain, then restore the
   authoritative geography array. No allocation occurs in the fixed tick. */
if(typeof h2oApplyEvaporation==='function'){
  const h2oApplyEvaporationBeforeCryosphere=h2oApplyEvaporation;
  h2oApplyEvaporation=function(core,dtSec,climate){
    if(!core?.seaIceConcentration||!core?.surfaceWaterFraction)return h2oApplyEvaporationBeforeCryosphere(core,dtSec,climate);
    cryoEnsureFields(core);
    const original=core.surfaceWaterFraction,scratch=core.cryoOpenWaterScratch;
    for(let i=0;i<core.count;i++)scratch[i]=original[i]*(1-cryoClamp(core.seaIceConcentration[i],0,1));
    core.surfaceWaterFraction=scratch;
    try{return h2oApplyEvaporationBeforeCryosphere(core,dtSec,climate);}
    finally{core.surfaceWaterFraction=original;}
  };
}

/* Feed physical snow/ice albedo into the existing local-energy/cloud-radiative
   code without changing their APIs. localEnergyFluxes supplies the cell
   direction, which maps exactly back to the cubed-sphere storage index. */
let cryoAlbedoContext=NaN,cryoActiveCore=null;
function cryoIndexForDir(core,dx,dy,dz){
  if(!core?.N)return -1;
  const ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz);let face,u,v,m;
  if(ax>=ay&&ax>=az){
    if(dx>=0){face=0;m=dx;u=-dz/m;v=dy/m;}
    else{face=1;m=-dx;u=dz/m;v=dy/m;}
  }else if(ay>=ax&&ay>=az){
    if(dy>=0){face=2;m=dy;u=dx/m;v=-dz/m;}
    else{face=3;m=-dy;u=dx/m;v=dz/m;}
  }else{
    if(dz>=0){face=4;m=dz;u=dx/m;v=dy/m;}
    else{face=5;m=-dz;u=-dx/m;v=dy/m;}
  }
  const N=core.N,x=Math.max(0,Math.min(N-1,Math.floor((u+1)*0.5*N)));
  const y=Math.max(0,Math.min(N-1,Math.floor((v+1)*0.5*N)));
  return face*N*N+y*N+x;
}
function cryoPhysicalClearAlbedo(T,c,f){
  f=cryoClamp(f,0,1);
  const iceA=(typeof localEnergyIceAlbedo==='function')?localEnergyIceAlbedo(c):0.62;
  let nonIce=0.20;
  if(typeof cloudRadClearGlobalAlbedo==='function'){
    const globalClear=Number.isFinite(c?.clearSkyAlbedo)?cryoClamp(c.clearSkyAlbedo,0.03,0.86):cloudRadClearGlobalAlbedo(c);
    const globalIce=cryoClamp(c?.iceArea||0,0,0.98);
    nonIce=cryoClamp((globalClear-globalIce*iceA)/Math.max(0.02,1-globalIce),0.04,0.72);
  }else if(typeof localEnergyNonIceAlbedo==='function')nonIce=localEnergyNonIceAlbedo(c);
  return cryoClamp(nonIce*(1-f)+iceA*f,0.03,0.92);
}
if(typeof localEnergyCellAlbedo==='function'){
  const localEnergyCellAlbedoBeforeCryosphere=localEnergyCellAlbedo;
  localEnergyCellAlbedo=function(T,cloudWater,c){
    if(Number.isFinite(cryoAlbedoContext))return cryoPhysicalClearAlbedo(T,c,cryoAlbedoContext);
    return localEnergyCellAlbedoBeforeCryosphere(T,cloudWater,c);
  };
}
if(typeof localEnergyFluxes==='function'){
  const localEnergyFluxesBeforeCryosphere=localEnergyFluxes;
  localEnergyFluxes=function(T,cloudWater,dx,dy,dz,axis,c,out){
    const prev=cryoAlbedoContext;
    if(cryoActiveCore?.surfaceCryoFraction){
      const i=cryoIndexForDir(cryoActiveCore,dx,dy,dz);
      cryoAlbedoContext=i>=0?cryoActiveCore.surfaceCryoFraction[i]:NaN;
    }
    try{return localEnergyFluxesBeforeCryosphere(T,cloudWater,dx,dy,dz,axis,c,out);}
    finally{cryoAlbedoContext=prev;}
  };
}
if(typeof cloudRadCellForcing==='function'){
  const cloudRadCellForcingBeforeCryosphere=cloudRadCellForcing;
  cloudRadCellForcing=function(core,i,climate,out){
    const prev=cryoAlbedoContext;
    cryoAlbedoContext=Number(core?.surfaceCryoFraction?.[i]);
    try{return cloudRadCellForcingBeforeCryosphere(core,i,climate,out);}
    finally{cryoAlbedoContext=prev;}
  };
}

function cryoMeltLand(core,i,energyJ){
  let E=Math.max(0,energyJ),snowMelt=0,iceMelt=0;
  if(E>0&&core.surfaceSnowWater){
    const snow=Math.max(0,core.surfaceSnowWater[i]);
    const dm=Math.min(snow,E/CRYO_LATENT_HEAT_FUSION);
    if(dm>0){core.surfaceSnowWater[i]=snow-dm;core.surfaceLiquidWater[i]+=dm;E-=dm*CRYO_LATENT_HEAT_FUSION;snowMelt+=dm;}
  }
  if(E>0){
    const ice=Math.max(0,core.landIceWater[i]);
    const dm=Math.min(ice,E/CRYO_LATENT_HEAT_FUSION);
    if(dm>0){core.landIceWater[i]=ice-dm;core.surfaceLiquidWater[i]+=dm;E-=dm*CRYO_LATENT_HEAT_FUSION;iceMelt+=dm;}
  }
  return {left:E,snow:snowMelt,ice:iceMelt};
}
function cryoStepLand(core,dtSec){
  const dt=Math.max(0,Number(dtSec)||0),cap=1.6e7;
  let snowMelt=0,iceMelt=0;
  for(let i=0;i<core.count;i++){
    const land=cryoLandFraction(core,i);if(land<0.001)continue;
    let T=Number(core.landSurfaceTemp?.[i]??core.surfaceTemp[i])||CRYO_FREEZE_K;
    if(T>CRYO_FREEZE_K&&(core.surfaceSnowWater[i]>0||core.landIceWater[i]>0)){
      const warmE=cap*(T-CRYO_FREEZE_K);
      const m=cryoMeltLand(core,i,warmE);snowMelt+=m.snow*land;iceMelt+=m.ice*land;
      T=CRYO_FREEZE_K+m.left/cap;
    }
    if(T<CRYO_FREEZE_K&&core.surfaceLiquidWater[i]>0){
      const coldE=cap*(CRYO_FREEZE_K-T);
      const dm=Math.min(core.surfaceLiquidWater[i],coldE/CRYO_LATENT_HEAT_FUSION);
      if(dm>0){core.surfaceLiquidWater[i]-=dm;core.landIceWater[i]+=dm;T+=dm*CRYO_LATENT_HEAT_FUSION/cap;}
    }
    const snow=Math.max(0,core.surfaceSnowWater[i]);
    if(snow>CRYO_LAND_ICE_COMPACT_MIN_SNOW&&T<270.5){
      const cold=1-cryoSmooth(266.5,271.5,T);
      const frac=(1-Math.exp(-dt/CRYO_LAND_ICE_COMPACT_TAU_SEC))*cold;
      const dm=Math.min(snow-CRYO_LAND_ICE_COMPACT_MIN_SNOW*0.35,snow*frac);
      if(dm>0){core.surfaceSnowWater[i]-=dm;core.landIceWater[i]+=dm;}
    }
    if(core.landSurfaceTemp)core.landSurfaceTemp[i]=cryoClamp(T,80,1600);
  }
  core.cryoSnowMeltKg=snowMelt;core.cryoLandIceMeltKg=iceMelt;
}
function cryoStepSea(core,dtSec){
  const dt=Math.max(0,Number(dtSec)||0);
  const growCap=CRYO_SEA_ICE_GROW_M_DAY*dt/86400;
  const meltCap=CRYO_SEA_ICE_MELT_M_DAY*dt/86400;
  let sw=0,si=0;
  for(let i=0;i<core.count;i++){
    const w=cryoWaterFraction(core,i);if(w<0.01)continue;
    const cap=Math.max(1e6,Number(core.oceanHeatCapacity?.[i])||1.4e8);
    let T=Number(core.seaSurfaceTemp?.[i]??core.surfaceTemp[i])||CRYO_SEA_FREEZE_K;
    let h=Math.max(0,core.seaIceThicknessM[i]);
    if(T<CRYO_SEA_FREEZE_K&&h<CRYO_SEA_ICE_MAX_M){
      const deficit=cap*(CRYO_SEA_FREEZE_K-T);
      const dhEnergy=deficit/(CRYO_ICE_DENSITY*CRYO_LATENT_HEAT_FUSION);
      const dh=Math.min(CRYO_SEA_ICE_MAX_M-h,growCap,Math.max(0,dhEnergy));
      if(dh>0){h+=dh;T+=dh*CRYO_ICE_DENSITY*CRYO_LATENT_HEAT_FUSION/cap;}
    }else if(T>CRYO_SEA_FREEZE_K&&h>0){
      const warmE=cap*(T-CRYO_SEA_FREEZE_K);
      const dhEnergy=warmE/(CRYO_ICE_DENSITY*CRYO_LATENT_HEAT_FUSION);
      const dh=Math.min(h,meltCap,Math.max(0,dhEnergy));
      if(dh>0){h-=dh;T-=dh*CRYO_ICE_DENSITY*CRYO_LATENT_HEAT_FUSION/cap;}
    }
    core.seaIceThicknessM[i]=cryoClamp(h,0,CRYO_SEA_ICE_MAX_M);
    if(core.seaSurfaceTemp)core.seaSurfaceTemp[i]=cryoClamp(T,80,1600);
    sw+=w;si+=w*cryoSeaIceCover(h);
  }
  core.cryoSeaIceMean=si/Math.max(1e-12,sw);
}
function cryoPublishSurface(core){
  if(typeof oceanPublishSurface==='function')oceanPublishSurface(core);
  else for(let i=0;i<core.count;i++){
    const w=cryoWaterFraction(core,i),land=Number(core.landSurfaceTemp?.[i]??core.surfaceTemp[i]),sea=Number(core.seaSurfaceTemp?.[i]??core.surfaceTemp[i]);
    core.surfaceTemp[i]=land*(1-w)+sea*w;
  }
  cryoRefreshCovers(core);
  return core;
}
function cryoStep(core,dtSec){
  if(!core?.count)return core;cryoEnsureFields(core);
  cryoStepLand(core,dtSec);cryoStepSea(core,dtSec);return cryoPublishSurface(core);
}

const weatherCoreCreateBeforeCryosphere=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeCryosphere(seed,N,climate,axis);return cryoInitialize(core);
};
const weatherCoreStepBeforeCryosphere=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core?.count)return core;
  cryoActiveCore=core;
  try{weatherCoreStepBeforeCryosphere(core,dtSec,climate,axis);}finally{cryoActiveCore=null;}
  return cryoStep(core,dtSec);
};
const weatherCoreFiniteBeforeCryosphere=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeCryosphere(core))return false;
  for(const k of ['landIceWater','snowCoverFraction','landIceCoverFraction','seaIceThicknessM','seaIceConcentration','surfaceCryoFraction']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i])||a[i]<0)return false;
  }
  return true;
};
function cryoDiagnostics(core){
  if(!core?.surfaceCryoFraction)return {snow:NaN,landIce:NaN,seaIce:NaN,thick:NaN};
  let ws=0,snow=0,landIce=0,seaW=0,seaIce=0,thick=0;
  for(let i=0;i<core.count;i++){
    const a=Math.max(1e-12,core.areaWeight?.[i]||1),w=cryoWaterFraction(core,i),l=1-w;ws+=a;
    snow+=a*l*core.snowCoverFraction[i];landIce+=a*l*core.landIceCoverFraction[i];
    seaW+=a*w;seaIce+=a*w*core.seaIceConcentration[i];thick+=a*w*core.seaIceThicknessM[i];
  }
  return {snow:snow/Math.max(1e-12,ws),landIce:landIce/Math.max(1e-12,ws),seaIce:seaIce/Math.max(1e-12,seaW),thick:thick/Math.max(1e-12,seaW)};
}
if(typeof createPanel==='function'){
  const createPanelBeforeCryosphere=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeCryosphere(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-cryo="cover"]')){
        appendWeatherCoreRow(box,'Снег / land ice','cryo-cover');
        const a=box.lastElementChild?.querySelector('[data-weathercore="cryo-cover"]');if(a){delete a.dataset.weathercore;a.dataset.cryo='cover';}
        appendWeatherCoreRow(box,'Sea ice / толщина','cryo-sea');
        const b=box.lastElementChild?.querySelector('[data-weathercore="cryo-sea"]');if(b){delete b.dataset.weathercore;b.dataset.cryo='sea';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeCryosphere=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeCryosphere();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.surfaceCryoFraction)return;
    const d=cryoDiagnostics(core),set=(k,v)=>{const e=box.querySelector('[data-cryo="'+k+'"]');if(e)e.textContent=v;};
    set('cover',(100*d.snow).toFixed(1)+'% / '+(100*d.landIce).toFixed(1)+'%');
    set('sea',(100*d.seaIce).toFixed(1)+'% · '+d.thick.toFixed(2)+' м');
  };
}
