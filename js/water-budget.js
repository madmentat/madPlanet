/* ============ 0.5.37: conserved global H2O budget ============ */
/*
   waterTotal is the persistent BASE cause. The old state.sea value remains
   only as a renderer-compatible derived sea-level proxy, while atmospheric
   H2O becomes a reservoir of the same conserved total instead of an
   independent gas inventory.

   This is intentionally a global one-box scaffold. Local evaporation,
   precipitation, soil moisture, rivers and real sea-level integration over
   terrain arrive in later weather/hydrology milestones.
*/

const WATER_BUDGET_MODEL = 1;
const WATER_EARTH_OCEAN_GEL_M = 2700.0;
/* 2700 m of water corresponds to about 261.3 Earth-atmosphere columns by
   mass. Atmosphere inventory units are defined as pressure-equivalent at 1g. */
const WATER_EOW_TO_ATM_INV = 261.3;
const WATER_TOTAL_MIN_EOW = 1e-4;
const WATER_TOTAL_MAX_EOW = 100.0;
const WATER_TOTAL_PIVOT = 0.50;
const WATER_DEFAULT_SLIDER = 0.50;

/* Append, never insert: legacy positional v3 hashes keep their old indices. */
if(!PARAMS.some(p=>p.k==='waterTotal')){
  PARAMS.push({
    k:'waterTotal', label:'Общий запас H₂O', def:WATER_DEFAULT_SLIDER,
    group:'Планета', role:'base', base:true
  });
}
if(!Number.isFinite(state.waterTotal)) state.waterTotal=WATER_DEFAULT_SLIDER;
const waterTotalParam=PARAMS.find(p=>p.k==='waterTotal');
if(waterTotalParam){
  waterTotalParam.role='base'; waterTotalParam.base=true;
  waterTotalParam.transient=false; delete waterTotalParam.derived;
}

/* Old visual ocean amount and H2O gas are calculated reservoirs now. */
const legacySeaParam=PARAMS.find(p=>p.k==='sea');
if(legacySeaParam){
  legacySeaParam.group='__legacy_water';
  legacySeaParam.role='derived'; legacySeaParam.base=false;
  legacySeaParam.derived='water'; legacySeaParam.transient=false;
}
const waterVaporParam=PARAMS.find(p=>p.k==='gasH2O');
if(waterVaporParam){
  waterVaporParam.role='derived'; waterVaporParam.base=false;
  waterVaporParam.derived='water'; waterVaporParam.transient=false;
}

/* Keep the parameter-role API coherent even though waterTotal is appended
   after param-model.js has run its initial classification pass. */
if(typeof parameterRole==='function' && typeof PARAM_ROLE!=='undefined'){
  const parameterRoleBeforeWater=parameterRole;
  parameterRole=function(key){
    if(key==='waterTotal') return PARAM_ROLE.BASE;
    if(key==='sea' || key==='gasH2O') return PARAM_ROLE.DERIVED;
    return parameterRoleBeforeWater(key);
  };
}

