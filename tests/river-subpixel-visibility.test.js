'use strict';
// Regression for the 0.5.183 visual failure: correctly routed rivers were
// multiplied by physicalWidth/footprint until they became invisible from
// orbital distances. Shader compilation and graph continuity did not catch it.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const shader=fs.readFileSync(path.join(__dirname,'../shaders/river-channels.glsl'),'utf8');
const surface=fs.readFileSync(path.join(__dirname,'../shaders/surface.glsl'),'utf8');
assert.doesNotMatch(shader,/ink\s*\*=\s*min\s*\(\s*1\.0\s*,\s*physicalHalfWidth/,
  'do not fade all subpixel rivers to nothing');
assert.match(shader,/float aa=max\(0\.000001,footprint\*0\.55\)/,
  'world-space channels need a finite antialiasing footprint');
assert.match(shader,/result=max\(result,vec2\(ink,0\.0\)\)/,
  'return the river water coverage, without old painted bank halos');
assert.doesNotMatch(surface,/float floodplain=drainage\.y/,
  'old parallel floodplain halos must remain disabled');

// CPU mirror of the actual GLSL visibility profile. These are not just
// topology checks: across a range of zooms, an on-center river must remain
// readable even when narrower than a pixel; the visible silhouette softens
// rather than abruptly disappearing.
function smoothstep(lo,hi,x){
  const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));
  return t*t*(3-2*t);
}
function coverage(bin,footprint,distance){
  const physicalWidth=0.000008+(0.00060-0.000008)*Math.pow(bin/15,2.3);
  const aa=Math.max(0.000001,footprint*0.55);
  const radiusLo=Math.max(0,physicalWidth-aa);
  return 1-smoothstep(radiusLo,physicalWidth+aa,distance);
}
for(const fp of [0.000025,0.0001,0.0004,0.002,0.006,0.018]){
  for(const bin of [1,4,8,12,15]){
    const center=coverage(bin,fp,0);
    assert.ok(center>=0.95,'river center must not disappear: bin='+bin+' footprint='+fp);
    const outer=coverage(bin,fp,fp*3+0.001);
    assert.ok(outer<=0.01,'channel must not paint a giant parallel outline');
    assert.ok(coverage(bin,fp,fp*0.5)<=center);
  }
}
for(let i=1;i<=15;i++)
  assert.ok(coverage(i,0.00005,0.00012)<=coverage(15,0.00005,0.00012),
    'broad mainstem must not look thinner than a headwater');
console.log('river-subpixel-visibility.test.js: OK (zoom/LOD and bank-halo regression)');
