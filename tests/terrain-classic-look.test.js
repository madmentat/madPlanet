const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const terrain=fs.readFileSync(path.join(root,'shaders/terrain.glsl'),'utf8');

/* 0.5.107: simplex fixes cubic-lattice facets, but its raw amplitude is about
   twice noise3. The classic visual recipe must therefore use a normalized
   wrapper rather than blindly applying pre-simplex coefficients. */
assert.match(terrain,/float classicSimplexFbm\(vec3 p, int oct\)\{ return 0\.50\*fbmSimplex\(p,oct\); \}/,
  'simplex must be normalized to the old terrain amplitude before classic coefficients are reused');
assert.match(terrain,/vec3 q = p \+ 0\.9\*w/,
  'classic continent domain-warp strength must be restored');
assert.match(terrain,/float c = classicSimplexFbm\(q, 5\)/,
  'classic five-octave continent body must remain');
assert.match(terrain,/c \+= 0\.14\*classicSimplexFbm\(q\*3\.1 \+ vec3\(7\.0\), 3\)/,
  'classic middle-scale continent detail must remain');
assert.match(terrain,/uIsle\*0\.6\*max\(isl-0\.22,0\.0\)/,
  'island abundance/profile must use the classic 0.22 heel on isotropic simplex');
assert.doesNotMatch(terrain,/smoothstep\(0\.18, 0\.28, isl\)/,
  'the broad 0.5.106 island remap changed island mass too much');

/* Mountain morphology should read like the pre-Grok world from orbit, while
   the newer true-seam/ghost-pair infrastructure stays underneath it. */
assert.match(terrain,/float bw = 0\.073\*\(0\.45 \+ 1\.15\*seg\)\*\(0\.60 \+ 1\.15\*orogN\)/,
  'orogenic envelope must recover the broad classic width');
assert.match(terrain,/float peaks = ridged\(sN\*6\.6 \+ uSeedS\*1\.9, 3\)/,
  'classic broad broken ridge scale must be restored');
assert.match(terrain,/float foldA = 0\.5 \+ 0\.5\*noise3\(sN\*13\.5/,
  'first classic fold scale missing');
assert.match(terrain,/float foldB = 0\.5 \+ 0\.5\*noise3\(sN\*27\.0/,
  'second classic fold scale missing');
assert.match(terrain,/mountOut = uTect \* ramp \* \(0\.34 \+ 0\.66\*peaks\) \* \(0\.58 \+ 0\.42\*folds\) \* 1\.38/,
  'classic mountain amplitude/profile must be restored');
assert.match(terrain,/mountOut \*= mix\(0\.40, 1\.0, ss\(-0\.05, 0\.03, h\)\)/,
  'coastal orogeny must not be chopped off by the later land-only gate');
assert.match(terrain,/h -= uTect \* belt\.x\*belt\.x \* 0\.075/,
  'classic shallow rift response must be restored');
assert.doesNotMatch(terrain,/float peaks2 =/,
  '0.5.105 needle-range stack must not replace classic mountain morphology');
assert.doesNotMatch(terrain,/float crest = exp\(-gSeamNear\*10\.0\)/,
  'mountains must not be squeezed into a narrow seam crest');

console.log('terrain-classic-look.test.js: OK');
