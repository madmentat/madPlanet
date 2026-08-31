/* ============ 0.5.80: close-orbit climate + irreversible volatile history ============ */
/*
   0.5.79 correctly removed the accidental 900 K (=626.85 C) climate ceiling,
   but it exposed long-term atmospheric/water retention as an instantaneous
   equilibrium multiplier. Dragging a live world inward could therefore make
   its ocean disappear in one frame, while dragging it outward restored the
   supposedly escaped atmosphere. Both behaviours looked wrong.

   Keep the same compact age/flux/escape-velocity retention targets, but treat
   them as asymptotic damage. Within one runtime/seed, H/He, water inventory and
   heavy atmosphere can only DECREASE toward the target. The decline takes
   seconds in the interactive simulation, leaving the existing water-budget
   phase relaxation free to show progressive evaporation/steam. Moving the
   same world outward stops further loss but does not resurrect escaped gas or
   water. A new seed/random world starts from its own equilibrium history.

   This is still an intentionally compact visual/evolution scaffold, not a
   hydrodynamic XUV escape solver.
*/

const EXTREME_ORBIT_MODEL=2;
const EXTREME_CLIMATE_MAX_K=2200;
const EXTREME_HEAVY_LOSS_TAU_SEC=28;
const EXTREME_WATER_LOSS_TAU_SEC=20;
const EXTREME_LIGHT_LOSS_TAU_SEC=10;

function extremeClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function extremeSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=extremeClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function extremeEscapeInputs(){
  const d=(typeof distanceInfo==='function')?distanceInfo(state.distance):{S:1};
  const p=(typeof planetPhysics==='function')?planetPhysics():{ageGyr:4.54,escapeKMS:11.186,gravityEarth:1};
  const S=Math.max(0,Number(d.S)||0);
  const ageGyr=extremeClamp(p.ageGyr??4.54,0.01,15);
  const escapeEarth=Math.max(0.08,(Number(p.escapeKMS)||11.186)/11.186);
  return {S,ageGyr,escapeEarth,gravityEarth:Math.max(0.05,Number(p.gravityEarth)||1)};
}
function stellarHeavyAtmosRetentionTarget(){
  const q=extremeEscapeInputs();
  const exposure=Math.max(0,Math.log10(Math.max(1,q.S/4.0)));
  if(!(exposure>0))return 1;
  const dose=0.50*q.ageGyr*Math.pow(exposure,1.50)/(q.escapeEarth*q.escapeEarth);
  return extremeClamp(Math.exp(-dose),0,1);
}
function stellarWaterRetentionTarget(){
  const q=extremeEscapeInputs();
  const exposure=Math.max(0,Math.log10(Math.max(1,q.S/1.35)));
  if(!(exposure>0))return 1;
  const dose=0.56*q.ageGyr*Math.pow(exposure,1.70)/(q.escapeEarth*q.escapeEarth);
  return extremeClamp(Math.exp(-dose),0,1);
}
function stellarLightGasRetentionTarget(){
  const q=extremeEscapeInputs();
  const exposure=Math.max(0,Math.log10(Math.max(1,q.S/0.55)));
  if(!(exposure>0))return 1;
  const dose=0.85*q.ageGyr*Math.pow(exposure,1.25)/(q.escapeEarth*q.escapeEarth);
  return extremeClamp(Math.exp(-dose),0,1);
}