function waterClamp01(x){ return Math.max(0,Math.min(1,Number(x)||0)); }
function waterSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=Math.max(0,Math.min(1,(x-a)/(b-a)));
  return u*u*(3-2*u);
}
function waterTotalEowFromSlider(v){
  v=waterClamp01(v);
  if(v<=WATER_TOTAL_PIVOT){
    const u=v/WATER_TOTAL_PIVOT;
    return Math.exp(Math.log(WATER_TOTAL_MIN_EOW)+u*(0-Math.log(WATER_TOTAL_MIN_EOW)));
  }
  const u=(v-WATER_TOTAL_PIVOT)/(1-WATER_TOTAL_PIVOT);
  return Math.exp(u*Math.log(WATER_TOTAL_MAX_EOW));
}
function waterTotalSliderFromEow(eow){
  eow=Math.max(WATER_TOTAL_MIN_EOW,Math.min(WATER_TOTAL_MAX_EOW,Number(eow)||WATER_TOTAL_MIN_EOW));
  if(eow<=1){
    const u=(Math.log(eow)-Math.log(WATER_TOTAL_MIN_EOW))/(0-Math.log(WATER_TOTAL_MIN_EOW));
    return waterClamp01(u*WATER_TOTAL_PIVOT);
  }
  const u=Math.log(eow)/Math.log(WATER_TOTAL_MAX_EOW);
  return waterClamp01(WATER_TOTAL_PIVOT+u*(1-WATER_TOTAL_PIVOT));
}
function waterTemperatureK(){
  if(typeof climateModel==='function'){
    const c=climateModel();
    if(c && Number.isFinite(c.T)) return Math.max(120,Math.min(900,c.T));
  }
  return 288.15;
}
function waterIceShareForTemp(T){
  T=Math.max(120,Math.min(900,Number(T)||288.15));
  /* Small polar reservoir around Earth-like conditions, then a rapid global
     transfer into ice as the mean climate cools toward snowball territory. */
  const polar=0.015*(1-waterSmooth(285,305,T));
  const snowball=0.97*(1-waterSmooth(225,280,T));
  return Math.max(0,Math.min(0.985,polar+snowball));
}
function waterSaturationPressureBar(T){
  /* Clausius-Clapeyron one-box approximation. It is deliberately capped near
     the critical point; this milestone needs the correct direction and mass
     transfer, not a full steam-table implementation. */
  T=Math.max(150,Math.min(647,Number(T)||288.15));
  const exponent=Math.max(-40,Math.min(20,5420*(1/273.15-1/T)));
  return 0.00611*Math.exp(exponent);
}
function waterEquilibriumVaporInventory(totalEow,T){
  totalEow=Math.max(0,Number(totalEow)||0);
  T=Number(T)||288.15;
  const hot=waterSmooth(310,380,T);
  const effectiveRH=0.25+0.65*hot;
  const pBar=waterSaturationPressureBar(T)*effectiveRH;
  const g=(typeof atmosphereGravityEarth==='function') ? Math.max(0.05,atmosphereGravityEarth()) : 1;
  const atmBar=(typeof EARTH_ATM_BAR!=='undefined') ? EARTH_ATM_BAR : 1.01325;
  const inv=pBar/(g*atmBar);
  return Math.max(0,Math.min(totalEow*WATER_EOW_TO_ATM_INV,inv));
}
function seaProxyFromOceanEow(oceanEow){
  oceanEow=Math.max(0,Number(oceanEow)||0);
  if(oceanEow<=1e-8) return 0;
  return waterClamp01(0.58+0.22*Math.log10(Math.max(WATER_TOTAL_MIN_EOW,oceanEow)));
}
function legacySeaToOceanEow(sea){
  sea=waterClamp01(sea);
  if(sea<=0.005) return WATER_TOTAL_MIN_EOW;
  return Math.max(WATER_TOTAL_MIN_EOW,
    Math.min(WATER_TOTAL_MAX_EOW,Math.pow(10,(sea-0.58)/0.22)));
}
function waterBudget(){
  const totalEow=waterTotalEowFromSlider(state.waterTotal);
  const maxVaporInv=totalEow*WATER_EOW_TO_ATM_INV;
  const vaporInv=Math.max(0,Math.min(maxVaporInv,Number(state.gasH2O)||0));
  const vaporEow=vaporInv/WATER_EOW_TO_ATM_INV;
  const condensed=Math.max(0,totalEow-vaporEow);
  const iceShare=waterIceShareForTemp(waterTemperatureK());
  const iceEow=condensed*iceShare;
  const oceanEow=Math.max(0,condensed-iceEow);
  return {
    totalEow,vaporInv,vaporEow,iceEow,oceanEow,iceShare,
    sumEow:vaporEow+iceEow+oceanEow,
    totalGelM:totalEow*WATER_EARTH_OCEAN_GEL_M,
    oceanGelM:oceanEow*WATER_EARTH_OCEAN_GEL_M,
    iceGelM:iceEow*WATER_EARTH_OCEAN_GEL_M
  };
}
function updateWaterDerivedState(){
  const b=waterBudget();
  const oldSea=Number(state.sea)||0;
  state.gasH2O=b.vaporInv;
  state.sea=seaProxyFromOceanEow(b.oceanEow);
  if(typeof updateLegacyAtmoProxy==='function') updateLegacyAtmoProxy();
  if(typeof atmoCompFromGases==='function') state.atmoComp=atmoCompFromGases();
  return Math.abs(state.sea-oldSea)>1e-7;
}
function settleWaterEquilibriumImmediate(iterations=3){
  for(let i=0;i<Math.max(1,iterations);i++){
    const total=waterTotalEowFromSlider(state.waterTotal);
    state.gasH2O=waterEquilibriumVaporInventory(total,waterTemperatureK());
    updateWaterDerivedState();
  }
  return waterBudget();
}
function migrateLegacyWaterState(){
  /* Preserve the old visible ocean as closely as possible. Infer the total
     inventory that yields that liquid reservoir at the current temperature,
     while keeping the already-migrated atmospheric H2O column. */
  const targetOcean=legacySeaToOceanEow(state.sea);
  const vaporEow=Math.max(0,Number(state.gasH2O)||0)/WATER_EOW_TO_ATM_INV;
  const iceShare=waterIceShareForTemp(waterTemperatureK());
  const condensed=targetOcean/Math.max(0.015,1-iceShare);
  const total=Math.max(WATER_TOTAL_MIN_EOW,Math.min(WATER_TOTAL_MAX_EOW,condensed+vaporEow));
  state.waterTotal=waterTotalSliderFromEow(total);
  updateWaterDerivedState();
  return waterBudget();
}

