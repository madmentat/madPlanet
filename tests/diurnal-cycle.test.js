const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const weatherSrc=read('js/weather-core.js');
const energySrc=read('js/local-energy-balance.js');
const diurnalSrc=read('js/diurnal-cycle.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');
const version=read('VERSION.txt');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=57),'diurnal cycle requires 0.5.57+');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/local-energy-balance.js','js/diurnal-cycle.js','js/baric-field.js'],'shell diurnal order');
ordered(buildPs,['js/local-energy-balance.js','js/diurnal-cycle.js','js/baric-field.js'],'PowerShell diurnal order');
assert.ok(!/uSunDir|requestAnimationFrame|Math\.random/.test(diurnalSrc),'physical sun must not depend on renderer/random/FPS');
assert.match(diurnalSrc,/planetPhysics\(\)/,'rotation period must come from physical planet state');
assert.match(diurnalSrc,/equinox-only milestone/,'0.5.57 must not silently implement seasons');

const state={seed:1234,draft:true,sea:0.58,star:0.43,luminosity:0.43};
const ctx={
  console,Math,Number,Date,Float32Array,state,
  planetPhysics:()=>({rotationHours:24}),
  climateModel:()=>({T:288.15,pressureBar:1.013,partialPressures:{h2o:0.004},cloudCov:0.45,iceArea:0.02,waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,ASR:239,OLR:239}),
};
vm.createContext(ctx);
vm.runInContext(weatherSrc,ctx,{filename:'weather-core.js'});
vm.runInContext(energySrc,ctx,{filename:'local-energy-balance.js'});
vm.runInContext(diurnalSrc,ctx,{filename:'diurnal-cycle.js'});

const axis=[0,1,0];
const climate={
  T:288.15,pressureBar:1.013,h2oBar:0.004,cloudCov:0.45,iceArea:0.02,
  waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,
  globalASR:239,globalOLR:239,sea:0.58,iceAlbedo:0.62,rotationPeriodSec:86400
};
const core=ctx.weatherCoreCreate(24680,32,climate,axis);
assert.equal(core.diurnalCycleModel,1);
assert.equal(core.rotationPeriodSec,86400);
for(const k of ['solarZenithCos','daylightFactor','localSolarTimeHours']){
  assert.ok(core[k] instanceof Float32Array,k+' must be persistent Float32Array');
  assert.equal(core[k].length,core.count);
}
assert.ok(ctx.weatherCoreFinite(core));

let noon=-1,midnight=-1,maxMu=-2,minMu=2;
for(let i=0;i<core.count;i++){
  const mu=core.solarZenithCos[i];
  if(mu>maxMu){maxMu=mu;noon=i;}
  if(mu<minMu){minMu=mu;midnight=i;}
}
assert.ok(maxMu>0.98&&minMu<-0.98,'cubed sphere must contain near-noon and near-midnight cells');
assert.ok(core.insolation[noon]>1300,'near-subsolar cell must receive near-normal stellar flux');
assert.ok(core.insolation[midnight]<1e-6,'night side must receive zero direct shortwave');

let ws=0,ins=0,day=0;
for(let i=0;i<core.count;i++){
  const w=core.areaWeight[i];ws+=w;ins+=w*core.insolation[i];if(core.solarZenithCos[i]>0)day+=w;
}
assert.ok(Math.abs(ins/ws-1361/4)<3.0,'instantaneous sphere mean must remain near solar constant / 4');
assert.ok(Math.abs(day/ws-0.5)<0.02,'equinox day side must cover half the sphere');

const sun0=[0,0,0],sunQ=[0,0,0],sunHalf=[0,0,0];
ctx.diurnalSunDirection(axis,24680,0,climate,sun0);
ctx.diurnalSunDirection(axis,24680,21600,climate,sunQ);
ctx.diurnalSunDirection(axis,24680,43200,climate,sunHalf);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
assert.ok(Math.abs(dot(sun0,sunQ))<1e-9,'quarter rotation must move subsolar point by 90 degrees');
assert.ok(dot(sun0,sunHalf)<-0.999999,'half rotation must swap noon and midnight');
assert.ok(Math.abs(dot(sun0,axis))<1e-12,'equinox sun direction must be perpendicular to spin axis');

/* One fixed tick: day cell receives positive SW while night loses heat only by
   OLR, so their thermal tendencies must diverge immediately. */
const tDay=core.surfaceTemp[noon],tNight=core.surfaceTemp[midnight];
ctx.weatherCoreStep(core,300,climate,axis);
const dDay=core.surfaceTemp[noon]-tDay,dNight=core.surfaceTemp[midnight]-tNight;
assert.ok(dDay>dNight,'daytime surface tendency must exceed nighttime tendency');
assert.ok(core.insolation[midnight]<1e-6,'midnight cell must remain dark over one short tick');

/* A very slow rotator must use its true physical period, not hard-coded Earth day. */
ctx.planetPhysics=()=>({rotationHours:2400});
assert.equal(ctx.diurnalRotationPeriodSec({}),2400*3600);
const slow0=[0,0,0],slowDay=[0,0,0];
ctx.diurnalSunDirection(axis,11,0,{},slow0);ctx.diurnalSunDirection(axis,11,86400,{},slowDay);
assert.ok(dot(slow0,slowDay)>0.998,'one Earth day must barely move the sun on a 100-day rotator');

console.log('diurnal-cycle.test.js: OK');
