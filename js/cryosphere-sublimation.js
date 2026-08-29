/* ============ 0.5.60 hotfix: land snow/ice sublimation ============ */
/*
   Precipitation can move atmospheric H2O into surfaceSnowWater/landIceWater.
   Before this hotfix the cold branch had no vapour return path unless the
   surface warmed above melting, so polar storage could become a one-way sink.

   Sublimation is a strictly local phase transfer:
       snow/land ice -> vaporColumn
   It is allowed only when the near-surface air is undersaturated relative to
   a cold surface, is rate-limited, wind-assisted, and consumes latent heat
   from the land skin. No water is created and sea ice is deliberately not
   included because its bulk mass belongs to the unresolved ocean reservoir.
*/

const CRYO_SUBLIMATION_MODEL=1;
const CRYO_SUBLIMATION_TARGET_RH=0.74;
const CRYO_SUBLIMATION_SNOW_TAU_SEC=2.8*86400;
const CRYO_SUBLIMATION_ICE_TAU_SEC=16*86400;
const CRYO_SUBLIMATION_SNOW_MAX_KG_M2_S=2.0e-5;
const CRYO_SUBLIMATION_ICE_MAX_KG_M2_S=4.0e-6;
const CRYO_SUBLIMATION_LATENT_J_KG=2.83e6;
const CRYO_SUBLIMATION_LAND_CAP_J_M2_K=1.6e7;

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
    /* Above freezing, the latent-heat melt path owns phase removal. */
    if(T>274.5)continue;

    const sat=(typeof h2oSaturationColumnKgM2==='function')?Math.max(1e-9,h2oSaturationColumnKgM2(Math.min(T,273.15),climate)):0;
    const target=CRYO_SUBLIMATION_TARGET_RH*sat;
    let deficit=Math.max(0,target-Math.max(0,core.vaporColumn[i]));
    if(!(deficit>1e-8))continue;

    const wind=cryoSubWind(core,i);
    const windBoost=0.45+0.95*cryoSubClamp(wind/12,0,1.5);
    /* Normal polar temperatures must allow sublimation. Only pathological
       ultra-cold cells are suppressed as vapour pressure approaches zero. */
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
