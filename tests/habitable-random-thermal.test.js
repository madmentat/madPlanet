const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/habitable-random-thermal-fix.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');

assert.match(src,/CITY_FINAL_MODEL=5/);
assert.match(src,/CITY_FINAL_TARGET_MIN_C=14/);
assert.match(src,/CITY_FINAL_TARGET_MAX_C=24/);
assert.match(src,/cityFinalSolveTemperateOrbit/);
assert.match(src,/cityFinalInitializeTemperateCore/);
assert.match(src,/surfaceSnowWater\.fill\(0\)/);
assert.match(src,/landIceWater\.fill\(0\)/);
assert.match(src,/seaIceThicknessM\.fill\(0\)/);
assert.doesNotMatch(src,/cityTaSolveCurrentSurface/,
  'Random must not chase instantaneous T_a with orbital distance');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/climate-consistency.js','js/habitable-random-thermal-fix.js','js/input-frame-pacing.js'],'shell finalizer order');
ordered(buildPs,['js/climate-consistency.js','js/habitable-random-thermal-fix.js','js/input-frame-pacing.js'],'PowerShell finalizer order');

/* Static regression: the finalizer must select AU using climateModel().C and
   only then initialize a fresh current core. This prevents the observed
   -84 C / +300 C split from becoming the control signal again. */
const solvePos=src.indexOf('cityFinalSolveTemperateOrbit(target)');
const initPos=src.indexOf('cityFinalInitializeTemperateCore()');
assert.ok(solvePos>=0&&initPos>solvePos,'formal orbit solve must precede current-core initialization');

console.log('habitable-random-thermal.test.js: OK');
