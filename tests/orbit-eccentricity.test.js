const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const eccSrc=read('js/orbit-eccentricity.js');
const seasonSrc=read('js/eccentric-seasons.js');
const overlay=read('js/orbit-overlay.js');
const scene=read('js/orbit-scene-path.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/star-orbit.js','js/orbit-eccentricity.js','js/param-model.js'],'shell eccentric orbit order');
ordered(buildPs,['js/star-orbit.js','js/orbit-eccentricity.js','js/param-model.js'],'PowerShell eccentric orbit order');
ordered(buildSh,['js/diurnal-cycle.js','js/seasons.js','js/eccentric-seasons.js','js/baric-field.js'],'shell eccentric seasons order');
ordered(buildPs,['js/diurnal-cycle.js','js/seasons.js','js/eccentric-seasons.js','js/baric-field.js'],'PowerShell eccentric seasons order');
assert.doesNotMatch(eccSrc,/Math\.random/,'eccentricity must be deterministic from seed');
assert.match(eccSrc,/ORBIT_ECCENTRICITY_MIN=0\.010/);
assert.match(eccSrc,/ORBIT_ECCENTRICITY_MAX=0\.180/);

const state={seed:8127344,distance:0.51};
const ctx={console,Math,Number,state,window:{},document:undefined,
  orbitalFluxEarth:(L,r)=>L/(r*r),orbitDistanceAU:()=>1,
  distanceInfo:v=>({au:1,S:1,status:'conservative',label:''}),
  currentStarOrbitDiagnostics:()=>({au:1}),syncDynamicLabels:undefined,createPanel:undefined};
vm.createContext(ctx);vm.runInContext(eccSrc,ctx,{filename:'orbit-eccentricity.js'});
for(const seed of [0,1,2,12345,8127344,-42,0x7fffffff]){
  const e=ctx.orbitEccentricityForSeed(seed);
  assert.ok(e>=0.010&&e<=0.180,'seeded eccentricity must stay in moderate range');
  assert.equal(e,ctx.orbitEccentricityForSeed(seed),'same seed must reproduce eccentricity exactly');
}
const e=0.12;
for(const M of [0,0.3,1.4,Math.PI,5.8]){
  const o=ctx.orbitStateFromMeanAnomaly(1,e,M);
  const residual=o.eccentricAnomaly-e*Math.sin(o.eccentricAnomaly)-o.meanAnomaly;
  assert.ok(Math.abs(residual)<1e-9||Math.abs(Math.abs(residual)-2*Math.PI)<1e-9,'Kepler equation must converge');
}
const peri=ctx.orbitStateFromMeanAnomaly(1,e,0),apo=ctx.orbitStateFromMeanAnomaly(1,e,Math.PI);
assert.ok(Math.abs(peri.radiusAU-(1-e))<1e-10,'M=0 must be periapsis');
assert.ok(Math.abs(apo.radiusAU-(1+e))<1e-10,'M=pi must be apoapsis');
assert.ok(ctx.orbitInstantFluxEarth(1,1,e,0)>ctx.orbitInstantFluxEarth(1,1,e,Math.PI),'periapsis flux must exceed apoapsis flux');

Object.assign(ctx,{
  seasonOrbitalPeriodSec:()=>100,seasonSeedPhase:()=>0,seasonOrbitPhaseRad:()=>0,
  weatherCoreClimateSnapshot:()=>({S:1}),weatherCore:{simSeconds:0},
  seasonRefreshFields:core=>core,weatherCoreFinite:()=>true,refreshWeatherCoreDiagnostics:undefined,
  appendWeatherCoreRow:undefined
});
vm.runInContext(seasonSrc,ctx,{filename:'eccentric-seasons.js'});
let s=ctx.weatherCoreClimateSnapshot();
assert.ok(s.S>1,'periapsis Weather Core forcing must exceed semi-major-axis flux');
ctx.weatherCore.simSeconds=50;s=ctx.weatherCoreClimateSnapshot();
assert.ok(s.S<1,'apoapsis Weather Core forcing must fall below semi-major-axis flux');
assert.ok(Math.abs(ctx.seasonOrbitPhaseRad(1,0,{orbitalPeriodSec:100})-0)<1e-10,'periapsis true anomaly must start at zero');

assert.match(overlay,/eccentricSeasonState/,'mini-map must use the physical Kepler state');
assert.match(overlay,/focus=rotatePoint\(cx,cy,-rx\*d\.e/,'mini-map star must occupy an ellipse focus');
assert.match(scene,/orbitEccentricityForSeed/,'main HUD must use the same seeded eccentricity');
assert.match(scene,/const starScreen=\[planetScreen\[0\]-radius\*cur2\[0\]/,'main HUD focus must be derived from current Kepler position');
assert.match(scene,/drawNode\(s\[0\],s\[1\],5\.2,'rgba\(255,177,73,\.96\)'\)/,'sun marker must be drawn as an opaque focus over the orbit line');
console.log('orbit-eccentricity.test.js: OK');
