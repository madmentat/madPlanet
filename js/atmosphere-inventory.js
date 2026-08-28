/* ============ 0.5.36: absolute atmospheric gas inventories ============ */
/*
   Gas state values are no longer fractions constrained to sum to one.
   Each gas stores an independent Earth-gravity pressure-equivalent column
   inventory. At 1 g, inventory=1 corresponds to 1 Earth standard atmosphere
   of that species; actual surface pressure scales with the planet gravity.

   The old state.atmo slider survives only as a hidden renderer/climate proxy.
   It is derived from the real total column and must never be a physical input.
*/

const ATMOSPHERE_INVENTORY_MODEL = 1;
const EARTH_ATM_BAR = 1.01325;
const GAS_INV_MIN = 1e-8;
const GAS_INV_MAX = 100.0;
const GAS_MOLAR_MASS = Object.freeze({
  gasN2:28.0134, gasO2:31.998, gasH2O:18.01528, gasCO2:44.0095,
  gasSO2:64.066, gasCH4:16.043, gasHHe:2.30
});

const legacyNormalizeGasesForMigration = normalizeGases;
const loadHashBeforeAtmosphereInventory = loadHash;

function legacyAtmoColumnScale(v){
  return 0.10 + 1.55*Math.max(0,Math.min(1,Number(v)||0));
}
function atmosphereGravityEarth(){
  if(typeof planetPhysics === 'function'){
    const p=planetPhysics();
    if(Number.isFinite(p.gravityEarth) && p.gravityEarth>0) return p.gravityEarth;
  }
  return 1.0;
}
function sanitizeGasInventories(){
  GAS_KEYS.forEach(k => {
    const x=Number(state[k]);
    state[k]=Number.isFinite(x) ? Math.max(0,Math.min(GAS_INV_MAX,x)) : 0;
  });
}
function gasInventoryTotal(){
  let s=0;
  GAS_KEYS.forEach(k => { s+=Math.max(0,Number(state[k])||0); });
  return s;
}
function gasFractions(){
  const out={};
  const total=gasInventoryTotal();
  if(total<=1e-15){
    GAS_KEYS.forEach(k => out[k]=0);
    out.gasN2=1;
    return out;
  }
  GAS_KEYS.forEach(k => out[k]=Math.max(0,Number(state[k])||0)/total);
  return out;
}
normalizeGases=function(){
  /* Compatibility name. Inventories are independent and never normalized. */
  sanitizeGasInventories();
};
function setGasFraction(key,value){
  /* Compatibility name used by ui.js: it now sets one inventory only. */
  if(!GAS_KEYS.includes(key)) return;
  state[key]=Math.max(0,Math.min(GAS_INV_MAX,Number(value)||0));
  updateLegacyAtmoProxy();
}
function gasSliderToVal(x){
  x=Math.max(0,Math.min(1,Number(x)||0));
  if(x<=0.002) return 0;
  return GAS_INV_MIN*Math.pow(GAS_INV_MAX/GAS_INV_MIN,x);
}
function gasValToSlider(v){
  v=Number(v)||0;
  if(v<=GAS_INV_MIN) return v>0 ? 0.002 : 0;
  return Math.max(0,Math.min(1,
    Math.log(v/GAS_INV_MIN)/Math.log(GAS_INV_MAX/GAS_INV_MIN)));
}
function gasPartialPressureBar(key){
  return Math.max(0,Number(state[key])||0)*atmosphereGravityEarth()*EARTH_ATM_BAR;
}
function atmosphereSurfacePressureBar(){
  return gasInventoryTotal()*atmosphereGravityEarth()*EARTH_ATM_BAR;
}
function meanMolecularWeight(){
  const f=gasFractions();
  let mw=0;
  GAS_KEYS.forEach(k => { mw+=(f[k]||0)*(GAS_MOLAR_MASS[k]||28.97); });
  return mw>0 ? mw : 28.97;
}
function atmosphereTemperatureK(){
  if(typeof climateModel === 'function'){
    const c=climateModel();
    if(c && Number.isFinite(c.T)) return Math.max(80,Math.min(3000,c.T));
  }
  if(typeof sliderToTemp === 'function') return Math.max(80,sliderToTemp(state.temp)+273.15);
  return 288.15;
}
function atmosphereScaleHeightKm(){
  const T=atmosphereTemperatureK();
  const mw=Math.max(1e-3,meanMolecularWeight())/1000;
  const g=Math.max(0.05,9.80665*atmosphereGravityEarth());
  return 8.314462618*T/(mw*g)/1000;
}
function atmosphereSurfaceDensityKgM3(){
  const P=atmosphereSurfacePressureBar()*1e5;
  const T=atmosphereTemperatureK();
  const mw=Math.max(1e-3,meanMolecularWeight())/1000;
  return P*mw/(8.314462618*T);
}
function updateLegacyAtmoProxy(){
  const earthColumnPressure=gasInventoryTotal()*atmosphereGravityEarth();
  state.atmo=Math.max(0,Math.min(1,(earthColumnPressure-0.10)/1.55));
  return state.atmo;
}
function migrateLegacyAtmosphereState(){
  /* Legacy gas values are fractions. Old atmo supplies the total column. */
  legacyNormalizeGasesForMigration();
  const scale=legacyAtmoColumnScale(state.atmo);
  GAS_KEYS.forEach(k => { state[k]=Math.max(0,state[k]||0)*scale; });
  sanitizeGasInventories();
  updateLegacyAtmoProxy();
}

