/* ============ 0.5.56 / 0.5.65: physical near-surface fog ============ */
/*
   Fog is a persistent near-surface weather state, not a latitude/coast/
   terminator mask. Formation requires genuinely near-saturated air together
   with a low condensation level, weak mixing and stable/cooling conditions.

   0.5.65 fixes runaway Earth-like fog. Weather Core advances five simulated
   minutes every real second, so the old broad RH gate beginning at 86% plus a
   45-minute formation time could turn a merely humid +21 C planet into an
   opaque global bank in seconds. Ordinary humid air is no longer enough:
   near-saturation AND near-ground condensation must coincide. Formation is
   slower, dissipation quicker, and optical depth is capped below an opaque
   whiteout. Genuine saturated calm basins/coasts can still grow persistent
   fog causally.
*/

const PHYSICAL_FOG_MODEL=1;
const FOG_FORM_TAU_SEC=90*60;
const FOG_DISSIPATE_TAU_SEC=24*60;
const FOG_ADVECT_EDGE_CFL=0.18;
const FOG_ADVECT_MAX_OUTFLOW=0.46;
const FOG_MAX_DEPTH_M=620;
const FOG_MAX_OPTICAL_DEPTH=0.72;

function fogClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function fogSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=fogClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function fogEnsureFields(core){
  if(!core?.count)return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['fogState','fogTarget','fogOpticalDepth','fogDepthM','fogFormationWeight','fogDissipationWeight'])f32(k);
  if(!core.fogMassDelta||core.fogMassDelta.length!==n)core.fogMassDelta=new Float64Array(n);
  if(!core.fogOutMass||core.fogOutMass.length!==n)core.fogOutMass=new Float64Array(n);
  const edges=core.h2oEdgeI?.length||0;
  if(edges&&(!core.fogEdgeFlux||core.fogEdgeFlux.length!==edges))core.fogEdgeFlux=new Float64Array(edges);
  core.physicalFogModel=PHYSICAL_FOG_MODEL;
  return core;
}
function fogRelativeHumidity(core,i){
  return fogClamp(core.relativeHumidity?.[i]??core.humidity?.[i]??0,0,1.5);
}
function fogWindSpeed(core,i){
  const u=Number((core.windStateU||core.windU)?.[i])||0;
  const v=Number((core.windStateV||core.windV)?.[i])||0;
  return Math.hypot(u,v);
}
function fogWetness(core,i){
  const ocean=fogClamp(core.surfaceWaterFraction?.[i]||0,0,1);
  const puddle=fogSmooth(0.02,1.5,Math.max(0,Number(core.surfaceLiquidWater?.[i])||0));
  let soil=0;
  const cap=Math.max(0,Number(core.soilCapacity?.[i])||0);
  if(cap>1e-6)soil=fogClamp((Number(core.soilMoisture?.[i])||0)/cap,0,1);
  const rain=fogSmooth(1e-7,2e-4,Math.max(0,Number(core.precipRainRate?.[i]??core.precipRate?.[i])||0));
  return fogClamp(Math.max(ocean,puddle,0.75*soil,0.75*rain),0,1);
}
function fogCellForcing(core,i,out){
  const rh=fogRelativeHumidity(core,i);
  const Ta=fogClamp(core.airTemp?.[i]??273.15,150,1200);
  const Ts=fogClamp(core.surfaceTemp?.[i]??Ta,150,1200);
  const wind=fogWindSpeed(core,i);
  const wet=fogWetness(core,i);
  const stability=fogClamp(core.bulkStabilityIndex?.[i]??0.5,0,1);
  const deep=fogClamp(core.deepConvectiveState?.[i]??0,0,1);
  let lcl=Number(core.lclHeightM?.[i]);
  if(!Number.isFinite(lcl)){
    const H=Math.max(500,Number(core.scaleHeight?.[i])||8500);
    lcl=(typeof verticalLclHeightM==='function')?verticalLclHeightM(Ta,rh,H):Math.max(0,(1-rh)*1800);
  }
  lcl=fogClamp(lcl,0,5000);
  let dew=Ta;
  if(typeof verticalDewPointK==='function')dew=verticalDewPointK(Ta,fogClamp(rh,1e-6,1));
  else dew=Ta-Math.max(0,lcl/125);
  const dewDef=Math.max(0,Ta-dew);

  /* Fog is condensation at the ground, not generic humid haze. Require the
     three related indicators to agree instead of allowing the maximum of one
     loose gate to carry the whole formation term. */
  const saturation=fogSmooth(0.925,1.005,rh);
  const dewGate=1-fogSmooth(0.65,3.0,dewDef);
  const lclGate=1-fogSmooth(100,760,lcl);
  const nearGround=Math.sqrt(Math.max(0,dewGate*lclGate));
  const calm=1-fogSmooth(4.0,10.0,wind);
  const stable=fogSmooth(0.50,0.88,stability);
  const surfaceCooling=fogSmooth(-0.25,2.2,Ta-Ts); /* surface <= air favours radiation fog */
  const support=fogClamp(0.46+0.23*stable+0.17*surfaceCooling+0.14*wet,0,1.05);
  let formation=saturation*nearGround*calm*support;
  formation=Math.pow(fogClamp(formation,0,1),1.22);
  formation*=1-0.84*deep;

  /* Humid-but-unsaturated air should actively clear rather than sit at a high
     neutral target forever. */
  const dry=1-fogSmooth(0.80,0.94,rh);
  const windMix=fogSmooth(6.5,15.0,wind);
  const surfaceHeating=fogSmooth(0.6,4.0,Ts-Ta);
  const turbulent=fogClamp(0.58*deep+0.25*(1-stability)+0.22*windMix,0,1);
  const dissipation=fogClamp(Math.max(dry,windMix,0.82*surfaceHeating,0.74*turbulent),0,1);
  const target=fogClamp(formation*(1-0.95*dissipation),0,1);

  out.rh=rh;out.wind=wind;out.wet=wet;out.lcl=lcl;out.dewDef=dewDef;
  out.formation=fogClamp(formation,0,1);out.dissipation=dissipation;out.target=target;out.stability=stability;
  return out;
}
function fogAdvect(core,dtSec){
  const nEdge=core.h2oEdgeI?.length||0;
  if(!nEdge||!core.fogState)return 0;
  fogEnsureFields(core);
  const flux=core.fogEdgeFlux,delta=core.fogMassDelta,out=core.fogOutMass;
  flux.fill(0);delta.fill(0);out.fill(0);
  const wu=core.windStateU||core.windU,wv=core.windStateV||core.windV;
  const dt=Math.max(0,Number(dtSec)||0);
  for(let e=0;e<nEdge;e++){
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e];
    const vi=wu[i]*core.h2oEdgeIE[e]+wv[i]*core.h2oEdgeIN[e];
    const vj=wu[j]*core.h2oEdgeJE[e]+wv[j]*core.h2oEdgeJN[e];
    const edgeV=0.5*(vi-vj);
    const frac=Math.min(FOG_ADVECT_EDGE_CFL,Math.abs(edgeV)*dt/Math.max(1,core.h2oEdgeDistance[e]));
    if(!(frac>0))continue;
    const donor=edgeV>=0?i:j;
    const quantity=fogClamp(core.fogState[donor],0,1)*Math.max(1e-12,core.areaWeight?.[donor]||1);
    const signed=(edgeV>=0?1:-1)*quantity*frac;
    flux[e]=signed;out[donor]+=Math.abs(signed);
  }
  for(let e=0;e<nEdge;e++){
    let dm=flux[e];if(dm===0)continue;
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e],donor=dm>0?i:j;
    const quantity=fogClamp(core.fogState[donor],0,1)*Math.max(1e-12,core.areaWeight?.[donor]||1);
    const scale=out[donor]>FOG_ADVECT_MAX_OUTFLOW*quantity
      ?FOG_ADVECT_MAX_OUTFLOW*quantity/Math.max(1e-30,out[donor]):1;
    dm*=scale;delta[i]-=dm;delta[j]+=dm;
  }
  let moved=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    moved+=Math.abs(delta[i]);
    core.fogState[i]=fogClamp((core.fogState[i]*w+delta[i])/w,0,1);
  }
  return moved*0.5;
}
function fogAdvanceValue(current,target,dtSec,formation,dissipation){
  current=fogClamp(current,0,1);target=fogClamp(target,0,1);
  let tau;
  if(target>current){
    tau=FOG_FORM_TAU_SEC*(1.55-0.72*fogClamp(formation,0,1));
  }else{
    tau=FOG_DISSIPATE_TAU_SEC/(0.58+1.05*fogClamp(dissipation,0,1));
  }
  tau=Math.max(7*60,tau);
  const a=1-Math.exp(-Math.max(0,dtSec)/tau);
  return fogClamp(current+(target-current)*a,0,1);
}
function fogRefreshDerived(core){
  if(!core?.fogState)return core;
  for(let i=0;i<core.count;i++){
    const s=fogClamp(core.fogState[i],0,1);
    const rh=fogRelativeHumidity(core,i);
    const lcl=fogClamp(core.lclHeightM?.[i]??700,0,2000);
    const stable=fogClamp(core.bulkStabilityIndex?.[i]??0.5,0,1);
    const optical=s*(0.48+0.36*fogSmooth(0.925,1.01,rh));
    core.fogOpticalDepth[i]=fogClamp(optical,0,FOG_MAX_OPTICAL_DEPTH);
    const depth=fogClamp(55+0.30*lcl+215*stable,55,FOG_MAX_DEPTH_M);
    core.fogDepthM[i]=s*depth;
  }
  return core;
}
function fogStep(core,dtSec){
  if(!core?.count)return core;
  fogEnsureFields(core);
  const dt=fogClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  core.fogAdvected=fogAdvect(core,dt);
  const f={};
  for(let i=0;i<core.count;i++){
    fogCellForcing(core,i,f);
    core.fogFormationWeight[i]=f.formation;
    core.fogDissipationWeight[i]=f.dissipation;
    core.fogTarget[i]=f.target;
    core.fogState[i]=fogAdvanceValue(core.fogState[i],f.target,dt,f.formation,f.dissipation);
  }
  fogRefreshDerived(core);
  return core;
}

