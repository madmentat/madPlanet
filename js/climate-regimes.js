/* ============ 0.5.38: global climate regimes ============ */
/*
   One-box global climate scaffold. It replaces the old fraction-based
   greenhouse heuristic with a balance driven by the physical causes already
   present in the model: stellar flux, absolute gas inventories, surface
   pressure, water inventory and ice/cloud/aerosol albedo.

   This is deliberately not a GCM. It supplies stable global attractors and
   regime diagnostics for later weather physics. The 282 W/m2 moist OLR limit
   is used only as a runaway-greenhouse proxy, not as a universal hard law.
*/

const CLIMATE_REGIME_MODEL = 1;
const CLIMATE_SOLAR_CONSTANT = 1361.0;
const CLIMATE_SIGMA = 5.670374419e-8;
const CLIMATE_MOIST_OLR_LIMIT = 282.0;

function climateClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function climateSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=climateClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function climatePressureBar(){
  if(typeof atmosphereSurfacePressureBar==='function'){
    const p=atmosphereSurfacePressureBar();
    if(Number.isFinite(p)) return Math.max(0,p);
  }
  return (0.10+1.55*climateClamp(state.atmo,0,1))*1.01325;
}
function climateGasPressureBar(key){
  if(typeof gasPartialPressureBar==='function'){
    const p=gasPartialPressureBar(key);
    if(Number.isFinite(p)) return Math.max(0,p);
  }
  const f=(typeof gasFractions==='function'?gasFractions():{})[key]||0;
  return climatePressureBar()*f;
}
function climateWaterEow(){
  if(typeof waterTotalEowFromSlider==='function' && Number.isFinite(state.waterTotal))
    return Math.max(0,waterTotalEowFromSlider(state.waterTotal));
  return Math.max(0.0001,Math.pow(10,(climateClamp(state.sea,0,1)-0.58)/0.22));
}
function climateWaterAvailability(eow){
  return climateSmooth(0.0001,0.05,Math.max(0,eow));
}
function climateIceAlbedoForStar(starT){
  /* Water ice absorbs much more near-IR light from cool stars. Thus an M-star
     snowball is darker and easier to thaw than the same ice around a G/F star. */
  const u=climateClamp((climateClamp(starT,2600,7200)-2600)/(7200-2600),0,1);
  return 0.38+(0.66-0.38)*u;
}
function climateIceArea(T,waterAvail){
  return climateClamp(waterAvail*(1-climateSmooth(245,282,T)),0,1);
}
function climateCloudCover(){
  return climateClamp(0.55*state.cloudLow+0.30*state.cloudMid+0.15*state.cloudHigh,0,1);
}
function climateGreenhouseOpticalDepth(p){
  const total=Math.max(0,p.total);
  /* Background pressure broadens greenhouse bands. Keep the factor bounded:
     the detailed high-pressure continuum belongs in a later radiative model. */
  const broad=climateClamp(0.55+0.45*Math.sqrt(Math.max(0.001,total)),0.45,3.0);
  const dry=0.060*Math.sqrt(total);
  const co2=0.250*Math.log1p(Math.max(0,p.co2)/0.00028)*broad;
  const ch4=0.080*Math.log1p(Math.max(0,p.ch4)/1.8e-6)*broad;
  const h2o=0.280*Math.log1p(Math.max(0,p.h2o)/0.0010)*broad;
  /* Crude collision-induced absorption scaffold for H2/He-rich envelopes. */
  const hhe=0.180*Math.pow(Math.max(0,p.hhe),0.70);
  return climateClamp(dry+co2+ch4+h2o+hhe,0,80);
}
function climateAerosolAlbedo(pSO2){
  return climateClamp(0.0034*Math.sqrt(Math.max(0,pSO2)/1e-6),0,0.35);
}
function climateRegimeLabel(code){
  return ({
    snowball:'снежок / snowball', frozen:'глобально холодный',
    temperate:'умеренный', warm:'тёплый', hotDry:'горячий сухой',
    moistGreenhouse:'влажный парниковый', runawayGreenhouse:'runaway greenhouse'
  })[code]||code;
}
function climateClassify(c){
  if(c.runawayIndex>0.55) return 'runawayGreenhouse';
  if(c.moistIndex>0.42) return 'moistGreenhouse';
  if(c.iceArea>0.72 && c.T<260) return 'snowball';
  if(c.T<273.15) return 'frozen';
  if(c.T<305) return 'temperate';
  if(c.T<330) return 'warm';
  if(c.waterAvail<0.15) return 'hotDry';
  return 'moistGreenhouse';
}

