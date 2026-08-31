const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'shaders/terrain.glsl'),'utf8');

assert.match(src,/float tectonicSmoothMin\(float a,float b\)/,
  'tectonic relief needs a differentiable nearest-plate reference');
assert.match(src,/if\(i>0\) dRef=tectonicSmoothMin\(dRef,d\)/,
  'all plate distances must contribute to the smooth reference');
assert.match(src,/float di = -dot\(sN, pi\) - uPlateP\[i\]\.w - dRef/,
  'pair weights must use the smooth reference');
assert.match(src,/float dj = -dot\(sN, pj\) - uPlateP\[j\]\.w - dRef/,
  'both sides of a plate pair must use the smooth reference');

const pairStart=src.indexOf('for(int i=0;i<uPlateN;i++){',src.indexOf('const float REACH'));
const pairEnd=src.indexOf('return vec3(num/den',pairStart);
assert.ok(pairStart>0&&pairEnd>pairStart,'tectonic pair loop must be found');
const pairLoop=src.slice(pairStart,pairEnd);
assert.doesNotMatch(pairLoop,/\- dmin/,
  'hard nearest-plate min must never feed tectonic pair reach/weights again');

/* The hard minimum is still useful for the optional plate-colour diagnostic;
   that identity must not influence the actual relief path. */
assert.match(src,/if\(d < dmin\)\{ dmin = d; nearSite = uPlateP\[i\]\.xyz; \}/);
assert.match(src,/gPlateTint = fract\(nearSite/);

/* The physical pair coordinate itself must be irregular, not merely shaded
   with noise after an exact Voronoi/spherical arc has already been carved. */
assert.match(pairLoop,/float seamS = \(dj - di\)\/base/,
  'pair seam coordinate must remain explicit for regression inspection');
assert.match(pairLoop,/float seamWarp = 0\.052\*dot\(wv2,bdir\) \+ 0\.020\*dot\(wv,bdir\)/,
  'pair-local 3-D warp must bend the analytic seam');
assert.match(pairLoop,/seamS \+= seamWarp/,
  'seam warp must be applied before distance/band evaluation');

/* Display seam diagnostics remain a continuous weighted field, never a hard
   selected pair that can pop or draw a one-pixel identity boundary. */
assert.doesNotMatch(pairLoop,/seam < gSeamNear/,
  'display seam globals must not hard-select a single plate pair');
assert.match(pairLoop,/float seamVisW=wgt\*\(1\.0-ss\(0\.018,0\.125,seam\)\)\*rupture/,
  'display seam needs a continuous broken near-seam weight');
assert.match(pairLoop,/seamVisNum\+=seamVisW\*seam/,
  'display seam distance must be accumulated continuously');
assert.match(pairLoop,/seamConvNum\+=seamVisW\*convC/,
  'display convergence must use the same continuous weights');
assert.match(src,/gSeamNear=seamVisNum\/seamVisDen/,
  'display seam distance must resolve from the continuous field');

assert.doesNotMatch(src,/cos\s*\(\s*belt\.y\s*\*/,
  'periodic tectonic ribbon generator must not return');

/* When neither relief nor plate diagnostics are visible, the O(N^2) pair
   search is pure waste and must be skipped entirely. */
assert.match(src,/if\(uTect > 0\.01 \|\| uPlatesOn > 0\.5\)\{\s*\n\s*belt = tectonicBelt\(sN\)/,
  'disabled tectonics must not execute the plate-pair shader path');

console.log('tectonic-cell-seams.test.js: OK');