/* ============ 0.5.123 / 0.5.125: surface skin + plateau/mountain thermodynamics ============ */
/*
   Weather Core historically exposed one surfaceTemp field for several distinct
   reservoirs. Over open ocean that is appropriate SST, but under sea ice the
   mixed layer remains close to the seawater freezing point while the radiating
   TOP of the ice can be tens of kelvin colder. Thermography therefore needs a
   separate visible/radiating surface skin.

   0.5.125 fixes a second structural omission exposed by thermography. The
   coarse climate previously derived elevation only from macroTerrain, which is
   the continent-scale land/ocean field and contains no tectonic mountain
   relief. wind-dynamics already computes orographicRoughness from the SAME
   plate geometry that creates visible mountain belts. Convert that resolved
   orographic proxy to physical relief and add it to the lapse-rate budget.
   Large mountain systems now cool the actual Weather Core; the renderer only
   adds a small sub-grid peak correction for relief finer than the 36-cell grid.
*/
const POLAR_SURFACE_THERMODYNAMICS_MODEL=2;
const PST_LAPSE_K_PER_KM=6.0;
const PST_TERRAIN_KM_PER_UNIT=8.0;
const PST_OROGRAPHIC_RELIEF_M=5200.0;
const PST_OROGRAPHIC_HEIGHT_SHARE=0.78;
const PST_ELEVATION_MAX_KM=9.0;
const PST_INVERSION_MAX_K=15.0;
const PST_OFFSET_MAX_K=48.0;
const PST_LAND_HEAT_CAPACITY=1.6e7;
const PST_ICE_CONDUCTION_SCALE_M=0.45;
const PST_ICE_RADIATIVE_DROP_MAX_K=6.0;
const PST_ICE_SKIN_MIN_K=150.0;
const PST_POLAR_DIAG_SIN75=0.9659258263;

function pstClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function pstSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=pstClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function pstWater(core,i){return pstClamp(core?.surfaceWaterFraction?.[i]||0,0,1);}
function pstAxis(axis){
  const a=axis||((typeof weatherCoreAxis==='function')?weatherCoreAxis():[0,1,0]);
  const q=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/q,a[1]/q,a[2]/q];
}
function pstSeaLevelProxy(){
  if(typeof ohtSeaLevelProxy==='function')return ohtSeaLevelProxy();
  if(typeof h2oSeaLevelProxy==='function')return h2oSeaLevelProxy();
  return 0;
}
function pstOrographicReliefKm(core,i){
  const rough=pstClamp(Number(core?.orographicRoughness?.[i])||0,0,1);
  const effectiveM=(typeof ORO_EFFECTIVE_RELIEF_M==='number'&&Number.isFinite(ORO_EFFECTIVE_RELIEF_M))
    ?ORO_EFFECTIVE_RELIEF_M:PST_OROGRAPHIC_RELIEF_M;
  return rough*effectiveM*PST_OROGRAPHIC_HEIGHT_SHARE/1000;
}
function pstElevationKm(core,i){
  const h=Number(core?.macroTerrain?.[i]);
  const baseKm=Number.isFinite(h)?Math.max(0,(h-pstSeaLevelProxy())*PST_TERRAIN_KM_PER_UNIT):0;
  /* orographicRoughness is a broad mountain-belt proxy, not metre-accurate
     topography. The 0.78 factor turns the existing 5.2 km effective relief
     used by orographic lift into a conservative mean ridge elevation. */
  const mountainKm=pstOrographicReliefKm(core,i);
  return pstClamp(baseKm+mountainKm,0,PST_ELEVATION_MAX_KM);
}
function pstPolarStrength(core,i,axis){
  const s=Math.abs(pstClamp(core.dirX[i]*axis[0]+core.dirY[i]*axis[1]+core.dirZ[i]*axis[2],-1,1));
  return pstSmooth(0.82,0.985,s); /* starts near 55 deg, full near 80 deg */
}
function pstDarkness(core,i){
  const d=Number(core?.dayLengthHours?.[i]);
  if(Number.isFinite(d))return pstClamp(1-d/24,0,1);
  return 0.5;
}
function pstClimateColdGate(climate){
  const T=Number.isFinite(Number(climate?.T))?Number(climate.T):288.15;
  return 1-pstSmooth(292,320,T); /* disappears on genuinely hot ice-free worlds */
}
function pstFeedbackWm2K(core){
  const x=Number(core?.ohtFeedbackWm2K);
  if(Number.isFinite(x)&&x>0)return pstClamp(x,1,12);
  let sa=0,so=0,st=0;
  for(let i=0;i<(core?.count||0);i++){
    const a=Math.max(1e-12,Number(core.areaWeight?.[i])||1),o=Number(core.outgoingLongwave?.[i]),T=Number(core.surfaceTemp?.[i]);
    if(Number.isFinite(o)&&Number.isFinite(T)&&T>0){sa+=a;so+=a*o;st+=a*T;}
  }
  return sa>0&&so>0&&st>0?pstClamp(4*(so/sa)/(st/sa),1,12):3.3;
}
function pstEnsure(core){
  if(!core?.count)return core;
  const n=core.count,f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['polarLandOffsetK','polarLandForcingWm2','surfaceSkinTemp','seaIceSkinTemp'])f32(k);
  core.polarSurfaceThermodynamicsModel=POLAR_SURFACE_THERMODYNAMICS_MODEL;
  return core;
}
function pstTargetLandOffsetK(core,i,climate,axis){
  const land=1-pstWater(core,i);if(land<0.001)return 0;
  const elevK=PST_LAPSE_K_PER_KM*pstElevationKm(core,i);
  const polar=pstPolarStrength(core,i,axis);
  const cold=pstClimateColdGate(climate);
  const dark=pstDarkness(core,i);
  const cryo=pstClamp(Math.max(Number(core?.snowCoverFraction?.[i])||0,Number(core?.landIceCoverFraction?.[i])||0),0,1);
  /* Stable polar boundary layer: even bare cold continental land has an
     inversion; snow/ice strengthens it. Darkness controls the seasonal part. */
  const inversion=PST_INVERSION_MAX_K*polar*cold*(0.55+0.45*dark)*(0.78+0.22*cryo);
  return -pstClamp(land*(elevK+inversion),0,PST_OFFSET_MAX_K);
}
function pstPublishSurface(core){
  if(typeof oceanPublishSurface==='function')oceanPublishSurface(core);
  else for(let i=0;i<core.count;i++){
    const w=pstWater(core,i),land=Number(core.landSurfaceTemp?.[i]??core.surfaceTemp[i]),sea=Number(core.seaSurfaceTemp?.[i]??core.surfaceTemp[i]);
    core.surfaceTemp[i]=land*(1-w)+sea*w;
  }
  return core;
}
function pstRefreshPolarBudget(core,climate,axis,bootstrap){
  if(!core?.count)return core;pstEnsure(core);axis=pstAxis(axis);
  const lambda=pstFeedbackWm2K(core);
  let maxOffset=0,maxElevation=0;
  for(let i=0;i<core.count;i++){
    const target=pstTargetLandOffsetK(core,i,climate,axis),old=Number(core.polarLandOffsetK[i])||0;
    const d=target-old;
    if(bootstrap||Math.abs(d)>1e-7){
      if(core.landSurfaceTemp&&(1-pstWater(core,i))>0.001)core.landSurfaceTemp[i]=pstClamp(core.landSurfaceTemp[i]+d,80,1600);
      if(core.airTemp)core.airTemp[i]=pstClamp(core.airTemp[i]+0.65*d,75,1600);
      core.polarLandOffsetK[i]=target;
    }
    core.polarLandForcingWm2[i]=lambda*target;
    maxOffset=Math.max(maxOffset,Math.abs(target));
    if((1-pstWater(core,i))>0.5)maxElevation=Math.max(maxElevation,pstElevationKm(core,i));
  }
  core.polarLandMaxOffsetK=maxOffset;core.surfaceMaxElevationKm=maxElevation;
  pstPublishSurface(core);return core;
}
function pstApplyPolarForcing(core,dtSec){
  if(!core?.polarLandForcingWm2||!core.landSurfaceTemp)return core;
  const dt=pstClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  if(!(dt>0))return core;
  for(let i=0;i<core.count;i++){
    const land=1-pstWater(core,i);if(land<0.001)continue;
    core.landSurfaceTemp[i]=pstClamp(core.landSurfaceTemp[i]+core.polarLandForcingWm2[i]*dt/PST_LAND_HEAT_CAPACITY,80,1600);
  }
  pstPublishSurface(core);return core;
}
function pstRefreshSkin(core,axis){
  if(!core?.count)return core;pstEnsure(core);axis=pstAxis(axis);
  let minK=Infinity,northMinK=Infinity,southMinK=Infinity,mountainMinK=Infinity;
  for(let i=0;i<core.count;i++){
    const w=pstWater(core,i);
    const landT=Number(core.landSurfaceTemp?.[i]??core.surfaceTemp[i])||273.15;
    const seaT=Number(core.seaSurfaceTemp?.[i]??core.surfaceTemp[i])||273.15;
    const airT=Number(core.airTemp?.[i]);
    const air=Number.isFinite(airT)?airT:seaT-6;
    const h=Math.max(0,Number(core.seaIceThicknessM?.[i])||0);
    const ice=pstClamp(Number(core.seaIceConcentration?.[i])||0,0,1);
    const coupling=Math.exp(-h/PST_ICE_CONDUCTION_SCALE_M);
    const base=Math.min(seaT,(typeof CRYO_SEA_FREEZE_K==='number'?CRYO_SEA_FREEZE_K:271.35));
    const dark=pstDarkness(core,i),polar=pstPolarStrength(core,i,axis);
    const radiativeDrop=PST_ICE_RADIATIVE_DROP_MAX_K*polar*dark*pstSmooth(0.08,0.8,h);
    let iceSkin=air+coupling*(base-air)-radiativeDrop;
    iceSkin=pstClamp(iceSkin,PST_ICE_SKIN_MIN_K,273.15);
    const seaSkin=seaT*(1-ice)+iceSkin*ice;
    const skin=landT*(1-w)+seaSkin*w;
    core.seaIceSkinTemp[i]=iceSkin;
    core.surfaceSkinTemp[i]=skin;
    minK=Math.min(minK,skin);
    const s=pstClamp(core.dirX[i]*axis[0]+core.dirY[i]*axis[1]+core.dirZ[i]*axis[2],-1,1);
    if(s>=PST_POLAR_DIAG_SIN75)northMinK=Math.min(northMinK,skin);
    if(s<=-PST_POLAR_DIAG_SIN75)southMinK=Math.min(southMinK,skin);
    if((1-w)>0.5&&pstElevationKm(core,i)>=2.0)mountainMinK=Math.min(mountainMinK,skin);
  }
  core.surfaceSkinMinK=Number.isFinite(minK)?minK:NaN;
  core.northPolarSkinMinK=Number.isFinite(northMinK)?northMinK:NaN;
  core.southPolarSkinMinK=Number.isFinite(southMinK)?southMinK:NaN;
  core.mountainSkinMinK=Number.isFinite(mountainMinK)?mountainMinK:NaN;
  return core;
}

