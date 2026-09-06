const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/habitable-random-thermal-fix.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');

assert.match(src,/CITY_FINAL_MODEL=7/);
assert.match(src,/CITY_FINAL_TARGET_MIN_C=14/);
assert.match(src,/CITY_FINAL_TARGET_MAX_C=24/);
assert.match(src,/cityFinalSolveTemperateOrbit/);
assert.match(src,/cityFinalInitializeTemperateCore/);
assert.match(src,/cityFinalCloseWeatherAndOrbit/);
assert.match(src,/climateWeatherTargets/);
assert.match(src,/soilRefreshCapacity/);
assert.match(src,/soilRefreshBaseline/);
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
const solvePos=src.indexOf('cityFinalCloseWeatherAndOrbit(target)');
const initCallPos=src.indexOf('cityFinalInitializeTemperateCore()',solvePos);
assert.ok(solvePos>=0&&initCallPos>solvePos,
  'weather/orbit closure must precede current-core initialization');
assert.doesNotMatch(src,/state\.(?:lowOn|midOn|highOn)\s*=/,
  'Random finalizer must not overwrite render-only cloud visibility');
const initDefPos=src.indexOf('function cityFinalInitializeTemperateCore()');
const rhPos=src.indexOf("h2oRefreshRelativeHumidity(core,climate)",initDefPos);
const soilPos=src.indexOf("soilRefreshBaseline(core)",rhPos);
assert.ok(initDefPos>=0&&rhPos>initDefPos&&soilPos>rhPos,
  'final soil baseline must be rebuilt from the final warm/humid core');

console.log('habitable-random-thermal.test.js: OK');
