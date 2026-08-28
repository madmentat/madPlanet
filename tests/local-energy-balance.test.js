const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const weatherSrc=fs.readFileSync(path.join(root,'js/weather-core.js'),'utf8');
const energySrc=fs.readFileSync(path.join(root,'js/local-energy-balance.js'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'local energy test must see a semantic version');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/weather-core.js','js/local-energy-balance.js','js/baric-field.js','js/wind-dynamics.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell energy/baric/wind order');
assertOrdered(buildSh,order,'shell energy/baric/wind order');

const state={seed:8127344,draft:true,sea:0.58,star:0.43,luminosity:0.43};
const ctx={console,Math,Number,Date,Float32Array,state};
vm.createContext(ctx);
vm.runInContext(weatherSrc,ctx,{filename:'weather-core.js'});
vm.runInContext(energySrc,ctx,{filename:'local-energy-balance.js'});

const axis=[0,1,0];
const climate={
  T:288.15,pressureBar:1.013,h2oBar:0.004,cloudCov:0.45,iceArea:0.02,
  waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,
  globalASR:239,globalOLR:239,sea:0.58,iceAlbedo:0.62
};
const core=ctx.weatherCoreCreate(12345,32,climate,axis);
assert.equal(core.energyModel,1,'Weather Core must advertise the local-energy model');
for(const k of ['areaWeight','insolation','localAlbedo','absorbedSolar','outgoingLongwave','netRadiation']){
  assert.ok(core[k] instanceof Float32Array,k+' must be a persistent Float32Array');
  assert.equal(core[k].length,core.count,k+' length must match cubed-sphere cells');
}
assert.ok(ctx.weatherCoreFinite(core),'energy-extended Weather Core must contain no NaN/Infinity');

let equator=0,polar=0,maxMu=-1,minMu=2;
for(let i=0;i<core.count;i++){
  const mu=ctx.localEnergyDailyMeanCosine(core.dirX[i],core.dirY[i],core.dirZ[i],axis);
  if(mu>maxMu){maxMu=mu;equator=i;}
  if(mu<minMu){minMu=mu;polar=i;}
}
assert.ok(core.insolation[equator]>core.insolation[polar]*8,
  'daily-mean equatorial insolation must greatly exceed near-polar insolation');

let wi=0,ws=0;
for(let i=0;i<core.count;i++){wi+=core.areaWeight[i]*core.insolation[i];ws+=core.areaWeight[i];}
const meanInsolation=wi/ws;
assert.ok(Math.abs(meanInsolation-1361/4)<2.0,
  'area-weighted global mean insolation must stay near solar constant / 4');

assert.ok(ctx.localEnergyCellAlbedo(245,0.2,climate)>ctx.localEnergyCellAlbedo(295,0.2,climate)+0.2,
  'cold wet cells must brighten through local ice-albedo feedback');

const f={insolation:0,albedo:0,absorbed:0,olr:0,net:0};
ctx.localEnergyFluxes(288,0.2,core.dirX[equator],core.dirY[equator],core.dirZ[equator],axis,climate,f);
assert.ok(f.absorbed>0&&f.olr>0&&Number.isFinite(f.net),'cell radiative terms must be explicit and finite');

const low={...climate,S:0.65};
const high={...climate,S:1.35};
const a=ctx.weatherCoreCreate(77,16,low,axis);
const b=ctx.weatherCoreCreate(77,16,high,axis);
const Ta=a.surfaceTemp[equator%a.count], Tb=b.surfaceTemp[equator%b.count];
ctx.weatherCoreStep(a,300,low,axis);
ctx.weatherCoreStep(b,300,high,axis);
assert.ok(b.netRadiation[equator%b.count]>a.netRadiation[equator%a.count],
  'higher stellar flux must produce a larger local net radiative forcing');
assert.ok(b.surfaceTemp[equator%b.count]-Tb>a.surfaceTemp[equator%a.count]-Ta,
  'surface temperature tendency must follow the local energy budget');

const d=ctx.localEnergyDiagnostics(core);
assert.ok(Number.isFinite(d.asr)&&Number.isFinite(d.olr)&&Number.isFinite(d.net));
assert.ok(d.maxT>d.minT,'local energy grid must preserve a real spatial temperature range');

assert.ok(!energySrc.includes('sunDir'),'view-light rotation must not drive physical climate');
assert.ok(!energySrc.includes('requestAnimationFrame'),'local energy must stay on the slow Weather Core clock');
assert.ok(energySrc.includes('LOCAL_ENERGY_LAND_HEAT_CAPACITY')&&energySrc.includes('LOCAL_ENERGY_OCEAN_HEAT_CAPACITY'),
  'temperature tendency must be limited by explicit effective heat capacity');
assert.ok(energySrc.includes('areaWeight=new Float32Array(core.count)'),
  'cubed-sphere area weights must be persistent, not allocated per tick');

console.log('local-energy-balance.test.js: OK');
