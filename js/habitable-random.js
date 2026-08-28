/* ============ 0.5.50 polish: city-ready random worlds ============ */
/*
   The historical Random button deliberately produced extreme atmospheres and
   arbitrary star/orbit combinations. That is useful for stress testing but a
   poor default generator: uninhabitable worlds are easy to make by hand.

   This replacement intercepts the button during the capture phase, before the
   old bubble listeners run. It samples physically moderate rocky worlds and
   then solves the orbital distance against the current climateModel(). A
   candidate is accepted only if the final coupled state has moderate global
   temperature/pressure, abundant water, non-runaway climate and manageable
   gravity. Methane is always exactly zero.

   gasHHe is a legacy combined H2/He control, so its random contribution is
   deliberately kept small; this lets the atmosphere vary without pretending
   we can expose a large pure-helium fraction while the UI still combines the
   two species.
*/

const CITY_RANDOM_MODEL = 1;
const CITY_TEMP_TARGET_MIN_C = 8;
const CITY_TEMP_TARGET_MAX_C = 26;
const CITY_TEMP_ACCEPT_MIN_C = 2;
const CITY_TEMP_ACCEPT_MAX_C = 32;
const CITY_PRESSURE_MIN_BAR = 0.65;
const CITY_PRESSURE_MAX_BAR = 1.55;
const CITY_O2_MIN_BAR = 0.16;
const CITY_O2_MAX_BAR = 0.30;
const CITY_GRAVITY_MIN_EARTH = 0.65;
const CITY_GRAVITY_MAX_EARTH = 1.40;
const CITY_MAX_ATTEMPTS = 12;

function cityRandClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function cityRandBetween(r,a,b){ return a+(b-a)*r(); }
function cityRandChoice(r,items){
  let x=r(),acc=0;
  for(const item of items){ acc+=item[1]; if(x<=acc) return item[0]; }
  return items[items.length-1][0];
}
function cityPivotLogInverse(x,pivot,lo,mid,hi){
  x=Math.max(lo,Math.min(hi,Number(x)||mid));
  if(x<=mid){
    const u=(Math.log(x)-Math.log(lo))/Math.max(1e-12,Math.log(mid)-Math.log(lo));
    return cityRandClamp(u*pivot,0,1);
  }
  const u=(Math.log(x)-Math.log(mid))/Math.max(1e-12,Math.log(hi)-Math.log(mid));
  return cityRandClamp(pivot+u*(1-pivot),0,1);
}
function citySetGasPartialBar(key,pBar){
  const g=(typeof atmosphereGravityEarth==='function')?Math.max(0.05,atmosphereGravityEarth()):1;
  const atm=(typeof EARTH_ATM_BAR!=='undefined')?EARTH_ATM_BAR:1.01325;
  state[key]=Math.max(0,Number(pBar)||0)/(g*atm);
}
function cityPartialBar(key){
  return (typeof gasPartialPressureBar==='function')?Math.max(0,gasPartialPressureBar(key)):0;
}

function cityRandomizePlanet(r){
  state.planetAge=cityRandClamp((cityRandBetween(r,2.0,8.5)-0.05)/11.95,0,1);
  const radiusEarth=cityRandBetween(r,0.82,1.22);
  state.planetRadius=cityPivotLogInverse(radiusEarth,0.50,0.25,1.0,3.0);
  state.coreType=cityRandBetween(r,0.14,0.52);
  const rotationHours=cityRandBetween(r,14,42);
  state.rotationPeriod=cityPivotLogInverse(rotationHours,0.32,4.0,24.0,2400.0);
  state.axialTilt=cityRandBetween(r,5,35)/90;

  if(typeof planetPhysics==='function'){
    for(let n=0;n<5;n++){
      const p=planetPhysics();
      if(p.gravityEarth>=CITY_GRAVITY_MIN_EARTH&&p.gravityEarth<=CITY_GRAVITY_MAX_EARTH) break;
      const adjusted=p.gravityEarth<CITY_GRAVITY_MIN_EARTH
        ? Math.min(1.20,radiusEarth+0.04*(n+1))
        : Math.max(0.84,radiusEarth-0.04*(n+1));
      state.planetRadius=cityPivotLogInverse(adjusted,0.50,0.25,1.0,3.0);
    }
  }
}