let extremeVolatileHistory={seed:null,heavy:1,water:1,light:1,initialized:false};
function stellarResetVolatileHistory(toEquilibrium=true){
  extremeVolatileHistory.seed=(typeof state!=='undefined'?(state.seed|0):0);
  extremeVolatileHistory.heavy=toEquilibrium?stellarHeavyAtmosRetentionTarget():1;
  extremeVolatileHistory.water=toEquilibrium?stellarWaterRetentionTarget():1;
  extremeVolatileHistory.light=toEquilibrium?stellarLightGasRetentionTarget():1;
  extremeVolatileHistory.initialized=true;
  return extremeVolatileHistory;
}
function stellarEnsureVolatileHistory(){
  const seed=(typeof state!=='undefined'?(state.seed|0):0);
  if(!extremeVolatileHistory.initialized || extremeVolatileHistory.seed!==seed)
    stellarResetVolatileHistory(true);
  return extremeVolatileHistory;
}
function stellarLossStep(current,target,dtSec,tauSec){
  current=extremeClamp(current,0,1);target=extremeClamp(target,0,1);
  if(target>=current)return current; /* escaped volatiles never grow back */
  const severity=Math.max(0.02,1-target);
  const tau=Math.max(1,tauSec/(0.45+0.55*Math.sqrt(severity)));
  return target+(current-target)*Math.exp(-Math.max(0,dtSec)/tau);
}
function stellarAdvanceVolatileHistory(dtSec){
  const h=stellarEnsureVolatileHistory(),dt=extremeClamp(dtSec,0,0.5);
  const oh=h.heavy,ow=h.water,ol=h.light;
  h.heavy=stellarLossStep(h.heavy,stellarHeavyAtmosRetentionTarget(),dt,EXTREME_HEAVY_LOSS_TAU_SEC);
  h.water=stellarLossStep(h.water,stellarWaterRetentionTarget(),dt,EXTREME_WATER_LOSS_TAU_SEC);
  h.light=stellarLossStep(h.light,stellarLightGasRetentionTarget(),dt,EXTREME_LIGHT_LOSS_TAU_SEC);
  return Math.abs(h.heavy-oh)+Math.abs(h.water-ow)+Math.abs(h.light-ol)>1e-10;
}
function stellarHeavyAtmosRetention(){return stellarEnsureVolatileHistory().heavy;}
function stellarWaterRetention(){return stellarEnsureVolatileHistory().water;}
function stellarLightGasRetention(){return stellarEnsureVolatileHistory().light;}
function stellarSpeciesRetention(key){
  if(key==='gasHHe')return stellarLightGasRetention();
  if(key==='gasH2O')return 1; /* H2O is capped by retained global water below. */
  return stellarHeavyAtmosRetention();
}

const gasPartialPressureBarBeforeExtreme=gasPartialPressureBar;
gasPartialPressureBar=function(key){
  const raw=Math.max(0,Number(gasPartialPressureBarBeforeExtreme(key))||0);
  if(key!=='gasH2O')return raw*stellarSpeciesRetention(key);
  const baseTotal=(typeof waterTotalEowFromSliderBeforeExtreme==='function')
    ?waterTotalEowFromSliderBeforeExtreme(state.waterTotal)
    :(typeof waterTotalEowFromSlider==='function'?waterTotalEowFromSlider(state.waterTotal):0);
  const maxInv=Math.max(0,baseTotal)*(typeof WATER_EOW_TO_ATM_INV==='number'?WATER_EOW_TO_ATM_INV:261.3)*stellarWaterRetention();
  const g=(typeof atmosphereGravityEarth==='function')?Math.max(0.05,atmosphereGravityEarth()):1;
  const atm=(typeof EARTH_ATM_BAR==='number')?EARTH_ATM_BAR:1.01325;
  return Math.min(raw,maxInv*g*atm);
};

const atmosphereSurfacePressureBarBeforeExtreme=atmosphereSurfacePressureBar;
atmosphereSurfacePressureBar=function(){
  let p=0;
  if(typeof GAS_KEYS!=='undefined')for(const k of GAS_KEYS)p+=Math.max(0,Number(gasPartialPressureBar(k))||0);
  return Number.isFinite(p)?p:Math.max(0,Number(atmosphereSurfacePressureBarBeforeExtreme())||0);
};

const waterTotalEowFromSliderBeforeExtreme=waterTotalEowFromSlider;
waterTotalEowFromSlider=function(v){
  return Math.max(0,waterTotalEowFromSliderBeforeExtreme(v))*stellarWaterRetention();
};

