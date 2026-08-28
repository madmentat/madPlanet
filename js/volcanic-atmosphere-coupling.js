/* ============ 0.5.39 hotfix: volcanism -> atmosphere -> climate ============ */
/*
   0.5.36 correctly stopped treating gas sliders as fractions, but in doing so
   it also removed the old volcanicTargets() source terms. Volcanism therefore
   stopped changing the atmosphere and global temperature altogether.

   Keep user gas inventories independent. Volcanism contributes a DERIVED
   steady-state burden on top of those background inventories:
     - CO2: long-lived greenhouse burden;
     - SO2: short-lived atmospheric burden whose aerosol raises albedo.

   These are source/lifetime equilibrium proxies, not a geochemical carbon
   cycle. The detailed carbon/sulfur cycles remain future slow-climate work.
*/

const VOLCANIC_ATMOSPHERE_MODEL = 1;
const VOLCANIC_ACTIVITY_ONSET = 0.30;
const VOLCANIC_CO2_MAX_INV = 0.050;   /* 1g pressure-equivalent atmospheres */
const VOLCANIC_SO2_MAX_INV = 0.00020;

function volcanicAtmoClamp01(x){ return Math.max(0,Math.min(1,Number(x)||0)); }
function volcanicAtmoSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=volcanicAtmoClamp01((x-a)/(b-a));
  return u*u*(3-2*u);
}
function volcanicActivityStrength(v=state.volcano){
  return volcanicAtmoSmooth(VOLCANIC_ACTIVITY_ONSET,1.0,volcanicAtmoClamp01(v));
}
function volcanicAtmosphereBurden(v=state.volcano){
  const q=volcanicActivityStrength(v);
  return {
    strength:q,
    co2Inv:VOLCANIC_CO2_MAX_INV*Math.pow(q,1.50),
    so2Inv:VOLCANIC_SO2_MAX_INV*Math.pow(q,1.10)
  };
}
function volcanicExtraInventoryForGas(key){
  const b=volcanicAtmosphereBurden();
  if(key==='gasCO2') return b.co2Inv;
  if(key==='gasSO2') return b.so2Inv;
  return 0;
}

/* Extend the canonical atmosphere views instead of mutating the user's gas
   controls. All downstream consumers (climate, renderer haze, diagnostics)
   therefore see one physically coherent total column. */
const gasInventoryTotalBeforeVolcanic=gasInventoryTotal;
gasInventoryTotal=function(){
  const b=volcanicAtmosphereBurden();
  return gasInventoryTotalBeforeVolcanic()+b.co2Inv+b.so2Inv;
};

const gasPartialPressureBarBeforeVolcanic=gasPartialPressureBar;
gasPartialPressureBar=function(key){
  const base=gasPartialPressureBarBeforeVolcanic(key);
  const extra=volcanicExtraInventoryForGas(key);
  if(!(extra>0)) return base;
  const g=(typeof atmosphereGravityEarth==='function')?Math.max(0.05,atmosphereGravityEarth()):1;
  const atm=(typeof EARTH_ATM_BAR!=='undefined')?EARTH_ATM_BAR:1.01325;
  return base+extra*g*atm;
};

const gasFractionsBeforeVolcanic=gasFractions;
gasFractions=function(){
  const total=gasInventoryTotal();
  if(!(total>1e-15)) return gasFractionsBeforeVolcanic();
  const out={};
  GAS_KEYS.forEach(k=>{
    const base=Math.max(0,Number(state[k])||0);
    out[k]=(base+volcanicExtraInventoryForGas(k))/total;
  });
  return out;
};

function volcanicBurdenLabel(inv){
  const g=(typeof atmosphereGravityEarth==='function')?Math.max(0.05,atmosphereGravityEarth()):1;
  const atm=(typeof EARTH_ATM_BAR!=='undefined')?EARTH_ATM_BAR:1.01325;
  const p=Math.max(0,inv)*g*atm;
  if(p>=0.1) return p.toFixed(2)+' bar';
  if(p>=1e-3) return (p*1000).toFixed(p>=0.01?0:1)+' mbar';
  if(p>=1e-6) return (p*1e6).toFixed(p>=1e-5?0:1)+' µbar';
  return (p*1e9).toFixed(1)+' nbar';
}
function refreshVolcanicAtmosphereDiagnostics(){
  if(typeof document==='undefined') return;
  const box=document.getElementById('volcanicAtmosphereDiag'); if(!box) return;
  const b=volcanicAtmosphereBurden();
  const set=(k,v)=>{const e=box.querySelector('[data-volcatmo="'+k+'"]');if(e)e.textContent=v;};
  set('co2','+'+volcanicBurdenLabel(b.co2Inv));
  set('so2','+'+volcanicBurdenLabel(b.so2Inv));
  set('strength',(100*b.strength).toFixed(0)+'%');
}
function appendVolcanicAtmosphereRow(body,label,key){
  const row=document.createElement('div');
  row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
  const a=document.createElement('span');a.textContent=label;a.style.opacity='.62';
  const b=document.createElement('span');b.dataset.volcatmo=key;b.style.textAlign='right';
  row.append(a,b);body.appendChild(row);
}
if(typeof createPanel==='function'){
  const createPanelBeforeVolcanicAtmosphere=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeVolcanicAtmosphere(group);
    if(group==='Атмосфера'&&!el.querySelector('#volcanicAtmosphereDiag')){
      const body=el.querySelector('.p-body');
      const box=document.createElement('div');box.id='volcanicAtmosphereDiag';
      box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--txt)';
      appendVolcanicAtmosphereRow(box,'Вулканический CO₂','co2');
      appendVolcanicAtmosphereRow(box,'Вулканический SO₂','so2');
      appendVolcanicAtmosphereRow(box,'Источник / lifetime proxy','strength');
      body.appendChild(box);refreshVolcanicAtmosphereDiagnostics();
    }
    return el;
  };
}
if(typeof syncDynamicLabels==='function'){
  const syncDynamicLabelsBeforeVolcanicAtmosphere=syncDynamicLabels;
  syncDynamicLabels=function(){
    syncDynamicLabelsBeforeVolcanicAtmosphere();
    refreshVolcanicAtmosphereDiagnostics();
  };
}
