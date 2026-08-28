const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const src = fs.readFileSync(path.join(root,'js/water-budget.js'),'utf8');
const version = fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs = fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh = fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'water budget test must see a semantic version');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/atmosphere-inventory.js','js/volcanic-atmosphere-coupling.js','js/water-budget.js','js/climate-regimes.js','js/stellar-weather-coupling.js','js/weather-core.js','js/local-energy-balance.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell water module order');
assertOrdered(buildSh,order,'shell water module order');

const gasKeys=['gasN2','gasO2','gasH2O','gasCO2','gasSO2','gasCH4','gasHHe'];
const PARAMS=[
  {k:'sea',label:'Океан',group:'Планета',base:true},
  ...gasKeys.map(k=>({k,group:'Атмосфера',gas:true,base:true,role:'base'})),
  {k:'temp',group:'Планета',transient:true}
];
const state={
  seed:1,sea:0.58,temp:0.52,atmo:0.60,atmoComp:0,
  gasN2:0.80,gasO2:0.21,gasH2O:0.004,gasCO2:0.00042,
  gasSO2:0.000001,gasCH4:0.000002,gasHHe:0.000005
};
let gravityEarth=1;
let climateT=288;
const document={
  getElementById(){return null;},
  createElement(){return {style:{},dataset:{},append(){},querySelector(){return null;}};}
};
const ctx={
  console,Math,Date,Number,PARAMS,state,document,window:{},
  PARAM_ROLE:{BASE:'base',DERIVED:'derived'},parameterRole(){return 'visual';},
  GAS_KEYS:gasKeys,GAS_INV_MAX:100,EARTH_ATM_BAR:1.01325,
  setGasFraction(key,value){state[key]=value;return value;},
  relaxDerived(){return false;},
  climateModel(){return {T:climateT,C:climateT-273.15};},
  atmosphereGravityEarth(){return gravityEarth;},
  updateLegacyAtmoProxy(){return state.atmo;},atmoCompFromGases(){return 0;},
  loadHash(){},saveHash(){},FLAG_KEYS:['rings','pinTemp','pinH2O','pinCO2','pinSO2'],
  hashT:0,setTimeout,clearTimeout,history:{replaceState(){}},location:{hash:''},
  performance:{now:()=>1000},releaseLegacyPins(){},captureTransientEquilibrium(){},
  sanitizeGasInventories(){},valueText(){return '';},
  createPanel(){return {querySelector(){return null;}};},syncDynamicLabels(){}
};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'water-budget.js'});

assert.ok(Math.abs(ctx.waterTotalEowFromSlider(0.5)-1)<1e-12,
  'waterTotal pivot must equal one Earth ocean');
assert.ok(Math.abs(ctx.waterTotalSliderFromEow(1)-0.5)<1e-12,
  'Earth-ocean inverse mapping must return the slider pivot');

const b0=ctx.waterBudget();
assert.ok(Math.abs(b0.sumEow-b0.totalEow)<1e-12,
  'ocean + ice + vapor must exactly conserve waterTotal');
assert.ok(state.sea>0.54 && state.sea<0.62,
  'Earth-like default should preserve approximately the old 58% sea proxy');
assert.ok(state.gasH2O>0.002 && state.gasH2O<0.01,
  'Earth-like global vapor equilibrium should remain near the old few-millibar default');

const coldIce=ctx.waterIceShareForTemp(235);
const earthIce=ctx.waterIceShareForTemp(288);
assert.ok(coldIce>earthIce+0.7,'cold climate must transfer most water into ice');
const earthVapor=ctx.waterEquilibriumVaporInventory(1,288);
const hotVapor=ctx.waterEquilibriumVaporInventory(1,500);
assert.ok(hotVapor>earthVapor*1000,'hot climate must move much more H2O into atmospheric vapor');

climateT=288;
state.waterTotal=0.5;
ctx.settleWaterEquilibriumImmediate();
const oceanBefore=ctx.waterBudget().oceanEow;
ctx.setGasFraction('gasH2O',20);
const manual=ctx.waterBudget();
assert.ok(manual.oceanEow<oceanBefore,'manual atmospheric H2O must come out of condensed reservoirs');
assert.ok(Math.abs(manual.sumEow-manual.totalEow)<1e-12,
  'manual H2O perturbation must not create or destroy total water');

state.sea=0.58; state.gasH2O=0.004; climateT=288;
const migrated=ctx.migrateLegacyWaterState();
assert.ok(Math.abs(state.sea-0.58)<1e-6,
  'legacy sea migration should preserve the old visible sea proxy');
assert.ok(Math.abs(migrated.sumEow-migrated.totalEow)<1e-12,
  'legacy migration must land on a conserved budget');

assert.equal(PARAMS.find(p=>p.k==='waterTotal').role,'base','waterTotal must be a persistent BASE cause');
assert.equal(PARAMS.find(p=>p.k==='sea').group,'__legacy_water','old sea slider must be hidden');
assert.equal(PARAMS.find(p=>p.k==='gasH2O').role,'derived','atmospheric H2O must be a derived reservoir');
assert.equal(ctx.parameterRole('waterTotal'),'base','parameterRole must classify appended waterTotal');
assert.equal(ctx.parameterRole('sea'),'derived','sea must be classified as derived');
assert.equal(ctx.parameterRole('gasH2O'),'derived','gasH2O must be classified as derived');

assert.ok(/const out=\['v6','s'\+state\.seed\]/.test(src),'water module must retain its v6 serializer before the later stellar v7 wrapper');
assert.ok(/p\.k==='sea' \|\| p\.k==='gasH2O'/.test(src),
  'water serializer must not persist calculated sea or atmospheric H2O reservoirs');
assert.ok(src.includes('WATER_EOW_TO_ATM_INV'),'water-to-atmosphere mass conversion must be explicit');

console.log('water-budget.test.js: OK');
