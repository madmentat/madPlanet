const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\n)\s*\/\/[^\n]*/g,'$1');
const render = read('js/render.js');
const clouds = read('shaders/clouds.glsl');
const surface = read('shaders/surface.glsl');
const ui = read('js/ui.js');
const glInit = read('js/gl-init.js');
const lightning = read('shaders/lightning.glsl');
const main = read('shaders/main.glsl');
const cloudGpu = read('js/weather-cloud-gpu.js');
const cloudRender = read('js/weather-cloud-render.js');
const cloudVisual = read('shaders/weather-cloud-visual.glsl');

assert.ok(!/gl\.finish\s*\(\s*\)\s*;/.test(render), 'render loop must not synchronously stall GPU with gl.finish()');
assert.match(render, /EXT_disjoint_timer_query_webgl2/, 'async GPU timer query expected');
assert.match(render, /renderUniformRevision/, 'static uniform cache expected');
assert.match(render, /ResizeObserver/, 'resize-on-change optimization expected');
assert.match(ui, /markRenderUniformsDirty\(\)/, 'UI must invalidate cached uniforms');
assert.match(clouds, /int N=\(uDraft>0\.5\)\?1:3;/, 'legacy low-cloud volume body should remain bounded while replacement is staged');
assert.match(clouds, /cumulusDensityFromShape\(p,shape,foot,climate\)/, 'legacy cloud morphology helper integrity expected');
assert.match(clouds, /0\.68\);/, 'low-cloud optical-depth compensation missing');
assert.ok(!/dFdx\(|dFdy\(|fwidth\(h\)/.test(surface), 'unsafe derivative terrain-normal optimization must stay disabled until separately validated on target GPUs');
assert.match(surface, /terrain\(normalize\(n0 \+ tg\*eps\)/, 'known-good finite-difference terrain normals expected');

assert.match(glInit, /KHR_parallel_shader_compile/, 'async shader link must use the parallel compile extension');
assert.match(glInit, /COMPLETION_STATUS_KHR/, 'link readiness must be polled, not waited on');
assert.match(glInit, /function pollShaderCompile\(/, 'per-frame link poll expected');
assert.match(render, /pollShaderCompile\(\)/, 'render loop must drive the background link poll');
const adoptIdx = glInit.indexOf("adoptProgram(p, 'balanced-compat')");
const kickIdx = glInit.lastIndexOf('startNextVariant();');
assert.ok(adoptIdx > 0 && kickIdx > adoptIdx, 'compact renderer must be adopted before the full program is queued');

/* Count executable calls, not explanatory comments that mention lightningGlow(). */
assert.ok(!/\bweather\s*\(/.test(stripComments(lightning)), 'lightning must not evaluate the weather field per bolt cell');
assert.ok(!/\blowCover\s*\(/.test(stripComments(lightning)), 'lightning must not evaluate cloud cover per bolt cell');
assert.equal((stripComments(main).match(/lightningGlow\s*\(/g) || []).length, 1, 'lightningGlow must be called once, not per compositing branch');

assert.ok(!/gSyn\s*=\s*synoptic\s*\(|gWx\s*=\s*weather\s*\(|lowCloudClimate\s*\(wd\)/.test(main),
  'main shader must not execute legacy procedural cloud geography');
assert.match(cloudVisual,/uWeatherCloudTex/,'physical cloud bridge must sample the Weather Core cubemap');
assert.ok(!/\bgWx\b|\bgSyn\b|lowCloudClimate\s*\(/.test(cloudVisual),
  'physical cloud decks must not reintroduce legacy climate/synoptic work');
assert.match(cloudGpu,/weatherCoreStep=function[\s\S]*weatherCloudGpuUpload\(core\)/,
  'cloud cubemap must upload after the fixed weather step');
assert.ok(!/requestAnimationFrame/.test(cloudGpu),'cloud cubemap upload must not run at render FPS');
assert.ok(!/texSubImage2D/.test(cloudRender),'per-frame render bridge may bind the cubemap but must never upload it');

console.log('performance-guards.test.js: OK');
