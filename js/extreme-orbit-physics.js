/* ============ 0.5.79: close-orbit equilibrium + cumulative volatile retention ============ */
/*
   BASE controls describe the equilibrium world we are looking at, not a live
   spacecraft trajectory. 0.5.78 could move an old Earth-like world to a few
   hundred Earth fluxes while keeping its original volatile inventory because
   atmosphere/water inventory had no long-term stellar-loss path at all.

   This module adds a deliberately compact evolutionary proxy. It is NOT a
   hydrodynamic escape solver and does not claim that atmosphere disappears
   instantly. Retention depends on received stellar flux, planet age and escape
   velocity: high gravity helps; strong irradiation integrated over Gyr hurts.
   The proxy is kept near unity around Earth/Venus-like bolometric fluxes and
   becomes severe only for genuinely close, old rocky worlds.

   It also removes climate-regimes.js's accidental 900 K (= 626.85 C) display
   ceiling. Once volatiles are mostly gone, the equilibrium temperature is
   recomputed from absorbed stellar power with the remaining greenhouse term.
   At 1 Lsun / 0.065 AU (~237 S_earth), a low-atmosphere rocky world therefore
   lands near ~1000 K instead of sticking at exactly 900 K.
*/

const EXTREME_ORBIT_MODEL=1;
const EXTREME_CLIMATE_MAX_K=2200;

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
/* Heavy molecules are comparatively hard to remove. Keep the onset well
   inside Mercury-like irradiation so ordinary HZ / Venus-like worlds are not
   silently rewritten by a bolometric escape proxy. */
function stellarHeavyAtmosRetention(){
  const q=extremeEscapeInputs();
  const exposure=Math.max(0,Math.log10(Math.max(1,q.S/4.0)));
  if(!(exposure>0))return 1;
  const dose=0.50*q.ageGyr*Math.pow(exposure,1.50)/(q.escapeEarth*q.escapeEarth);
  return extremeClamp(Math.exp(-dose),0,1);
}
/* Water is easier to lose after a moist/runaway greenhouse feeds H into the
   upper atmosphere. This is intentionally stronger than the heavy-gas proxy. */
function stellarWaterRetention(){
  const q=extremeEscapeInputs();
  const exposure=Math.max(0,Math.log10(Math.max(1,q.S/1.35)));
  if(!(exposure>0))return 1;
  const dose=0.56*q.ageGyr*Math.pow(exposure,1.70)/(q.escapeEarth*q.escapeEarth);
  return extremeClamp(Math.exp(-dose),0,1);
}
function stellarLightGasRetention(){
  const q=extremeEscapeInputs();
  const exposure=Math.max(0,Math.log10(Math.max(1,q.S/0.55)));
  if(!(exposure>0))return 1;
  const dose=0.85*q.ageGyr*Math.pow(exposure,1.25)/(q.escapeEarth*q.escapeEarth);
  return extremeClamp(Math.exp(-dose),0,1);
}
function stellarSpeciesRetention(key){
  if(key==='gasHHe')return stellarLightGasRetention();
  if(key==='gasH2O')return 1; /* H2O is capped by the retained global water budget below. */
  return stellarHeavyAtmosRetention();
}

/* Gas inventories remain user/base causes. Pressure functions expose the
   equilibrium retained atmosphere, so moving the same sliders back outward
   restores the reservoir instead of irreversibly mutating the URL state. */
const gasPartialPressureBarBeforeExtreme=gasPartialPressureBar;
gasPartialPressureBar=function(key){
  const raw=Math.max(0,Number(gasPartialPressureBarBeforeExtreme(key))||0);
  if(key!=='gasH2O')return raw*stellarSpeciesRetention(key);
  /* Do not double-attenuate water after water-budget has already relaxed its
     vapor store. Instead cap stale atmospheric vapor by the maximum retained
     H2O inventory immediately after a large orbit change. */
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

/* Wrap the conserved H2O cause rather than mutating it. Every downstream
   reservoir calculation therefore sees the long-term retained water amount. */
const waterTotalEowFromSliderBeforeExtreme=waterTotalEowFromSlider;
waterTotalEowFromSlider=function(v){
  return Math.max(0,waterTotalEowFromSliderBeforeExtreme(v))*stellarWaterRetention();
};

/* `state.atmo` is renderer compatibility only. Make its proxy follow retained
   pressure, otherwise a nearly stripped planet keeps a bright blue halo and
   weather/cloud support even though physical pressure has collapsed. */
const updateLegacyAtmoProxyBeforeExtreme=updateLegacyAtmoProxy;
updateLegacyAtmoProxy=function(){
  const g=(typeof atmosphereGravityEarth==='function')?Math.max(0.05,atmosphereGravityEarth()):1;
  const atm=(typeof EARTH_ATM_BAR==='number')?EARTH_ATM_BAR:1.01325;
  const earthColumn=atmosphereSurfacePressureBar()/Math.max(1e-9,g*atm);
  state.atmo=extremeClamp((earthColumn-0.10)/1.55,0,1);
  return state.atmo;
};

/* The original climate module intentionally targeted ordinary rocky climates,
   but its final clamp to 900 K accidentally became the UI's exact 627 C
   ceiling. Re-evaluate the hot volatile-poor equilibrium without that cap. */
const climateModelBeforeExtremeOrbit=climateModel;
climateModel=function(){
  const c=climateModelBeforeExtremeOrbit();
  const heavy=stellarHeavyAtmosRetention();
  const water=stellarWaterRetention();
  const S=Math.max(0,Number(c.S)||0);
  const stripped=extremeSmooth(0.20,0.995,1-Math.min(heavy,water));
  const scorch=extremeSmooth(5,55,S);
  const barrenWeight=stripped*scorch;

  /* Once oceans/clouds are gone, use a plausible low/moderate rocky Bond
     albedo rather than retaining a stale cloud/ice albedo from the former HZ
     state. Different mineral surfaces can vary widely; this is a compact
     equilibrium scaffold, not mineral spectroscopy. */
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
    c.regime='irradiatedBarren';
    c.regimeLabel='обожжённый / volatile-poor';
  }else if(typeof climateClassify==='function'&&typeof climateRegimeLabel==='function'){
    c.regime=climateClassify(c);c.regimeLabel=climateRegimeLabel(c.regime);
  }
  return c;
};

/* Water thermodynamics must not reintroduce the retired 900 K ceiling. */
waterTemperatureK=function(){
  const c=climateModel();
  return extremeClamp(c?.T??288.15,120,EXTREME_CLIMATE_MAX_K);
};

function extremeOrbitDiagnostics(){
  const e=extremeEscapeInputs(),c=climateModel();
  return {S:e.S,ageGyr:e.ageGyr,escapeEarth:e.escapeEarth,
    atmosphereRetention:stellarHeavyAtmosRetention(),waterRetention:stellarWaterRetention(),
    pressureBar:c.pressureBar,T:c.T};
}

/* Bring derived compatibility state into equilibrium immediately at module
   load; later large BASE changes are handled by weather-regime-rebase.js. */
updateLegacyAtmoProxy();
if(typeof settleWaterEquilibriumImmediate==='function')settleWaterEquilibriumImmediate(4);
