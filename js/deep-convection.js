/* ============ 0.5.51: deep moist convection ============ */
/*
   Weather Core v13 adds a compact sub-grid deep-convection diagnosis. This is
   not a fake 3-D atmosphere and it does not move the whole grid cell upward at
   thunderstorm updraft speeds. Instead, local surface/air thermal contrast,
   moisture, LCL, scale height and resolved large-scale lift diagnose CAPE/CIN
   proxies and a persistent convective-plume state.

   CAPE follows the parcel-energy idea: when the environment cools with height
   faster than a moist parcel, positive buoyancy grows with height and the
   vertically integrated buoyancy becomes available kinetic energy. CIN is the
   corresponding low-level negative-buoyancy barrier plus a dry/high-LCL
   penalty. Orographic, frontal and cyclone ascent can erode that barrier;
   anticyclonic subsidence suppresses the trigger.

   deepUpdraftMS is a sub-grid plume speed derived from sqrt(2*CAPE), not a
   resolved grid vertical velocity. This module never edits temperature,
   pressure, wind, vapor or condensate. Existing condensation/precipitation
   modules may use the previous-tick deepConvectiveState to shorten their phase
   conversion times; latent heat and H2O ownership stay with those modules.
*/

const DEEP_CONVECTION_MODEL = 1;
const DEEP_DRY_LAPSE_K_M = 0.0098;
const DEEP_MOIST_LAPSE_K_M = 0.0060;
const DEEP_LCL_M_PER_K = 125.0;
const DEEP_CAPE_MAX_J_KG = 6500.0;
const DEEP_CIN_MAX_J_KG = 1800.0;
const DEEP_CAPE_TRIGGER_J_KG = 120.0;
const DEEP_CAPE_STRONG_J_KG = 2200.0;
const DEEP_CIN_WEAK_J_KG = 80.0;
const DEEP_CIN_STRONG_J_KG = 850.0;
const DEEP_MAX_UPDRAFT_MS = 45.0;
const DEEP_GROW_TAU_SEC = 600.0;
const DEEP_DECAY_TAU_SEC = 1800.0;
const DEEP_MAX_TOP_SCALE = 1.80;

function deepClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function deepSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=deepClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function deepGravityMS2(climate){
  if(Number.isFinite(climate?.gravityMS2)&&climate.gravityMS2>0) return deepClamp(climate.gravityMS2,0.05,80);
  if(typeof h2oGravityMS2==='function') return deepClamp(h2oGravityMS2(climate),0.05,80);
  return 9.80665;
}
function deepScaleHeightM(core,i,climate){
  const h=Number(core?.scaleHeight?.[i]);
  if(Number.isFinite(h)&&h>0) return deepClamp(h,500,120000);
  const T=deepClamp(core?.airTemp?.[i]??climate?.T??288.15,80,1400);
  const g=deepGravityMS2(climate);
  const M=deepClamp(climate?.meanMolarMassKg||0.02897,0.001,0.2);
  return deepClamp(8.314462618*T/(M*g),500,120000);
}
function deepDewPointK(T,rh){
  T=deepClamp(T,173.15,373.15);rh=deepClamp(rh,1e-6,1);
  const tc=deepClamp(T-273.15,-80,60),a=17.625,b=243.04;
  const gamma=Math.log(rh)+a*tc/(b+tc);
  return deepClamp(b*gamma/(a-gamma)+273.15,173.15,T);
}
function deepLclHeightM(T,rh,H){
  const td=deepDewPointK(T,rh);
  return deepClamp(DEEP_LCL_M_PER_K*Math.max(0,T-td),0,DEEP_MAX_TOP_SCALE*H*0.98);
}
function deepRelativeHumidity(core,i){
  const rh=Number(core?.relativeHumidity?.[i]);
  if(Number.isFinite(rh)) return deepClamp(rh,0,2);
  return deepClamp(core?.humidity?.[i]||0,0,2);
}
function deepAirDensity(core,i,climate){
  const rho=Number(core?.airDensity?.[i]);
  if(Number.isFinite(rho)&&rho>0) return deepClamp(rho,1e-5,100);
  const p=Math.max(1,Number(core?.pressure?.[i])||Math.max(1,Number(climate?.pressureBar)||1)*1e5);
  const T=deepClamp(core?.airTemp?.[i]??climate?.T??288.15,80,1400);
  const M=deepClamp(climate?.meanMolarMassKg||0.02897,0.001,0.2);
  return deepClamp(p*M/(8.314462618*T),1e-5,100);
}
function deepAirColumnKgM2(core,i,climate){
  const g=deepGravityMS2(climate);
  const p=Math.max(1,Number(core?.pressure?.[i])||Math.max(1,Number(climate?.pressureBar)||1)*1e5);
  return p/g;
}