function gasInventoryLabel(key){
  const p=gasPartialPressureBar(key);
  const f=gasFractions()[key]||0;
  let pressure;
  if(p>=10) pressure=p.toFixed(1)+' bar';
  else if(p>=0.1) pressure=p.toFixed(2)+' bar';
  else if(p>=1e-3) pressure=(p*1000).toFixed(p>=0.01?0:1)+' mbar';
  else if(p>=1e-6) pressure=(p*1e6).toFixed(p>=1e-5?0:1)+' μbar';
  else pressure=(p*1e9).toFixed(1)+' nbar';
  const pc=f*100;
  const pct=pc>=10?pc.toFixed(1):pc>=1?pc.toFixed(2):pc>=0.01?pc.toFixed(3):pc.toPrecision(2);
  return pressure+' · '+pct+'%';
}

/* Hide the obsolete density slider while retaining the field for old hashes
   and for renderer uniforms. Gas controls are true persistent BASE inputs. */
const legacyAtmoParam=PARAMS.find(p=>p.k==='atmo');
if(legacyAtmoParam){
  legacyAtmoParam.group='__legacy_atmosphere';
  legacyAtmoParam.role='diagnostic';
  legacyAtmoParam.base=false;
  legacyAtmoParam.derived='pressure';
  legacyAtmoParam.transient=true;
}
PARAMS.filter(p=>p.gas).forEach(p=>{
  p.role='base'; p.base=true; p.transient=false;
  delete p.derived;
});

/* Convert defaults immediately. A later loadHash() either replaces them from
   v5 or reloads legacy fractions and migrates those once. */
migrateLegacyAtmosphereState();

/* Gas labels are keyed now; the old gasLabel(value) had no species context. */
if(typeof valueText==='function'){
  const valueTextBeforeAtmosphereInventory=valueText;
  valueText=function(p){
    if(p && p.gas) return gasInventoryLabel(p.k);
    return valueTextBeforeAtmosphereInventory(p);
  };
}

function parseNamedHash(parts){
  const map={}; let seedSet=false;
  for(let i=1;i<parts.length;i++){
    const kv=parts[i], eq=kv.indexOf('=');
    if(eq<0){
      if(!seedSet && kv[0]==='s'){
        const sd=parseInt(kv.slice(1),10);
        if(Number.isFinite(sd)){ state.seed=sd; seedSet=true; }
      }
      continue;
    }
    map[kv.slice(0,eq)]=kv.slice(eq+1);
  }
  return map;
}
loadHash=function(){
  const h=location.hash.slice(1);
  if(!h){ updateLegacyAtmoProxy(); return; }
  const parts=h.split(',');
  if(parts[0]==='v5'){
    const map=parseNamedHash(parts);
    PARAMS.forEach(p=>{
      if(p.k==='atmo') return;
      const v=parseFloat(map[p.k]);
      if(!Number.isFinite(v)) return;
      state[p.k]=p.gas ? Math.max(0,Math.min(GAS_INV_MAX,v))
                       : Math.max(0,Math.min(1,v));
    });
    FLAG_KEYS.forEach(k=>{
      if(/^pin(?:Temp|H2O|CO2|SO2)$/.test(k)) return;
      if(k in map) state[k]=map[k]==='1';
    });
    sanitizeGasInventories();
    if(typeof releaseLegacyPins==='function') releaseLegacyPins();
    if(typeof captureTransientEquilibrium==='function') captureTransientEquilibrium();
    updateLegacyAtmoProxy();
    return;
  }

  /* Older hashes contain fractions plus the old atmo amount. Temporarily put
     the original normalizer back because the legacy parser expects it. */
  const inventoryNormalizer=normalizeGases;
  normalizeGases=legacyNormalizeGasesForMigration;
  try{ loadHashBeforeAtmosphereInventory(); }
  finally{ normalizeGases=inventoryNormalizer; }
  migrateLegacyAtmosphereState();
  if(typeof releaseLegacyPins==='function') releaseLegacyPins();
  if(typeof captureTransientEquilibrium==='function') captureTransientEquilibrium();
};

