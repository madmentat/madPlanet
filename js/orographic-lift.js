/* ============ 0.5.46: orographic lift + rain shadow ============ */
/*
   Weather Core v8 turns the 0.5.42 tectonic/orographic resistance field into
   thermodynamic forcing. The model does not invent mountain-shaped weather.
   It differentiates the existing orographicRoughness field on the same
   cubed-sphere neighbour stencil and projects the resolved tangent wind onto
   that slope:

       w ~= U dot grad(h)

   Positive w means air is climbing the resolved mountain belt; negative w is
   leeward descent. Column temperature receives a bounded adiabatic tendency.
   The 0.5.44 saturation/condensation layer then decides whether that cooling
   actually forms cloud water, and 0.5.45 precipitation removes mature
   condensate. Descending air warms and increases its saturation deficit, so
   rain shadow emerges without deleting atmospheric water by fiat.

   This module is loaded immediately after weather-core.js. Later physics
   wrappers (energy, baric, wind, H2O, condensation, precipitation) therefore
   operate on its temperature tendency in the same fixed weather tick. The
   explicit operator split uses the wind momentum present at the start of the
   tick; the momentum equation advances that wind later in the chain.
*/

const OROGRAPHIC_LIFT_MODEL = 1;
const ORO_EFFECTIVE_RELIEF_M = 5200.0;
const ORO_DRY_LAPSE_K_M = 0.0098;
const ORO_MOIST_LAPSE_K_M = 0.0055;
const ORO_COLUMN_COUPLING = 0.55;
const ORO_MAX_VERTICAL_MS = 4.0;
const ORO_MAX_TEMP_TICK_K = 3.0;

function oroClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function oroSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=oroClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function oroEnsureFields(core){
  if(!core||!core.count) return core;
  const n=core.count;
  const ensure=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  ensure('orographicSlopeE');
  ensure('orographicSlopeN');
  ensure('orographicVerticalVelocity');
  ensure('orographicDeltaT');
  ensure('windwardLiftIndex');
  ensure('rainShadowIndex');
  core.orographicLiftModel=OROGRAPHIC_LIFT_MODEL;
  if(typeof core.orographicSlopeSignature!=='string') core.orographicSlopeSignature='';
  return core;
}
function oroSlopeSignature(core){
  const sig=String(core?.orographySignature||'none');
  const n=core?.N||0;
  const r=(typeof windPlanetRadiusM==='function')?windPlanetRadiusM(null):0;
  return sig+'|'+n+'|'+Math.round(r);
}

/* windGradE/N are derivatives per metre. Multiplying the gradient of the
   dimensionless orographic proxy by an effective relief height produces a
   physical terrain slope dh/dx, dh/dy. Rebuild only when tectonic orography
   changes; wind changes do not require recomputing slopes. */
function orographicRebuildSlopes(core){
  oroEnsureFields(core);
  if(!core?.windNeighbor||!core?.windGradE||!core?.orographicRoughness){
    if(core){core.orographicSlopeE.fill(0);core.orographicSlopeN.fill(0);}
    return core;
  }
  for(let i=0;i<core.count;i++){
    const h0=oroClamp(core.orographicRoughness[i],0,1);
    let ge=0,gn=0;
    for(let k=0;k<4;k++){
      const j=core.windNeighbor[k][i]|0;
      if(j<0||j>=core.count) continue;
      const dh=oroClamp(core.orographicRoughness[j],0,1)-h0;
      ge+=core.windGradE[k][i]*dh;
      gn+=core.windGradN[k][i]*dh;
    }
    core.orographicSlopeE[i]=ge*ORO_EFFECTIVE_RELIEF_M;
    core.orographicSlopeN[i]=gn*ORO_EFFECTIVE_RELIEF_M;
  }
  core.orographicSlopeSignature=oroSlopeSignature(core);
  return core;
}
function oroRelativeHumidity(core,i,climate){
  if(core?.vaporColumn&&typeof h2oSaturationColumnKgM2==='function'){
    const sat=Math.max(1e-9,h2oSaturationColumnKgM2(core.airTemp[i],climate));
    return oroClamp(core.vaporColumn[i]/sat,0,2);
  }
  if(core?.relativeHumidity) return oroClamp(core.relativeHumidity[i],0,2);
  if(core?.humidity) return oroClamp(core.humidity[i],0,1);
  return 0.5;
}

