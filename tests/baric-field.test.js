const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const weatherSrc=fs.readFileSync(path.join(root,'js/weather-core.js'),'utf8');
const energySrc=fs.readFileSync(path.join(root,'js/local-energy-balance.js'),'utf8');
const baricSrc=fs.readFileSync(path.join(root,'js/baric-field.js'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'baric test must see a semantic version');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/weather-core.js','js/local-energy-balance.js','js/baric-field.js','js/wind-dynamics.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell baric/wind order');
assertOrdered(buildSh,order,'shell baric/wind order');

const state={seed:123,draft:true,sea:0.58,star:0.43,luminosity:0.43};
const ctx={console,Math,Number,Date,Float32Array,state};
vm.createContext(ctx);
vm.runInContext(weatherSrc,ctx,{filename:'weather-core.js'});
vm.runInContext(energySrc,ctx,{filename:'local-energy-balance.js'});
vm.runInContext(baricSrc,ctx,{filename:'baric-field.js'});

const axis=[0,1,0];
const climate={
  T:288.15,pressureBar:1.01325,h2oBar:0.004,cloudCov:0.45,iceArea:0.02,
  waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,
  globalASR:239,globalOLR:239,sea:0.58,iceAlbedo:0.62,
  meanMolarMassKg:0.02897,gravityMS2:9.80665
};
const core=ctx.weatherCoreCreate(12345,32,climate,axis);
assert.equal(core.baricModel,1,'Weather Core must advertise baric model v1');
for(const k of ['pressureTarget','pressureState','pressureAnomaly','airDensity','scaleHeight']){
  assert.ok(core[k] instanceof Float32Array,k+' must be a persistent Float32Array');
  assert.equal(core[k].length,core.count,k+' length must match cell count');
}
assert.ok(ctx.weatherCoreFinite(core),'baric Weather Core must contain no NaN/Infinity');

let warm=0,cold=0;
for(let i=1;i<core.count;i++){
  if(core.airTemp[i]>core.airTemp[warm]) warm=i;
  if(core.airTemp[i]<core.airTemp[cold]) cold=i;
}
assert.ok(core.airTemp[warm]>core.airTemp[cold]+20,'test grid must contain a meaningful thermal contrast');
assert.ok(core.pressureTarget[warm]<core.pressureTarget[cold],
  'warm columns must diagnose a relative thermal low versus cold columns');
assert.ok(core.pressureAnomaly[warm]<0&&core.pressureAnomaly[cold]>0,
  'initialized baric field must contain both lows and highs');
assert.ok(core.airDensity[warm]<core.airDensity[cold],
  'warm low-pressure air must be less dense than cold high-pressure air');
assert.ok(core.scaleHeight[warm]>core.scaleHeight[cold],
  'warmer columns must have a larger hydrostatic scale height');

const mean0=ctx.baricAreaMean(core,core.pressure);
assert.ok(Math.abs(mean0-climate.pressureBar*1e5)<0.5,
  'area-weighted mean pressure must equal the real global atmospheric column');

for(let i=0;i<core.count;i++) core.pressureState[i]*=(i%2)?0.82:1.18;
ctx.weatherCoreStep(core,300,climate,axis);
const mean1=ctx.baricAreaMean(core,core.pressure);
assert.ok(Math.abs(mean1-climate.pressureBar*1e5)<0.5,
  'baric step must remove numerical/global mass drift exactly');
assert.ok(ctx.baricDiagnostics(core).maxAnom>0&&ctx.baricDiagnostics(core).minAnom<0,
  'baric relaxation must retain spatial pressure structure');

const doubleP={...climate,pressureBar:2.0265};
ctx.weatherCoreStep(core,300,doubleP,axis);
assert.ok(Math.abs(ctx.baricAreaMean(core,core.pressure)-doubleP.pressureBar*1e5)<1,
  'changing real total gas pressure must rescale the global baric field immediately');
assert.ok(core.pressure[warm]>0&&core.airDensity[warm]>0,'pressure and density must remain positive');
assert.ok(ctx.weatherCoreFinite(core),'stepped baric Weather Core must remain finite');

assert.ok(baricSrc.includes('Surface pressure is column mass * gravity'),
  'module must document why temperature cannot directly create surface pressure');
assert.ok(baricSrc.includes('pressureState=new Float32Array(core.count)'),
  'baric dynamics must own persistent pressure state instead of fighting the old scaffold');
assert.ok(!baricSrc.includes('requestAnimationFrame'),'baric dynamics must stay on the slow Weather Core clock');

console.log('baric-field.test.js: OK');
