const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/climate-regimes.js'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'climate test must see a semantic version');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/atmosphere-inventory.js','js/volcanic-atmosphere-coupling.js','js/water-budget.js','js/climate-regimes.js','js/stellar-weather-coupling.js','js/weather-core.js','js/local-energy-balance.js','js/baric-field.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell climate module order');
assertOrdered(buildSh,order,'shell climate module order');

const state={
  star:0.38,luminosity:0.43,distance:0.51,atmo:0.60,temp:0.52,sea:0.58,waterTotal:0.50,
  cloudLow:0.48,cloudMid:0.44,cloudHigh:0.30,
  gasN2:0.8085,gasO2:0.2169,gasH2O:0.00433,gasCO2:0.000435,
  gasSO2:1.04e-6,gasCH4:2.07e-6,gasHHe:5.18e-6
};
let flux=1.0,starT=5772,waterEow=1.0;
function pressure(){
  return ['gasN2','gasO2','gasH2O','gasCO2','gasSO2','gasCH4','gasHHe']
    .reduce((s,k)=>s+state[k],0)*1.01325;
}
const ctx={
  console,Math,Number,state,PARAMS:[],
  starPhysics(){return {T:starT,L:1};},
  orbitDistanceAU(){return 1;},orbitalFluxEarth(){return flux;},
  habitableZoneForStar(){return {conservativeInner:0.95,conservativeOuter:1.67};},
  atmosphereSurfacePressureBar:pressure,
  gasPartialPressureBar(k){return Math.max(0,state[k]||0)*1.01325;},
  waterTotalEowFromSlider(){return waterEow;},
  sliderToTemp(){return 15;},document:undefined
};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'climate-regimes.js'});

let c=ctx.climateModel();
assert.ok(c.T>284&&c.T<293,'Earth-like pivot should remain near 288 K');
assert.ok(c.A>0.26&&c.A<0.33,'Earth-like planetary albedo should remain near 0.3');
assert.equal(c.regime,'temperate','Earth-like pivot should classify as temperate');
assert.ok(Math.abs(c.ASR-c.OLR)<0.5,'stable Earth-like state should be near top-of-atmosphere balance');

const earthT=c.T;
state.gasCO2=0.02;
c=ctx.climateModel();
assert.ok(c.T>earthT+8,'adding substantial CO2 inventory must warm the global climate');
assert.equal(c.S,1,'greenhouse changes must not alter incoming stellar flux');

state.gasCO2=0.000435;
flux=0.70;
c=ctx.climateModel();
assert.equal(c.regime,'snowball','weak stellar forcing with water should enter snowball regime');
assert.ok(c.iceArea>0.72,'snowball regime needs large global ice area');
assert.ok(c.A>0.55,'ice-albedo feedback must strongly brighten a snowball world');

flux=1.40;
state.gasH2O=0.20;
c=ctx.climateModel();
assert.equal(c.regime,'runawayGreenhouse','hot wet high-flux case should trip runaway proxy');
assert.ok(c.runawayIndex>0.55,'runaway proxy should be explicitly strong');
assert.ok(c.OLR<=282.1,'hot moist OLR should approach the radiation ceiling');
assert.ok(c.energyImbalance>0,'runaway case should have positive TOA energy imbalance');

waterEow=0.0001;
state.gasH2O=1e-8;
c=ctx.climateModel();
assert.notEqual(c.regime,'runawayGreenhouse','hot but dry worlds must not be called wet runaway greenhouses');
assert.ok(c.runawayIndex<0.1,'dry world should suppress runaway-water feedback');

assert.ok(ctx.climateIceAlbedoForStar(3000)<ctx.climateIceAlbedoForStar(5772),
  'M-star ice albedo must be lower than Sun-like ice albedo');
assert.ok(src.includes('CLIMATE_MOIST_OLR_LIMIT = 282.0'),
  'runaway proxy must expose its moist OLR-limit assumption');
assert.ok(src.includes('gasPartialPressureBar'),
  'greenhouse must use absolute gas partial pressures, not normalized percentages');
assert.ok(src.includes('climateIceAlbedoForStar'),
  'ice-albedo feedback must include stellar spectral dependence');
assert.ok(src.includes("runawayGreenhouse:'runaway greenhouse'"),
  'diagnostics must expose runaway greenhouse state');

console.log('climate-regimes.test.js: OK');
