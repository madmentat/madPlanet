const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const smooth=read('js/smooth-motion-ui.js');
const prelude=read('shaders/surface-artifact-prelude.glsl');
const postlude=read('shaders/surface-artifact-postlude.glsl');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/render.js','js/cryosphere-render.js','js/smooth-motion-ui.js','js/screenshot-trigger.js'],'shell smooth layer order');
ordered(buildPs,['js/render.js','js/cryosphere-render.js','js/smooth-motion-ui.js','js/screenshot-trigger.js'],'PowerShell smooth layer order');

/* Landscape coarse-pointer tablets must not run the desktop Weather Core. */
assert.match(smooth,/matchMedia\('\(pointer: coarse\)'\)\.matches/,'coarse pointer must classify tablet physics');
assert.match(smooth,/return \(uaMobile \|\| coarse \|\| compact\) \? WEATHER_CORE_DRAFT_N : WEATHER_CORE_DESKTOP_N/,
  'mobile/coarse devices must use the intended compact Weather Core');

/* Motion-first mobile policy: materially above the old ~32 fps target, and
   framebuffer reallocations may not happen underneath an active drag. */
assert.match(smooth,/SMOOTH_MOBILE_FRAME_MS = 20\.5/,'mobile renderer should target roughly 45-50 fps');
assert.match(smooth,/SMOOTH_MOBILE_SCALE_MIN = deviceMemory <= 4 \? 0\.62 : 0\.70/,
  'mobile renderer needs enough resolution headroom to recover frame pacing');
assert.match(smooth,/pointers\.size>0\)return/,'dynamic resolution must pause during active pointer interaction');
assert.match(smooth,/qualityCooldown=120/,'quality recovery should be slow enough to avoid resize oscillation');

/* The ice texture may interpolate spatially again, but only into a scalar edge
   field. The fragment shader resolves a ~one-pixel material contour so LINEAR
   sampling cannot recreate the old kilometre-wide translucent polar wash. */
assert.match(smooth,/gl\.TEXTURE_MIN_FILTER,gl\.LINEAR/,'cryosphere source must no longer expose NEAREST texel stairs');
assert.match(smooth,/0\.5\+\(raw-edgeNoise\)\*slope/,'transitional cryosphere must publish a signed edge field');
assert.match(prelude,/vec4 cryoSurfaceTextureAA/,'surface cryosphere AA helper missing');
assert.match(prelude,/fwidth\(q\)\*0\.72/,'cryosphere edge must use screen-space derivative width');
assert.match(prelude,/#define texture\(TEX,COORD\) cryoSurfaceTextureAA/,'AA helper must intercept only the surface texture read');
assert.match(postlude,/#undef texture/,'surface texture macro must not leak into later shader modules');

/* Requested live readout under the world label. */
for(const text of ['FPS','T̄','ЗВЕЗДА','ОРБИТА'])assert.ok(smooth.includes(text),'missing live telemetry label: '+text);
assert.match(smooth,/climateModel\(\)/,'headline temperature must come from the physical climate model');
assert.match(smooth,/starLabel\(state\.star\)/,'headline stellar class must follow the active star');
assert.match(smooth,/distanceInfo\(state\.distance\)\?\.au/,'headline orbital distance must use the shared AU mapping');
assert.match(smooth,/span<400/,'telemetry DOM must be throttled rather than updated every render frame');

console.log('smooth-motion-ui.test.js: OK');
