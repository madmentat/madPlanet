/* ============ 0.5.166: final warm random-world acceptance ============ */
/*
   habitable-random.js historically solved the radiative climate attractor
   returned by climateModel(). That is not the same quantity shown as T_a:
   T_a is the current area-weighted Weather Core surface temperature.

   The Weather Core intentionally applies latitudinal thermal structure and
   local perturbations, so a world whose climateModel() says +18 C can have a
   materially colder current surface mean. 0.5.163 made that discrepancy
   visible by fixing T_a, but the Random generator still optimized the old
   quantity.

   This adapter leaves the original city-ready generator intact and performs a
   cheap post-pass: it adjusts orbital distance against the actual Weather
   Core surface mean, using the star's habitable-zone bounds as the search
   bracket. Random worlds therefore target a genuinely temperate CURRENT T_a,
   not merely a pleasant equilibrium estimate.
*/

const CITY_TA_MODEL=3;
const CITY_TA_TARGET_MIN_C=14;
const CITY_TA_TARGET_MAX_C=24;
const CITY_TA_ACCEPT_MIN_C=10;
const CITY_TA_ACCEPT_MAX_C=27;
const CITY_TA_SOLVE_STEPS=12;

function cityTaClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function cityTaMeanSurfaceC(core){
  if(!core?.count)return NaN;
  const field=(core.surfaceSkinTemp&&core.surfaceSkinTemp.length===core.count)
    ?core.surfaceSkinTemp:core.surfaceTemp;
  if(!field||field.length!==core.count)return NaN;
  let sum=0,sw=0;
  for(let i=0;i<core.count;i++){
    const K=Number(field[i]);if(!Number.isFinite(K))continue;
    const w=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
    sum+=K*w;sw+=w;
  }
  return sw>0?sum/sw-273.15:NaN;
}
function cityTaInvalidateCore(){
  /* climate-consistency makes waterTemperatureK() prefer the CURRENT Weather
     Core. A probe must therefore discard the previous-orbit core BEFORE water
     equilibrium is settled, otherwise the old cold surface condenses water,
     weakens greenhouse forcing and makes every following probe look cold too. */
  try{if(typeof weatherCore!=='undefined')weatherCore=null;}catch(_e){}
}
function cityTaFreshCore(){
  try{
    cityTaInvalidateCore();
    const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
    return cityTaMeanSurfaceC(core);
  }catch(_e){return NaN;}
}
function cityTaSetOrbit(au){
  if(typeof stellarDistanceSliderFromAU==='function')state.distance=stellarDistanceSliderFromAU(au);
  /* Critical order for 0.5.166: invalidate stale physical surface first, then
     settle H2O against the new orbit, then build a fresh Weather Core. */
  cityTaInvalidateCore();
  if(typeof settleWaterEquilibriumImmediate==='function')settleWaterEquilibriumImmediate(2);
  if(typeof updateLegacyAtmoProxy==='function')updateLegacyAtmoProxy();
  return cityTaFreshCore();
}
function cityTaTargetFromSeed(){
  const h=(typeof weatherHash01==='function')
    ?weatherHash01(state.seed|0,0x164):0.5;
  return CITY_TA_TARGET_MIN_C+(CITY_TA_TARGET_MAX_C-CITY_TA_TARGET_MIN_C)*h;
}
function cityTaSolveCurrentSurface(){
  if(typeof state==='undefined'||typeof starPhysics!=='function'||typeof climateModel!=='function')return NaN;
  const st=starPhysics(state.star,state.luminosity);
  const hz=(typeof habitableZoneForStar==='function')
    ?habitableZoneForStar(st.T,st.L)
    :{conservativeInner:Math.sqrt(Math.max(1e-9,st.L))*0.90,
      conservativeOuter:Math.sqrt(Math.max(1e-9,st.L))*1.55};
  let lo=Math.max(0.01,(Number(hz.conservativeInner)||0.7)*0.72);
  let hi=Math.max(lo*1.08,(Number(hz.conservativeOuter)||1.5)*1.20);
  const target=cityTaTargetFromSeed();
  let bestAu=Math.max(lo,Math.min(hi,typeof orbitDistanceAU==='function'?orbitDistanceAU(state.distance):Math.sqrt(lo*hi)));
  let bestC=NaN,bestErr=Infinity;

  /* Weather Core is a deterministic projection of the current climate state.
     Rebuild it at each probe because its surface field depends on c.T. */
  for(let i=0;i<CITY_TA_SOLVE_STEPS;i++){
    const au=Math.sqrt(lo*hi);
    const c=cityTaSetOrbit(au);
    if(Number.isFinite(c)){
      const err=Math.abs(c-target);
      if(err<bestErr){bestErr=err;bestAu=au;bestC=c;}
      /* Orbital distance is inverse to heating: a cold probe must move
         inward (smaller AU), while a hot probe must move outward. 0.5.164
         accidentally updated the opposite bracket and therefore drove cold
         random worlds even farther from their star. */
      if(c<target)hi=au;else lo=au;
    }else break;
  }
  const finalC=cityTaSetOrbit(bestAu);
  return Number.isFinite(finalC)?finalC:bestC;
}

if(typeof generateCityReadyRandomWorld==='function'){
  const cityRandomOriginal=generateCityReadyRandomWorld;
  generateCityReadyRandomWorld=function(randomSource=Math.random){
    const result=cityRandomOriginal(randomSource);
    /* This wrapper is intentionally assembled AFTER climate-consistency.js.
       All late water/temperature post-processing has therefore already run
       inside cityRandomOriginal(), and this is the final thermal acceptance. */
    cityTaSolveCurrentSurface();
    if(typeof deriveWorld==='function')deriveWorld();
    /* Rebuild after deriveWorld too: it is the final state from which the first
       rendered T_a must be sampled. */
    cityTaFreshCore();
    if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();
    if(typeof syncUI==='function')syncUI();
    if(typeof saveHash==='function')saveHash();
    return (typeof climateModel==='function')?climateModel():result;
  };
}

if(typeof window!=='undefined')window.__madPlanetHabitableRandomThermalFix={
  model:CITY_TA_MODEL,target:[CITY_TA_TARGET_MIN_C,CITY_TA_TARGET_MAX_C],
  acceptance:[CITY_TA_ACCEPT_MIN_C,CITY_TA_ACCEPT_MAX_C]
};