function waterTotalLabel(v){
  const eow=waterTotalEowFromSlider(v);
  const m=eow*WATER_EARTH_OCEAN_GEL_M;
  if(m<1) return m.toFixed(2)+' м GEL';
  if(m<1000) return m.toFixed(m<10?1:0)+' м GEL';
  return (m/1000).toFixed(m<10000?2:1)+' км GEL';
}

/* Editing atmospheric H2O transfers water between reservoirs; it never
   creates or deletes total H2O. After release it relaxes toward the global
   saturation target. */
const setGasFractionBeforeWater=setGasFraction;
let waterManualVaporUntil=0;
setGasFraction=function(key,value){
  if(key!=='gasH2O') return setGasFractionBeforeWater(key,value);
  const total=waterTotalEowFromSlider(state.waterTotal);
  state.gasH2O=Math.max(0,Math.min(total*WATER_EOW_TO_ATM_INV,Number(value)||0));
  const now=(typeof performance!=='undefined' && performance.now)?performance.now():Date.now();
  waterManualVaporUntil=now+700;
  updateWaterDerivedState();
  return state.gasH2O;
};

const relaxDerivedBeforeWater=relaxDerived;
relaxDerived=function(dtSec){
  const movedBefore=!!relaxDerivedBeforeWater(dtSec);
  const dt=Math.max(0,Math.min(0.5,Number(dtSec)||0));
  const now=(typeof performance!=='undefined' && performance.now)?performance.now():Date.now();
  let movedWater=false;
  if(now>=waterManualVaporUntil){
    const total=waterTotalEowFromSlider(state.waterTotal);
    const target=waterEquilibriumVaporInventory(total,waterTemperatureK());
    const old=Math.max(0,Number(state.gasH2O)||0);
    const a=1-Math.exp(-dt/7.0);
    const next=old+(target-old)*a;
    if(Math.abs(next-old)>1e-8){ state.gasH2O=next; movedWater=true; }
  }
  const oldSea=Number(state.sea)||0;
  updateWaterDerivedState();
  if(Math.abs(state.sea-oldSea)>1e-7) movedWater=true;
  return movedBefore||movedWater;
};

/* Final URL format for this model. v6 stores the conserved cause, not the two
   calculated reservoirs sea/gasH2O. */
const loadHashBeforeWater=loadHash;
function parseWaterNamedHash(parts){
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
  if(!h){
    settleWaterEquilibriumImmediate();
    if(typeof captureTransientEquilibrium==='function') captureTransientEquilibrium();
    return;
  }
  const parts=h.split(',');
  if(parts[0]==='v6'){
    const map=parseWaterNamedHash(parts);
    PARAMS.forEach(p=>{
      if(p.k==='atmo' || p.k==='sea' || p.k==='gasH2O') return;
      const v=parseFloat(map[p.k]);
      if(!Number.isFinite(v)) return;
      state[p.k]=p.gas
        ? Math.max(0,Math.min((typeof GAS_INV_MAX!=='undefined'?GAS_INV_MAX:100),v))
        : Math.max(0,Math.min(1,v));
    });
    FLAG_KEYS.forEach(k=>{
      if(/^pin(?:Temp|H2O|CO2|SO2)$/.test(k)) return;
      if(k in map) state[k]=map[k]==='1';
    });
    if(typeof sanitizeGasInventories==='function') sanitizeGasInventories();
    if(typeof releaseLegacyPins==='function') releaseLegacyPins();
    settleWaterEquilibriumImmediate();
    if(typeof captureTransientEquilibrium==='function') captureTransientEquilibrium();
    return;
  }

  loadHashBeforeWater();
  migrateLegacyWaterState();
  if(typeof captureTransientEquilibrium==='function') captureTransientEquilibrium();
};

