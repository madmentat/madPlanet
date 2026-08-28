const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['weather-core.js','orographic-lift.js','local-energy-balance.js','baric-field.js','wind-dynamics.js','h2o-advection.js','condensation.js','precipitation.js','soil-hydrology.js','weather-fronts.js','pressure-systems.js','vertical-stability.js'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'js',f),'utf8')]));
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'pressure-system test must see a semantic version');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/weather-fronts.js','js/pressure-systems.js','js/vertical-stability.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell system order');
assertOrdered(buildSh,order,'shell system order');

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.72,star:0.43,luminosity:0.43};
const world={seedS:[2.3,-4.1,7.7],plateN:4,
  plateP:new Float32Array([1,0,0,0,0,0,1,0,-1,0,0,0,0,0,-1,0]),
  plateW:new Float32Array([0,.45,0,0,0,-.35,0,0,0,.30,0,0,0,-.40,0,0])};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,Int8Array,state,world};
vm.createContext(ctx);for(const f of files)vm.runInContext(src[f],ctx,{filename:f});
const axis=[0,1,0];
const climate={T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:.45,iceArea:.02,waterAvail:1,S:1,regime:'temperate',A:.30,tau:.76,globalASR:239,globalOLR:239,sea:.58,iceAlbedo:.62,meanMolarMassKg:.02897,gravityMS2:9.80665,radiusM:6371000,rotationPeriodSec:86400};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);
assert.equal(core.pressureSystemsModel,1);
for(const k of ['relativeVorticity1e5','cyclonicVorticity1e5','pressureCoreHpa','cycloneStrength','anticycloneStrength','systemStrength','systemVerticalVelocity','systemDivergence1e5','systemLatitudeGate']){
  assert.ok(core[k] instanceof Float32Array,k);assert.equal(core[k].length,core.count,k+' length');
}
assert.ok(core.systemType instanceof Int8Array);assert.ok(ctx.weatherCoreFinite(core));

function dot3(ax,ay,az,bx,by,bz){return ax*bx+ay*by+az*bz;}
function setNeighbourWindInCenterBasis(i,j,ue,vn){
  const wx=ue*core.frontEastX[i]+vn*core.frontNorthX[i];
  const wy=ue*core.frontEastY[i]+vn*core.frontNorthY[i];
  const wz=ue*core.frontEastZ[i]+vn*core.frontNorthZ[i];
  core.windStateU[j]=core.windU[j]=dot3(wx,wy,wz,core.frontEastX[j],core.frontEastY[j],core.frontEastZ[j]);
  core.windStateV[j]=core.windV[j]=dot3(wx,wy,wz,core.frontNorthX[j],core.frontNorthY[j],core.frontNorthZ[j]);
}
function controlledVortex(i,amp,centerP,neighbourP){
  core.pressure.fill(101325);core.windStateU.fill(0);core.windStateV.fill(0);core.windU.fill(0);core.windV.fill(0);core.frontStrength.fill(0);
  core.pressure[i]=centerP;
  for(let k=0;k<4;k++){
    const j=core.windNeighbor[k][i];core.pressure[j]=neighbourP;
    const de=Math.sign(core.windGradE[k][i]),dn=Math.sign(core.windGradN[k][i]);
    setNeighbourWindInCenterBasis(i,j,-amp*dn,amp*de);
  }
}
function findLat(lo,hi){
  for(let i=0;i<core.count;i++){const s=core.dirY[i];if(s>lo&&s<hi)return i;}
  return -1;
}
const north=findLat(0.38,0.75);assert.ok(north>=0,'test grid needs a northern mid-latitude cell');

/* Northern low + positive relative vorticity => cyclone. */
controlledVortex(north,34,100300,101500);core.frontStrength[north]=0.45;
ctx.systemRefresh(core,climate,axis);
assert.ok(core.relativeVorticity1e5[north]>0.05,'controlled vortex must have positive NH relative vorticity');
assert.ok(core.pressureCoreHpa[north]>0,'lower centre pressure must diagnose a low core');
assert.equal(core.systemType[north],1,'NH low with cyclonic spin must diagnose a cyclone');
assert.ok(core.cycloneStrength[north]>0.08&&core.systemVerticalVelocity[north]>0,'cyclone must produce bounded ascent');

