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

/* 0.5.75 regression stays enforced as well: no periodic distance-to-seam fold
   generator may return while removing the one-pixel cell-boundary artifacts. */
assert.doesNotMatch(src,/cos\s*\(\s*belt\.y\s*\*/,
  'periodic tectonic ribbon generator must not return');

console.log('tectonic-cell-seams.test.js: OK');