function cityRandomizeAtmosphere(r){
  const targetTotal=cityRandBetween(r,0.78,1.30);
  const o2=cityRandBetween(r,0.18,0.245);
  const co2=Math.exp(cityRandBetween(r,Math.log(0.00018),Math.log(0.0030)));
  const hhe=cityRandChoice(r,[
    [cityRandBetween(r,0.00002,0.003),0.55],
    [cityRandBetween(r,0.003,0.015),0.35],
    [cityRandBetween(r,0.015,0.030),0.10]
  ]);
  const so2=cityRandBetween(r,1e-8,2e-7);
  const n2=Math.max(0.30,targetTotal-o2-co2-hhe-so2);

  citySetGasPartialBar('gasN2',n2);
  citySetGasPartialBar('gasO2',o2);
  citySetGasPartialBar('gasCO2',co2);
  citySetGasPartialBar('gasSO2',so2);
  citySetGasPartialBar('gasHHe',hhe);
  state.gasCH4=0;
  if(typeof sanitizeGasInventories==='function') sanitizeGasInventories();
  if(typeof updateLegacyAtmoProxy==='function') updateLegacyAtmoProxy();
}

function cityRandomizeWaterAndSurface(r){
  const eow=Math.exp(cityRandBetween(r,Math.log(0.28),Math.log(1.8)));
  if(typeof waterTotalSliderFromEow==='function') state.waterTotal=waterTotalSliderFromEow(eow);
  state.cont=cityRandBetween(r,0.30,0.72);
  state.tect=cityRandBetween(r,0.22,0.72);
  state.isle=cityRandBetween(r,0.20,0.78);
  state.lake=cityRandBetween(r,0.28,0.80);
  state.volcano=cityRandBetween(r,0.10,0.36);
  state.city=cityRandBetween(r,0.30,0.82);
  state.lava=cityRandBetween(r,0.30,0.70);
}

function cityRandomizeStar(r){
  const band=cityRandChoice(r,[['K',0.34],['G',0.52],['F',0.14]]);
  if(band==='K') state.star=cityRandBetween(r,0.16,0.38);
  else if(band==='F') state.star=cityRandBetween(r,0.50,0.60);
  else state.star=cityRandBetween(r,0.38,0.50);
  const mult=cityRandBetween(r,0.78,1.28);
  state.luminosity=(typeof stellarLuminositySliderFromMultiplier==='function')
    ? stellarLuminositySliderFromMultiplier(mult)
    : cityRandBetween(r,0.39,0.48);
}

function cityEvaluateOrbit(au,targetC){
  state.distance=(typeof stellarDistanceSliderFromAU==='function')
    ? stellarDistanceSliderFromAU(au) : state.distance;
  if(typeof tempToSlider==='function') state.temp=tempToSlider(targetC);
  if(typeof settleWaterEquilibriumImmediate==='function') settleWaterEquilibriumImmediate(4);
  if(typeof updateLegacyAtmoProxy==='function') updateLegacyAtmoProxy();
  return (typeof climateModel==='function')?climateModel():null;
}

function citySolveTemperateOrbit(targetC){
  const st=starPhysics(state.star,state.luminosity);
  const hz=(typeof habitableZoneForStar==='function')
    ? habitableZoneForStar(st.T,st.L)
    : {conservativeInner:Math.sqrt(st.L)*0.90,conservativeOuter:Math.sqrt(st.L)*1.55};
  let near=Math.max(0.01,(hz.conservativeInner||Math.sqrt(st.L)*0.90)*0.92);
  let far=Math.max(near*1.05,(hz.conservativeOuter||Math.sqrt(st.L)*1.55)*1.04);
  let best=null,bestAu=Math.sqrt(near*far),bestErr=Infinity;

  for(let n=0;n<15;n++){
    const au=Math.sqrt(near*far);
    const c=cityEvaluateOrbit(au,targetC);
    if(!c||!Number.isFinite(c.C)) break;
    const err=Math.abs(c.C-targetC);
    if(err<bestErr){bestErr=err;best=c;bestAu=au;}
    if(c.C>targetC) near=au; else far=au;
  }
  const final=cityEvaluateOrbit(bestAu,targetC);
  return final||best;
}

function cityRandomCandidatePenalty(c,p){
  if(!c||!p) return 1e9;
  let q=0;
  const outside=(x,a,b)=>x<a?a-x:x>b?x-b:0;
  q+=outside(c.C,CITY_TEMP_ACCEPT_MIN_C,CITY_TEMP_ACCEPT_MAX_C)*4;
  q+=outside(c.pressureBar,CITY_PRESSURE_MIN_BAR,CITY_PRESSURE_MAX_BAR)*30;
  q+=outside(cityPartialBar('gasO2'),CITY_O2_MIN_BAR,CITY_O2_MAX_BAR)*80;
  q+=outside(p.gravityEarth,CITY_GRAVITY_MIN_EARTH,CITY_GRAVITY_MAX_EARTH)*30;
  q+=Math.max(0,(c.runawayIndex||0)-0.08)*80;
  q+=Math.max(0,(c.moistIndex||0)-0.22)*40;
  q+=Math.max(0,(c.iceArea||0)-0.45)*25;
  q+=Math.max(0,0.75-(c.waterAvail||0))*20;
  q+=Math.max(0,cityPartialBar('gasCO2')-0.015)*120;
  q+=Math.max(0,cityPartialBar('gasSO2')-0.00002)*20000;
  if((state.gasCH4||0)!==0) q+=1000;
  return q;
}
function cityRandomCandidateAccepted(c,p){ return cityRandomCandidatePenalty(c,p)<1e-6; }