saveHash=function(){
  clearTimeout(hashT);
  hashT=setTimeout(()=>{
    const out=['v5','s'+state.seed];
    PARAMS.forEach(p=>{
      if(p.k==='atmo' || p.transient) return;
      const v=Number(state[p.k]);
      if(!Number.isFinite(v)) return;
      out.push(p.k+'='+v.toFixed(p.gas?8:3));
    });
    FLAG_KEYS.forEach(k=>{
      if(/^pin(?:Temp|H2O|CO2|SO2)$/.test(k)) return;
      out.push(k+'='+(state[k]?1:0));
    });
    try{ history.replaceState(null,'','#'+out.join(',')); }catch(e){}
  },200);
};

/* Replace the old fraction-normalizing derived loop. 0.5.36 keeps inventories
   fixed and only retains temperature plus the generic transient weather
   relaxation. Later releases can add reservoir/source terms explicitly. */
relaxDerived=function(dtSec){
  const dt=Math.max(0,Math.min(0.5,Number(dtSec)||0));
  updateLegacyAtmoProxy();
  state.atmoComp=atmoCompFromGases();
  let moved=false;
  const target=tempToSlider(climateModel().C);
  const a=1-Math.exp(-dt/2.2);
  const t=state.temp+(target-state.temp)*a;
  if(Math.abs(t-state.temp)>1e-5) moved=true;
  state.temp=t;
  if(typeof relaxTransientControls==='function' && relaxTransientControls(dt)) moved=true;
  return moved;
};

function appendAtmosphereDiagnosticRow(body,label,key){
  const row=document.createElement('div');
  row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
  const a=document.createElement('span'); a.textContent=label; a.style.opacity='.62';
  const b=document.createElement('span'); b.dataset.atmosphere=key; b.style.textAlign='right';
  row.append(a,b); body.appendChild(row);
}
function refreshAtmosphereDiagnostics(){
  if(typeof document==='undefined') return;
  const box=document.getElementById('atmospherePhysicsDiag');
  if(!box) return;
  updateLegacyAtmoProxy();
  const set=(k,v)=>{ const e=box.querySelector('[data-atmosphere="'+k+'"]'); if(e)e.textContent=v; };
  const p=atmosphereSurfacePressureBar();
  set('pressure',p<0.01?(p*1000).toFixed(2)+' mbar':p.toFixed(p<10?2:1)+' bar');
  set('mw',meanMolecularWeight().toFixed(2)+' г/моль');
  set('density',atmosphereSurfaceDensityKgM3().toFixed(3)+' кг/м³');
  set('scale',atmosphereScaleHeightKm().toFixed(1)+' км');
  set('column',gasInventoryTotal().toFixed(3)+' P⊕ при 1g');
}
if(typeof createPanel==='function'){
  const createPanelBeforeAtmosphereInventory=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeAtmosphereInventory(group);
    if(group==='Атмосфера' && !el.querySelector('#atmospherePhysicsDiag')){
      const body=el.querySelector('.p-body');
      const box=document.createElement('div');
      box.id='atmospherePhysicsDiag';
      box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--txt)';
      appendAtmosphereDiagnosticRow(box,'Давление','pressure');
      appendAtmosphereDiagnosticRow(box,'Молярная масса','mw');
      appendAtmosphereDiagnosticRow(box,'Плотность у поверхности','density');
      appendAtmosphereDiagnosticRow(box,'Scale height','scale');
      appendAtmosphereDiagnosticRow(box,'Суммарный запас','column');
      body.appendChild(box);
      refreshAtmosphereDiagnostics();
    }
    return el;
  };
}
if(typeof syncDynamicLabels==='function'){
  const syncDynamicLabelsBeforeAtmosphereInventory=syncDynamicLabels;
  syncDynamicLabels=function(){
    updateLegacyAtmoProxy();
    syncDynamicLabelsBeforeAtmosphereInventory();
    refreshAtmosphereDiagnostics();
  };
}

/* Existing random-world generation still creates a normalized legacy mixture.
   Convert that newly generated mixture into an independent inventory once the
   old handler has completed. */
if(typeof document!=='undefined'){
  const randAtmos=document.getElementById('rand');
  if(randAtmos) randAtmos.addEventListener('click',()=>{
    legacyNormalizeGasesForMigration();
    const scale=legacyAtmoColumnScale(state.atmo);
    GAS_KEYS.forEach(k=>{ state[k]=Math.max(0,state[k]||0)*scale; });
    sanitizeGasInventories();
    updateLegacyAtmoProxy();
    if(typeof syncUI==='function') syncUI();
    if(typeof saveHash==='function') saveHash();
  });
}
