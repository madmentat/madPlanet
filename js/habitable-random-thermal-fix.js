/* ============ 0.5.167: escape the snowball branch for Random ============ */
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

const CITY_TA_MODEL=4;
const CITY_TA_TARGET_MIN_C=14;
const CITY_TA_TARGET_MAX_C=24;
const CITY_TA_ACCEPT_MIN_C=10;
const CITY_TA_ACCEPT_MAX_C=27;
const CITY_TA_SOLVE_STEPS=14;

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
function cityTaSetOrbit(au,targetC){
  if(typeof stellarDistanceSliderFromAU==='function')state.distance=stellarDistanceSliderFromAU(au);
  /* Random is explicitly a temperate-world generator. climateModel() uses
     state.temp as the initial condition of its ice/albedo iteration, while
     climate-consistency continuously writes the CURRENT surface temperature
     back into state.temp. After one snowball probe that made later probes start
     from -70..-90 C and remain on the cold attractor even at a warmer orbit.
     Warm-start each candidate before H2O equilibrium is solved. */
  cityTaInvalidateCore();
  if(Number.isFinite(targetC)&&typeof tempToSlider==='function'){
    const v=tempToSlider(targetC);
    if(Number.isFinite(v))state.temp=v;
  }
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
  const remember=(au,c)=>{
    if(!Number.isFinite(c))return c;
    const err=Math.abs(c-target);
    if(err<bestErr){bestErr=err;bestAu=au;bestC=c;}
    return c;
  };
  const probe=au=>remember(au,cityTaSetOrbit(au,target));

  /* First make sure the bracket actually straddles the warm solution.
     HZ bounds are an excellent first guess, not a guarantee for every sampled
     atmosphere/cloud/albedo state. Expand inward if even the nominal inner
     probe is cold, and outward if the nominal outer probe is still hot. */
  let cLo=probe(lo);
  for(let i=0;i<7&&Number.isFinite(cLo)&&cLo<target&&lo>0.011;i++){
    const next=Math.max(0.01,lo*0.72);
    if(!(next<lo))break;
    lo=next;cLo=probe(lo);
  }
  let cHi=probe(hi);
  for(let i=0;i<7&&Number.isFinite(cHi)&&cHi>target&&hi<999;i++){
    const next=Math.min(1000,hi*1.35);
    if(!(next>hi))break;
    hi=next;cHi=probe(hi);
  }

  /* Current surface temperature should decrease with orbital distance once
     every probe starts from the same temperate branch. */
  for(let i=0;i<CITY_TA_SOLVE_STEPS;i++){
    const au=Math.sqrt(lo*hi);
    const c=probe(au);
    if(!Number.isFinite(c))break;
    if(c<target)hi=au;else lo=au;
  }
  const finalC=cityTaSetOrbit(bestAu,target);
  const out=Number.isFinite(finalC)?finalC:bestC;
  try{
    if(typeof window!=='undefined'&&window.__madPlanetHabitableRandomThermalFix){
      window.__madPlanetHabitableRandomThermalFix.last={
        targetC:target,finalC:out,finalAu:bestAu,errorC:Number.isFinite(out)?out-target:NaN
      };
    }
  }catch(_e){}
  return out;
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