function cityApplyWeatherTargets(){
  if(typeof climateWeatherTargets!=='function') return;
  const t=climateWeatherTargets();
  for(const k of ['snowAlt','cloudLow','cloudMid','cloudHigh','wind','convection','storm']){
    if(Number.isFinite(t[k])) state[k]=cityRandClamp(t[k],0,1);
  }
}
function cityRandomizeVisuals(r){
  state.magnet=cityRandBetween(r,0.38,0.88);
  state.magTilt=cityRandBetween(r,0.15,0.65);
  state.magAzimuth=r();
  state.aurora=cityRandBetween(r,0.20,0.75);
  state.rings=r()<0.16;
  state.ringInner=cityRandBetween(r,0.24,0.58);
  state.ringWidth=cityRandBetween(r,0.28,0.70);
  state.ringDens=cityRandBetween(r,0.30,0.68);
  state.ringCount=cityRandBetween(r,0.20,0.80);
  state.ringMat=cityRandBetween(r,0.05,0.45);
  state.ringGrain=cityRandBetween(r,0.20,0.72);
  state.stormRate=cityRandBetween(r,0.32,0.72);
  state.stormGlow=cityRandBetween(r,0.36,0.76);
}

function generateCityReadyRandomWorld(randomSource=Math.random){
  let targetFallback=18;
  for(let attempt=0;attempt<CITY_MAX_ATTEMPTS;attempt++){
    const seed=(Math.floor(randomSource()*0x7fffffff)^Math.floor(randomSource()*0x7fffffff))>>>0;
    const r=(typeof mulberry32==='function')?mulberry32(seed):randomSource;
    state.seed=Math.floor(r()*1e8);
    cityRandomizePlanet(r);
    cityRandomizeWaterAndSurface(r);
    cityRandomizeAtmosphere(r);
    cityRandomizeStar(r);
    cityRandomizeVisuals(r);
    state.pinTemp=false;state.pinCO2=false;state.pinSO2=false;state.pinH2O=false;
    state.cloudLow=0.48;state.cloudMid=0.36;state.cloudHigh=0.24;
    const targetC=cityRandBetween(r,CITY_TEMP_TARGET_MIN_C,CITY_TEMP_TARGET_MAX_C);
    targetFallback=targetC;
    const c=citySolveTemperateOrbit(targetC);
    const p=(typeof planetPhysics==='function')?planetPhysics():{gravityEarth:1};
    if(cityRandomCandidateAccepted(c,p)) break;
  }

  if((typeof planetPhysics==='function') && (typeof climateModel==='function')){
    let c=climateModel(),p=planetPhysics();
    if(!cityRandomCandidateAccepted(c,p)){
      state.coreType=cityRandClamp(state.coreType,0.18,0.42);
      state.planetRadius=cityPivotLogInverse(1.0,0.50,0.25,1.0,3.0);
      state.volcano=Math.min(state.volcano,0.28);
      citySetGasPartialBar('gasO2',0.205);
      citySetGasPartialBar('gasCO2',0.00042);
      citySetGasPartialBar('gasSO2',1e-8);
      citySetGasPartialBar('gasHHe',0.001);
      citySetGasPartialBar('gasN2',0.79);
      state.gasCH4=0;
      if(typeof sanitizeGasInventories==='function') sanitizeGasInventories();
      citySolveTemperateOrbit(targetFallback);
    }
  }

  cityApplyWeatherTargets();
  if(typeof settleWaterEquilibriumImmediate==='function') settleWaterEquilibriumImmediate(5);
  if(typeof deriveWorld==='function') deriveWorld();
  if(typeof releaseLegacyPins==='function') releaseLegacyPins();
  if(typeof captureTransientEquilibrium==='function') captureTransientEquilibrium();
  if(typeof updateLegacyAtmoProxy==='function') updateLegacyAtmoProxy();
  if(typeof markRenderUniformsDirty==='function') markRenderUniformsDirty();
  if(typeof syncUI==='function') syncUI();
  if(typeof saveHash==='function') saveHash();
  return (typeof climateModel==='function')?climateModel():null;
}

if(typeof document!=='undefined'){
  const btn=document.getElementById('rand');
  if(btn){
    btn.title='Случайная планета с умеренным климатом и условиями для городов';
    btn.addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      generateCityReadyRandomWorld(Math.random);
    },true);
  }
}
