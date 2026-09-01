const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const terrain=read('shaders/terrain.glsl');
const surface=read('shaders/surface.glsl');
const pre=read('shaders/surface-artifact-prelude.glsl');
const post=read('shaders/surface-artifact-postlude.glsl');

/* 0.5.89: all-pair tectonic math may remain differentiable, but physical
   height must be supported by proximity to the REAL nearest/second-nearest
   boundary. Use a broad smooth window rather than Grok's very narrow
   exp(-28*gSeamNear), which risked squeezing mountain systems into ribbons. */
assert.match(terrain,/float seamGate = 1\.0 - ss\(0\.075,0\.240,gSeamNear\)/,
  'physical tectonic relief needs a broad real-seam support window');
assert.match(terrain,/belt\.x \*= seamGate/,'tectonic height must fade in plate interiors');
assert.match(terrain,/belt\.z \*= seamGate/,'orographic/lee source must fade with physical tectonics');
assert.match(terrain,/leeOut \*= seamGate/,'published lee effect must not survive deep inside a plate');
assert.doesNotMatch(terrain,/exp\(-28\.0 \* gSeamNear\)/,
  'do not collapse all orogeny into Grok\'s overly narrow exponential corridor');

/* The raw surface shader has a single uTect use: the finite-difference normal
   gain. That slider must therefore be locally supported during surface-only
   preprocessing instead of multiplying every land normal on the planet. */
assert.equal((surface.match(/\buTect\b/g)||[]).length,1,
  'surface uTect usage changed; review the local normal-support macro before adding more');
assert.match(pre,/#define uTect \(uTect \* max\(max\(ss\(0\.004,0\.065,mount\),ss\(0\.010,0\.120,ridge\)\),1\.0-ss\(0\.080,0\.240,seamNearCenter\)\)\)/,
  'Tectonics normal gain must be supported only by real orogenic relief/margin proximity');
assert.match(post,/#undef uTect/,'surface-only Tectonics remap must not leak to later shader modules');
assert.doesNotMatch(pre,/#define gSeamNear/,'real tectonic seam must never be shadowed again');

console.log('tectonic-interior-artifacts.test.js: OK');