function orographicApplyThermodynamics(core,dtSec,climate){
  if(!core||!core.count) return core;
  oroEnsureFields(core);
  if(core.orographicSlopeSignature!==oroSlopeSignature(core)) orographicRebuildSlopes(core);
  const dt=oroClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  const wu=core.windStateU||core.windU,wv=core.windStateV||core.windV;
  if(!wu||!wv) return core;
  for(let i=0;i<core.count;i++){
    const rawW=wu[i]*core.orographicSlopeE[i]+wv[i]*core.orographicSlopeN[i];
    const w=oroClamp(rawW,-ORO_MAX_VERTICAL_MS,ORO_MAX_VERTICAL_MS);
    const rh=oroRelativeHumidity(core,i,climate);
    const moist=oroSmooth(0.55,1.05,rh);
    const lapse=ORO_DRY_LAPSE_K_M+(ORO_MOIST_LAPSE_K_M-ORO_DRY_LAPSE_K_M)*moist;
    const dT=oroClamp(-w*lapse*dt*ORO_COLUMN_COUPLING,-ORO_MAX_TEMP_TICK_K,ORO_MAX_TEMP_TICK_K);
    core.airTemp[i]=oroClamp(core.airTemp[i]+dT,80,1400);
    core.orographicVerticalVelocity[i]=w;
    core.orographicDeltaT[i]=dT;

    const up=Math.max(0,w),down=Math.max(0,-w);
    const wet=0.25+0.75*oroSmooth(0.35,1.05,rh);
    core.windwardLiftIndex[i]=oroClamp(oroSmooth(0.03,0.75,up)*wet,0,1);
    /* Rain shadow is a diagnostic of active descending flow. The actual
       drying is thermodynamic: descent warms the air while windward
       condensation/precipitation has already removed part of its H2O. */
    core.rainShadowIndex[i]=oroClamp(oroSmooth(0.03,0.75,down),0,1);
  }
  return core;
}

const weatherCoreCreateBeforeOrographicLift=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeOrographicLift(seed,N,climate,axis);
  oroEnsureFields(core);
  return core;
};

const weatherCoreStepBeforeOrographicLift=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeOrographicLift(core,dtSec,climate,axis);
  orographicApplyThermodynamics(core,dtSec,climate);
  return core;
};

const weatherCoreFiniteBeforeOrographicLift=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeOrographicLift(core)) return false;
  for(const k of ['orographicSlopeE','orographicSlopeN','orographicVerticalVelocity','orographicDeltaT','windwardLiftIndex','rainShadowIndex']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])) return false;
  }
  for(let i=0;i<core.count;i++){
    if(core.windwardLiftIndex[i]<0||core.windwardLiftIndex[i]>1.000001) return false;
    if(core.rainShadowIndex[i]<0||core.rainShadowIndex[i]>1.000001) return false;
  }
  return true;
};

function orographicDiagnostics(core){
  if(!core?.orographicVerticalVelocity) return {lift:NaN,down:NaN,dT:NaN,shadow:NaN};
  let sw=0,lift=0,down=0,dT=0,shadow=0;let liftMax=0,shadowMax=0;
  for(let i=0;i<core.count;i++){
    const a=Math.max(1e-12,core.areaWeight?.[i]||1),w=core.orographicVerticalVelocity[i];
    sw+=a;lift+=a*Math.max(0,w);down+=a*Math.max(0,-w);dT+=a*core.orographicDeltaT[i];shadow+=a*core.rainShadowIndex[i];
    if(w>liftMax)liftMax=w;if(core.rainShadowIndex[i]>shadowMax)shadowMax=core.rainShadowIndex[i];
  }
  const q=Math.max(1e-12,sw);
  return {lift:lift/q,liftMax,down:down/q,dT:dT/q,shadow:shadow/q,shadowMax};
}

if(typeof createPanel==='function'){
  const createPanelBeforeOrographicLift=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeOrographicLift(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-oro="lift"]')){
        appendWeatherCoreRow(box,'Орографический подъём','oro-lift');
        const a=box.lastElementChild?.querySelector('[data-weathercore="oro-lift"]');if(a){delete a.dataset.weathercore;a.dataset.oro='lift';}
        appendWeatherCoreRow(box,'Rain shadow','oro-shadow');
        const b=box.lastElementChild?.querySelector('[data-weathercore="oro-shadow"]');if(b){delete b.dataset.weathercore;b.dataset.oro='shadow';}
        appendWeatherCoreRow(box,'Орографический ΔT','oro-dt');
        const c=box.lastElementChild?.querySelector('[data-weathercore="oro-dt"]');if(c){delete c.dataset.weathercore;c.dataset.oro='dt';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeOrographicLift=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeOrographicLift();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag');if(!box) return;
    const core=weatherCoreEnsure();if(!core?.orographicVerticalVelocity) return;
    const d=orographicDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-oro="'+k+'"]');if(e)e.textContent=v;};
    set('lift',d.lift.toFixed(3)+' / '+d.liftMax.toFixed(2)+' м/с mean/max');
    set('shadow',(100*d.shadow).toFixed(1)+' / '+(100*d.shadowMax).toFixed(0)+'%');
    set('dt',(d.dT>=0?'+':'')+d.dT.toFixed(3)+' K/тик');
  };
}