function deepEnsureFields(core){
  if(!core||!core.count) return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n) core[k]=new Float32Array(n);};
  for(const k of [
    'capeProxyJkg','cinProxyJkg','deepConvectionTarget','deepConvectiveState',
    'deepUpdraftMS','deepPlumeAreaFraction','deepMoistureFluxKgM2S',
    'deepConvectiveTopTargetM','deepForcingIndex','deepMoistureGate'
  ]) f32(k);
  core.deepConvectionModel=DEEP_CONVECTION_MODEL;
  return core;
}

function deepCellDiagnosis(core,i,climate,out){
  const Ts=deepClamp(core.surfaceTemp[i],80,1400);
  const Ta=deepClamp(core.airTemp[i],80,1400);
  const H=deepScaleHeightM(core,i,climate);
  const g=deepGravityMS2(climate);
  const rh=deepRelativeHumidity(core,i);
  const zRef=deepClamp(0.12*H,350,1800);
  const moist=deepSmooth(0.52,0.96,deepClamp(rh,0,1));
  const parcelGamma=DEEP_DRY_LAPSE_K_M+(DEEP_MOIST_LAPSE_K_M-DEEP_DRY_LAPSE_K_M)*moist;
  const envGamma=deepClamp((Ts-Ta)/Math.max(100,zRef),-0.025,0.032);
  const excess=envGamma-parcelGamma;
  const lcl=deepLclHeightM(Ta,rh,H);
  const moistureGate=deepSmooth(0.52,0.90,deepClamp(rh,0,1))*(1-deepSmooth(1800,4400,lcl));

  const oroW=Math.max(0,Number(core.orographicVerticalVelocity?.[i])||0);
  const frontW=Math.max(0,Number(core.frontVerticalVelocity?.[i])||0);
  const systemW=Number(core.systemVerticalVelocity?.[i])||0;
  const systemUp=Math.max(0,systemW),systemDown=Math.max(0,-systemW);
  const resolvedLift=oroW+frontW+systemUp;
  const forcing=deepClamp(
    0.45*deepSmooth(0.03,1.1,resolvedLift)
    +0.30*deepClamp(core.frontStrength?.[i]||0,0,1)
    +0.25*deepClamp(core.cycloneStrength?.[i]||0,0,1),0,1);
  const subsidence=deepSmooth(0.04,0.60,systemDown);

  /* Integral of linearly growing parcel temperature advantage:
       CAPE ~= g/T * integral((Gamma_env-Gamma_parcel) z dz)
            ~= g/T * 0.5 * dGamma * depth^2.
     Depth is limited to the part of the column a moist plume can plausibly
     sample in this one-column approximation. */
  const capeDepth=H*deepClamp(0.72+0.55*moistureGate+0.18*forcing,0.65,1.42);
  let cape=g/Math.max(80,Ta)*0.5*Math.max(0,excess)*capeDepth*capeDepth;
  cape*=0.38+0.62*moistureGate;
  cape=deepClamp(cape,0,DEEP_CAPE_MAX_J_KG);

  const capDepth=deepClamp(lcl+0.10*H,450,0.62*H);
  const thermalCin=g/Math.max(80,Ta)*0.5*Math.max(0,-excess)*capDepth*capDepth;
  const dryCin=520*deepSmooth(1500,4300,lcl)*(1-0.55*forcing);
  let cin=deepClamp(thermalCin+dryCin,0,DEEP_CIN_MAX_J_KG);
  cin*=1-0.76*forcing;
  cin+=480*subsidence;
  cin=deepClamp(cin,0,DEEP_CIN_MAX_J_KG);

  const capeGate=deepSmooth(DEEP_CAPE_TRIGGER_J_KG,DEEP_CAPE_STRONG_J_KG,cape);
  const cinGate=1-deepSmooth(DEEP_CIN_WEAK_J_KG,DEEP_CIN_STRONG_J_KG,cin);
  let target=capeGate*moistureGate*cinGate*(0.72+0.28*forcing)*(1-0.92*subsidence);
  target=deepClamp(target,0,1);

  out.Ta=Ta;out.H=H;out.rh=rh;out.lcl=lcl;out.envGamma=envGamma;out.parcelGamma=parcelGamma;
  out.cape=cape;out.cin=cin;out.target=target;out.forcing=forcing;out.moistureGate=moistureGate;
  return out;
}

