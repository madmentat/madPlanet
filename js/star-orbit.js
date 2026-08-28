/* ============ 0.5.34: star/orbit physics and habitable zone ============ */
/* The weather system will later consume these values directly. For this
   release they replace the old sqrt(L)-only HZ label and centralize the
   orbit mapping used by the climate model. */

const STELLAR_CLASS_ANCHORS = Object.freeze([
  {x:0.00, cls:'M', T:3000},
  {x:0.17, cls:'K', T:4500},
  {x:0.43, cls:'G', T:5772},
  {x:0.57, cls:'F', T:6800},
  {x:0.71, cls:'A', T:9000},
  {x:0.86, cls:'B', T:18000},
  {x:1.00, cls:'O', T:35000},
]);

/* Kopparapu et al. conservative/optimistic effective-flux fits.
   Valid for 2600..7200 K. For hotter stars the fit is clamped to 7200 K and
   marked approximate rather than silently extrapolated far outside its range. */
const HZ_COEFF = Object.freeze({
  recentVenus:       Object.freeze([1.776, 2.136e-4, 2.533e-8, -1.332e-11, -3.097e-15]),
  runawayGreenhouse: Object.freeze([1.107, 1.332e-4, 1.580e-8, -8.308e-12, -1.931e-15]),
  maximumGreenhouse: Object.freeze([0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16]),
  earlyMars:         Object.freeze([0.320, 5.547e-5, 1.526e-9, -2.874e-12, -5.011e-16]),
});

function clampUnit(x){ return Math.max(0, Math.min(1, Number(x) || 0)); }
function interpolateAnchorTemperature(x){
  x = clampUnit(x);
  for(let i=0;i<STELLAR_CLASS_ANCHORS.length-1;i++){
    const a=STELLAR_CLASS_ANCHORS[i], b=STELLAR_CLASS_ANCHORS[i+1];
    if(x <= b.x){
      const u=(x-a.x)/Math.max(1e-9,b.x-a.x);
      return a.T + (b.T-a.T)*u;
    }
  }
  return STELLAR_CLASS_ANCHORS[STELLAR_CLASS_ANCHORS.length-1].T;
}
function nearestSpectralClass(x){
  x=clampUnit(x);
  let best=STELLAR_CLASS_ANCHORS[0], d=Math.abs(x-best.x);
  for(let i=1;i<STELLAR_CLASS_ANCHORS.length;i++){
    const q=Math.abs(x-STELLAR_CLASS_ANCHORS[i].x);
    if(q<d){ best=STELLAR_CLASS_ANCHORS[i]; d=q; }
  }
  return best.cls;
}

/* Logarithmic sliders with explicit Earth/Sun pivots. This gives M-dwarf
   systems enough room close to the star without sacrificing wide hot-star
   orbits. */
function pivotLogSlider(v, pivot, lo, hi){
  v=clampUnit(v);
  if(v <= pivot){
    const u=v/Math.max(1e-9,pivot);
    return Math.pow(10, Math.log10(lo) + u*(0-Math.log10(lo)));
  }
  const u=(v-pivot)/Math.max(1e-9,1-pivot);
  return Math.pow(10, u*Math.log10(hi));
}
function stellarLuminosityFromSlider(v){ return pivotLogSlider(v,0.43,0.003,50.0); }
function orbitDistanceAU(v){ return pivotLogSlider(v,0.51,0.03,10.0); }
function orbitalFluxEarth(L, au){ return Math.max(0,Number(L)||0)/Math.max(1e-9,au*au); }

