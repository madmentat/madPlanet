/* ============ 0.5.80: staged thermodynamic response to major BASE changes ============ */
/*
   0.5.79 rebuilt Weather Core outright after a large orbit/pressure jump. That
   removed stale green/wet state, but it also made an ocean vanish in one frame
   because surface temperature jumped directly from temperate to close-orbit
   equilibrium. 0.5.78's gradual evaporation looked much better; its only real
   problem was the six-simulated-hour surface lag, which could take too long on
   a phone.

   Keep the persistent weather object and its storm/front history. A major
   forcing jump now opens a short transition window. Roughly once per real
   second only the base thermodynamic reservoirs (surface T, air T, pressure)
   are nudged toward the new equilibrium. The ordinary weather modules continue
   evolving humidity/clouds/precipitation around them. Result: seconds-long
   boiling/cooling instead of either an instant cut or a minute of stale Earth.
*/

const WEATHER_REGIME_REBASE_MODEL=2;
const WEATHER_REGIME_TRANSITION_MS=15000;
const WEATHER_REGIME_BLEND_INTERVAL_MS=900;
let weatherRegimeSignature=null;
let weatherRegimeTransitions=0;
let weatherRegimeTransitionUntil=0;
let weatherRegimeLastBlendMs=-1e12;

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
function weatherRegimeNowMs(){
  return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')?performance.now():Date.now();
}
function weatherApplyThermalTransition(core,climate){
  if(!core?.count||typeof weatherCoreTargetsForCell!=='function')return false;
  const axis=weatherCoreAxis(),q={surfaceTemp:0,airTemp:0,pressurePa:0,humidity:0,cloudWater:0};
  const surfaceA=0.10,airA=0.18,pressureA=0.16;
  for(let i=0;i<core.count;i++){
    weatherCoreTargetsForCell(climate,core.dirX[i],core.dirY[i],core.dirZ[i],axis,core.seed,i,q);
    core.surfaceTemp[i]+=(q.surfaceTemp-core.surfaceTemp[i])*surfaceA;
    core.airTemp[i]+=(q.airTemp-core.airTemp[i])*airA;
    core.pressure[i]+=(q.pressurePa-core.pressure[i])*pressureA;
  }
  core.weatherRegimeRebaseModel=WEATHER_REGIME_REBASE_MODEL;
  core.weatherRegimeTransitions=weatherRegimeTransitions;
  return true;
}

const weatherCoreEnsureBeforeRegimeRebase=weatherCoreEnsure;
weatherCoreEnsure=function(){
  const core=weatherCoreEnsureBeforeRegimeRebase();
  if(!core)return core;
  const climate=weatherCoreClimateSnapshot();
  const sig=weatherRebaseSignature(climate),now=weatherRegimeNowMs();
  if(weatherRegimeSignature&&weatherForcingJumpIsMajor(weatherRegimeSignature,sig)){
    weatherRegimeTransitions++;
    weatherRegimeTransitionUntil=now+WEATHER_REGIME_TRANSITION_MS;
    weatherRegimeLastBlendMs=-1e12;
  }
  weatherRegimeSignature=sig;
  if(now<weatherRegimeTransitionUntil && now-weatherRegimeLastBlendMs>=WEATHER_REGIME_BLEND_INTERVAL_MS){
    weatherApplyThermalTransition(core,climate);
    weatherRegimeLastBlendMs=now;
  }
  return core;
};

function weatherRegimeRebaseDiagnostics(){
  const now=weatherRegimeNowMs();
  return {model:WEATHER_REGIME_REBASE_MODEL,rebases:0,transitions:weatherRegimeTransitions,
    active:now<weatherRegimeTransitionUntil,signature:weatherRegimeSignature};
}