climateModel=function(){
  const st=starPhysics(state.star,state.luminosity);
  const au=orbitDistanceAU(state.distance);
  const S=orbitalFluxEarth(st.L,au);
  const hz=habitableZoneForStar(st.T,st.L);
  const pressure=climatePressureBar();
  const p={
    total:pressure,
    co2:climateGasPressureBar('gasCO2'),
    ch4:climateGasPressureBar('gasCH4'),
    h2o:climateGasPressureBar('gasH2O'),
    so2:climateGasPressureBar('gasSO2'),
    hhe:climateGasPressureBar('gasHHe')
  };
  const tau=climateGreenhouseOpticalDepth(p);
  const aer=climateAerosolAlbedo(p.so2);
  const waterEow=climateWaterEow();
  const waterAvail=climateWaterAvailability(waterEow);
  const cloudCov=climateCloudCover();
  const sea=climateClamp(state.sea,0,1);
  const iceAlb=climateIceAlbedoForStar(st.T);
  const rayleigh=0.025*Math.min(2.0,Math.sqrt(Math.max(0,pressure)));
  const co2Scatter=Math.min(0.08,0.012*Math.log1p(Math.max(0,p.co2)/0.1));

  let T=Number.isFinite(state.temp) && typeof sliderToTemp==='function'
    ? sliderToTemp(state.temp)+273.15 : 288.0;
  T=climateClamp(T,120,900);
  let A=0.30, ASR=240, Te=255, iceArea=0;
  for(let i=0;i<14;i++){
    iceArea=climateIceArea(T,waterAvail);
    const surfaceOpen=0.060*sea+0.300*(1-sea);
    const surface=surfaceOpen*(1-iceArea)+iceAlb*iceArea;
    const cloudAlbedo=0.230*cloudCov;
    A=climateClamp(surface+cloudAlbedo+rayleigh+aer+co2Scatter,0.03,0.86);
    ASR=CLIMATE_SOLAR_CONSTANT*Math.max(0,S)*(1-A)/4;
    Te=Math.pow(Math.max(1,ASR)/CLIMATE_SIGMA,0.25);
    const target=Te*Math.pow(1+0.75*tau,0.25);
    T=0.45*T+0.55*target;
  }

  /* A saturated wet atmosphere develops a radiation ceiling. Blend toward
     that ceiling only when the model is actually both hot and moist, so dry
     high-flux planets are not falsely labelled runaway greenhouses. */
  const moistGate=waterAvail
    *climateSmooth(312,345,T)
    *climateSmooth(0.008,0.080,p.h2o);
  const rawOLR=CLIMATE_SIGMA*Math.pow(T,4)/Math.max(1e-6,1+0.75*tau);
  const OLR=rawOLR*(1-moistGate)+Math.min(rawOLR,CLIMATE_MOIST_OLR_LIMIT)*moistGate;
  let imbalance=ASR-OLR;

  /* Kopparapu's spectral inner edge is a second, deliberately soft warning.
     It keeps the proxy sensible across M/K/G/F stars without pretending that
     one fixed solar-flux threshold applies to every spectrum. */
  const innerFlux=st.L/Math.max(1e-9,hz.conservativeInner*hz.conservativeInner);
  const hzRunaway=climateSmooth(0.98,1.18,S/Math.max(1e-6,innerFlux))*waterAvail;
  const radiationRunaway=climateSmooth(0,35,Math.max(0,imbalance))*moistGate;
  const runawayIndex=climateClamp(Math.max(hzRunaway*0.72,radiationRunaway),0,1);

  /* Positive TOA imbalance in a wet opaque atmosphere nudges the equilibrium
     upward. The water-budget relaxation then adds vapour, creating the
     intended positive feedback without an instantaneous discontinuity. */
  if(imbalance>0 && moistGate>0){
    T+=Math.min(150,0.35*imbalance*moistGate);
  }
  T=climateClamp(T,120,900);

  const moistIndex=climateClamp(Math.max(
    climateSmooth(320,350,T)*waterAvail,
    climateSmooth(0.020,0.120,p.h2o)*waterAvail*0.85
  ),0,1);
  iceArea=climateIceArea(T,waterAvail);

  /* Recompute OLR after any runaway nudge for diagnostics. */
  const rawOLR2=CLIMATE_SIGMA*Math.pow(T,4)/Math.max(1e-6,1+0.75*tau);
  const moistGate2=waterAvail
    *climateSmooth(312,345,T)
    *climateSmooth(0.008,0.080,p.h2o);
  const OLR2=rawOLR2*(1-moistGate2)+Math.min(rawOLR2,CLIMATE_MOIST_OLR_LIMIT)*moistGate2;
  imbalance=ASR-OLR2;

  const out={
    T,C:T-273.15,S,au,A,aer,tau,dens:pressure/1.01325,hz,
    pressureBar:pressure,Te,ASR,OLR:OLR2,energyImbalance:imbalance,
    iceArea,waterEow,waterAvail,cloudCov,moistIndex,runawayIndex,
    innerFlux,partialPressures:p
  };
  out.regime=climateClassify(out);
  out.regimeLabel=climateRegimeLabel(out.regime);
  return out;
};

