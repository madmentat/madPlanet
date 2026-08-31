const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const prelude=read('shaders/surface-artifact-prelude.glsl');
const postlude=read('shaders/surface-artifact-postlude.glsl');
const surface=read('shaders/surface.glsl');
const terrain=read('shaders/terrain.glsl');

/* 0.5.88: surface shading must receive the real nearest/second-nearest plate
   boundary computed by terrain.glsl. The old 0.5.80 workaround replaced
   gSeamNear with a function of mount, manufacturing smooth contour lines around
   tectonic relief and then feeding those fake lines to both volcanism and the
   optional plate overlay. */
assert.doesNotMatch(prelude,/^\s*#define\s+gSeamNear\b/m,
  'surface prelude must never replace the real plate-boundary field with a mount-derived contour');
assert.doesNotMatch(postlude,/^\s*#undef\s+gSeamNear\b/m,
  'surface postlude should not pretend gSeamNear is a temporary macro');
assert.match(terrain,/gSeamNear\s*=\s*max\(0\.0,\(dsecond-dmin\)\/diagBase\)/,
  'terrain must publish the real nearest/second-nearest weighted-Voronoi boundary');
assert.match(surface,/float seamNearCenter\s*=\s*gSeamNear\s*;/,
  'surface must snapshot the real terrain seam before finite-difference terrain calls overwrite globals');

const volc=(surface.match(/\/\* ---- вулканизм ----[\s\S]*?\/\* океан \*\//)||[''])[0];
assert.match(volc,/seamNearCenter/,
  'volcanic arcs may follow the real plate boundary, not an invented mount contour');
const plates=(surface.match(/\/\* ---- схема литосферных плит ---- \*\/[\s\S]*?return col;/)||[''])[0];
assert.match(plates,/seamNearCenter/,
  'plate diagnostic lines must be drawn from the real boundary snapshot');

/* The cryosphere texture AA macro is unrelated and intentionally remains. */
assert.match(prelude,/^\s*#define\s+texture\(TEX,COORD\)\s+cryoSurfaceTextureAA/m,
  'cryosphere one-pixel material-edge helper must remain active');

console.log('tectonic-surface-seam-routing.test.js: OK');
