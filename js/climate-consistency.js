/* ============ 0.5.128: current-surface climate consistency ============ */
/*
   climateModel().T is a global radiative equilibrium / regime estimate. It is
   not the instantaneous mean temperature of the persistent Weather Core.
   Treating that forecast as the CURRENT water temperature reverses causality:
   a still-cold world can evaporate ocean according to a future hot attractor,
   adding H2O greenhouse before the surface has actually warmed.

   This layer keeps the two concepts explicit:
     - current surface = area-weighted Weather Core surfaceSkinTemp;
     - calculated regime = climateModel().T.
   H2O phase partition follows the current surface whenever that field exists.
   Before the first Weather Core exists (startup / candidate generation), the
   old equilibrium estimate remains the only available bootstrap temperature.
*/
const CLIMATE_CONSISTENCY_MODEL=1;
const CLIMATE_CONSISTENCY_SETTLE_MIN_STEPS=8;
const CLIMATE_CONSISTENCY_SETTLE_MAX_STEPS=28;

function climateConsistencyClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function climateConsistencySurfaceStats(core){
  if(!core?.count)return {meanK:NaN,minK:NaN,maxK:NaN,count:0};
  const field=(core.surfaceSkinTemp&&core.surfaceSkinTemp.length===core.count)
    ?core.surfaceSkinTemp:core.surfaceTemp;
  if(!field||field.length!==core.count)return {meanK:NaN,minK:NaN,maxK:NaN,count:0};
  let sw=0,st=0,mn=Infinity,mx=-Infinity,n=0;
  for(let i=0;i<core.count;i++){
    const T=Number(field[i]);if(!Number.isFinite(T))continue;
    const w=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
    sw+=w;st+=w*T;mn=Math.min(mn,T);mx=Math.max(mx,T);n++;
  }
  return {
    meanK:sw>0?st/sw:NaN,
    minK:Number.isFinite(mn)?mn:NaN,
    maxK:Number.isFinite(mx)?mx:NaN,
    count:n
  };
}
function climateConsistencyCurrentCore(){
  if(typeof weatherCore==='undefined'||!weatherCore)return null;
  if(typeof state!=='undefined'&&Number(weatherCore.seed)!==(state.seed|0))return null;
  return weatherCore;
}
function climateConsistencyCurrentSurfaceMeanK(){
  return climateConsistencySurfaceStats(climateConsistencyCurrentCore()).meanK;
}
function climateConsistencyCurrentSurfaceC(){
  const K=climateConsistencyCurrentSurfaceMeanK();return Number.isFinite(K)?K-273.15:NaN;
}

/* H2O phase state must follow the temperature the ocean/ice/land actually has,
   not the eventual radiative attractor. This is the physical fix for the
   runaway lead/lag loop; the equilibrium estimate remains the bootstrap when
   no current Weather Core exists yet. */
if(typeof waterTemperatureK==='function'){
  const waterTemperatureBeforeClimateConsistency=waterTemperatureK;
  waterTemperatureK=function(){
    const K=climateConsistencyCurrentSurfaceMeanK();
    if(Number.isFinite(K))return climateConsistencyClamp(K,120,900);
    return waterTemperatureBeforeClimateConsistency();
  };
}

/* The old immediate water solve used a fixed 3..5 passes. Near the moist
   greenhouse knee that can stop on an intermediate state which looks temperate
   for the Random-world acceptance test and then runs away seconds later.
   Iterate the same existing solver one pass at a time until T and vapour both
   settle, with a hard small bound because this path runs only at bootstrap /
   explicit world generation, never at render FPS. */
if(typeof settleWaterEquilibriumImmediate==='function'){
  const settleWaterBeforeClimateConsistency=settleWaterEquilibriumImmediate;
  settleWaterEquilibriumImmediate=function(iterations=5){
    const requested=Math.max(1,Math.round(Number(iterations)||5));
    const limit=Math.max(CLIMATE_CONSISTENCY_SETTLE_MIN_STEPS,
      Math.min(CLIMATE_CONSISTENCY_SETTLE_MAX_STEPS,requested*4));
    let out=null,prevT=NaN,prevV=NaN;
    for(let i=0;i<limit;i++){
      out=settleWaterBeforeClimateConsistency(1);
      let T=NaN;try{T=Number(climateModel()?.T);}catch(_e){}
      const V=Math.max(0,Number(state?.gasH2O)||0);
      if(i>=4&&Number.isFinite(T)&&Number.isFinite(prevT)){
        const dT=Math.abs(T-prevT);
        const dV=Math.abs(V-prevV)/Math.max(1e-8,1,Math.abs(V));
        if(dT<0.03&&dV<2e-6)break;
      }
      prevT=T;prevV=V;
    }
    return out;
  };
}

/* Random-world generation changes the seed and all physical causes at once.
   Build the new Weather Core before handing control back to the user so the
   headline, thermal probe and GPU fields cannot spend an interaction grace
   window displaying the previous world's climate. */