function hzEffectiveFlux(T, coeff){
  const fitT=Math.max(2600,Math.min(7200,Number(T)||5772));
  const dT=fitT-5780;
  return coeff[0] + coeff[1]*dT + coeff[2]*dT*dT
       + coeff[3]*dT*dT*dT + coeff[4]*dT*dT*dT*dT;
}
function habitableZoneForStar(T,L){
  const fitT=Math.max(2600,Math.min(7200,Number(T)||5772));
  const approx=Math.abs(fitT-(Number(T)||5772))>1e-6;
  const flux={
    optimisticInner: hzEffectiveFlux(T,HZ_COEFF.recentVenus),
    conservativeInner: hzEffectiveFlux(T,HZ_COEFF.runawayGreenhouse),
    conservativeOuter: hzEffectiveFlux(T,HZ_COEFF.maximumGreenhouse),
    optimisticOuter: hzEffectiveFlux(T,HZ_COEFF.earlyMars),
  };
  const root=s=>Math.sqrt(Math.max(1e-12,L)/Math.max(1e-12,s));
  return {
    fitT, approx, flux,
    optimisticInner: root(flux.optimisticInner),
    conservativeInner: root(flux.conservativeInner),
    conservativeOuter: root(flux.conservativeOuter),
    optimisticOuter: root(flux.optimisticOuter),
  };
}
function hzStatus(au,hz){
  if(au < hz.optimisticInner) return {code:'hot',label:'горячее HZ'};
  if(au < hz.conservativeInner) return {code:'warm-edge',label:'горячий край HZ'};
  if(au <= hz.conservativeOuter) return {code:'conservative',label:'зона Златовласки'};
  if(au <= hz.optimisticOuter) return {code:'cold-edge',label:'холодный край HZ'};
  return {code:'cold',label:'холоднее HZ'};
}

/* Replace the old coarse stellar mapping while preserving the fields used by
   the renderer. Luminosity stays user-controlled; radius follows
   Stefan-Boltzmann and mass remains a first-order main-sequence estimate. */
starPhysics = function(t, lumT=0.43){
  const T=interpolateAnchorTemperature(t);
  const L=stellarLuminosityFromSlider(lumT);
  const M=Math.pow(Math.max(L,1e-6),1/3.8);
  const R=Math.sqrt(L)*Math.pow(5772/T,2);
  const hz=habitableZoneForStar(T,L);
  return {
    T,L,M,R,hz:Math.sqrt(L),
    hzInner:hz.conservativeInner,
    hzOuter:hz.conservativeOuter,
    hzApprox:hz.approx
  };
};
starLabel = function(t){ return nearestSpectralClass(t); };
luminosityLabel = function(v){
  const x=starPhysics(state?.star ?? 0.38,v);
  return x.L.toFixed(x.L<0.1?3:2)+'L · '+x.R.toFixed(2)+'R · '+x.M.toFixed(2)+'M';
};
distanceInfo = function(v){
  const au=orbitDistanceAU(v);
  const st=starPhysics(state?.star ?? 0.38,state?.luminosity ?? 0.43);
  const hz=habitableZoneForStar(st.T,st.L);
  const status=hzStatus(au,hz);
  const S=orbitalFluxEarth(st.L,au);
  return {
    au, hz:Math.sqrt(st.L), q:au/Math.sqrt(st.L), S,
    inner:hz.conservativeInner, outer:hz.conservativeOuter,
    optimisticInner:hz.optimisticInner, optimisticOuter:hz.optimisticOuter,
    approx:hz.approx, status:status.code,
    label:au.toFixed(2)+' AU · '+S.toFixed(S<0.1?2:1)+' S⊕ · '+status.label
  };
};

/* Keep the existing climate parameterization for now, but feed it the same
   stellar luminosity and orbit distance shown in the UI. Previously the UI
   and the climate model each carried their own mapping constants. */
