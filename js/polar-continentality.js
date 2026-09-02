/* ============ 0.5.124: polar continentality / ice-sheet interior cooling ============ */
/*
   The 0.5.123 surface-skin split fixed the SST-vs-ice-top diagnostic error,
   but a broad polar land mass could still sit too close to the zonal target if
   it was not very mountainous. Antarctica is cold for more than altitude:
   continental interiors are weakly coupled to ocean heat, have persistent
   stable boundary layers and, once snow/ice is established, maintain a strong
   radiative cold trap. This module adds that missing geography term.

   It does NOT change the global mean climate target. The term applies only to
   high-latitude land, is strongest in cells surrounded by land, is amplified by
   snow/land ice and darkness, and fades on genuinely hot climates. Physical
   OLR still closes the budget through the existing polar-surface module.
*/
const POLAR_CONTINENTALITY_MODEL=1;
const PCI_MAX_EXTRA_K=22.0;
const PCI_OFFSET_MAX_K=70.0;

function pciClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function pciSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=pciClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function pciLand(core,i){return 1-pciClamp(core?.surfaceWaterFraction?.[i]||0,0,1);}
function pciEnsure(core){
  if(!core?.count)return core;
  const n=core.count;
  if(!core.polarContinentality||core.polarContinentality.length!==n)core.polarContinentality=new Float32Array(n);
  const sig=(core.h2oSurfaceSignature||'')+'|'+core.N+'|'+n;
  if(core.polarContinentalitySignature===sig)return core;
  const nb=core.windNeighbor;
  for(let i=0;i<n;i++){
    if(pciLand(core,i)<0.5){core.polarContinentality[i]=0;continue;}
    let sum=2*pciLand(core,i),w=2;
    if(nb&&nb.length>=4){
      for(let k=0;k<4;k++){
        const j=nb[k]?.[i]|0;if(j<0||j>=n||j===i)continue;
        sum+=2*pciLand(core,j);w+=2;
        for(let q=0;q<4;q++){
          const m=nb[q]?.[j]|0;if(m<0||m>=n||m===j)continue;
          sum+=0.35*pciLand(core,m);w+=0.35;
        }
      }
    }
    const localLand=w>0?sum/w:pciLand(core,i);
    core.polarContinentality[i]=pciSmooth(0.56,0.94,localLand);
  }
  core.polarContinentalitySignature=sig;
  core.polarContinentalityModel=POLAR_CONTINENTALITY_MODEL;
  return core;
}
function pciClimateGate(climate){
  const T=Number.isFinite(Number(climate?.T))?Number(climate.T):288.15;
  return 1-pciSmooth(291.0,307.0,T);
}
function pciExtraOffsetK(core,i,climate,axis){
  if(!core?.count||pciLand(core,i)<0.5)return 0;
  pciEnsure(core);
  const interior=pciClamp(core.polarContinentality[i],0,1);
  if(interior<=0)return 0;
  const polar=(typeof pstPolarStrength==='function')?pstPolarStrength(core,i,axis):0;
  const dark=(typeof pstDarkness==='function')?pstDarkness(core,i):0.5;
  const cryo=pciClamp(Math.max(Number(core.snowCoverFraction?.[i])||0,Number(core.landIceCoverFraction?.[i])||0),0,1);
  const cold=pciClimateGate(climate);
  return PCI_MAX_EXTRA_K*interior*polar*cold*(0.68+0.32*dark)*(0.48+0.52*cryo);
}

/* Extend the target owned by polar-surface-thermodynamics. The base term still
   owns elevation and inversion; we add only continental isolation. */
if(typeof pstTargetLandOffsetK==='function'){
  const pstTargetLandOffsetKBeforeContinentality=pstTargetLandOffsetK;
  pstTargetLandOffsetK=function(core,i,climate,axis){
    const base=Number(pstTargetLandOffsetKBeforeContinentality(core,i,climate,axis))||0;
    const extra=pciExtraOffsetK(core,i,climate,axis);
    if(extra<=0)return base;
    return -pciClamp(Math.abs(Math.min(0,base))+extra,0,PCI_OFFSET_MAX_K);
  };
}

/* Keep the cache valid when geography is rebuilt by re-running pciEnsure from
   the same slow Weather Core cadence. No render-frame work is introduced. */
if(typeof weatherCoreCreate==='function'){
  const weatherCoreCreateBeforePolarContinentality=weatherCoreCreate;
  weatherCoreCreate=function(seed,N,climate,axis){
    const core=weatherCoreCreateBeforePolarContinentality(seed,N,climate,axis);
    if(core?.count)pciEnsure(core);return core;
  };
}
if(typeof weatherCoreStep==='function'){
  const weatherCoreStepBeforePolarContinentality=weatherCoreStep;
  weatherCoreStep=function(core,dtSec,climate,axis){
    weatherCoreStepBeforePolarContinentality(core,dtSec,climate,axis);
    if(core?.count)pciEnsure(core);return core;
  };
}
if(typeof weatherCoreFinite==='function'){
  const weatherCoreFiniteBeforePolarContinentality=weatherCoreFinite;
  weatherCoreFinite=function(core){
    if(!weatherCoreFiniteBeforePolarContinentality(core))return false;
    const a=core?.polarContinentality;if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i])||a[i]<0||a[i]>1)return false;
    return true;
  };
}

window.__madPlanetPolarContinentality={ensure:pciEnsure,extraOffsetK:pciExtraOffsetK};
