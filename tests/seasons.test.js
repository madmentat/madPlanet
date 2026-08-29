const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const weatherSrc=read('js/weather-core.js');
const energySrc=read('js/local-energy-balance.js');
const diurnalSrc=read('js/diurnal-cycle.js');
const seasonSrc=read('js/seasons.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');
const version=read('VERSION.txt');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=58),'seasons require 0.5.58+');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/local-energy-balance.js','js/diurnal-cycle.js','js/seasons.js','js/baric-field.js'],'shell seasons order');
ordered(buildPs,['js/local-energy-balance.js','js/diurnal-cycle.js','js/seasons.js','js/baric-field.js'],'PowerShell seasons order');
assert.ok(!/uSunDir|requestAnimationFrame|Math\.random/.test(seasonSrc),'seasons must stay independent of renderer/random/FPS');
assert.match(seasonSrc,/starPhysics\(/,'year length must use resolved stellar mass');
assert.match(seasonSrc,/orbitDistanceAU\(/,'year length must use resolved orbital distance');
assert.match(seasonSrc,/planetPhysics\(\)/,'axial tilt must come from physical planet state');

const state={seed:4321,draft:true,sea:0.58,star:0.43,luminosity:0.43,distance:0.51};
let tilt=23.44,rotationHours=24,starMass=1,orbitAU=1;
const ctx={
  console,Math,Number,Date,Float32Array,state,
  planetPhysics:()=>({rotationHours,axialTiltDeg:tilt}),
  starPhysics:()=>({M:starMass}),
  orbitDistanceAU:()=>orbitAU,
  climateModel:()=>({T:288.15,pressureBar:1.013,partialPressures:{h2o:0.004},cloudCov:0.45,iceArea:0.02,waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,ASR:239,OLR:239}),
};
vm.createContext(ctx);
vm.runInContext(weatherSrc,ctx,{filename:'weather-core.js'});
vm.runInContext(energySrc,ctx,{filename:'local-energy-balance.js'});
vm.runInContext(diurnalSrc,ctx,{filename:'diurnal-cycle.js'});
vm.runInContext(seasonSrc,ctx,{filename:'seasons.js'});

const axis=[0,1,0];
const climate={T:288.15,pressureBar:1.013,h2oBar:0.004,cloudCov:0.45,iceArea:0.02,waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,globalASR:239,globalOLR:239,sea:0.58,iceAlbedo:0.62,rotationPeriodSec:86400};
const year=ctx.seasonOrbitalPeriodSec({});
assert.ok(Math.abs(year/86400-365.2568983)<1e-6,'1 AU around 1 solar mass must give Earth-like year');

assert.ok(Math.abs(ctx.seasonDeclinationRadForPhase(0,23.44))<1e-12,'equinox declination must be zero');
assert.ok(Math.abs(ctx.seasonDeclinationRadForPhase(Math.PI/2,23.44)*180/Math.PI-23.44)<1e-10,'northern solstice must reach +tilt');
assert.ok(Math.abs(ctx.seasonDeclinationRadForPhase(3*Math.PI/2,23.44)*180/Math.PI+23.44)<1e-10,'southern solstice must reach -tilt');
assert.equal(ctx.seasonDayLengthHours(70*Math.PI/180,23.44*Math.PI/180),24,'70N must have polar day near northern solstice');
assert.equal(ctx.seasonDayLengthHours(-70*Math.PI/180,23.44*Math.PI/180),0,'70S must have polar night near northern solstice');
assert.ok(Math.abs(ctx.seasonDayLengthHours(0,23.44*Math.PI/180)-12)<1e-12,'equator keeps 12-hour day on circular orbit');

/* Find the model time at which this deterministic seed reaches northern solstice. */
const seed=24680;
const p0=ctx.seasonSeedPhase(seed);
let dPhase=(Math.PI/2-p0)%(2*Math.PI);if(dPhase<0)dPhase+=2*Math.PI;
const tSol=dPhase/(2*Math.PI)*year;
const decSol=ctx.seasonSolarDeclinationRad(seed,tSol,{});
const decOpp=ctx.seasonSolarDeclinationRad(seed,tSol+year/2,{});
assert.ok(Math.abs(decSol*180/Math.PI-23.44)<1e-8,'resolved sun must reach northern solstice');
assert.ok(Math.abs(decOpp*180/Math.PI+23.44)<1e-8,'half a year later declination must flip sign');

const sun=[0,0,0];ctx.diurnalSunDirection(axis,seed,tSol,climate,sun);
assert.ok(Math.abs(sun[1]-Math.sin(23.44*Math.PI/180))<1e-8,'tilted sun must have the correct spin-axis component');

const core=ctx.weatherCoreCreate(seed,32,climate,axis);
assert.equal(core.seasonsModel,1);
assert.ok(core.dayLengthHours instanceof Float32Array&&core.dayLengthHours.length===core.count);
assert.ok(ctx.weatherCoreFinite(core));

/* Any unit sun direction over a sphere has global instantaneous mean max(mu,0)=1/4. */
let ws=0,mu=0;
for(let i=0;i<core.count;i++){
  const w=core.areaWeight[i];ws+=w;
  mu+=w*Math.max(0,core.dirX[i]*sun[0]+core.dirY[i]*sun[1]+core.dirZ[i]*sun[2]);
}
assert.ok(Math.abs(mu/ws-0.25)<0.003,'tilted solstice must preserve sphere-mean S/4 geometry');

/* Zero obliquity must remove seasons entirely at every orbital phase. */
tilt=0;
for(const q of [0,0.2,0.5,0.73,0.99]){
  assert.ok(Math.abs(ctx.seasonDeclinationRadForPhase(q*2*Math.PI,tilt))<1e-12);
}

/* Kepler scaling: farther orbit lengthens year, larger stellar mass shortens it. */
tilt=23.44;orbitAU=2;starMass=1;
const y2=ctx.seasonOrbitalPeriodSec({});
assert.ok(Math.abs(y2/year-Math.sqrt(8))<1e-10,'2 AU year must scale as sqrt(a^3)');
orbitAU=1;starMass=4;
const yMassive=ctx.seasonOrbitalPeriodSec({});
assert.ok(Math.abs(yMassive/year-0.5)<1e-10,'4-solar-mass star must halve period at fixed a');

console.log('seasons.test.js: OK');