climateModel = function(){
  const st=starPhysics(state.star,state.luminosity);
  const au=orbitDistanceAU(state.distance);
  const S=orbitalFluxEarth(st.L,au);
  const dens=0.10+1.55*Math.max(0,Math.min(1,state.atmo));
  const g=gasFractions();
  const tau=dens*(g.gasCO2*180+g.gasCH4*1400+g.gasH2O*70
                 +g.gasSO2*40+g.gasHHe*4);
  const aer=Math.min(0.42,3.4*Math.sqrt(Math.max(0,g.gasSO2)*dens));
  const cloudCov=Math.max(0,Math.min(1,
      0.55*state.cloudLow+0.30*state.cloudMid+0.15*state.cloudHigh));
  let T=288,A=0.3;
  for(let i=0;i<6;i++){
    const iceFrac=Math.max(0,Math.min(1,(273.15-T)/55));
    A=Math.max(0.03,Math.min(0.88,
        0.055+0.16*(1-state.sea)+0.30*cloudCov+0.40*iceFrac+aer));
    T=278.6*Math.pow(Math.max(S,1e-4)*(1-A),0.25)+108*Math.log(1+tau);
  }
  const hz=habitableZoneForStar(st.T,st.L);
  return {T,C:T-273.15,S,au,A,aer,tau,dens,hz};
};

function currentStarOrbitDiagnostics(){
  const st=starPhysics(state.star,state.luminosity);
  const d=distanceInfo(state.distance);
  const hz=habitableZoneForStar(st.T,st.L);
  return {
    cls:starLabel(state.star), T:st.T, L:st.L, au:d.au, S:d.S,
    inner:hz.conservativeInner, outer:hz.conservativeOuter,
    optimisticInner:hz.optimisticInner, optimisticOuter:hz.optimisticOuter,
    approx:hz.approx, status:d.status
  };
}
function formatHzRange(a,b){ return a.toFixed(2)+'–'+b.toFixed(2)+' AU'; }
function refreshStarDiagnostics(){
  if(typeof document==='undefined') return;
  const box=document.getElementById('starPhysicsDiag');
  if(!box) return;
  const d=currentStarOrbitDiagnostics();
  const statusText={
    hot:'горячее оптимистичной HZ',
    'warm-edge':'в оптимистичной внутренней кромке',
    conservative:'в консервативной HZ',
    'cold-edge':'в оптимистичной внешней кромке',
    cold:'холоднее оптимистичной HZ'
  }[d.status] || d.status;
  const set=(k,v)=>{ const e=box.querySelector('[data-hz="'+k+'"]'); if(e)e.textContent=v; };
  set('star',d.cls+' · '+Math.round(d.T)+' K');
  set('flux',d.S.toFixed(d.S<0.1?3:2)+' S⊕');
  set('hz',formatHzRange(d.inner,d.outer)+(d.approx?' ~':''));
  set('wide',formatHzRange(d.optimisticInner,d.optimisticOuter)+(d.approx?' ~':''));
  set('status',statusText);
}
function appendStarDiagnosticRow(body,label,key){
  const row=document.createElement('div');
  row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
  const a=document.createElement('span'); a.textContent=label; a.style.opacity='.62';
  const b=document.createElement('span'); b.dataset.hz=key; b.style.textAlign='right';
  row.append(a,b); body.appendChild(row);
}

/* Panels are lazy. Add diagnostics only when the Star panel is first opened. */
if(typeof createPanel==='function'){
  const createPanelBeforeStarOrbit=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeStarOrbit(group);
    if(group==='Звезда' && !el.querySelector('#starPhysicsDiag')){
      const body=el.querySelector('.p-body');
      const box=document.createElement('div');
      box.id='starPhysicsDiag';
      box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--txt)';
      appendStarDiagnosticRow(box,'Звезда','star');
      appendStarDiagnosticRow(box,'Поток','flux');
      appendStarDiagnosticRow(box,'HZ консервативная','hz');
      appendStarDiagnosticRow(box,'HZ оптимистичная','wide');
      appendStarDiagnosticRow(box,'Положение','status');
      body.appendChild(box);
      refreshStarDiagnostics();
    }
    return el;
  };
}
if(typeof syncDynamicLabels==='function'){
  const syncDynamicLabelsBeforeStarOrbit=syncDynamicLabels;
  syncDynamicLabels=function(){
    syncDynamicLabelsBeforeStarOrbit();
    refreshStarDiagnostics();
  };
}
