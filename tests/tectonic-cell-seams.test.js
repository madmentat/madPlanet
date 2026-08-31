const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'shaders/terrain.glsl'),'utf8');

assert.match(src,/float tectonicSmoothMin\(float a,float b\)/,
  'tectonic relief needs a differentiable nearest-plate reference');
assert.match(src,/if\(i>0\) dRef=tectonicSmoothMin\(dRef,d\)/,
  'all plate distances must contribute to the smooth relief reference');
assert.match(src,/float di = -dot\(sN, pi\) - uPlateP\[i\]\.w - dRef/,
  'pair weights must use the smooth reference');
assert.match(src,/float dj = -dot\(sN, pj\) - uPlateP\[j\]\.w - dRef/,
  'both sides of a plate pair must use the smooth reference');

const pairStart=src.indexOf('for(int i=0;i<uPlateN;i++){',src.indexOf('const float REACH'));
const pairEnd=src.indexOf('return vec3(num/den',pairStart);
assert.ok(pairStart>0&&pairEnd>pairStart,'tectonic pair loop must be found');
const pairLoop=src.slice(pairStart,pairEnd);
assert.doesNotMatch(pairLoop,/\- dmin/,
  'hard nearest-plate identity must never feed the physical relief path');

/* 0.5.86: the colour/line diagnostic must describe the ACTUAL weighted-
   Voronoi cell boundary: nearest site versus second-nearest competitor. The
   old all-pair seam average drew bisectors for non-neighbouring plates, so two
   ghost lines could cross inside one coloured plate. */
assert.match(src,/float dmin = 1e9, dsecond = 1e9/,
  'diagnostics must track the first and second nearest weighted sites');
assert.match(src,/else if\(d < dsecond\)/,
  'the second-nearest competitor must be tracked explicitly');
assert.match(src,/gPlateTint = fract\(nearSite/,
  'plate tint must still come from the true nearest site');
assert.match(src,/gSeamNear = max\(0\.0,\(dsecond-dmin\)\/diagBase\)/,
  'displayed plate line must be the nearest/second-nearest boundary gap');
assert.match(src,/gSeamConv = clamp\(diagConv\*2\.4,-1\.0,1\.0\)/,
  'boundary convergence colour must come from the same real competing pair');
assert.doesNotMatch(src,/seamVisNum|seamVisDen|seamConvNum|seamVisW/,
  'all-pair display seam averaging must not return: it creates ghost bisectors');

/* The physical all-pair blend can remain differentiable, but a pair whose two
   members are not both locally competitive must lose amplitude. Crucially the
   gate is applied to contrib/lee rather than den so normalisation cannot undo
   the suppression. */
assert.match(pairLoop,/float pairCompetitive = exp\(-280\.0\*\(di\*di \+ dj\*dj\)\)/,
  'non-neighbour plate pairs need a stronger smooth local-competition gate (0.5.87)');
assert.match(pairLoop,/contrib \*= pairCompetitive/,
  'ghost-pair relief must be attenuated before accumulation');
assert.match(pairLoop,/\* rupture \* pairCompetitive/,
  'orographic lee effects from ghost pairs must be attenuated too');
assert.doesNotMatch(pairLoop,/den\s*\+=\s*wgt\*pairCompetitive/,
  'competition must not be placed in the normalising denominator or it cancels itself');

/* The physical pair coordinate itself must remain irregular, not merely shaded
   with noise after an exact spherical arc has already been carved. */
assert.match(pairLoop,/float seamS = \(dj - di\)\/base/,
  'pair seam coordinate must remain explicit for regression inspection');
assert.match(pairLoop,/float seamWarp = 0\.052\*dot\(wv2,bdir\) \+ 0\.020\*dot\(wv,bdir\)/,
  'pair-local 3-D warp must bend the physical seam');
assert.match(pairLoop,/seamS \+= seamWarp/,
  'seam warp must be applied before distance/band evaluation');
assert.doesNotMatch(src,/cos\s*\(\s*belt\.y\s*\*/,
  'periodic tectonic ribbon generator must not return');

/* When neither relief nor plate diagnostics are visible, the O(N^2) pair
   search is pure waste and must be skipped entirely. */
assert.match(src,/if\(uTect > 0\.01 \|\| uPlatesOn > 0\.5\)\{\s*\n\s*belt = tectonicBelt\(sN\)/,
  'disabled tectonics must not execute the plate-pair shader path');

console.log('tectonic-cell-seams.test.js: OK');
