const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const volc=fs.readFileSync(path.join(root,'js/volcanic-atmosphere-coupling.js'),'utf8');
const climateSrc=fs.readFileSync(path.join(root,'js/climate-regimes.js'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.ok(buildPs.includes("'js/atmosphere-inventory.js','js/volcanic-atmosphere-coupling.js','js/water-budget.js','js/climate-regimes.js'"),
  'PowerShell build must load volcanic atmosphere coupling after inventories and before climate');
assert.ok(buildSh.includes('js/atmosphere-inventory.js js/volcanic-atmosphere-coupling.js js/water-budget.js js/climate-regimes.js'),
  'shell build must load volcanic atmosphere coupling after inventories and before climate');

const GAS_KEYS=['gasN2','gasO2','gasH2O','gasCO2','gasSO2','gasCH4','gasHHe'];
const state={
  volcano:0,star:0.43,luminosity:0.43,distance:0.51,atmo:0.60,temp:0.52,sea:0.58,waterTotal:0.5,
  cloudLow:0.48,cloudMid:0.44,cloudHigh:0.30,
  gasN2:0.8085,gasO2:0.2169,gasH2O:0.00433,gasCO2:0.000435,
  gasSO2:1.04e-6,gasCH4:2.07e-6,gasHHe:5.18e-6
};
function baseTotal(){return GAS_KEYS.reduce((s,k)=>s+Math.max(0,state[k]||0),0);}
function baseFractions(){const t=baseTotal();const o={};GAS_KEYS.forEach(k=>o[k]=(state[k]||0)/t);return o;}
const ctx={
  console,Math,Number,state,GAS_KEYS,EARTH_ATM_BAR:1.01325,
  gasInventoryTotal:baseTotal,
  gasPartialPressureBar:k=>Math.max(0,state[k]||0)*1.01325,
  gasFractions:baseFractions,
  atmosphereGravityEarth:()=>1,
  document:undefined,
  starPhysics:()=>({T:5772,L:1}),
  orbitDistanceAU:()=>1,
  orbitalFluxEarth:(L,au)=>L/(au*au),
  habitableZoneForStar:()=>({conservativeInner:0.95,conservativeOuter:1.67}),
  atmosphereSurfacePressureBar(){return ctx.gasInventoryTotal()*1.01325;},
  waterTotalEowFromSlider:()=>1,
  sliderToTemp:()=>15
};
vm.createContext(ctx);
vm.runInContext(volc,ctx,{filename:'volcanic-atmosphere-coupling.js'});
vm.runInContext(climateSrc,ctx,{filename:'climate-regimes.js'});

const baseCO2=state.gasCO2,baseSO2=state.gasSO2;
state.volcano=0;
const cold=ctx.climateModel();
const p0co2=ctx.gasPartialPressureBar('gasCO2');
const p0so2=ctx.gasPartialPressureBar('gasSO2');

state.volcano=1;
const hot=ctx.climateModel();
const p1co2=ctx.gasPartialPressureBar('gasCO2');
const p1so2=ctx.gasPartialPressureBar('gasSO2');

assert.equal(state.gasCO2,baseCO2,'volcanism must not overwrite user CO2 background inventory');
assert.equal(state.gasSO2,baseSO2,'volcanism must not overwrite user SO2 background inventory');
assert.ok(p1co2>p0co2+0.045,'maximum volcanism must add a substantial derived CO2 burden');
assert.ok(p1so2>p0so2+0.00015,'maximum volcanism must add a derived SO2 burden');
assert.ok(ctx.atmosphereSurfacePressureBar()>1.05,'derived volcanic gas burden must contribute to total pressure');
assert.ok(hot.T>cold.T+15,'volcanism must measurably affect global temperature through atmospheric forcing');
assert.ok(hot.aer>cold.aer,'SO2 burden must simultaneously strengthen aerosol cooling/albedo');
const f=ctx.gasFractions();
const sum=GAS_KEYS.reduce((s,k)=>s+(f[k]||0),0);
assert.ok(Math.abs(sum-1)<1e-10,'gas fractions including volcanic burdens must still sum to one');
assert.ok((f.gasCO2||0)>baseFractions().gasCO2,'renderer composition view must see volcanic CO2');
assert.ok(volc.includes('source/lifetime equilibrium'),'module must document burden semantics rather than direct temperature magic');

console.log('volcanic-atmosphere-coupling.test.js: OK');
