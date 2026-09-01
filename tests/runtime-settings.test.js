const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const runtime=read('js/runtime-settings.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/render.js','js/runtime-settings.js','js/weather-cloud-render.js','js/smooth-motion-ui.js','js/pause-ui.js'],'shell runtime order');
ordered(buildPs,['js/render.js','js/runtime-settings.js','js/weather-cloud-render.js','js/smooth-motion-ui.js','js/pause-ui.js'],'PowerShell runtime order');

assert.match(runtime,/const SPEED_STEPS=\[0\.25,0\.5,1,2,4\]/,'simulation speed ladder must stay bounded');
assert.match(runtime,/const TICK_STEPS=\[30,60,120,180,300\]/,'Weather Core model-step choices must stay inside the proven 300 s stability envelope');
assert.match(runtime,/drawFrame=function\(now\)\{return drawFrameBeforeRuntimeClock\(visualNowMs\(now\)\);\}/,'base frame simulation must use the continuous synthetic clock');
assert.match(runtime,/relaxDerivedBeforeRuntimeClock\(Math\.max\(0,Number\(dtSec\)\|\|0\)\*settings\.speed\)/,'derived physical relaxation must follow simulation speed');
assert.match(runtime,/weatherCoreStep\(core,settings\.tickSeconds/,'user model time per tick must drive Weather Core integration');
assert.match(runtime,/1000\/Math\.max\(0\.25,settings\.speed\)/,'speed multiplier must request matching Weather Core cadence');
assert.match(runtime,/Math\.max\(250,Math\.min\(4000/,'weather cadence must stay bounded rather than flood the main thread');
assert.match(runtime,/localStorage\.setItem\(STORAGE_KEY/,'program settings must persist per device/browser');
assert.match(runtime,/settings\.weatherGrid>0\?settings\.weatherGrid:requestedBeforeRuntime\(\)/,'performance UI must be able to override the synoptic grid');
assert.match(runtime,/settings\.deferWeatherInteraction/,'interaction-priority weather policy must remain user-configurable');
assert.match(runtime,/settings\.adaptiveResolution/,'adaptive framebuffer resolution must remain user-configurable');
assert.match(runtime,/target=1000\/settings\.targetFps/,'adaptive render target must follow the selected FPS');

/* Placement contract: settings immediately left of hamburger; time controls
   adjacent to pause in both desktop and narrow layouts. */
assert.match(runtime,/right:calc\(var\(--safe-b\) \+ 48px\);bottom:var\(--safe-b\)/,'desktop settings button must sit left of hamburger');
assert.match(runtime,/left:calc\(50% - 48px\).*top:var\(--safe-t\)/,'mobile settings button must sit left of top-center hamburger');
assert.match(runtime,/sim-speed-control\{position:fixed;z-index:10;top:var\(--safe-t\);right:calc\(var\(--safe-b\) \+ 48px\)/,'desktop speed controls must sit beside pause');
assert.match(runtime,/bottom:calc\(var\(--safe-b\) \+ 102px\)/,'phone speed controls must follow the lifted pause row');
assert.match(runtime,/data-sim-speed=\"-1\"/,'slow-down control missing');
assert.match(runtime,/id=\"simSpeedBadge\"/,'current simulation speed badge missing');
assert.match(runtime,/data-sim-speed=\"1\"/,'speed-up control missing');

for(const label of ['Настройки программы','Время за тик Weather Core','Быстродействие на этом устройстве','Целевой FPS','Сетка Weather Core','Диагностика'])
  assert.ok(runtime.includes(label),'runtime settings UI label missing: '+label);
assert.match(runtime,/Promise\.resolve\(\)\.then\(installLateHooks\)/,'runtime policy must install after the later render/pause wrappers');

console.log('runtime-settings.test.js: OK');
