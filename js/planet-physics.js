/* ============ 0.5.35: planet physical scaffold ============ */
/*
   This patch establishes the planet-side BASE inputs before weather starts
   depending on them. Only relationships that are already unambiguous are
   calculated here: radius + bulk-composition proxy -> density, mass, surface
   gravity and escape velocity. Age, rotation and axial tilt are stored as
   first-class causes but are deliberately not wired to volcanism, dynamo or
   seasons yet. Those couplings need their own explicit models later.
*/

const PLANET_PARAM_DEFS = Object.freeze([
  {k:'planetAge',      label:'Возраст планеты',           def:(4.54-0.05)/(12.0-0.05), group:'Планета'},
  {k:'planetRadius',   label:'Радиус планеты',            def:0.50, group:'Планета'},
  {k:'coreType',       label:'Внутреннее строение',       def:0.25, group:'Планета'},
  {k:'rotationPeriod', label:'Период вращения',           def:0.32, group:'Планета'},
  {k:'axialTilt',      label:'Наклон оси',                def:23.44/90.0, group:'Планета'},
]);

/* Existing positional hashes keep their meaning because new parameters are
   appended, never inserted into the legacy sequence. v4 hashes are named. */
PLANET_PARAM_DEFS.forEach(p => {
  if(!PARAMS.some(q => q.k === p.k)) PARAMS.push({...p});
  if(!Number.isFinite(state[p.k])) state[p.k] = p.def;
});

/* Volcanism is a user-facing slow BASE input at this stage. Keep it next to
   the other planetary causes instead of presenting it as mere surface paint.
   A later interior-heat model may supply its natural/equilibrium value. */
const volcanoParam = PARAMS.find(p => p.k === 'volcano');
if(volcanoParam) volcanoParam.group = 'Планета';

const EARTH_DENSITY_G_CM3 = 5.514;
const EARTH_G_MS2 = 9.80665;
const EARTH_ESCAPE_KMS = 11.186;

/* coreType is intentionally a bulk-composition scaffold, not a claim that a
   single slider fully specifies mantle/core mineralogy. Density anchors are
   representative values used only to obtain a coherent first mass estimate. */
const INTERIOR_ANCHORS = Object.freeze([
  Object.freeze({x:0.00, label:'железистая / Mercury-like', density:6.50}),
  Object.freeze({x:0.25, label:'Earth-like Fe + силикаты',   density:5.514}),
  Object.freeze({x:0.55, label:'силикатная, мало металла',   density:4.20}),
  Object.freeze({x:0.80, label:'водный мир',                 density:2.60}),
  Object.freeze({x:1.00, label:'ледяной / volatile-rich',    density:1.60}),
]);

function planetClamp01(x){ return Math.max(0, Math.min(1, Number(x) || 0)); }
function planetPivotLog(v,pivot,lo,mid,hi){
  v=planetClamp01(v);
  if(v <= pivot){
    const u=v/Math.max(1e-9,pivot);
    return Math.exp(Math.log(lo) + u*(Math.log(mid)-Math.log(lo)));
  }
  const u=(v-pivot)/Math.max(1e-9,1-pivot);
  return Math.exp(Math.log(mid) + u*(Math.log(hi)-Math.log(mid)));
}
function planetAgeGyr(v){ return 0.05 + 11.95*planetClamp01(v); }
function planetRadiusEarth(v){ return planetPivotLog(v,0.50,0.25,1.0,3.0); }
function rotationPeriodHours(v){ return planetPivotLog(v,0.32,4.0,24.0,2400.0); }
function axialTiltDeg(v){ return 90.0*planetClamp01(v); }

function interiorAt(v){
  v=planetClamp01(v);
  for(let i=0;i<INTERIOR_ANCHORS.length-1;i++){
    const a=INTERIOR_ANCHORS[i], b=INTERIOR_ANCHORS[i+1];
    if(v <= b.x){
      const u=(v-a.x)/Math.max(1e-9,b.x-a.x);
      return {
        label: u < 0.5 ? a.label : b.label,
        density: a.density + (b.density-a.density)*u
      };
    }
  }
  const z=INTERIOR_ANCHORS[INTERIOR_ANCHORS.length-1];
  return {label:z.label,density:z.density};
}

function planetPhysics(){
  const ageGyr=planetAgeGyr(state.planetAge);
  const radiusEarth=planetRadiusEarth(state.planetRadius);
  const interior=interiorAt(state.coreType);
  const density=interior.density;
  /* First-order constant-bulk-density scaffold. More realistic compressed
     mass-radius curves can replace this without changing the public inputs. */
  const massEarth=(density/EARTH_DENSITY_G_CM3)*Math.pow(radiusEarth,3);
  const gravityEarth=massEarth/Math.max(1e-9,radiusEarth*radiusEarth);
  const gravityMS2=EARTH_G_MS2*gravityEarth;
  const escapeKMS=EARTH_ESCAPE_KMS*Math.sqrt(Math.max(0,massEarth/radiusEarth));
  return {
    ageGyr,radiusEarth,
    coreLabel:interior.label,density,massEarth,
    gravityEarth,gravityMS2,escapeKMS,
    rotationHours:rotationPeriodHours(state.rotationPeriod),
    axialTiltDeg:axialTiltDeg(state.axialTilt),
    surfaceAreaEarth:radiusEarth*radiusEarth
  };
}