/* OLR must see the radiating surface, not the water beneath sea ice. During
   the cryosphere-owned inner energy step cryoActiveCore identifies the current
   grid, so the previous tick's skin temperature can replace the legacy T. */
if(typeof localEnergyFluxes==='function'){
  const localEnergyFluxesBeforePolarSkin=localEnergyFluxes;
  localEnergyFluxes=function(T,cloudWater,dx,dy,dz,axis,c,out){
    let skin=NaN;
    if(typeof cryoActiveCore!=='undefined'&&cryoActiveCore?.surfaceSkinTemp&&typeof cryoIndexForDir==='function'){
      const i=cryoIndexForDir(cryoActiveCore,dx,dy,dz);
      if(i>=0)skin=Number(cryoActiveCore.surfaceSkinTemp[i]);
    }
    return localEnergyFluxesBeforePolarSkin(Number.isFinite(skin)?skin:T,cloudWater,dx,dy,dz,axis,c,out);
  };
}

/* User-facing broad "surface" diagnostics should follow the visible/radiating
   skin field. Ocean physics keeps authoritative SST in seaSurfaceTemp. */
if(typeof planetTemperatureBands==='function'){
  const planetTemperatureBandsBeforePolarSkin=planetTemperatureBands;
  planetTemperatureBands=function(core,axis){
    if(!core?.surfaceSkinTemp)return planetTemperatureBandsBeforePolarSkin(core,axis);
    const old=core.surfaceTemp;core.surfaceTemp=core.surfaceSkinTemp;
    try{return planetTemperatureBandsBeforePolarSkin(core,axis);}finally{core.surfaceTemp=old;}
  };
}

const weatherCoreCreateBeforePolarSurface=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforePolarSurface(seed,N,climate,axis);
  if(!core?.count)return core;
  pstEnsure(core);pstRefreshPolarBudget(core,climate,axis,true);pstRefreshSkin(core,axis);return core;
};
const weatherCoreStepBeforePolarSurface=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforePolarSurface(core,dtSec,climate,axis);
  if(!core?.count)return core;
  pstEnsure(core);pstRefreshPolarBudget(core,climate,axis,false);pstApplyPolarForcing(core,dtSec);pstRefreshSkin(core,axis);return core;
};
const weatherCoreFiniteBeforePolarSurface=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforePolarSurface(core))return false;
  for(const k of ['polarLandOffsetK','polarLandForcingWm2','surfaceSkinTemp','seaIceSkinTemp']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  return Number.isFinite(core.polarLandMaxOffsetK||0)&&Number.isFinite(core.surfaceMaxElevationKm||0);
};

window.__madPlanetPolarSurface={
  targetLandOffsetK:pstTargetLandOffsetK,refreshSkin:pstRefreshSkin,elevationKm:pstElevationKm,
  orographicReliefKm:pstOrographicReliefKm
};
