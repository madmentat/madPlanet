/* ============ 0.5.60 / 0.5.73 / 0.5.77: land snow/ice sublimation + seasonal freeze ============ */
/*
   Precipitation can move atmospheric H2O into surfaceSnowWater/landIceWater.
   Before this hotfix the cold branch had no vapour return path unless the
   surface warmed above melting, so polar storage could become a one-way sink.

   Sublimation is a strictly local phase transfer:
       snow/land ice -> vaporColumn
   It is allowed only when the near-surface air is undersaturated relative to
   a cold surface, is rate-limited, wind-assisted, and consumes latent heat
   from the land skin. No water is created and sea ice bulk mass remains in the
   unresolved ocean reservoir.

   0.5.73 repairs landed liquid: mild frost freezes only a seasonal skin at a
   daily rate cap; persistent glacier ice still requires slow compaction.

   0.5.77 separates sea-ice SURFACE CLOSURE from bulk thickness. Thickness may
   grow slowly because the ocean has huge thermal inertia, but an exposed
   Earth-like sea surface cannot remain visibly liquid tens or hundreds of
   kelvin below the seawater freezing point. A temperature floor therefore
   supplies the minimum concentration of a thin surface skin while the existing
   Stefan-like thickness path remains authoritative for metres of ice mass.
*/

const CRYO_SUBLIMATION_MODEL=1;
const CRYO_SUBLIMATION_TARGET_RH=0.74;
const CRYO_SUBLIMATION_SNOW_TAU_SEC=2.8*86400;
const CRYO_SUBLIMATION_ICE_TAU_SEC=16*86400;
const CRYO_SUBLIMATION_SNOW_MAX_KG_M2_S=2.0e-5;
const CRYO_SUBLIMATION_ICE_MAX_KG_M2_S=4.0e-6;
const CRYO_SUBLIMATION_LATENT_J_KG=2.83e6;
const CRYO_SUBLIMATION_LAND_CAP_J_M2_K=1.6e7;
const CRYO_LAND_SURFACE_FREEZE_MAX_KG_M2_DAY=18.0;
/* Typical Earth seawater starts freezing near 271.3 K. Close-up rendering
   needs a continuous surface-area response: barely supercooled water may show
   leads/frazil, but below about -15 C the exposed skin is effectively closed.
   This is coverage only; it does NOT create metres of hidden ice mass. */
const CRYO_SEA_SKIN_START_K=271.35;
const CRYO_SEA_SKIN_FULL_K=258.15;

function cryoSubClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function cryoSubSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=cryoSubClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function cryoSubEnsure(core){
  if(!core?.count)return core;
  if(!core.snowSublimationRate||core.snowSublimationRate.length!==core.count)core.snowSublimationRate=new Float32Array(core.count);
  if(!core.iceSublimationRate||core.iceSublimationRate.length!==core.count)core.iceSublimationRate=new Float32Array(core.count);
  core.cryosphereSublimationModel=CRYO_SUBLIMATION_MODEL;
  return core;
}
function cryoSubWind(core,i){
  const u=Number((core.windStateU||core.windU)?.[i])||0;
  const v=Number((core.windStateV||core.windV)?.[i])||0;
  return Math.hypot(u,v);
}

/* Replace only the landed-liquid freeze branch of cryoStepLand. Melt and slow
   snow->glacier compaction retain the authoritative 0.5.60 equations. */
if(typeof cryoStepLand==='function'){
  cryoStepLand=function(core,dtSec){
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
        const cold=cryoSubClamp((CRYO_FREEZE_K-T)/12.0,0,1);
        const daily=CRYO_LAND_SURFACE_FREEZE_MAX_KG_M2_DAY*(0.20+0.80*Math.sqrt(cold));
        const rateCap=daily*dt/86400;
        const dm=Math.min(core.surfaceLiquidWater[i],coldE/CRYO_LATENT_HEAT_FUSION,rateCap);
        if(dm>0){
          core.surfaceLiquidWater[i]-=dm;
          core.surfaceSnowWater[i]+=dm;
          T+=dm*CRYO_LATENT_HEAT_FUSION/cap;
        }
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
  };
}

/* A thin sea-ice skin can close the visible surface much faster than the bulk
   ocean can grow decimetres/metres of ice. Preserve the original thickness-
   derived concentration near the phase boundary, but impose a thermodynamic
   minimum at deep supercooling. Liquid water may still exist underneath. */
