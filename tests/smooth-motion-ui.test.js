const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const smooth=read('js/smooth-motion-ui.js');
const prelude=read('shaders/surface-artifact-prelude.glsl');
const postlude=read('shaders/surface-artifact-postlude.glsl');
const surface=read('shaders/surface.glsl');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/render.js','js/cryosphere-render.js','js/smooth-motion-ui.js','js/screenshot-trigger.js'],'shell smooth layer order');
ordered(buildPs,['js/render.js','js/cryosphere-render.js','js/smooth-motion-ui.js','js/screenshot-trigger.js'],'PowerShell smooth layer order');

/* Landscape coarse-pointer tablets must not run the desktop Weather Core. */
assert.match(smooth,/matchMedia\('\(pointer: coarse\)'\)\.matches/,'coarse pointer must classify tablet physics');
assert.match(smooth,/SMOOTH_MOBILE_WEATHER_N = deviceMemory <= 4 \? 24 : 28/,
  'mobile Weather Core must be smaller than the old 32-cell face');
assert.match(smooth,/return \(uaMobile \|\| coarse \|\| compact\) \? SMOOTH_MOBILE_WEATHER_N : WEATHER_CORE_DESKTOP_N/,
  'mobile/coarse devices must use the tuned compact Weather Core');

/* Motion-first mobile policy: stay near the 60 Hz budget and allow quality to
   react while pinch/drag increases fragment cost. */
assert.match(smooth,/SMOOTH_MOBILE_FRAME_MS = 18\.0/,'mobile renderer should target roughly 50-60 fps');
assert.match(smooth,/SMOOTH_MOBILE_SCALE_MIN = deviceMemory <= 4 \? 0\.60 : 0\.68/,
  'mobile renderer needs enough scale headroom to recover close-zoom frame pacing');
assert.doesNotMatch(smooth,/pointers\.size>0\)return/,
  'adaptive quality must not freeze exactly while the user is pinching/dragging');
assert.match(smooth,/const interacting=/,'interaction-aware degradation policy expected');
assert.match(smooth,/qualityCooldown=interacting\?72:45/,
  'interaction downscale must be controlled rather than oscillating every sample');
assert.match(smooth,/qualityCooldown=120/,'quality recovery should stay slow');

/* The ice texture may interpolate spatially and temporally only as a scalar
   boundary field. Since 0.5.98 the surface samples it through an explicit
   helper; never hijack the global texture() builtin again. */
assert.match(smooth,/gl\.TEXTURE_MIN_FILTER,gl\.LINEAR/,'cryosphere source must no longer expose NEAREST texel stairs');
assert.match(smooth,/0\.5\+\(raw-edgeNoise\)\*slope/,'transitional cryosphere must publish a signed edge field');
assert.match(smooth,/SMOOTH_MOBILE_CRYO_PUBLISH_MS = 2400/,
  'mobile must not rebuild the expensive cryosphere display cubemap every second');
assert.match(smooth,/base\*5\.0/,'cryosphere edge motion must interpolate between slow visual publishes');
assert.match(prelude,/vec4 cryoSurfaceSample\(samplerCube tex, vec3 dir\)/,'direct surface cryosphere sampling helper missing');
assert.match(prelude,/smoothstep\(vec4\(0\.02\), vec4\(0\.18\), q\)/,'cryosphere helper must keep the continuous soft heel');
assert.match(surface,/cryoSurfaceSample\(uCryosphereTex, normalize\(sN\)\)/,'surface must use the scoped cryosphere helper');
assert.doesNotMatch(prelude,/#define\s+texture\(/,'global texture() macro must stay retired');
assert.doesNotMatch(postlude,/#undef\s+texture/,'postlude must not pretend texture() is still hijacked');

/* Requested live readout under the world label. */
for(const text of ['FPS','T̄','ЗВЕЗДА','ОРБИТА'])assert.ok(smooth.includes(text),'missing live telemetry label: '+text);
assert.match(smooth,/climateModel\(\)/,'headline temperature must come from the physical climate model');
assert.match(smooth,/starLabel\(state\.star\)/,'headline stellar class must follow the active star');
assert.match(smooth,/distanceInfo\(state\.distance\)\?\.au/,'headline orbital distance must use the shared AU mapping');
assert.match(smooth,/span<400/,'telemetry DOM must be throttled rather than updated every render frame');

console.log('smooth-motion-ui.test.js: OK');
