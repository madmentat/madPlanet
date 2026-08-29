/* ============ 0.5.59: ocean mixed-layer heat / SST ============ */
/*
   The physical surface now has separate land-skin and ocean mixed-layer
   thermal reservoirs. Existing local-energy + cloud-radiative modules still
   own the radiative flux calculation; this module consumes their final
   netRadiation once per fixed Weather Core tick and makes the two reservoirs
   authoritative for surfaceTemp.

   Ocean heat storage is intentionally a compact mixed-layer model, not a full
   circulation model. A conservative neighbour exchange spreads SST only
   between connected wet cells on the existing H2O edge graph. It transports
   heat, never H2O, pressure or momentum. Evaporation/fog downstream continue
   reading core.surfaceTemp, which over open-ocean cells is now the resolved
   SST and over land is the fast land skin temperature.
*/

const OCEAN_THERMAL_MODEL=1;
const OCEAN_WATER_RHO_CP=4.08e6;              /* J m^-3 K^-1, seawater volumetric heat capacity */
const OCEAN_MIXED_LAYER_BASE_M=35.0;
const OCEAN_MIXED_LAYER_MIN_M=8.0;
const OCEAN_MIXED_LAYER_MAX_M=85.0;
const OCEAN_LAND_HEAT_CAPACITY=1.6e7;         /* J m^-2 K^-1, same land-skin scale as 0.5.40 */
const OCEAN_HORIZONTAL_DIFFUSIVITY_M2_S=1.8e5;/* unresolved eddy/mixed-layer heat spreading */
const OCEAN_EDGE_MAX_MIX=0.025;

function oceanClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function oceanSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=oceanClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function oceanWaterFraction(core,i){return oceanClamp(core?.surfaceWaterFraction?.[i]||0,0,1);}
function oceanWindSpeed(core,i){
  const u=Number((core.windStateU||core.windU)?.[i])||0;
  const v=Number((core.windStateV||core.windV)?.[i])||0;
  return Math.hypot(u,v);
}
function oceanMixedLayerDepthM(core,i){
  const wind=oceanWindSpeed(core,i);
  const deep=oceanClamp(core.deepConvectiveState?.[i]||0,0,1);
  const storm=oceanSmooth(4,18,wind);
  return oceanClamp(OCEAN_MIXED_LAYER_BASE_M+24*storm+14*deep,
    OCEAN_MIXED_LAYER_MIN_M,OCEAN_MIXED_LAYER_MAX_M);
}
function oceanHeatCapacityJm2K(core,i){
  return OCEAN_WATER_RHO_CP*oceanMixedLayerDepthM(core,i);
}
function oceanEffectiveSurfaceTemp(core,i){
  const w=oceanWaterFraction(core,i);
  const land=Number(core.landSurfaceTemp?.[i]);
  const sea=Number(core.seaSurfaceTemp?.[i]);
  const fallback=Number(core.surfaceTemp?.[i])||273.15;
  return (Number.isFinite(land)?land:fallback)*(1-w)+(Number.isFinite(sea)?sea:fallback)*w;
}
function oceanEnsureFields(core){
  if(!core?.count)return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['landSurfaceTemp','seaSurfaceTemp','mixedLayerDepthM','oceanHeatCapacity','surfaceThermalInertia'])f32(k);
  if(!core.oceanHeatDelta||core.oceanHeatDelta.length!==n)core.oceanHeatDelta=new Float64Array(n);
  core.oceanThermalModel=OCEAN_THERMAL_MODEL;
  return core;
}
function oceanInitialize(core){
  if(!core?.count)return core;
  oceanEnsureFields(core);
  for(let i=0;i<core.count;i++){
    const T=oceanClamp(core.surfaceTemp?.[i]??273.15,80,1600);
    core.landSurfaceTemp[i]=T;
    core.seaSurfaceTemp[i]=T;
    const depth=oceanMixedLayerDepthM(core,i);
    const cap=OCEAN_WATER_RHO_CP*depth;
    core.mixedLayerDepthM[i]=depth;
    core.oceanHeatCapacity[i]=cap;
    const w=oceanWaterFraction(core,i);
    core.surfaceThermalInertia[i]=OCEAN_LAND_HEAT_CAPACITY*(1-w)+cap*w;
    core.surfaceTemp[i]=T;
  }
  return core;
}
function oceanIntegrateRadiation(core,dtSec){
  const dt=oceanClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  for(let i=0;i<core.count;i++){
    const net=Number(core.netRadiation?.[i])||0;
    const depth=oceanMixedLayerDepthM(core,i);
    const oceanCap=Math.max(1e6,OCEAN_WATER_RHO_CP*depth);
    core.mixedLayerDepthM[i]=depth;
    core.oceanHeatCapacity[i]=oceanCap;
    core.landSurfaceTemp[i]=oceanClamp(core.landSurfaceTemp[i]+net*dt/OCEAN_LAND_HEAT_CAPACITY,80,1600);
    core.seaSurfaceTemp[i]=oceanClamp(core.seaSurfaceTemp[i]+net*dt/oceanCap,80,1600);
  }
  return core;
}
function oceanDiffuseSST(core,dtSec){
  const edges=core?.h2oEdgeI?.length||0;
  if(!edges||!core.seaSurfaceTemp)return 0;
  const dt=oceanClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  const delta=core.oceanHeatDelta;delta.fill(0);
  let moved=0;
  for(let e=0;e<edges;e++){
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e];
    const wi=oceanWaterFraction(core,i),wj=oceanWaterFraction(core,j);
    const wet=Math.min(wi,wj);
    if(wet<0.05)continue;
    const Ti=core.seaSurfaceTemp[i],Tj=core.seaSurfaceTemp[j];
    const dT=Ti-Tj;if(Math.abs(dT)<1e-9)continue;
    const ai=Math.max(1e-12,core.areaWeight?.[i]||1)*wi;
    const aj=Math.max(1e-12,core.areaWeight?.[j]||1)*wj;
    const Ci=Math.max(1e6,core.oceanHeatCapacity[i])*ai;
    const Cj=Math.max(1e6,core.oceanHeatCapacity[j])*aj;
    const exchangeCap=Math.min(Ci,Cj);
    const L=Math.max(1,Number(core.h2oEdgeDistance?.[e])||1);
    const mix=Math.min(OCEAN_EDGE_MAX_MIX,OCEAN_HORIZONTAL_DIFFUSIVITY_M2_S*dt/(L*L))*wet;
    const q=dT*exchangeCap*mix;
    delta[i]-=q;delta[j]+=q;moved+=Math.abs(q);
  }
  for(let i=0;i<core.count;i++){
    const w=oceanWaterFraction(core,i);if(w<0.001)continue;
    const area=Math.max(1e-12,core.areaWeight?.[i]||1)*w;
    const cap=Math.max(1e6,core.oceanHeatCapacity[i])*area;
    core.seaSurfaceTemp[i]=oceanClamp(core.seaSurfaceTemp[i]+delta[i]/Math.max(1e-12,cap),80,1600);
  }
  return 0.5*moved;
}
function oceanPublishSurface(core){
  for(let i=0;i<core.count;i++){
    const w=oceanWaterFraction(core,i);
    const cap=Math.max(1e6,core.oceanHeatCapacity[i]);
    core.surfaceThermalInertia[i]=OCEAN_LAND_HEAT_CAPACITY*(1-w)+cap*w;
    core.surfaceTemp[i]=oceanEffectiveSurfaceTemp(core,i);
  }
  return core;
}
function oceanStep(core,dtSec){
  if(!core?.count)return core;
  oceanEnsureFields(core);
  oceanIntegrateRadiation(core,dtSec);
  core.oceanHeatMovedJ=oceanDiffuseSST(core,dtSec);
  oceanPublishSurface(core);
  return core;
}

