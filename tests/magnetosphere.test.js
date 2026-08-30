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

/* 0.5.68: Kp expands the allowed auroral region, but visible emission inside
   it must be thin broken curtains. A non-zero sector floor was the direct cause
   of the polar-camera fluorescent "eye" in 0.5.65..0.5.67. */
const aurora=fs.readFileSync(path.join(root,'shaders','aurora-pass.glsl'),'utf8');
assert.match(aurora,/float activityV=pow\(clamp\(activity,0\.0,1\.0\),0\.80\)/,'aurora activity response missing');
assert.match(aurora,/float zoneHW=radians\(mix\(1\.8,7\.0,activityV\)\)/,'Kp must widen the physical activity zone');
assert.match(aurora,/float ribbonHW=radians\(mix\(0\.38,0\.88,activityV\)\)/,'individual optical curtains must remain thin');
assert.match(aurora,/float sector0=smoothstep\(cut0,cut0\+0\.17,broad0\)/,'primary auroral sectors need real zero-valued gaps');
assert.match(aurora,/float sector1=smoothstep\(cut1,cut1\+0\.18,broad1\)/,'secondary auroral sectors need independent real gaps');
assert.ok(!/float\s+sector\w*\s*=\s*0\.(?:0?[1-9]|1[0-9])\s*\+/.test(aurora),'auroral sector floors must not recreate a full luminous ring');
assert.ok(!/mix\(1\.55,8\.8,activityV\)/.test(aurora),'old fat single-oval half-width must stay retired');
for(const name of ['arc0','arc1','arc2','split'])assert.match(aurora,new RegExp('float '+name+'='),'broken multi-ribbon aurora missing '+name);
assert.match(aurora,/float viewGain=mix\(0\.70,1\.55,tangent\)/,'orbital view should strengthen tangential limb curtains');
assert.match(aurora,/float power=\(0\.020\+0\.46\*pow\(activityV,1\.42\)\)/,'aurora power calibration missing');
assert.match(aurora,/const int N=8;/,'auroral volume sampling calibration changed unexpectedly');
assert.match(aurora,/vec3 display=sum\/\(vec3\(1\.0\)\+0\.78\*sum\)/,'separate aurora pass needs display-space compression');
assert.match(aurora,/\*0\.92;/,'moderate Kp must not use the old 1.08 fluorescent overcompensation');
assert.match(aurora,/pow\(clamp\(display,vec3\(0\.0\),vec3\(1\.0\)\),vec3\(1\.0\/2\.2\)\)/,'separate aurora pass needs gamma conversion');
assert.ok(!/sin\s*\(\s*lon\s*\*/.test(aurora),'periodic techno-ring must not return');

/* Visibility should not need emergency brightness hacks to compensate for a
   default-off switch. Keep the ordinary world visibly aurora-capable. */
const stateSrc=fs.readFileSync(path.join(root,'js','state.js'),'utf8');
assert.match(stateSrc,/auroraOn:\s*true/,'polar aurora must be enabled by default');

const rotation=fs.readFileSync(path.join(root,'js','magnet-axis-rotation.js'),'utf8');
assert.match(rotation,/m3axis\(world\.axis,t\*SPIN\)/,'tilted magnetic axis must rotate with the planet');
assert.match(rotation,/currentMagAxisBodyFixed/,'rotation must preserve the slider-defined body-frame dipole');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
assert.ok(buildSh.includes('js/magnet-axis-rotation.js'),'shell build must include magnetic-axis rotation');
assert.ok(buildPs.includes('js/magnet-axis-rotation.js'),'PowerShell build must include magnetic-axis rotation');

console.log('magnetosphere math/render tests: OK');
