const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const terrain=fs.readFileSync(path.join(root,'shaders/terrain.glsl'),'utf8');

/* Plate boundaries may organise mountain systems, but their analytic
   power-Voronoi arc must never be directly engraved into the terrain. */
assert.doesNotMatch(terrain,/cos\s*\(\s*belt\.y\s*\*/,
  'tectonic relief must not stamp periodic stripes from distance to a plate seam');
assert.match(terrain,/float seamWarp = 0\.052\*dot\(wv2,bdir\) \+ 0\.020\*dot\(wv,bdir\)/,
  'the pair-local seam coordinate must be displaced by 3-D noise');
assert.match(terrain,/seamS \+= seamWarp/,
  'warping must act on the actual seam coordinate, not only on ridge colour');
assert.match(terrain,/float ruptureField = clamp/,
  'long plate boundaries need a non-periodic breakup field');
assert.match(terrain,/\? convC\*\(arc\*\(0\.56\+0\.44\*rupture\) - 0\.035\*trench\*rupture\)/,
  'convergent uplift must be broken and any trench contribution must stay weak');
assert.match(terrain,/float trench = band\*rupture/,
  'subduction trench may remain only as part of the broken rupture field');
assert.match(terrain,/: convC\*band\*\(0\.16\+0\.44\*rupture\)/,
  'divergent rifts must be shallow/broken rather than continuous ink lines');
assert.doesNotMatch(terrain,/arc - 0\.62\*trench/,
  'every convergent boundary must not carry the old compulsory parallel trench');
assert.match(terrain,/float peaks = ridged\([^\n]+, 3\)/,
  'collision relief should retain broken ridge structure at lower shader cost');
assert.match(terrain,/float foldA = 0\.5 \+ 0\.5\*noise3/,
  'mountain chains still need local non-periodic breakup');
assert.match(terrain,/float foldB = 0\.5 \+ 0\.5\*noise3/,
  'a second unrelated field must stop long smooth ridge arcs');
assert.doesNotMatch(terrain,/foldWarp/,
  'the old expensive secondary 12-octave fold stack must stay retired');
assert.match(terrain,/h -= uTect \* belt\.x\*belt\.x \* 0\.075/,
  'rift relief must stay materially shallower than the old engraved groove');

/* 0.5.85 regression: do not create a second perfectly smooth contour around
   an otherwise noisy tectonic belt by hard-switching relief at |belt.x|=c.
   The squared belt amplitude is already a continuous fade to zero. */
assert.doesNotMatch(terrain,/abs\s*\(\s*belt\.x\s*\)\s*>\s*0\.004/,
  'tectonic relief must not switch on at a fixed spatial belt contour');
assert.match(terrain,/if\(uTect > 0\.01\)\{[\s\S]*?if\(belt\.x > 0\.0\)/,
  'tectonic terrain should remain globally enabled while the signed belt amplitude fades continuously');

console.log('tectonic-morphology.test.js: OK');