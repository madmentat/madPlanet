const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/star-orbit.js'),'utf8');
const buildPs = fs.readFileSync(path.join(root, 'build.ps1'),'utf8');
const buildSh = fs.readFileSync(path.join(root, 'build.sh'),'utf8');
const version = fs.readFileSync(path.join(root, 'VERSION.txt'),'utf8');

assert.match(version, /^VERSION\s+\d+\.\d+\.\d+\s*$/m, 'star/orbit test must see a semantic version');
assert.match(buildPs, /'js\/ui\.js','js\/planet-physics\.js','js\/star-orbit\.js','js\/param-model\.js'/,
  'PowerShell build must load star-orbit after planet scaffold and before param-model');
assert.match(buildSh, /js\/ui\.js js\/planet-physics\.js js\/star-orbit\.js js\/param-model\.js/,
  'shell build must load star-orbit after planet scaffold and before param-model');

const state = {
  star:0.43, luminosity:0.43, distance:0.51, atmo:0.60, sea:0.58,
  cloudLow:0.48, cloudMid:0.44, cloudHigh:0.30,
  gasCO2:0.00042, gasCH4:0.000002, gasH2O:0.004,
  gasSO2:0.000001, gasHHe:0.000005
};
const ctx = {
  console, Math, state,
  starPhysics(){ return {T:5772,L:1,M:1,R:1,hz:1}; },
  starLabel(){ return 'G'; },
  luminosityLabel(){ return ''; },
  distanceInfo(){ return {}; },
  climateModel(){ return {}; },
  gasFractions(){
    return {
      gasCO2:state.gasCO2, gasCH4:state.gasCH4, gasH2O:state.gasH2O,
      gasSO2:state.gasSO2, gasHHe:state.gasHHe
    };
  }
};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'star-orbit.js'});

const sun = ctx.starPhysics(0.43,0.43);
assert.ok(Math.abs(sun.T-5772) < 1, 'G anchor must stay solar-temperature');
assert.ok(Math.abs(sun.L-1) < 1e-9, 'luminosity slider pivot must be exactly 1 Lsun');
assert.ok(Math.abs(ctx.orbitDistanceAU(0.51)-1) < 1e-9, 'distance slider pivot must be exactly 1 AU');

const hzSun = ctx.habitableZoneForStar(5772,1);
assert.ok(hzSun.conservativeInner > 0.93 && hzSun.conservativeInner < 0.98,
  'solar conservative inner HZ should be near 0.95 AU');
assert.ok(hzSun.conservativeOuter > 1.65 && hzSun.conservativeOuter < 1.70,
  'solar conservative outer HZ should be near 1.67 AU');
assert.equal(ctx.hzStatus(1,hzSun).code,'conservative','Earth-like 1 AU orbit should sit in conservative HZ');

assert.equal(ctx.orbitalFluxEarth(1,2),0.25,'stellar flux must obey inverse-square law');
assert.equal(ctx.orbitalFluxEarth(4,2),1,'luminosity must scale flux linearly');

const hzM = ctx.habitableZoneForStar(3000,0.01);
const hzK = ctx.habitableZoneForStar(4500,0.01);
assert.notEqual(hzM.conservativeInner,hzK.conservativeInner,
  'M and K spectra must not share one fixed HZ coefficient');
assert.ok(hzM.conservativeInner < 0.2 && hzM.conservativeOuter < 0.4,
  'low-luminosity M-star HZ must move close to the star');

const hot = ctx.habitableZoneForStar(9000,10);
assert.equal(hot.approx,true,'HZ fit outside 2600..7200 K must be marked approximate');
assert.equal(hot.fitT,7200,'hot-star HZ polynomial must clamp rather than wildly extrapolate');

const c = ctx.climateModel();
assert.ok(Number.isFinite(c.T) && Number.isFinite(c.C) && Number.isFinite(c.S),
  'climate model must remain finite with centralized star/orbit physics');
assert.ok(Math.abs(c.S-1) < 1e-9,'default Sun/Earth pivots must feed 1 Searth into climate model');

assert.match(src,/runawayGreenhouse/,'conservative inner HZ coefficient missing');
assert.match(src,/maximumGreenhouse/,'conservative outer HZ coefficient missing');
assert.match(src,/orbitalFluxEarth\(st\.L,au\)/,'climate and diagnostics must use the same inverse-square flux');
console.log('star-orbit.test.js: OK');
