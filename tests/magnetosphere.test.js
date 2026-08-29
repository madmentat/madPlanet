const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');

function auroraLatitudeRad(a){
  a=Math.max(0,Math.min(1,a));
  return (75.0-15.5*a)*Math.PI/180;
}
function dipoleRadius(L,theta){ return L*Math.sin(theta)**2; }

const deg=x=>x*180/Math.PI;
assert.ok(Math.abs(deg(auroraLatitudeRad(0))-75.0)<1e-10);
assert.ok(Math.abs(deg(auroraLatitudeRad(1))-59.5)<1e-10);
assert.ok(auroraLatitudeRad(0)>auroraLatitudeRad(0.5));
assert.ok(auroraLatitudeRad(0.5)>auroraLatitudeRad(1));

for(const L of [1.5,2,4,8]){
  const theta0=Math.asin(Math.sqrt(1/L));
  assert.ok(Math.abs(dipoleRadius(L,theta0)-1)<1e-12, `L=${L} north footpoint`);
  assert.ok(Math.abs(dipoleRadius(L,Math.PI-theta0)-1)<1e-12, `L=${L} south footpoint`);
  assert.ok(Math.abs(dipoleRadius(L,Math.PI/2)-L)<1e-12, `L=${L} equatorial apex`);
}

for(const a of [0,0.25,0.5,0.75,1]){
  const mu=Math.sin(auroraLatitudeRad(a));
  assert.ok(mu>0.85, `activity=${a}: magnetic pole projection too small: ${mu}`);
}

/* Separate aurora pass must be visible at high Kp without becoming a perfect
   ring. Check the physical/visual invariants rather than pinning 0.5.63 exact
   constants. */
const aurora=fs.readFileSync(path.join(root,'shaders','aurora-pass.glsl'),'utf8');
assert.match(aurora,/float activityV=pow\(clamp\(activity,0\.0,1\.0\),0\.78\)/,'aurora activity response missing');
assert.match(aurora,/float hw=radians\(mix\(1\.55,8\.8,activityV\)\)/,'Kp 9 must produce a broad visible oval');
assert.match(aurora,/float sector=0\.16\+0\.84\*smoothstep/,'noise must not erase the entire physical oval');
assert.match(aurora,/float power=\(0\.028\+0\.64\*pow\(activityV,1\.35\)\)/,'high Kp needs readable nightside emission');
assert.match(aurora,/const int N=9;/,'thin auroral volume needs enough samples to remain visible');
assert.match(aurora,/vec3 display=sum\/\(vec3\(1\.0\)\+0\.72\*sum\)/,'separate aurora pass needs display-space compression');
assert.match(aurora,/\*1\.08;/,'separate pass must not crush aurora back below display visibility');
assert.match(aurora,/pow\(clamp\(display,vec3\(0\.0\),vec3\(1\.0\)\),vec3\(1\.0\/2\.2\)\)/,'separate aurora pass needs gamma conversion');
assert.ok(!/sin\s*\(\s*lon\s*\*/.test(aurora),'periodic techno-ring must not return');

const rotation=fs.readFileSync(path.join(root,'js','magnet-axis-rotation.js'),'utf8');
assert.match(rotation,/m3axis\(world\.axis,t\*SPIN\)/,'tilted magnetic axis must rotate with the planet');
assert.match(rotation,/currentMagAxisBodyFixed/,'rotation must preserve the slider-defined body-frame dipole');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
assert.ok(buildSh.includes('js/magnet-axis-rotation.js'),'shell build must include magnetic-axis rotation');
assert.ok(buildPs.includes('js/magnet-axis-rotation.js'),'PowerShell build must include magnetic-axis rotation');

console.log('magnetosphere math/render tests: OK');
