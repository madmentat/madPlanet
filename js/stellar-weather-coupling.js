/* ============ 0.5.39: stellar forcing -> climate -> visual weather ============ */
/*
   This bridge closes two gaps left by the 0.5.34-0.5.38 scaffolds:
     1) spectral class used to change colour/temperature but not the star's
        nominal main-sequence luminosity, so moving M..O could leave climate
        almost unchanged at fixed luminosity slider;
     2) the renderer received climate through state.temp, whose old mapping
        was clamped to -78..+97 C. A +460 C climate therefore looked exactly
        like +97 C and mountain snow could survive the apparent Venus regime.

   The spectral slider now supplies a main-sequence baseline M/L. The
   luminosity slider is a multiplicative offset around that baseline, keeping
   unusual/evolved systems possible without making class and power unrelated.
   Distance remains an independent physical AU input, but its range is wide
   enough for both M dwarfs and luminous B/O stars.

   No stellar age is inferred here: class/mass/luminosity constrain a main-
   sequence lifetime, not a unique current age.
*/

const STELLAR_WEATHER_COUPLING_MODEL = 1;
const STELLAR_LUM_MULT_PIVOT = 0.43;
const STELLAR_DISTANCE_PIVOT = 0.51;

const STELLAR_MAIN_SEQUENCE_ANCHORS = Object.freeze([
  Object.freeze({x:0.00, cls:'M', T:3000,  M:0.20, L:0.006}),
  Object.freeze({x:0.17, cls:'K', T:4500,  M:0.70, L:0.17}),
  Object.freeze({x:0.43, cls:'G', T:5772,  M:1.00, L:1.00}),
  Object.freeze({x:0.57, cls:'F', T:6800,  M:1.35, L:3.5}),
  Object.freeze({x:0.71, cls:'A', T:9000,  M:2.20, L:25.0}),
  Object.freeze({x:0.86, cls:'B', T:18000, M:8.00, L:3000.0}),
  Object.freeze({x:1.00, cls:'O', T:35000, M:30.0, L:200000.0}),
]);

function stellarCouplingClamp01(x){ return Math.max(0,Math.min(1,Number(x)||0)); }
function stellarLogLerp(a,b,u){
  return Math.exp(Math.log(Math.max(1e-12,a))*(1-u)+Math.log(Math.max(1e-12,b))*u);
}
function stellarMainSequenceBaseline(x){
  x=stellarCouplingClamp01(x);
  for(let i=0;i<STELLAR_MAIN_SEQUENCE_ANCHORS.length-1;i++){
    const a=STELLAR_MAIN_SEQUENCE_ANCHORS[i], b=STELLAR_MAIN_SEQUENCE_ANCHORS[i+1];
    if(x<=b.x){
      const u=(x-a.x)/Math.max(1e-9,b.x-a.x);
      return {
        cls:u<0.5?a.cls:b.cls,
        T:a.T+(b.T-a.T)*u,
        M:stellarLogLerp(a.M,b.M,u),
        L:stellarLogLerp(a.L,b.L,u)
      };
    }
  }
  const z=STELLAR_MAIN_SEQUENCE_ANCHORS[STELLAR_MAIN_SEQUENCE_ANCHORS.length-1];
  return {cls:z.cls,T:z.T,M:z.M,L:z.L};
}
function stellarLuminosityMultiplier(v){
  /* 0.43 = class-typical luminosity. The wide multiplier deliberately allows
     subgiant/overluminous and underluminous experiments while class still
     determines the order of magnitude. */
  return pivotLogSlider(v,STELLAR_LUM_MULT_PIVOT,0.03,30.0);
}

starPhysics=function(t,lumT=STELLAR_LUM_MULT_PIVOT){
  const base=stellarMainSequenceBaseline(t);
  const lumMult=stellarLuminosityMultiplier(lumT);
  const L=base.L*lumMult;
  /* At fixed spectral temperature an off-main-sequence luminosity change is
     mostly a radius change. Mass follows only weakly as a compatibility
     estimate rather than pretending every offset is another main-sequence
     star of the same temperature. */
  const massFactor=Math.pow(lumMult,1/5.5);
  const M=base.M*Math.max(0.55,Math.min(2.2,massFactor));
  const R=Math.sqrt(Math.max(L,1e-12))*Math.pow(5772/base.T,2);
  const hz=habitableZoneForStar(base.T,L);
  return {
    T:base.T,L,M,R,lumMult,nominalL:base.L,nominalM:base.M,
    hz:Math.sqrt(L),hzInner:hz.conservativeInner,hzOuter:hz.conservativeOuter,
    hzApprox:hz.approx
  };
};

/* Absolute orbit: 0.01..1000 AU with the old 0.51 -> 1 AU pivot preserved.
   The old 10 AU ceiling made the habitable zones of luminous B/O stars
   unreachable even though those classes were exposed in the UI. */
orbitDistanceAU=function(v){ return pivotLogSlider(v,STELLAR_DISTANCE_PIVOT,0.01,1000.0); };