const updateLegacyAtmoProxyBeforeExtreme=updateLegacyAtmoProxy;
updateLegacyAtmoProxy=function(){
  const g=(typeof atmosphereGravityEarth==='function')?Math.max(0.05,atmosphereGravityEarth()):1;
  const atm=(typeof EARTH_ATM_BAR==='number')?EARTH_ATM_BAR:1.01325;
  const earthColumn=atmosphereSurfacePressureBar()/Math.max(1e-9,g*atm);
  state.atmo=extremeClamp((earthColumn-0.10)/1.55,0,1);
  return state.atmo;
};

const climateModelBeforeExtremeOrbit=climateModel;
climateModel=function(){
  const c=climateModelBeforeExtremeOrbit();
  const heavy=stellarHeavyAtmosRetention();
  const water=stellarWaterRetention();
  const S=Math.max(0,Number(c.S)||0);
  const stripped=extremeSmooth(0.20,0.995,1-Math.min(heavy,water));
  const scorch=extremeSmooth(5,55,S);
  const barrenWeight=stripped*scorch;
  const barrenAlbedo=0.16-0.025*extremeSmooth(40,300,S);
  const A=extremeClamp((Number(c.A)||0.30)+(barrenAlbedo-(Number(c.A)||0.30))*barrenWeight,0.03,0.86);
  const ASR=CLIMATE_SOLAR_CONSTANT*S*(1-A)/4;
  const Te=Math.pow(Math.max(1,ASR)/CLIMATE_SIGMA,0.25);
  const tau=Math.max(0,Number(c.tau)||0);
  const greenhouse=Math.pow(1+0.75*tau,0.25);
  const hotTarget=Te*greenhouse;

  c.A=A;c.ASR=ASR;c.Te=Te;
  c.T=extremeClamp(Math.max(Number(c.T)||120,hotTarget),120,EXTREME_CLIMATE_MAX_K);
  c.C=c.T-273.15;
  c.pressureBar=atmosphereSurfacePressureBar();
  c.waterEow=waterTotalEowFromSlider(state.waterTotal);
  if(typeof climateWaterAvailability==='function')c.waterAvail=climateWaterAvailability(c.waterEow);
  if(typeof climateIceArea==='function')c.iceArea=climateIceArea(c.T,c.waterAvail??0);
  const rawOLR=CLIMATE_SIGMA*Math.pow(c.T,4)/Math.max(1e-6,1+0.75*tau);
  c.OLR=rawOLR;c.energyImbalance=ASR-rawOLR;
  c.atmosphereRetention=heavy;c.waterRetention=water;c.volatileStripping=barrenWeight;
  if(barrenWeight>0.72 || c.T>500){
    c.regime='irradiatedBarren';c.regimeLabel='обожжённый / volatile-poor';
  }else if(typeof climateClassify==='function'&&typeof climateRegimeLabel==='function'){
    c.regime=climateClassify(c);c.regimeLabel=climateRegimeLabel(c.regime);
  }
  return c;
};

waterTemperatureK=function(){
  const c=climateModel();
  return extremeClamp(c?.T??288.15,120,EXTREME_CLIMATE_MAX_K);
};

/* Run loss before the ordinary water/gas relaxation so this frame's reservoirs
   see the newly retained total. Evaporation/condensation itself remains the
   existing gradual water-budget process. */
const relaxDerivedBeforeExtremeOrbit=relaxDerived;
relaxDerived=function(dtSec){
  const lost=stellarAdvanceVolatileHistory(dtSec);
  const moved=!!relaxDerivedBeforeExtremeOrbit(dtSec);
  if(lost)updateLegacyAtmoProxy();
  return lost||moved;
};

function extremeOrbitDiagnostics(){
  const e=extremeEscapeInputs(),c=climateModel();
  return {S:e.S,ageGyr:e.ageGyr,escapeEarth:e.escapeEarth,
    atmosphereRetention:stellarHeavyAtmosRetention(),waterRetention:stellarWaterRetention(),
    atmosphereRetentionTarget:stellarHeavyAtmosRetentionTarget(),waterRetentionTarget:stellarWaterRetentionTarget(),
    pressureBar:c.pressureBar,T:c.T};
}

stellarResetVolatileHistory(true);
updateLegacyAtmoProxy();
if(typeof settleWaterEquilibriumImmediate==='function')settleWaterEquilibriumImmediate(4);