saveHash=function(){
  clearTimeout(hashT);
  hashT=setTimeout(()=>{
    const out=['v6','s'+state.seed];
    PARAMS.forEach(p=>{
      if(p.k==='atmo' || p.k==='sea' || p.k==='gasH2O' || p.transient) return;
      const v=Number(state[p.k]); if(!Number.isFinite(v)) return;
      const digits=p.gas?8:(p.k==='waterTotal'?6:3);
      out.push(p.k+'='+v.toFixed(digits));
    });
    FLAG_KEYS.forEach(k=>{
      if(/^pin(?:Temp|H2O|CO2|SO2)$/.test(k)) return;
      out.push(k+'='+(state[k]?1:0));
    });
    try{ history.replaceState(null,'','#'+out.join(',')); }catch(e){}
  },200);
};

/* Human-readable slider and diagnostics. */
if(typeof valueText==='function'){
  const valueTextBeforeWater=valueText;
  valueText=function(p){
    if(p && p.k==='waterTotal') return waterTotalLabel(state.waterTotal);
    return valueTextBeforeWater(p);
  };
}
function appendWaterDiagnosticRow(body,label,key){
  const row=document.createElement('div');
  row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
  const a=document.createElement('span'); a.textContent=label; a.style.opacity='.62';
  const b=document.createElement('span'); b.dataset.water=key; b.style.textAlign='right';
  row.append(a,b); body.appendChild(row);
}
function waterReservoirLabel(eow,total){
  const pc=total>0?100*eow/total:0;
  return eow.toFixed(eow<0.1?4:2)+' океана⊕ · '+pc.toFixed(pc<1?2:1)+'%';
}
function refreshWaterDiagnostics(){
  if(typeof document==='undefined') return;
  const box=document.getElementById('waterBudgetDiag'); if(!box) return;
  const b=waterBudget();
  const set=(k,v)=>{ const e=box.querySelector('[data-water="'+k+'"]'); if(e)e.textContent=v; };
  set('total',waterTotalLabel(state.waterTotal)+' · '+b.totalEow.toFixed(b.totalEow<0.1?4:2)+' океана⊕');
  set('ocean',waterReservoirLabel(b.oceanEow,b.totalEow));
  set('ice',waterReservoirLabel(b.iceEow,b.totalEow));
  set('vapor',waterReservoirLabel(b.vaporEow,b.totalEow));
  set('sea',Math.round(state.sea*100)+'% renderer proxy');
}
if(typeof createPanel==='function'){
  const createPanelBeforeWater=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeWater(group);
    if(group==='Планета' && !el.querySelector('#waterBudgetDiag')){
      const body=el.querySelector('.p-body');
      const box=document.createElement('div');
      box.id='waterBudgetDiag';
      box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--txt)';
      appendWaterDiagnosticRow(box,'H₂O всего','total');
      appendWaterDiagnosticRow(box,'Жидкий океан','ocean');
      appendWaterDiagnosticRow(box,'Лёд','ice');
      appendWaterDiagnosticRow(box,'Атмосфера','vapor');
      appendWaterDiagnosticRow(box,'Уровень моря','sea');
      body.appendChild(box);
      refreshWaterDiagnostics();
    }
    return el;
  };
}
if(typeof syncDynamicLabels==='function'){
  const syncDynamicLabelsBeforeWater=syncDynamicLabels;
  syncDynamicLabels=function(){
    syncDynamicLabelsBeforeWater();
    refreshWaterDiagnostics();
  };
}

/* Defaults use one Earth-ocean equivalent and start near the old sea=0.58
   appearance. loadHash() will replace this with v6 data or migrate an older
   world before the first rendered frame. */
settleWaterEquilibriumImmediate();

/* Existing random-world code still picks legacy sea. Its listener runs before
   this one; translate that result into a conserved inventory once per reroll. */
if(typeof document!=='undefined'){
  const randWater=document.getElementById('rand');
  if(randWater) randWater.addEventListener('click',()=>{
    migrateLegacyWaterState();
    if(typeof syncUI==='function') syncUI();
    if(typeof saveHash==='function') saveHash();
  });
}
