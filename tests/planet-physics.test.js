const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/planet-physics.js'),'utf8');
const version = fs.readFileSync(path.join(root, 'VERSION.txt'),'utf8');
const buildPs = fs.readFileSync(path.join(root, 'build.ps1'),'utf8');
const buildSh = fs.readFileSync(path.join(root, 'build.sh'),'utf8');

assert.match(version, /^VERSION\s+\d+\.\d+\.\d+\s*$/m, 'planet scaffold test must see a semantic version');
assert.match(buildPs, /'js\/ui\.js','js\/planet-physics\.js','js\/star-orbit\.js','js\/param-model\.js'/,
  'PowerShell build must load planet scaffold before parameter classification');
assert.match(buildSh, /js\/ui\.js js\/planet-physics\.js js\/star-orbit\.js js\/param-model\.js/,
  'shell build must load planet scaffold before parameter classification');

const PARAMS = [
  {k:'temp',group:'Планета',def:0.5},
  {k:'volcano',group:'Поверхность',def:0.35,base:true}
];
const state = {temp:0.5,volcano:0.35};
const document = {
  getElementById(){ return null; },
  createElement(){ return {style:{},dataset:{},append(){}}; }
};
const ctx = {
  PARAMS,state,document,console,Math,
  valueText(p){ return String(state[p.k] ?? ''); },
  createPanel(){ return {querySelector(){return null;}}; },
  syncDynamicLabels(){}, saveHash(){}, syncUI(){}
};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'planet-physics.js'});

for(const k of ['planetAge','planetRadius','coreType','rotationPeriod','axialTilt']){
  assert.ok(PARAMS.some(p=>p.k===k), k+' must be a first-class parameter');
  assert.ok(Number.isFinite(state[k]), k+' must have a default state value');
}
assert.equal(PARAMS.find(p=>p.k==='volcano').group,'Планета','volcanism belongs with slow planet causes');

const earth = ctx.planetPhysics();
assert.ok(Math.abs(earth.ageGyr-4.54) < 0.01, 'default planet age should be Earth-like');
assert.ok(Math.abs(earth.radiusEarth-1.0) < 1e-9, 'default radius should be 1 R_earth');
assert.ok(Math.abs(earth.density-5.514) < 1e-6, 'Earth-like interior anchor should use Earth bulk density');
assert.ok(Math.abs(earth.massEarth-1.0) < 1e-6, 'Earth-like scaffold should yield 1 M_earth');
assert.ok(Math.abs(earth.gravityMS2-9.80665) < 1e-4, 'Earth-like scaffold should yield Earth gravity');
assert.ok(Math.abs(earth.escapeKMS-11.186) < 1e-3, 'Earth-like scaffold should yield Earth escape velocity');
assert.ok(Math.abs(earth.rotationHours-24.0) < 1e-6, 'default rotation should be one day');
assert.ok(Math.abs(earth.axialTiltDeg-23.44) < 1e-6, 'default obliquity should be Earth-like');

state.coreType=0.0;
const iron=ctx.planetPhysics();
state.coreType=1.0;
const icy=ctx.planetPhysics();
assert.ok(iron.density > icy.density, 'iron-rich bodies must be denser than volatile-rich bodies');

state.coreType=0.25;
state.planetRadius=1.0;
const large=ctx.planetPhysics();
assert.ok(large.massEarth > 20, 'larger radius at fixed bulk density must strongly increase mass');
assert.ok(large.gravityEarth > 2, 'larger constant-density body must have stronger surface gravity');

state.volcano=0.73;
state.planetAge=1.0;
ctx.planetPhysics();
assert.equal(state.volcano,0.73,'age must not secretly overwrite volcanism before interior thermal physics exists');

console.log('planet-physics.test.js: OK');
