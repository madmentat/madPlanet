const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const terrain=read('shaders/terrain.glsl');
const surface=read('shaders/surface.glsl');
const pre=read('shaders/surface-artifact-prelude.glsl');
const post=read('shaders/surface-artifact-postlude.glsl');

/* 0.5.107: retain a deep-interior ghost guard, but it must begin well outside
   the normal mountain envelope. Earlier narrow seam gates changed the actual
   geography and squeezed ranges into synthetic boundary ribbons. */
assert.match(terrain,/float seamGate = 1\.0 - ss\(0\.24,0\.50,gSeamNear\)/,
  'deep-plate relief needs a broad, morphology-neutral real-seam guard');
assert.match(terrain,/belt\.x \*= seamGate/,'tectonic height must still die deep inside plates');
assert.match(terrain,/belt\.z \*= seamGate/,'orographic source must use the same deep-interior guard');
assert.match(terrain,/leeOut \*= seamGate/,'published lee effect must not survive deep inside a plate');
assert.doesNotMatch(terrain,/exp\(-28\.0 \* gSeamNear\)/,
  'do not collapse all orogeny into the old narrow exponential corridor');

/* Normal shading uses the modern stable ONB/central-difference path, but the
   Tectonics slider must not amplify unrelated land. surface.glsl owns the
   local support explicitly; the prelude may only restore amplitude, never add
   a second spatial mask. */
assert.equal((surface.match(/\buTect\b/g)||[]).length,1,
  'surface uTect usage changed; review local normal support before adding more');
assert.match(surface,/float localTectSupport = max\(/,
  'surface must retain explicit local support for tectonic normal strength');
assert.match(surface,/ss\(0\.02, 0\.10, mount\)/,
  'real mountain height must participate in local normal support');
assert.match(pre,/#define uTect \(1\.75\*uTect\)/,
  'surface prelude may calibrate amplitude but must not spatially remask Tectonics');
assert.doesNotMatch(pre,/#define uTect \(uTect \* max/,
  'double localisation of Tectonics flattens legitimate mountain relief');
assert.match(post,/#undef uTect/,'surface-only amplitude calibration must not leak later');
assert.doesNotMatch(pre,/#define gSeamNear/,'real tectonic seam must never be shadowed again');

console.log('tectonic-interior-artifacts.test.js: OK');
