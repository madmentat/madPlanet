/* ============ 0.5.122: eccentric seasonal forcing ============ */
/*
   seasons.js owns the physical year and axial-tilt geometry. This layer turns
   its uniform orbital angle into a Keplerian orbit and feeds the resulting
   instantaneous star distance into Weather Core's local energy budget.
*/
const ECCENTRIC_SEASONS_MODEL=1;
function eccentricSeasonMeanAnomalyRad(seed,simSeconds,climate){
  const P=seasonOrbitalPeriodSec(climate);
  let q=seasonSeedPhase(seed)+2*Math.PI*(Number(simSeconds)||0)/P;
  q%=2*Math.PI;if(q<0)q+=2*Math.PI;return q;
}
function eccentricSeasonState(seed,simSeconds,climate){
  const a=Number.isFinite(climate?.semiMajorAxisAU)?climate.semiMajorAxisAU:
    ((typeof orbitDistanceAU==='function'&&typeof state!=='undefined')?orbitDistanceAU(state.distance):1);
  const e=Number.isFinite(climate?.orbitalEccentricity)?climate.orbitalEccentricity:
    ((typeof orbitEccentricityForSeed==='function')?orbitEccentricityForSeed(seed):0);
  return orbitStateFromMeanAnomaly(a,e,eccentricSeasonMeanAnomalyRad(seed,simSeconds,climate));
}
const seasonOrbitPhaseRadCircular=seasonOrbitPhaseRad;
seasonOrbitPhaseRad=function(seed,simSeconds,climate){
  if(typeof orbitStateFromMeanAnomaly!=='function')return seasonOrbitPhaseRadCircular(seed,simSeconds,climate);
  return eccentricSeasonState(seed,simSeconds,climate).trueAnomaly;
};

const weatherCoreClimateSnapshotBeforeEccentricSeasons=weatherCoreClimateSnapshot;
weatherCoreClimateSnapshot=function(){
  const s=weatherCoreClimateSnapshotBeforeEccentricSeasons();
  if(typeof state==='undefined'||typeof orbitStateFromMeanAnomaly!=='function')return s;
  const sim=(typeof weatherCore!=='undefined'&&weatherCore&&Number.isFinite(weatherCore.simSeconds))?weatherCore.simSeconds:0;
  const seed=state.seed|0;
  const a=(typeof orbitDistanceAU==='function')?orbitDistanceAU(state.distance):1;
  const e=(typeof orbitEccentricityForSeed==='function')?orbitEccentricityForSeed(seed):0;
  const o=eccentricSeasonState(seed,sim,{...s,semiMajorAxisAU:a,orbitalEccentricity:e});
  const meanAtA=Math.max(0,Number(s.S)||0);
  const factor=Math.pow(a/Math.max(1e-9,o.radiusAU),2);
  s.SMeanAtSemiMajor=meanAtA;
  s.S=meanAtA*factor;
  s.semiMajorAxisAU=a;
  s.orbitalEccentricity=e;
  s.orbitalDistanceAU=o.radiusAU;
  s.periapsisAU=o.periapsisAU;
  s.apoapsisAU=o.apoapsisAU;
  s.orbitalFluxFactor=factor;
  s.eccentricSeasonsModel=ECCENTRIC_SEASONS_MODEL;
  return s;
};

const seasonRefreshFieldsBeforeEccentric=seasonRefreshFields;
seasonRefreshFields=function(core,climate,axis){
  seasonRefreshFieldsBeforeEccentric(core,climate,axis);
  if(!core)return core;
  const o=eccentricSeasonState(core.seed|0,core.simSeconds,climate||{});
  core.orbitalEccentricity=o.e;
  core.orbitalDistanceAU=o.radiusAU;
  core.periapsisAU=o.periapsisAU;
  core.apoapsisAU=o.apoapsisAU;
  core.orbitMeanAnomaly=o.meanAnomaly/(2*Math.PI);
  core.eccentricSeasonsModel=ECCENTRIC_SEASONS_MODEL;
  return core;
};
const weatherCoreFiniteBeforeEccentricSeasons=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeEccentricSeasons(core))return false;
  if(!core?.eccentricSeasonsModel)return true;
  return Number.isFinite(core.orbitalEccentricity)&&Number.isFinite(core.orbitalDistanceAU)&&
    Number.isFinite(core.periapsisAU)&&Number.isFinite(core.apoapsisAU)&&Number.isFinite(core.orbitMeanAnomaly);
};

if(typeof createPanel==='function'){
  const createPanelBeforeEccentricSeasons=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeEccentricSeasons(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-eccseason="orbit"]')){
        appendWeatherCoreRow(box,'Орбита r / e','eccseason-orbit');
        const x=box.lastElementChild?.querySelector('[data-weathercore="eccseason-orbit"]');
        if(x){delete x.dataset.weathercore;x.dataset.eccseason='orbit';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeEccentricSeasons=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeEccentricSeasons();
    if(typeof document==='undefined')return;
    const e=document.querySelector('#weatherCoreDiag [data-eccseason="orbit"]');if(!e)return;
    const core=weatherCoreEnsure();if(!core)return;
    const r=Number(core.orbitalDistanceAU),q=Number(core.orbitalEccentricity);
    e.textContent=Number.isFinite(r)&&Number.isFinite(q)?r.toFixed(3)+' AU · e '+q.toFixed(3):'—';
  };
}
window.__madPlanetEccentricSeasons={state:eccentricSeasonState,meanAnomaly:eccentricSeasonMeanAnomalyRad};