function appendClimateDiagnosticRow(body,label,key){
  const row=document.createElement('div');
  row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
  const a=document.createElement('span'); a.textContent=label; a.style.opacity='.62';
  const b=document.createElement('span'); b.dataset.climate=key; b.style.textAlign='right';
  row.append(a,b); body.appendChild(row);
}
function refreshClimateDiagnostics(){
  if(typeof document==='undefined') return;
  const box=document.getElementById('climateRegimeDiag'); if(!box) return;
  const c=climateModel();
  const set=(k,v)=>{ const e=box.querySelector('[data-climate="'+k+'"]'); if(e)e.textContent=v; };
  set('regime',c.regimeLabel);
  set('temp',c.T.toFixed(1)+' K · '+c.C.toFixed(1)+' °C');
  set('albedo',c.A.toFixed(3));
  set('balance',c.ASR.toFixed(0)+' / '+c.OLR.toFixed(0)+' Вт/м²');
  const d=c.energyImbalance;
  set('imbalance',(d>=0?'+':'')+d.toFixed(1)+' Вт/м²');
  set('ice',(100*c.iceArea).toFixed(c.iceArea<0.1?1:0)+'%');
  set('greenhouse','τ '+c.tau.toFixed(2)+' · H₂O '+c.partialPressures.h2o.toPrecision(2)+' bar');
}
if(typeof createPanel==='function'){
  const createPanelBeforeClimate=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeClimate(group);
    if(group==='Планета' && !el.querySelector('#climateRegimeDiag')){
      const body=el.querySelector('.p-body');
      const box=document.createElement('div');
      box.id='climateRegimeDiag';
      box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--txt)';
      appendClimateDiagnosticRow(box,'Климатический режим','regime');
      appendClimateDiagnosticRow(box,'Средняя T','temp');
      appendClimateDiagnosticRow(box,'Альбедо','albedo');
      appendClimateDiagnosticRow(box,'ASR / OLR','balance');
      appendClimateDiagnosticRow(box,'Баланс энергии','imbalance');
      appendClimateDiagnosticRow(box,'Ледяное покрытие','ice');
      appendClimateDiagnosticRow(box,'Парниковая оптика','greenhouse');
      body.appendChild(box);
      refreshClimateDiagnostics();
    }
    return el;
  };
}
if(typeof syncDynamicLabels==='function'){
  const syncDynamicLabelsBeforeClimate=syncDynamicLabels;
  syncDynamicLabels=function(){
    syncDynamicLabelsBeforeClimate();
    refreshClimateDiagnostics();
  };
}

/* Re-equilibrate the water scaffold once under the new radiative model so the
   first rendered frame does not spend several seconds drifting from the old
   0.5.37 climate heuristic. */
if(typeof settleWaterEquilibriumImmediate==='function') settleWaterEquilibriumImmediate(5);
