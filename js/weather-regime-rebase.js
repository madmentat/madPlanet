/* ============ 0.5.79: rebase persistent weather after major BASE changes ============ */
/*
   Weather Core persistence is desirable for ordinary weather evolution, but a
   BASE control edit is a new equilibrium planet configuration, not a simulated
   orbital transfer. In 0.5.78 moving a temperate world straight to 0.065 AU
   left the old surface reservoir cooling/heating with a six-simulated-hour
   time constant. Because one real second is five simulated minutes, stale HZ
   vegetation/water could remain visible for tens of real seconds.

   Preserve weather for small edits. Only a genuinely different forcing regime
   (large equilibrium-T jump, multi-fold stellar-flux change, or multi-fold
   pressure change) rebuilds the low-resolution core from the new physical
   equilibrium. This costs nothing per fragment and avoids fake transitional
   climates that the UI never asked us to simulate.
*/

const WEATHER_REGIME_REBASE_MODEL=1;
let weatherRegimeSignature=null;
let weatherRegimeRebases=0;

function weatherRebaseSignature(c){
  return {T:Number(c?.T)||288,S:Math.max(0,Number(c?.S)||0),p:Math.max(0,Number(c?.pressureBar)||0)};
}
function weatherRebaseRatio(a,b,floor){
  a=Math.max(floor,Number(a)||0);b=Math.max(floor,Number(b)||0);
  return Math.max(a,b)/Math.min(a,b);
}
function weatherForcingJumpIsMajor(a,b){
  if(!a||!b)return false;
  const dT=Math.abs((Number(a.T)||0)-(Number(b.T)||0));
  const fluxRatio=weatherRebaseRatio(a.S,b.S,0.02);
  const pressureRatio=weatherRebaseRatio(a.p,b.p,0.005);
  return dT>70 || fluxRatio>2.5 || pressureRatio>4.0;
}

const weatherCoreEnsureBeforeRegimeRebase=weatherCoreEnsure;
weatherCoreEnsure=function(){
  let core=weatherCoreEnsureBeforeRegimeRebase();
  if(!core)return core;
  const climate=weatherCoreClimateSnapshot();
  const sig=weatherRebaseSignature(climate);
  if(weatherRegimeSignature&&weatherForcingJumpIsMajor(weatherRegimeSignature,sig)){
    /* weatherCoreCreate is intentionally looked up dynamically. Later weather
       modules wrap that constructor with all of their own fields, so a rebase
       still creates the complete current Weather Core rather than v1 only. */
    weatherCore=weatherCoreCreate(state.seed,weatherCoreRequestedResolution(),climate,weatherCoreAxis());
    core=weatherCore;
    weatherRegimeRebases++;
    core.weatherRegimeRebaseModel=WEATHER_REGIME_REBASE_MODEL;
    core.weatherRegimeRebases=weatherRegimeRebases;
  }
  weatherRegimeSignature=sig;
  return core;
};

function weatherRegimeRebaseDiagnostics(){
  return {model:WEATHER_REGIME_REBASE_MODEL,rebases:weatherRegimeRebases,signature:weatherRegimeSignature};
}