function deepRefresh(core,dtSec,climate,initialize=false){
  if(!core||!core.count) return core;
  deepEnsureFields(core);
  const dt=Math.max(0,Number(dtSec)||0),s={};
  for(let i=0;i<core.count;i++){
    deepCellDiagnosis(core,i,climate,s);
    let stateNow=deepClamp(core.deepConvectiveState[i],0,1);
    if(initialize) stateNow=s.target;
    else{
      const tau=s.target>stateNow?DEEP_GROW_TAU_SEC:DEEP_DECAY_TAU_SEC;
      const a=1-Math.exp(-dt/Math.max(1,tau));
      stateNow=deepClamp(stateNow+(s.target-stateNow)*a,0,1);
    }

    const available=Math.max(0,s.cape-s.cin);
    const plumeEfficiency=0.54*(0.45+0.55*s.moistureGate)*Math.sqrt(Math.max(0,stateNow));
    const updraft=deepClamp(Math.sqrt(2*available)*plumeEfficiency,0,DEEP_MAX_UPDRAFT_MS);
    const plumeArea=deepClamp(0.012+0.075*stateNow,0,0.10);
    const airColumn=Math.max(0.1,deepAirColumnKgM2(core,i,climate));
    const qv=deepClamp((core.vaporColumn?.[i]||0)/airColumn,0,0.25);
    const rho=deepAirDensity(core,i,climate);
    const moistureFlux=Math.max(0,rho*updraft*qv*plumeArea);
    const top=deepClamp(s.lcl+s.H*(0.28+1.45*stateNow),s.lcl,DEEP_MAX_TOP_SCALE*s.H);

    core.capeProxyJkg[i]=s.cape;
    core.cinProxyJkg[i]=s.cin;
    core.deepConvectionTarget[i]=s.target;
    core.deepConvectiveState[i]=stateNow;
    core.deepUpdraftMS[i]=updraft;
    core.deepPlumeAreaFraction[i]=plumeArea;
    core.deepMoistureFluxKgM2S[i]=moistureFlux;
    core.deepConvectiveTopTargetM[i]=top;
    core.deepForcingIndex[i]=s.forcing;
    core.deepMoistureGate[i]=s.moistureGate;
  }
  return core;
}

const weatherCoreCreateBeforeDeepConvection=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeDeepConvection(seed,N,climate,axis);
  deepEnsureFields(core);
  deepRefresh(core,WEATHER_CORE_FIXED_DT_SEC,climate,true);
  return core;
};

const weatherCoreStepBeforeDeepConvection=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeDeepConvection(core,dtSec,climate,axis);
  deepRefresh(core,weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC),climate,false);
  return core;
};

const weatherCoreFiniteBeforeDeepConvection=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeDeepConvection(core)) return false;
  const fields=['capeProxyJkg','cinProxyJkg','deepConvectionTarget','deepConvectiveState','deepUpdraftMS',
    'deepPlumeAreaFraction','deepMoistureFluxKgM2S','deepConvectiveTopTargetM','deepForcingIndex','deepMoistureGate'];
  for(const k of fields){
    const a=core?.[k];if(!a||a.length!==core.count) return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])||a[i]<0) return false;
  }
  for(let i=0;i<core.count;i++){
    if(core.deepConvectionTarget[i]>1.000001||core.deepConvectiveState[i]>1.000001) return false;
    if(core.deepUpdraftMS[i]>DEEP_MAX_UPDRAFT_MS+1e-6) return false;
    if(core.deepPlumeAreaFraction[i]>0.100001) return false;
    if(core.deepForcingIndex[i]>1.000001||core.deepMoistureGate[i]>1.000001) return false;
  }
  return true;
};

function deepConvectionDiagnostics(core){
  if(!core?.deepConvectiveState) return {coverage:NaN,cape:NaN,capeMax:NaN,updraft:NaN,flux:NaN};
  let sw=0,active=0,cape=0,capeMax=0,updraft=0,flux=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1),d=core.deepConvectiveState[i];sw+=w;
    if(d>0.35) active+=w;
    cape+=w*core.capeProxyJkg[i];capeMax=Math.max(capeMax,core.capeProxyJkg[i]);
    updraft=Math.max(updraft,core.deepUpdraftMS[i]);flux=Math.max(flux,core.deepMoistureFluxKgM2S[i]);
  }
  const den=Math.max(1e-12,sw);
  return {coverage:active/den,cape:cape/den,capeMax,updraft,flux};
}

if(typeof createPanel==='function'){
  const createPanelBeforeDeepConvection=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeDeepConvection(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-deep="cape"]')){
        appendWeatherCoreRow(box,'CAPE mean / max','deep-cape');
        const a=box.lastElementChild?.querySelector('[data-weathercore="deep-cape"]');if(a){delete a.dataset.weathercore;a.dataset.deep='cape';}
        appendWeatherCoreRow(box,'Глубокая конвекция','deep-coverage');
        const b=box.lastElementChild?.querySelector('[data-weathercore="deep-coverage"]');if(b){delete b.dataset.weathercore;b.dataset.deep='coverage';}
        appendWeatherCoreRow(box,'Convective updraft max','deep-updraft');
        const c=box.lastElementChild?.querySelector('[data-weathercore="deep-updraft"]');if(c){delete c.dataset.weathercore;c.dataset.deep='updraft';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeDeepConvection=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeDeepConvection();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag');if(!box) return;
    const core=weatherCoreEnsure();if(!core?.deepConvectiveState) return;
    const d=deepConvectionDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-deep="'+k+'"]');if(e)e.textContent=v;};
    set('cape',d.cape.toFixed(0)+' / '+d.capeMax.toFixed(0)+' J/kg');
    set('coverage',(100*d.coverage).toFixed(1)+'% ячеек');
    set('updraft',d.updraft.toFixed(1)+' м/с');
  };
}
