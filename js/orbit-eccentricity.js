/* ============ 0.5.122: deterministic Keplerian eccentricity ============ */
/*
   The orbit-distance slider is the semi-major axis. Each world seed gets a
   deterministic, moderate eccentricity so random planets are no longer locked
   to perfect circles. The distribution is deliberately biased toward low e:
   most temperate rocky worlds stay fairly circular, while visibly elliptical
   Mars-like cases remain possible without producing cometary extremes.

   These helpers contain orbital geometry only. Seasonal forcing is connected
   later, after seasons.js owns the model clock.
*/
const ORBIT_ECCENTRICITY_MODEL=1;
const ORBIT_ECCENTRICITY_MIN=0.010;
const ORBIT_ECCENTRICITY_MAX=0.180;

function orbitHash01(seed,salt=0){
  let x=((seed|0)^0x6d2b79f5^(salt|0))>>>0;
  x=Math.imul(x^(x>>>16),0x7feb352d)>>>0;
  x=Math.imul(x^(x>>>15),0x846ca68b)>>>0;
  x=(x^(x>>>16))>>>0;
  return x/4294967296;
}
function orbitEccentricityForSeed(seed){
  const u=orbitHash01(seed,0x1735a9d);
  return ORBIT_ECCENTRICITY_MIN+(ORBIT_ECCENTRICITY_MAX-ORBIT_ECCENTRICITY_MIN)*Math.pow(u,1.65);
}
function orbitNormalizeAngle(a){
  const tau=2*Math.PI;
  a=(Number(a)||0)%tau;if(a<0)a+=tau;return a;
}
function orbitSolveEccentricAnomaly(meanAnomaly,e){
  const M=orbitNormalizeAngle(meanAnomaly);
  e=Math.max(0,Math.min(0.80,Number(e)||0));
  let E=M+e*Math.sin(M)*(1+e*Math.cos(M));
  for(let i=0;i<6;i++){
    const f=E-e*Math.sin(E)-M;
    E-=f/Math.max(1e-8,1-e*Math.cos(E));
  }
  return orbitNormalizeAngle(E);
}
function orbitStateFromMeanAnomaly(semiMajorAU,e,meanAnomaly){
  const a=Math.max(1e-6,Number(semiMajorAU)||1);
  e=Math.max(0,Math.min(0.80,Number(e)||0));
  const M=orbitNormalizeAngle(meanAnomaly);
  const E=orbitSolveEccentricAnomaly(M,e);
  const ce=Math.cos(E),se=Math.sin(E);
  const radiusAU=a*(1-e*ce);
  const bFactor=Math.sqrt(Math.max(0,1-e*e));
  const trueAnomaly=orbitNormalizeAngle(Math.atan2(bFactor*se,ce-e));
  return {
    semiMajorAU:a,e,meanAnomaly:M,eccentricAnomaly:E,trueAnomaly,radiusAU,
    periapsisAU:a*(1-e),apoapsisAU:a*(1+e),minorAxisAU:a*bFactor
  };
}
function orbitInstantFluxEarth(luminosity,semiMajorAU,e,meanAnomaly){
  const o=orbitStateFromMeanAnomaly(semiMajorAU,e,meanAnomaly);
  return (typeof orbitalFluxEarth==='function')?orbitalFluxEarth(luminosity,o.radiusAU)
    :Math.max(0,Number(luminosity)||0)/Math.max(1e-9,o.radiusAU*o.radiusAU);
}
function orbitMeanFluxFactor(e){
  e=Math.max(0,Math.min(0.80,Number(e)||0));
  return 1/Math.sqrt(Math.max(1e-8,1-e*e));
}
function currentOrbitEccentricity(){
  return orbitEccentricityForSeed((typeof state!=='undefined'&&Number.isFinite(state.seed))?state.seed:0);
}

/* Enrich the existing distance label without changing the meaning of the
   slider: displayed distance remains semi-major axis a. */
if(typeof distanceInfo==='function'){
  const distanceInfoBeforeEccentricity=distanceInfo;
  distanceInfo=function(v){
    const d=distanceInfoBeforeEccentricity(v);
    const e=currentOrbitEccentricity();
    d.e=e;d.periapsisAU=d.au*(1-e);d.apoapsisAU=d.au*(1+e);
    d.label='a '+d.au.toFixed(2)+' AU · e '+e.toFixed(3)+' · '+d.S.toFixed(d.S<0.1?2:1)+' S⊕ · '+
      ({hot:'горячее HZ','warm-edge':'горячий край HZ',conservative:'зона Златовласки','cold-edge':'холодный край HZ',cold:'холоднее HZ'}[d.status]||d.status);
    return d;
  };
}
if(typeof currentStarOrbitDiagnostics==='function'){
  const currentStarOrbitDiagnosticsBeforeEccentricity=currentStarOrbitDiagnostics;
  currentStarOrbitDiagnostics=function(){
    const d=currentStarOrbitDiagnosticsBeforeEccentricity();
    const e=currentOrbitEccentricity();
    d.e=e;d.periapsisAU=d.au*(1-e);d.apoapsisAU=d.au*(1+e);return d;
  };
}
if(typeof createPanel==='function'){
  const createPanelBeforeOrbitEccentricity=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeOrbitEccentricity(group);
    if(group==='Звезда'){
      const box=el.querySelector('#starPhysicsDiag');
      if(box&&!box.querySelector('[data-orbitecc="shape"]')){
        const row=document.createElement('div');row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
        const a=document.createElement('span');a.textContent='Орбита a / e';a.style.opacity='.62';
        const b=document.createElement('span');b.dataset.orbitecc='shape';b.style.textAlign='right';row.append(a,b);box.appendChild(row);
      }
    }
    return el;
  };
}
function refreshOrbitEccentricityDiagnostics(){
  if(typeof document==='undefined')return;
  const e=document.querySelector('#starPhysicsDiag [data-orbitecc="shape"]');if(!e)return;
  const a=(typeof orbitDistanceAU==='function'&&typeof state!=='undefined')?orbitDistanceAU(state.distance):1;
  const q=currentOrbitEccentricity();
  e.textContent=a.toFixed(2)+' AU · e '+q.toFixed(3)+' · '+(a*(1-q)).toFixed(2)+'…'+(a*(1+q)).toFixed(2)+' AU';
}
if(typeof syncDynamicLabels==='function'){
  const syncDynamicLabelsBeforeOrbitEccentricity=syncDynamicLabels;
  syncDynamicLabels=function(){syncDynamicLabelsBeforeOrbitEccentricity();refreshOrbitEccentricityDiagnostics();};
}
window.__madPlanetOrbitEccentricity={
  forSeed:orbitEccentricityForSeed,stateFromMeanAnomaly:orbitStateFromMeanAnomaly,
  instantFluxEarth:orbitInstantFluxEarth,current:currentOrbitEccentricity
};
