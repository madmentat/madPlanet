const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const render = read('js/render.js');
const clouds = read('shaders/clouds.glsl');
const surface = read('shaders/surface.glsl');
const ui = read('js/ui.js');
const glInit = read('js/gl-init.js');
const lightning = read('shaders/lightning.glsl');
const main = read('shaders/main.glsl');

assert.ok(!/gl\.finish\s*\(\s*\)\s*;/.test(render), 'render loop must not synchronously stall GPU with gl.finish()');
assert.match(render, /EXT_disjoint_timer_query_webgl2/, 'async GPU timer query expected');
assert.match(render, /renderUniformRevision/, 'static uniform cache expected');
assert.match(render, /ResizeObserver/, 'resize-on-change optimization expected');
assert.match(ui, /markRenderUniformsDirty\(\)/, 'UI must invalidate cached uniforms');
assert.match(clouds, /int N=\(uDraft>0\.5\)\?1:3;/, 'low-cloud volume must use three samples (one in draft) from a single inlined body');
assert.match(clouds, /cumulusDensityFromShape\(p,shape,foot,climate\)/, 'low deck must reuse its cumulus shape instead of recomputing it');
assert.match(clouds, /0\.68\);/, 'low-cloud optical-depth compensation missing');
// Explicit regression guard: the screen-derivative terrain-normal experiment caused compatibility trouble.
assert.ok(!/dFdx\(|dFdy\(|fwidth\(h\)/.test(surface), 'unsafe derivative terrain-normal optimization must stay disabled until separately validated on target GPUs');
assert.match(surface, /terrain\(normalize\(n0 \+ tg\*eps\)/, 'known-good finite-difference terrain normals expected');

/* 0.5.8: запуск не должен блокировать поток на линковке основной программы.
   На ANGLE/D3D она собирается минутами, и getProgramParameter(LINK_STATUS)
   сразу после linkProgram() держал вкладку белой всё это время. */
assert.match(glInit, /KHR_parallel_shader_compile/, 'async shader link must use the parallel compile extension');
assert.match(glInit, /COMPLETION_STATUS_KHR/, 'link readiness must be polled, not waited on');
assert.match(glInit, /function pollShaderCompile\(/, 'per-frame link poll expected');
assert.match(render, /pollShaderCompile\(\)/, 'render loop must drive the background link poll');
const adoptIdx = glInit.indexOf("adoptProgram(p, 'balanced-compat')");
const kickIdx = glInit.lastIndexOf('startNextVariant();');
assert.ok(adoptIdx > 0 && kickIdx > adoptIdx, 'compact renderer must be adopted before the full program is queued');

/* 0.5.8: грозовые ячейки больше не гоняют погоду и рельеф по шесть раз. */
assert.ok(!/weather\s*\(/.test(lightning), 'lightning must not evaluate the weather field per bolt cell');
assert.ok(!/lowCover\s*\(/.test(lightning), 'lightning must not evaluate cloud cover per bolt cell');
assert.equal((main.match(/lightningGlow\s*\(/g) || []).length, 1, 'lightningGlow must be inlined once, not per compositing branch');

/* 0.5.8: климат ярусов считается один раз на пиксель. */
assert.match(main, /gClimLow = needClim \? lowCloudClimate\(wd\)/, 'cloud climate must be hoisted to a per-pixel global');
assert.ok(!/float midCloudClimate\(/.test(clouds), 'middle-deck climate must reuse the hoisted global, not recompute terrain');
const cloudsCode = clouds.replace(/\/\*[\s\S]*?\*\//g, '');
assert.equal((cloudsCode.match(/lowCloudClimate\(/g) || []).length, 1, 'lowCloudClimate must be defined once and never called from the cloud decks');

console.log('performance-guards.test.js: OK');
