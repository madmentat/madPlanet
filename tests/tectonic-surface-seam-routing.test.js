const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const prelude=read('shaders/surface-artifact-prelude.glsl');
const postlude=read('shaders/surface-artifact-postlude.glsl');
const surface=read('shaders/surface.glsl');
const terrain=read('shaders/terrain.glsl');

/* Surface shading must receive the real nearest/second-nearest plate boundary
   computed by terrain.glsl. The old 0.5.80 workaround replaced gSeamNear with
   a function of mount and manufactured smooth contour lines around tectonics. */
assert.doesNotMatch(prelude,/^\s*#define\s+gSeamNear\b/m,
  'surface prelude must never replace the real plate-boundary field with a mount-derived contour');
assert.doesNotMatch(postlude,/^\s*#undef\s+gSeamNear\b/m,
  'surface postlude should not pretend gSeamNear is a temporary macro');
assert.match(terrain,/gSeamNear\s*=\s*max\(0\.0,\(dsecond-dmin\)\/diagBase\)/,
  'terrain must publish the real nearest/second-nearest weighted-Voronoi boundary');
assert.match(surface,/float seamNearCenter\s*=\s*gSeamNear\s*;/,
  'surface must snapshot the real terrain seam before finite-difference terrain calls overwrite globals');

/* Do not key these checks to comment headings: those changed during the Grok
   refactor while the actual routing stayed valid. Check the executable uses. */
assert.match(surface,/float arc\s*=\s*1\.0\s*-\s*ss\([^;]*seamNearCenter\)/,
  'volcanic arcs may follow the real plate boundary, not an invented mount contour');
assert.match(surface,/float line\s*=\s*1\.0\s*-\s*ss\([^;]*seamNearCenter\)/,
  'plate diagnostic lines must be drawn from the real boundary snapshot');

/* 0.5.98 retired the global texture() macro. Cryosphere sampling is explicit
   and therefore cannot hijack unrelated cubemap/2D texture calls. */
assert.match(prelude,/vec4\s+cryoSurfaceSample\s*\(samplerCube\s+tex,\s*vec3\s+dir\)/,
  'explicit cryosphere surface sampler must remain available');
assert.doesNotMatch(prelude,/^\s*#define\s+texture\s*\(/m,
  'surface prelude must not hijack the GLSL texture builtin');
assert.match(surface,/cryoSurfaceSample\(uCryosphereTex,\s*normalize\(sN\)\)/,
  'surface must sample cryosphere through the explicit helper');

console.log('tectonic-surface-seam-routing.test.js: OK');