/* Same location, high pressure and opposite spin => anticyclone. */
controlledVortex(north,-34,102300,101100);
ctx.systemRefresh(core,climate,axis);
assert.ok(core.cyclonicVorticity1e5[north]<-0.05,'opposite spin must be anticyclonic in NH');
assert.ok(core.pressureCoreHpa[north]<0,'higher centre pressure must diagnose a high core');
assert.equal(core.systemType[north],2,'NH high with anticyclonic spin must diagnose an anticyclone');
assert.ok(core.anticycloneStrength[north]>0.08&&core.systemVerticalVelocity[north]<0,'anticyclone must produce subsidence');

/* Near the equator Coriolis-sign classification must fade even for an
   artificially strong pressure/vorticity pattern. */
let equator=-1,best=99;for(let i=0;i<core.count;i++){const a=Math.abs(core.dirY[i]);if(a<best){best=a;equator=i;}}
controlledVortex(equator,50,99500,102000);ctx.systemRefresh(core,climate,axis);
assert.ok(core.systemLatitudeGate[equator]<0.25,'equatorial latitude gate must strongly suppress system classification');
assert.ok(core.systemStrength[equator]<0.25,'equatorial synthetic vortex must not become a full synoptic cyclone');

/* Vertical coupling: cyclone ascent deepens cloud diagnosis; anticyclonic
   subsidence stabilises and shallows the same thermodynamic column. */
const q=north;
core.surfaceTemp[q]=300;core.airTemp[q]=293;core.relativeHumidity[q]=0.92;core.cloudWaterState[q]=1.0;core.scaleHeight[q]=8400;core.pressure[q]=101325;
core.orographicVerticalVelocity[q]=0;core.frontVerticalVelocity[q]=0;
core.systemVerticalVelocity[q]=0;ctx.verticalRefresh(core,climate);const neutralTop=core.cloudTopHeightM[q],neutralConv=core.convectiveIndex[q],neutralStab=core.bulkStabilityIndex[q];
core.systemVerticalVelocity[q]=1.0;ctx.verticalRefresh(core,climate);const cycloneTop=core.cloudTopHeightM[q],cycloneConv=core.convectiveIndex[q];
core.systemVerticalVelocity[q]=-0.55;ctx.verticalRefresh(core,climate);const antiTop=core.cloudTopHeightM[q],antiConv=core.convectiveIndex[q],antiStab=core.bulkStabilityIndex[q];
assert.ok(cycloneTop>neutralTop+100&&cycloneConv>=neutralConv,'cyclone ascent must deepen the cloud column');
assert.ok(antiTop<neutralTop-100&&antiConv<neutralConv&&antiStab>neutralStab,'anticyclone subsidence must stabilise and shallow the column');

/* System diagnosis itself must not mutate the conserved thermodynamic state. */
const beforeT=Array.from(core.airTemp),beforeP=Array.from(core.pressure),beforeV=Array.from(core.vaporColumn),beforeC=Array.from(core.cloudWaterState),beforeU=Array.from(core.windStateU),beforeW=Array.from(core.windStateV);
ctx.systemRefresh(core,climate,axis);
assert.deepEqual(Array.from(core.airTemp),beforeT);assert.deepEqual(Array.from(core.pressure),beforeP);
assert.deepEqual(Array.from(core.vaporColumn),beforeV);assert.deepEqual(Array.from(core.cloudWaterState),beforeC);
assert.deepEqual(Array.from(core.windStateU),beforeU);assert.deepEqual(Array.from(core.windStateV),beforeW);

const live=ctx.weatherCoreCreate(77,12,climate,axis);for(let n=0;n<16;n++)ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live),'coupled pressure-system ticks must remain finite');
assert.ok(src['pressure-systems.js'].includes('systemRelativeVorticity')&&src['pressure-systems.js'].includes('pressureCoreHpa'),'systems must derive from vorticity and pressure extrema');
assert.ok(src['pressure-systems.js'].includes('frontWindDivergence')&&src['pressure-systems.js'].includes('systemLatitudeGate'),'systems must use resolved dynamics and hemisphere gate');
assert.ok(!src['pressure-systems.js'].includes('Math.random'),'physical pressure systems must not use random centres');
assert.ok(!src['pressure-systems.js'].includes('requestAnimationFrame'),'pressure systems must stay on fixed Weather Core clock');
console.log('pressure-systems.test.js: OK');