const weatherCoreCreateBeforeOceanThermal=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeOceanThermal(seed,N,climate,axis);
  return oceanInitialize(core);
};
const weatherCoreStepBeforeOceanThermal=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core?.count)return core;
  /* Preserve the authoritative reservoirs from the previous tick. The wrapped
     chain computes the current clear+cloud radiative diagnostics and may make
     a trial surfaceTemp update with the old blended capacity; that trial is
     intentionally replaced below by the two-reservoir integration. */
  weatherCoreStepBeforeOceanThermal(core,dtSec,climate,axis);
  return oceanStep(core,dtSec);
};
const weatherCoreFiniteBeforeOceanThermal=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeOceanThermal(core))return false;
  for(const k of ['landSurfaceTemp','seaSurfaceTemp','mixedLayerDepthM','oceanHeatCapacity','surfaceThermalInertia']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  return true;
};
function oceanDiagnostics(core){
  if(!core?.seaSurfaceTemp)return {land:NaN,sea:NaN,contrast:NaN,depth:NaN};
  let wl=0,ws=0,tl=0,ts=0,depth=0;
  for(let i=0;i<core.count;i++){
    const a=Math.max(1e-12,core.areaWeight?.[i]||1),w=oceanWaterFraction(core,i);
    const l=a*(1-w),s=a*w;wl+=l;ws+=s;tl+=l*core.landSurfaceTemp[i];ts+=s*core.seaSurfaceTemp[i];depth+=s*core.mixedLayerDepthM[i];
  }
  const land=tl/Math.max(1e-12,wl),sea=ts/Math.max(1e-12,ws);
  return {land,sea,contrast:land-sea,depth:depth/Math.max(1e-12,ws)};
}
if(typeof createPanel==='function'){
  const createPanelBeforeOceanThermal=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeOceanThermal(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-oceanthermal="temps"]')){
        appendWeatherCoreRow(box,'Land / SST mean','oceanthermal-temps');
        const a=box.lastElementChild?.querySelector('[data-weathercore="oceanthermal-temps"]');if(a){delete a.dataset.weathercore;a.dataset.oceanthermal='temps';}
        appendWeatherCoreRow(box,'SST mixed layer','oceanthermal-depth');
        const b=box.lastElementChild?.querySelector('[data-weathercore="oceanthermal-depth"]');if(b){delete b.dataset.weathercore;b.dataset.oceanthermal='depth';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeOceanThermal=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeOceanThermal();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.seaSurfaceTemp)return;
    const d=oceanDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-oceanthermal="'+k+'"]');if(e)e.textContent=v;};
    set('temps',(d.land-273.15).toFixed(1)+' / '+(d.sea-273.15).toFixed(1)+' °C');
    set('depth',d.depth.toFixed(0)+' м · Δ '+(d.contrast>=0?'+':'')+d.contrast.toFixed(1)+' K');
  };
}
