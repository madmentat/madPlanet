'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/river-frame-pacing.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');

for(const build of [buildSh,buildPs]){
  assert.ok(build.indexOf('js/frame-pacing-polish.js')<build.indexOf('js/river-frame-pacing.js'),'river pacing should see the final camera-motion priority hook');
  assert.ok(build.indexOf('js/river-frame-pacing.js')<build.indexOf('js/screenshot-trigger.js'),'river pacing must install before late screenshot hooks');
}
assert.match(src,/RIVER_PUBLISH_MIN_DESKTOP_MS=1200/,'desktop river cubemap must not repack every weather tick');
assert.match(src,/RIVER_PUBLISH_MIN_MOBILE_MS=1550/,'mobile river publication needs an even wider wall-time budget');
assert.match(src,/riverPublishPending=core/,'river publications must coalesce to the latest Weather Core state');
assert.match(src,/requestIdleCallback/,'heavy river rasterization must move to an idle turn');
assert.match(src,/riverPacingImmediateRequired/,'new seed\/texture allocation must still publish synchronously');
assert.match(src,/riverPublishCostEwmaMs/,'river upload cost must be measured for later idle admission');
assert.match(src,/cameraMotionActive/,'camera motion must outrank decorative river repacking');
assert.match(src,/__madPlanetPresentationClock/,'recent frame hitches must defer river publication');
assert.doesNotMatch(src,/requestAnimationFrame\s*\(/,'river texture publication must not become render-FPS work');

console.log('river-frame-pacing.test.js: OK');