luminosityLabel=function(v){
  const x=starPhysics(state?.star ?? 0.43,v);
  const mult=x.lumMult;
  const ms=mult<0.1?mult.toFixed(2):mult<10?mult.toFixed(2):mult.toFixed(1);
  return x.L.toPrecision(x.L<0.1?2:3)+' L☉ · ×'+ms+' · '+x.M.toFixed(2)+' M☉';
};
distanceInfo=function(v){
  const au=orbitDistanceAU(v);
  const st=starPhysics(state?.star ?? 0.43,state?.luminosity ?? STELLAR_LUM_MULT_PIVOT);
  const hz=habitableZoneForStar(st.T,st.L);
  const status=hzStatus(au,hz);
  const S=orbitalFluxEarth(st.L,au);
  return {
    au,hz:Math.sqrt(st.L),q:au/Math.sqrt(st.L),S,
    inner:hz.conservativeInner,outer:hz.conservativeOuter,
    optimisticInner:hz.optimisticInner,optimisticOuter:hz.optimisticOuter,
    approx:hz.approx,status:status.code,
    label:au.toFixed(au<0.1?3:au<10?2:1)+' AU · '+
      S.toPrecision(S<0.1?2:3)+' S⊕ · '+status.label
  };
};

/* New blank worlds should start on the actual solar anchor. Old named hashes
   carry their explicit star value and remain untouched. */
const stellarParam=PARAMS.find(p=>p.k==='star');
if(stellarParam) stellarParam.def=0.43;
if(typeof location!=='undefined' && !location.hash && Math.abs(Number(state.star)-0.38)<1e-9)
  state.star=0.43;

/* Do NOT clamp calculated temperature to the old slider's +97 C ceiling.
   HTML range controls still display at their nearest edge, but state.temp is
   an internal renderer channel and GLSL mix() intentionally extrapolates for
   values outside 0..1. Thus +460 C is no longer visually identical to +97 C. */
tempToSlider=function(C){ return (Number(C)+78)/175; };

function stellarWeatherSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=Math.max(0,Math.min(1,(x-a)/(b-a)));
  return u*u*(3-2*u);
}
function climateWeatherTargets(){
  const c=climateModel();
  const C=c.C;
  const pH2O=Math.max(0,c.partialPressures?.h2o||0);
  const wet=stellarWeatherSmooth(0.0001,0.008,pH2O);
  const warm=stellarWeatherSmooth(-5,45,C);
  const hot=stellarWeatherSmooth(45,120,C);
  const supercritical=stellarWeatherSmooth(330,374,C);
  const snowball=stellarWeatherSmooth(0.45,0.90,c.iceArea||0);
  const waterAvail=Math.max(0,Math.min(1,c.waterAvail??1));
  const fluxStress=Math.min(1,Math.abs(Math.log2(Math.max(0.02,c.S||1)))/3.0);

  /* Liquid-water clouds become common with available vapour, but once the
     global mean passes water's critical region they disappear as white cloud
     decks: the atmosphere is steam/supercritical fluid, not floating liquid
     droplets. Snowball worlds favour low stratiform cover instead. */
  const cloudLow=Math.max(0,Math.min(1,
    (0.30+0.30*wet+0.10*waterAvail+0.12*snowball)*(1-0.82*supercritical)*(1-0.30*hot*(1-wet))));
  const cloudMid=Math.max(0,Math.min(1,
    (0.25+0.22*wet+0.17*warm*wet+0.08*fluxStress)*(1-0.78*supercritical)));
  const cloudHigh=Math.max(0,Math.min(1,
    (0.16+0.20*wet+0.24*warm*wet+0.12*(c.moistIndex||0))*(1-0.68*supercritical)));

  const wind=Math.max(0,Math.min(1,0.42+0.18*fluxStress+0.12*warm+0.10*snowball));
  const convection=Math.max(0,Math.min(1,
    (0.30+0.58*warm*wet+0.18*(c.moistIndex||0))*(1-0.75*supercritical)));
  const storm=Math.max(0,Math.min(1,
    0.16+0.70*Math.sqrt(Math.max(0,convection*wet))+0.12*fluxStress));
  const snowAlt=Math.max(0,Math.min(1,(C+20)/80));
  return {snowAlt,cloudLow,cloudMid,cloudHigh,wind,convection,storm};
}

/* 0.5.33 returned weather to a captured startup value. Now that climate has
   physical inputs, derived weather returns to a climate-dependent target.
   Manual dragging remains a temporary forcing with the same hold semantics. */
if(typeof relaxTransientControls==='function' && typeof TRANSIENT_DERIVED_KEYS!=='undefined'){
  relaxTransientControls=function(dtSec){
    const now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    const targets=climateWeatherTargets();
    let moved=false;
    TRANSIENT_DERIVED_KEYS.forEach(k=>{
      if(transientHeld[k] || now<(transientManualUntil[k]||0)) return;
      const target=Number.isFinite(targets[k])?targets[k]:Math.max(0,Math.min(1,state[k]));
      const old=Math.max(0,Math.min(1,Number(state[k])||0));
      const next=relaxTransientScalar(old,target,dtSec,TRANSIENT_TAU[k]);
      if(Math.abs(next-old)>1e-7){ state[k]=next; moved=true; }
    });
    return moved;
  };
}

/* Steam-dominated atmospheres used to remain Earth-blue because H2O did not
   participate in the haze-colour adapter. Give a water-dominated greenhouse
   a pale Venus-like optical character; pressure still comes from real gas
   inventory and is not invented here. */
if(typeof atmoCompFromGases==='function'){
  const atmoCompBeforeStellarWeather=atmoCompFromGases;
  atmoCompFromGases=function(){
    const base=atmoCompBeforeStellarWeather();
    const g=gasFractions();
    const steam=stellarWeatherSmooth(0.08,0.55,Math.max(0,g.gasH2O||0));
    return Math.max(base,0.48*steam);
  };
}