const weatherCoreCreateBeforePhysicalFog=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforePhysicalFog(seed,N,climate,axis);
  fogEnsureFields(core);
  fogRefreshDerived(core);
  return core;
};
const weatherCoreStepBeforePhysicalFog=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforePhysicalFog(core,dtSec,climate,axis);
  return fogStep(core,dtSec);
};
const weatherCoreFiniteBeforePhysicalFog=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforePhysicalFog(core))return false;
  for(const k of ['fogState','fogTarget','fogOpticalDepth','fogDepthM','fogFormationWeight','fogDissipationWeight']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i])||a[i]<0)return false;
  }
  return true;
};
function fogDiagnostics(core){
  if(!core?.fogState)return {cover:NaN,optical:NaN,depth:NaN,max:NaN};
  let ws=0,cover=0,opt=0,depth=0,max=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);ws+=w;
    const s=fogClamp(core.fogState[i],0,1);if(s>0.16)cover+=w;
    opt+=w*core.fogOpticalDepth[i];depth+=w*core.fogDepthM[i];if(s>max)max=s;
  }
  ws=Math.max(1e-12,ws);return {cover:cover/ws,optical:opt/ws,depth:depth/ws,max};
}
if(typeof createPanel==='function'){
  const createPanelBeforePhysicalFog=createPanel;
  createPanel=function(group){
    const el=createPanelBeforePhysicalFog(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-physicalfog="state"]')){
        appendWeatherCoreRow(box,'Туман cover / max','physicalfog-state');
        const a=box.lastElementChild?.querySelector('[data-weathercore="physicalfog-state"]');if(a){delete a.dataset.weathercore;a.dataset.physicalfog='state';}
        appendWeatherCoreRow(box,'Туман оптика / глубина','physicalfog-optics');
        const b=box.lastElementChild?.querySelector('[data-weathercore="physicalfog-optics"]');if(b){delete b.dataset.weathercore;b.dataset.physicalfog='optics';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforePhysicalFog=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforePhysicalFog();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.fogState)return;
    const d=fogDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-physicalfog="'+k+'"]');if(e)e.textContent=v;};
    set('state',(100*d.cover).toFixed(0)+'% / '+d.max.toFixed(2));
    set('optics',d.optical.toFixed(2)+' / '+d.depth.toFixed(0)+' м');
  };
}
