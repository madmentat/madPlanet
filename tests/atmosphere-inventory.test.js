const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root,'js/atmosphere-inventory.js'),'utf8');
const version = fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs = fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh = fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'atmosphere inventory test must see a semantic version');
assert.match(buildPs,/'js\/param-model\.js','js\/screenshot\.js','js\/atmosphere-inventory\.js'/,
  'PowerShell build must load atmosphere inventory after compatibility wrappers');
assert.match(buildSh,/js\/param-model\.js js\/screenshot\.js js\/atmosphere-inventory\.js/,
  'shell build must load atmosphere inventory after compatibility wrappers');

const gasKeys=['gasN2','gasO2','gasH2O','gasCO2','gasSO2','gasCH4','gasHHe'];
const PARAMS=[
  {k:'atmo',group:'Атмосфера',def:0.60,base:true},
  ...gasKeys.map(k=>({k,group:'Атмосфера',gas:true,base:true})),
  {k:'temp',group:'Планета',transient:true}
];
const state={
  seed:1, atmo:0.60, temp:0.52, atmoComp:0,
  gasN2:0.7808,gasO2:0.2095,gasH2O:0.004,gasCO2:0.00042,
  gasSO2:0.000001,gasCH4:0.000002,gasHHe:0.000005
};
function legacyNormalize(){
  let s=0; gasKeys.forEach(k=>s+=state[k]);
  gasKeys.forEach(k=>state[k]/=s);
}
const document={
  getElementById(){return null;},
  createElement(){return {style:{},dataset:{},append(){},querySelector(){return null;}};}
};
const ctx={
  console,Math,Date,Number,PARAMS,state,document,
  GAS_KEYS:gasKeys,
  normalizeGases:legacyNormalize,
  setGasFraction(){},gasSliderToVal(){},gasValToSlider(){},
  loadHash(){},saveHash(){},valueText(){return '';},
  createPanel(){return {querySelector(){return null;}};},syncDynamicLabels(){},
  FLAG_KEYS:['rings','pinTemp','pinH2O','pinCO2','pinSO2'],
  hashT:0,setTimeout,clearTimeout,history:{replaceState(){}},location:{hash:''},
  planetPhysics(){return {gravityEarth:1};},climateModel(){return {T:288,C:15};},
  sliderToTemp(v){return v*175-78;},atmoCompFromGases(){return 0;},
  tempToSlider(C){return (C+78)/175;},relaxTransientControls(){return false;},
  releaseLegacyPins(){},captureTransientEquilibrium(){}
};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'atmosphere-inventory.js'});

const total0=ctx.gasInventoryTotal();
assert.ok(Math.abs(total0-1.03)<1e-9,'legacy default atmo=0.60 must migrate to a 1.03 Earth-column inventory');
const n2Before=state.gasN2;
const pressureBefore=ctx.atmosphereSurfacePressureBar();
ctx.setGasFraction('gasCO2',state.gasCO2+1.0);
assert.equal(state.gasN2,n2Before,'adding CO2 must not remove or renormalize N2');
assert.ok(ctx.gasInventoryTotal()>total0+0.99,'adding gas must increase total atmospheric inventory');
assert.ok(ctx.atmosphereSurfacePressureBar()>pressureBefore+1.0,'adding gas must increase surface pressure');

const sumFrac=gasKeys.reduce((s,k)=>s+ctx.gasFractions()[k],0);
assert.ok(Math.abs(sumFrac-1)<1e-12,'display composition fractions must still sum to one');
assert.ok(ctx.meanMolecularWeight()>20 && ctx.meanMolecularWeight()<50,'mixture molecular weight must remain physical');

const p1=ctx.atmosphereSurfacePressureBar();
ctx.planetPhysics=()=>({gravityEarth:2});
const p2=ctx.atmosphereSurfacePressureBar();
assert.ok(Math.abs(p2/p1-2)<1e-12,'same gas column at 2g must produce twice the surface pressure');

const savedN2=state.gasN2;
ctx.normalizeGases();
assert.equal(state.gasN2,savedN2,'compat normalizeGases must not renormalize absolute inventories');

assert.equal(PARAMS.find(p=>p.k==='atmo').group,'__legacy_atmosphere','old atmosphere amount slider must be hidden');
assert.equal(PARAMS.find(p=>p.k==='atmo').role,'diagnostic','old atmo field must be derived compatibility state');
assert.equal(PARAMS.find(p=>p.k==='gasCO2').role,'base','persistent dry-gas inventories must be base inputs');
assert.ok(/const out=\['v5','s'\+state\.seed\]/.test(src),'atmosphere milestone must retain v5 migration support');
assert.ok(/if\(p\.k==='atmo' \|\| p\.transient\) return;/.test(src),'derived atmo proxy must not be serialized by the v5 layer');
assert.ok(/state\[key\]=Math\.max\(0,Math\.min\(GAS_INV_MAX/.test(src),'gas editing must set one inventory independently');

console.log('atmosphere-inventory.test.js: OK');
