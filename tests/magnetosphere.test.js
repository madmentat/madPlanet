const assert = require('node:assert/strict');

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

// Авроральный диапазон должен оставаться полярным и соответствовать |dot(n,M)| >> 0.34.
for(const a of [0,0.25,0.5,0.75,1]){
  const mu=Math.sin(auroraLatitudeRad(a));
  assert.ok(mu>0.85, `activity=${a}: magnetic pole projection too small: ${mu}`);
}

console.log('magnetosphere math tests: OK');
