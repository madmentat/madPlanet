const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/param-model.js'),'utf8');
const version = fs.readFileSync(path.join(root, 'VERSION.txt'),'utf8');
const buildPs = fs.readFileSync(path.join(root, 'build.ps1'),'utf8');
const buildSh = fs.readFileSync(path.join(root, 'build.sh'),'utf8');

assert.match(version, /^VERSION\s+\d+\.\d+\.\d+\s*$/m, 'parameter-model test must see a semantic version');
assert.match(buildPs, /'js\/ui\.js','js\/planet-physics\.js','js\/star-orbit\.js','js\/param-model\.js','js\/screenshot\.js'/,
  'PowerShell build must load planet/star scaffolds before param-model and render');
assert.match(buildSh, /js\/ui\.js js\/planet-physics\.js js\/star-orbit\.js js\/param-model\.js js\/screenshot\.js/,
  'shell build must load planet/star scaffolds before param-model and render');

const keys = [
  'temp','sea','cont','tect','isle','lake','snowAlt','city','volcano','lava',
  'ringInner','ringWidth','ringDens','ringCount','ringMat','ringGrain',
  'cloudLow','cloudMid','cloudHigh','wind','convection','storm','stormRate','stormGlow',
  'atmo','gasN2','gasO2','gasH2O','gasCO2','gasSO2','gasCH4','gasHHe',
  'magnet','magTilt','magAzimuth','aurora','skyStars','skyMilky','skyNebula','skyHue',
  'star','luminosity','distance',
  'planetAge','planetRadius','coreType','rotationPeriod','axialTilt'
];
const PARAMS = keys.map(k => ({k, group:'x', def:0.5, gas:k.startsWith('gas')}));
const state = Object.fromEntries(keys.map(k => [k,0.5]));
Object.assign(state,{seed:1,pinTemp:true,pinH2O:true,pinCO2:true,pinSO2:true});
const document = {
  addEventListener(){},
  getElementById(){ return null; },
  createElement(){ return {className:'',textContent:'',title:''}; }
};
const ctx = {
  PARAMS,state,document,console,Math,Date,performance:{now:()=>1000},
  PIN_OF:{temp:'pinTemp',gasH2O:'pinH2O',gasCO2:'pinCO2',gasSO2:'pinSO2'},
  FLAG_KEYS:['pinTemp','pinH2O','pinCO2','pinSO2','rings'],
  hashT:0,history:{replaceState(){}},location:{hash:''},
  setTimeout,clearTimeout,
  createPanel(){ return {querySelector(){return null;}}; },
  saveHash(){},loadHash(){ state.cloudLow=0.67; },
  relaxDerived(){ return false; }
};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'param-model.js'});

const byKey = k => PARAMS.find(p=>p.k===k);
assert.equal(byKey('star').role,'base');
assert.equal(byKey('volcano').role,'base','volcanism is a user-controlled slow forcing until interior physics exists');
assert.equal(byKey('planetAge').role,'base','planet age is a first-class base cause');
assert.equal(byKey('planetRadius').role,'base');
assert.equal(byKey('coreType').role,'base');
assert.equal(byKey('rotationPeriod').role,'base');
assert.equal(byKey('axialTilt').role,'base');
assert.equal(byKey('tect').role,'geo');
assert.equal(byKey('wind').role,'derived');
assert.equal(byKey('stormGlow').role,'visual');
assert.equal(byKey('wind').transient,true);
assert.equal(byKey('temp').transient,true);
assert.equal(byKey('gasCO2').transient,false,'gas inventory remains persistable until 0.5.36');
assert.equal('temp' in ctx.PIN_OF,false,'calculated temperature must not stay pinned');
assert.equal('gasCO2' in ctx.PIN_OF,false,'volcanic gases must evolve after manual intervention');
assert.equal(state.pinTemp,false);
assert.equal(state.pinCO2,false);

ctx.loadHash();
state.cloudLow=1.0;
ctx.performance.now=()=>2000;
const before=state.cloudLow;
for(let i=0;i<120;i++) ctx.relaxDerived(0.1);
assert.ok(state.cloudLow < before,'released derived value must move back toward equilibrium');
assert.ok(state.cloudLow > 0.67,'relaxation should be gradual, not a snap');

assert.match(src,/if\(p\.transient\) return;/,'transient derived values must not be serialized');
assert.match(src,/\^pin\(\?:Temp\|H2O\|CO2\|SO2\)/,'legacy permanent pin flags must not be serialized');
assert.match(src,/unclassified parameters:/,'every new parameter must be assigned an explicit role');
console.log('param-model.test.js: OK');