if(typeof generateCityReadyRandomWorld==='function'){
  const generateCityReadyRandomWorldBeforeConsistency=generateCityReadyRandomWorld;
  generateCityReadyRandomWorld=function(randomSource=Math.random){
    const result=generateCityReadyRandomWorldBeforeConsistency(randomSource);
    if(typeof settleWaterEquilibriumImmediate==='function')settleWaterEquilibriumImmediate(6);
    if(typeof weatherCoreEnsure==='function')weatherCoreEnsure();
    if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();
    return (typeof climateModel==='function')?climateModel():result;
  };
}

function climateConsistencyDecoratePanel(el){
  if(!el)return el;
  const climateBox=el.querySelector?.('#climateRegimeDiag');
  if(!climateBox)return el;
  const predicted=climateBox.querySelector('[data-climate="temp"]');
  if(predicted?.parentElement){
    const label=predicted.parentElement.querySelector('span');
    if(label)label.textContent='Расчётная T* режима';
  }
  if(!climateBox.querySelector('[data-climate-consistency="current"]')){
    const add=(label,key)=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
      const a=document.createElement('span');a.textContent=label;a.style.opacity='.62';
      const b=document.createElement('span');b.dataset.climateConsistency=key;b.style.textAlign='right';
      row.append(a,b);climateBox.appendChild(row);
    };
    add('Текущая T̄ поверхности','current');
    add('Текущая → расчётная','delta');
  }
  return el;
}
function refreshClimateConsistencyDiagnostics(){
  if(typeof document==='undefined')return;
  const box=document.getElementById('climateRegimeDiag');if(!box)return;
  const current=climateConsistencyCurrentSurfaceC();
  let target=NaN;try{target=Number(climateModel()?.C);}catch(_e){}
  const set=(k,v)=>{const e=box.querySelector('[data-climate-consistency="'+k+'"]');if(e)e.textContent=v;};
  const fmt=C=>Number.isFinite(C)?((C>=0?'+':'')+C.toFixed(1)+' °C'):'—';
  set('current',fmt(current));
  set('delta',Number.isFinite(current)&&Number.isFinite(target)
    ?fmt(current)+' → '+fmt(target):'—');
}
if(typeof createPanel==='function'){
  const createPanelBeforeClimateConsistency=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeClimateConsistency(group);
    if(group==='Планета')climateConsistencyDecoratePanel(el);
    refreshClimateConsistencyDiagnostics();
    return el;
  };
}
if(typeof refreshClimateDiagnostics==='function'){
  const refreshClimateDiagnosticsBeforeConsistency=refreshClimateDiagnostics;
  refreshClimateDiagnostics=function(){
    refreshClimateDiagnosticsBeforeConsistency();
    const el=(typeof document!=='undefined')?document.querySelector('.param-panel'):null;
    if(el)climateConsistencyDecoratePanel(el);
    refreshClimateConsistencyDiagnostics();
  };
}

/* T-bar in the corner is an observation, not a forecast. Keep the calculated
   regime in the Planet panel, but make the headline match the same physical
   field used by the thermal probe and thermal cubemap. */
let climateConsistencyTelemetryLastMs=-1e12;
if(typeof smoothTelemetryUpdate==='function'){
  const smoothTelemetryUpdateBeforeConsistency=smoothTelemetryUpdate;
  smoothTelemetryUpdate=function(now){
    smoothTelemetryUpdateBeforeConsistency(now);
    const t=Number(now)||((typeof performance!=='undefined')?performance.now():Date.now());
    if(t-climateConsistencyTelemetryLastMs<350)return;
    climateConsistencyTelemetryLastMs=t;
    const C=climateConsistencyCurrentSurfaceC();
    if(Number.isFinite(C)&&typeof smoothTelemetryText==='function'&&smoothTelemetryValues?.temp){
      smoothTelemetryText(smoothTelemetryValues.temp,(C>=0?'+':'')+C.toFixed(1)+' °C');
      let target=NaN;try{target=Number(climateModel()?.C);}catch(_e){}
      smoothTelemetryValues.temp.title='Текущая area-weighted температура поверхности'+
        (Number.isFinite(target)?'; расчётный климатический режим '+(target>=0?'+':'')+target.toFixed(1)+' °C':'');
    }
  };
}

/* Re-run the small bootstrap solve once after all climate/water wrappers are in
   place. The first RAF has only been scheduled by render.js at this point; it
   cannot run until this concatenated script finishes evaluating. */
try{
  if(typeof settleWaterEquilibriumImmediate==='function')settleWaterEquilibriumImmediate(5);
  if(typeof updateLegacyAtmoProxy==='function')updateLegacyAtmoProxy();
  if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();
}catch(_e){}

window.__madPlanetClimateConsistency={
  model:CLIMATE_CONSISTENCY_MODEL,
  surfaceStats:climateConsistencySurfaceStats,
  currentMeanK:climateConsistencyCurrentSurfaceMeanK,
  currentC:climateConsistencyCurrentSurfaceC
};
