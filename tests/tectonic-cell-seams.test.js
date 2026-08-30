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

/* 0.5.77: the remaining dotted arcs came from a second hard identity choice:
   gSeamNear selected one pair even though physical relief was already a sum.
   Volcanism and finite-difference calls then exposed that pair switch. */
assert.doesNotMatch(pairLoop,/seam < gSeamNear/,
  'display seam globals must not hard-select a single plate pair');
assert.match(pairLoop,/float seamVisW=wgt\*\(1\.0-ss\(0\.018,0\.115,seam\)\)/,
  'display seam needs a cheap continuous near-seam weight');
assert.match(pairLoop,/seamVisNum\+=seamVisW\*seam/,
  'display seam distance must be accumulated continuously');
assert.match(pairLoop,/seamConvNum\+=seamVisW\*convC/,
  'display convergence must use the same continuous weights');
assert.match(src,/gSeamNear=seamVisNum\/seamVisDen/,
  'display seam distance must resolve from the continuous field');

/* 0.5.75 regression stays enforced as well: no periodic distance-to-seam fold
   generator may return while removing the one-pixel cell-boundary artifacts. */
assert.doesNotMatch(src,/cos\s*\(\s*belt\.y\s*\*/,
  'periodic tectonic ribbon generator must not return');

console.log('tectonic-cell-seams.test.js: OK');