function planetAgeLabel(v){
  const x=planetAgeGyr(v);
  return (x<1 ? x.toFixed(2) : x.toFixed(1))+' млрд лет';
}
function planetRadiusLabel(v){
  const r=planetRadiusEarth(v);
  return r.toFixed(r<1?2:1)+' R⊕';
}
function coreTypeLabel(v){ return interiorAt(v).label; }
function rotationPeriodLabel(v){
  const h=rotationPeriodHours(v);
  if(h < 48) return h.toFixed(h<10?1:0)+' ч';
  const d=h/24;
  return d.toFixed(d<10?1:0)+' сут';
}
function axialTiltLabel(v){ return axialTiltDeg(v).toFixed(1)+'°'; }

/* Extend the old generic UI without making ui.js own planet physics. */
if(typeof valueText === 'function'){
  const valueTextBeforePlanet=valueText;
  valueText=function(p){
    switch(p.k){
      case 'planetAge': return planetAgeLabel(state.planetAge);
      case 'planetRadius': return planetRadiusLabel(state.planetRadius);
      case 'coreType': return coreTypeLabel(state.coreType);
      case 'rotationPeriod': return rotationPeriodLabel(state.rotationPeriod);
      case 'axialTilt': return axialTiltLabel(state.axialTilt);
      default: return valueTextBeforePlanet(p);
    }
  };
}

function appendPlanetDiagnosticRow(body,label,key){
  const row=document.createElement('div');
  row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
  const a=document.createElement('span'); a.textContent=label; a.style.opacity='.62';
  const b=document.createElement('span'); b.dataset.planet=key; b.style.textAlign='right';
  row.append(a,b); body.appendChild(row);
}
function refreshPlanetDiagnostics(){
  if(typeof document === 'undefined') return;
  const box=document.getElementById('planetPhysicsDiag');
  if(!box) return;
  const p=planetPhysics();
  const set=(k,v)=>{ const e=box.querySelector('[data-planet="'+k+'"]'); if(e)e.textContent=v; };
  set('mass',p.massEarth.toFixed(p.massEarth<1?2:1)+' M⊕');
  set('density',p.density.toFixed(2)+' г/см³');
  set('gravity',p.gravityMS2.toFixed(2)+' м/с² · '+p.gravityEarth.toFixed(2)+' g⊕');
  set('escape',p.escapeKMS.toFixed(1)+' км/с');
  set('interior','возраст/вулканизм/динамо: связи позже');
}

if(typeof createPanel === 'function'){
  const createPanelBeforePlanet=createPanel;
  createPanel=function(group){
    const el=createPanelBeforePlanet(group);
    if(group==='Планета' && !el.querySelector('#planetPhysicsDiag')){
      const body=el.querySelector('.p-body');
      const box=document.createElement('div');
      box.id='planetPhysicsDiag';
      box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--txt)';
      appendPlanetDiagnosticRow(box,'Масса','mass');
      appendPlanetDiagnosticRow(box,'Средняя плотность','density');
      appendPlanetDiagnosticRow(box,'Гравитация','gravity');
      appendPlanetDiagnosticRow(box,'Escape velocity','escape');
      appendPlanetDiagnosticRow(box,'Медленная физика','interior');
      body.appendChild(box);
      refreshPlanetDiagnostics();
    }
    return el;
  };
}
if(typeof syncDynamicLabels === 'function'){
  const syncDynamicLabelsBeforePlanet=syncDynamicLabels;
  syncDynamicLabels=function(){
    syncDynamicLabelsBeforePlanet();
    refreshPlanetDiagnostics();
  };
}

/* The existing random-world action predates these controls. Add a second,
   later listener so new worlds vary the scaffold too without rewriting UI. */
if(typeof document !== 'undefined'){
  const randPlanet=document.getElementById('rand');
  if(randPlanet) randPlanet.addEventListener('click',()=>{
    state.planetAge=0.08+Math.random()*0.82;
    state.planetRadius=0.20+Math.random()*0.62;
    state.coreType=Math.random();
    state.rotationPeriod=0.08+Math.random()*0.72;
    state.axialTilt=Math.pow(Math.random(),1.7)*0.75;
    if(typeof syncUI==='function') syncUI();
    if(typeof saveHash==='function') saveHash();
  });
}
