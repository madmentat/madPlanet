'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/weather-frame-budget.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');

for(const build of [buildSh,buildPs]){
  assert.ok(build.indexOf('js/presentation-clock.js')<build.indexOf('js/weather-frame-budget.js'),'weather budget must be able to consume presentation jank state');
  assert.ok(build.indexOf('js/weather-frame-budget.js')<build.indexOf('js/weather-cloud-render.js'),'scheduler policy must install before late visual wrappers');
}
assert.match(src,/weatherCoreCostEwmaMs/,'scheduler must use measured physical tick cost');
assert.match(src,/WEATHER_FRAME_COST_MULT=1\.28/,'idle admission needs a safety multiplier');
assert.match(src,/deadline\.timeRemaining\(\)/,'scheduler must inspect the actual idle slice');
assert.match(src,/remain<need/,'a tick must not start inside an undersized idle slice');
assert.match(src,/WEATHER_FRAME_MAX_STALE_MS=1600/,'physics may defer under load but needs a bounded starvation limit');
assert.match(src,/presentationClock|__madPlanetPresentationClock/,'weather work must defer after a recent presentation hitch');
assert.match(src,/deadline\.didTimeout&&stale<WEATHER_FRAME_MAX_STALE_MS/,'idle timeout alone must not automatically justify a visible hitch');
assert.doesNotMatch(src,/setInterval\s*\(/,'weather frame budget must remain cooperative and non-overlapping');

console.log('weather-frame-budget.test.js: OK');