function cryoSeaColdSkinCover(T){
  T=Number(T);
  if(!Number.isFinite(T))return 0;
  return 1-cryoSubSmooth(CRYO_SEA_SKIN_FULL_K,CRYO_SEA_SKIN_START_K,T);
}
if(typeof cryoRefreshCovers==='function'){
  const cryoRefreshCoversBeforeColdSkin=cryoRefreshCovers;
  cryoRefreshCovers=function(core){
    cryoRefreshCoversBeforeColdSkin(core);
    if(!core?.seaIceConcentration||!core?.surfaceWaterFraction)return core;
    let seaW=0,seaC=0;
    for(let i=0;i<core.count;i++){
      const w=cryoSubClamp(core.surfaceWaterFraction[i],0,1);if(w<1e-5)continue;
      const T=Number(core.seaSurfaceTemp?.[i]??core.surfaceTemp?.[i]??CRYO_SEA_FREEZE_K);
      const skin=cryoSeaColdSkinCover(T);
      if(skin>core.seaIceConcentration[i])core.seaIceConcentration[i]=skin;
      const landCover=Math.max(Number(core.snowCoverFraction?.[i])||0,Number(core.landIceCoverFraction?.[i])||0);
      core.surfaceCryoFraction[i]=cryoSubClamp((1-w)*landCover+w*core.seaIceConcentration[i],0,1);
      const aw=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
      seaW+=aw*w;seaC+=aw*w*core.seaIceConcentration[i];
    }
    if(seaW>0)core.cryoSeaIceMean=seaC/seaW;
    return core;
  };
}

function cryoSublimationStep(core,dtSec,climate){
  if(!core?.vaporColumn||!core?.surfaceSnowWater)return core;
  cryoSubEnsure(core);
  const dt=cryoSubClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  core.snowSublimationRate.fill(0);core.iceSublimationRate.fill(0);
  if(!(dt>0))return core;

  let meanMass=0,ws=0;
  for(let i=0;i<core.count;i++){
    const water=cryoSubClamp(core.surfaceWaterFraction?.[i]||0,0,1);
    const land=1-water;if(land<1e-4)continue;
    const aw=Math.max(1e-12,core.areaWeight?.[i]||1);ws+=aw;
    let T=Number(core.landSurfaceTemp?.[i]??core.surfaceTemp?.[i]??273.15)||273.15;
    if(T>274.5)continue;

    const sat=(typeof h2oSaturationColumnKgM2==='function')?Math.max(1e-9,h2oSaturationColumnKgM2(Math.min(T,273.15),climate)):0;
    const target=CRYO_SUBLIMATION_TARGET_RH*sat;
    let deficit=Math.max(0,target-Math.max(0,core.vaporColumn[i]));
    if(!(deficit>1e-8))continue;

    const wind=cryoSubWind(core,i);
    const windBoost=0.45+0.95*cryoSubClamp(wind/12,0,1.5);
    const coldGate=cryoSubSmooth(185,225,T);
    const dryGate=cryoSubSmooth(0,Math.max(0.05,0.35*sat),deficit);
    const support=land*windBoost*coldGate*dryGate;
    if(!(support>0))continue;

    let snow=Math.max(0,core.surfaceSnowWater[i]);
    if(snow>0&&deficit>0){
      const rate=Math.min(CRYO_SUBLIMATION_SNOW_MAX_KG_M2_S,snow/dt,deficit/CRYO_SUBLIMATION_SNOW_TAU_SEC*support);
      const dm=Math.max(0,rate*dt);
      if(dm>0){
        core.surfaceSnowWater[i]=snow-dm;core.vaporColumn[i]+=dm;deficit=Math.max(0,deficit-dm);
        core.snowSublimationRate[i]=rate;
        T-=dm*CRYO_SUBLIMATION_LATENT_J_KG/CRYO_SUBLIMATION_LAND_CAP_J_M2_K;
        meanMass+=dm*aw;
      }
    }

    let ice=Math.max(0,core.landIceWater?.[i]||0);
    if(ice>0&&deficit>0){
      const rate=Math.min(CRYO_SUBLIMATION_ICE_MAX_KG_M2_S,ice/dt,deficit/CRYO_SUBLIMATION_ICE_TAU_SEC*support);
      const dm=Math.max(0,rate*dt);
      if(dm>0){
        core.landIceWater[i]=ice-dm;core.vaporColumn[i]+=dm;
        core.iceSublimationRate[i]=rate;
        T-=dm*CRYO_SUBLIMATION_LATENT_J_KG/CRYO_SUBLIMATION_LAND_CAP_J_M2_K;
        meanMass+=dm*aw;
      }
    }
    if(core.landSurfaceTemp)core.landSurfaceTemp[i]=cryoSubClamp(T,80,1600);
    if(core.surfaceTemp&&water<0.01)core.surfaceTemp[i]=core.landSurfaceTemp?core.landSurfaceTemp[i]:cryoSubClamp(T,80,1600);
  }
  if(typeof cryoRefreshCovers==='function')cryoRefreshCovers(core);
  if(typeof h2oRefreshRelativeHumidity==='function')h2oRefreshRelativeHumidity(core,climate);
  core.cryoSublimatedKgM2Mean=meanMass/Math.max(1e-12,ws);
  return core;
}

const weatherCoreCreateBeforeCryoSublimation=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeCryoSublimation(seed,N,climate,axis);cryoSubEnsure(core);return core;
};
const weatherCoreStepBeforeCryoSublimation=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeCryoSublimation(core,dtSec,climate,axis);
  return cryoSublimationStep(core,dtSec,climate);
};
