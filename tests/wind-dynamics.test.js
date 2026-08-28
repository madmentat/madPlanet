const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const weatherSrc=fs.readFileSync(path.join(root,'js/weather-core.js'),'utf8');
const energySrc=fs.readFileSync(path.join(root,'js/local-energy-balance.js'),'utf8');
const baricSrc=fs.readFileSync(path.join(root,'js/baric-field.js'),'utf8');
const windSrc=fs.readFileSync(path.join(root,'js/wind-dynamics.js'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+0\.5\.42\s*$/m,'wind dynamics milestone must be 0.5.42');
assert.ok(buildPs.includes("'js/local-energy-balance.js','js/baric-field.js','js/wind-dynamics.js','js/render.js'"),
  'PowerShell build must load wind dynamics after baric field and before render');
assert.ok(buildSh.includes('js/local-energy-balance.js js/baric-field.js js/wind-dynamics.js js/render.js'),
  'shell build must load wind dynamics after baric field and before render');

const state={seed:123,draft:true,sea:0.58,star:0.43,luminosity:0.43,tect:0.80};
const world={
  plateN:4,
  plateP:new Float32Array([
     1,0,0,0,
     0,0,1,0,
    -1,0,0,0,
     0,0,-1,0
  ]),
  plateW:new Float32Array([
    0, 0.45,0,0,
    0,-0.35,0,0,
    0, 0.30,0,0,
    0,-0.40,0,0
  ])
};
const ctx={console,Math,Number,Date,Float32Array,Int32Array,state,world};
vm.createContext(ctx);
vm.runInContext(weatherSrc,ctx,{filename:'weather-core.js'});
vm.runInContext(energySrc,ctx,{filename:'local-energy-balance.js'});
vm.runInContext(baricSrc,ctx,{filename:'baric-field.js'});
vm.runInContext(windSrc,ctx,{filename:'wind-dynamics.js'});

const axis=[0,1,0];
const climate={
  T:288.15,pressureBar:1.01325,h2oBar:0.004,cloudCov:0.45,iceArea:0.02,
  waterAvail:1,S:1,regime:'temperate',A:0.30,tau:0.76,
  globalASR:239,globalOLR:239,sea:0.58,iceAlbedo:0.62,
  meanMolarMassKg:0.02897,gravityMS2:9.80665,
  radiusM:6371000,rotationPeriodSec:86400
};
const core=ctx.weatherCoreCreate(12345,16,climate,axis);
assert.equal(core.windModel,1,'Weather Core must advertise wind dynamics model v1');
for(const k of ['windStateU','windStateV','pgfEast','pgfNorth','orographicRoughness','orographicBarrierE','orographicBarrierN']){
  assert.ok(core[k] instanceof Float32Array,k+' must be a persistent Float32Array');
  assert.equal(core[k].length,core.count,k+' length must match cell count');
}
assert.equal(core.windNeighbor.length,4,'wind stencil must have four tangent neighbours');
assert.ok(core.windNeighbor.every(a=>a instanceof Int32Array),'wind neighbour stencil must use compact integer arrays');
assert.ok(ctx.weatherCoreFinite(core),'wind-extended Weather Core must start finite');

/* A cube-face edge must point into an adjacent face rather than stopping at
   the storage seam. */
const N=core.N,edge=Math.floor(N/2)*N+(N-1);
const edgeFace=Math.floor(edge/(N*N));
assert.ok(core.windNeighbor.some(a=>Math.floor(a[edge]/(N*N))!==edgeFace),
  'pressure stencil must cross cubed-sphere face seams');

/* Construct a clean eastward pressure gradient around one interior cell. */
const i=Math.floor(N/2)*N+Math.floor(N/2);
const p0=101325;
for(let q=0;q<core.count;q++) core.pressure[q]=p0;
let kp=0,kn=0;
for(let k=1;k<4;k++){
  if(core.windGradE[k][i]>core.windGradE[kp][i])kp=k;
  if(core.windGradE[k][i]<core.windGradE[kn][i])kn=k;
}
core.pressure[core.windNeighbor[kp][i]]=p0+2500;
core.pressure[core.windNeighbor[kn][i]]=p0-2500;
const grad={e:0,n:0};ctx.windPressureGradient(core,i,grad);
assert.ok(grad.e>0,'synthetic eastward pressure increase must yield a positive east pressure gradient');
assert.ok(-grad.e/Math.max(1e-5,core.airDensity[i])<0,
  'pressure-gradient acceleration must point from high pressure toward low pressure');

/* Coriolis is a pure rotation: northward flow bends east in the northern
   hemisphere and west in the southern hemisphere without changing speed. */
const north={},south={};
ctx.windApplyCoriolis(0,10,1e-4,300,north);
ctx.windApplyCoriolis(0,10,-1e-4,300,south);
assert.ok(north.u>0&&south.u<0,'Coriolis sign must reverse between hemispheres');
assert.ok(Math.abs(Math.hypot(north.u,north.v)-10)<1e-10,
  'exact Coriolis rotation must not create kinetic energy');

/* Restore the physical baric field and let it drive momentum. */
ctx.baricComputeTargets(core,climate);
for(let q=0;q<core.count;q++){
  core.pressureState[q]=core.pressureTarget[q];core.pressure[q]=core.pressureState[q];
  core.windStateU[q]=core.windStateV[q]=core.windU[q]=core.windV[q]=0;
}
ctx.baricRefreshDerived(core,climate);
for(let t=0;t<8;t++)ctx.weatherCoreStep(core,300,climate,axis);
const wd=ctx.windDiagnostics(core);
assert.ok(wd.mean>0.01&&wd.max>wd.mean,'real baric gradients must generate a non-zero spatial wind field');
assert.ok(wd.max<500,'wind field must remain numerically bounded below the stability cap');
assert.ok(ctx.weatherCoreFinite(core),'stepped wind Weather Core must remain finite');

/* Orographic resistance is tied to tectonic plate geometry and disappears
   when tectonic relief is disabled. */
let roughMax=0;for(const r of core.orographicRoughness)if(r>roughMax)roughMax=r;
assert.ok(roughMax>0.01,'plate boundaries with tectonics must create local orographic resistance');
state.tect=0;ctx.windRefreshOrography(core,axis);
roughMax=0;for(const r of core.orographicRoughness)if(r>roughMax)roughMax=r;
assert.equal(roughMax,0,'zero tectonic relief must remove the orographic drag proxy');

assert.ok(windSrc.includes('windStateU=new Float32Array(core.count)'),
  'physical momentum must be isolated from the old compatibility wind damping');
assert.ok(windSrc.includes('world.plateP')&&windSrc.includes('world.plateW'),
  'orographic drag must use the same tectonic plate geometry as visible terrain');
assert.ok(!windSrc.includes('requestAnimationFrame'),'wind dynamics must stay on the fixed slow Weather Core clock');

console.log('wind-dynamics.test.js: OK');
