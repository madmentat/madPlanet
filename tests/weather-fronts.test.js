const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['weather-core.js','orographic-lift.js','local-energy-balance.js','baric-field.js','wind-dynamics.js','h2o-advection.js','condensation.js','precipitation.js','soil-hydrology.js','weather-fronts.js','vertical-stability.js'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'js',f),'utf8')]));
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'front test must see a semantic version');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/soil-hydrology.js','js/weather-fronts.js','js/vertical-stability.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell front order');
assertOrdered(buildSh,order,'shell front order');

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.72,star:0.43,luminosity:0.43};
const world={seedS:[2.3,-4.1,7.7],plateN:4,
  plateP:new Float32Array([1,0,0,0,0,0,1,0,-1,0,0,0,0,0,-1,0]),
  plateW:new Float32Array([0,.45,0,0,0,-.35,0,0,0,.30,0,0,0,-.40,0,0])};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,Int8Array,state,world};
vm.createContext(ctx);for(const f of files)vm.runInContext(src[f],ctx,{filename:f});
const axis=[0,1,0];
const climate={T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:.45,iceArea:.02,waterAvail:1,S:1,regime:'temperate',A:.30,tau:.76,globalASR:239,globalOLR:239,sea:.58,iceAlbedo:.62,meanMolarMassKg:.02897,gravityMS2:9.80665,radiusM:6371000,rotationPeriodSec:86400};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);
assert.equal(core.frontsModel,1);
for(const k of ['frontTempGradientK100km','frontHumidityGradient100km','frontPressureGradientHpa100km','frontConvergence1e5','frontThermalAdvectionKHour','frontStrength','frontNormalE','frontNormalN','frontTangentE','frontTangentN','frontVerticalVelocity']){
  assert.ok(core[k] instanceof Float32Array,k);assert.equal(core[k].length,core.count,k+' length');
}
assert.ok(core.frontType instanceof Int8Array);assert.ok(ctx.weatherCoreFinite(core));

const i=Math.floor(core.N/2)*core.N+Math.floor(core.N/2);
function prepareThermalBoundary(localU){
  core.airTemp.fill(290);core.relativeHumidity.fill(0.50);core.pressure.fill(101325);
  core.windStateU.fill(0);core.windStateV.fill(0);core.windU.fill(0);core.windV.fill(0);
  core.windStateU[i]=core.windU[i]=localU;
  for(let k=0;k<4;k++){
    const j=core.windNeighbor[k][i];
    const se=Math.sign(core.windGradE[k][i]),sn=Math.sign(core.windGradN[k][i]);
    const thermalSign=se||sn||1;
    core.airTemp[j]=290+35*thermalSign;
    core.relativeHumidity[j]=Math.max(0.05,Math.min(0.95,0.50+0.25*thermalSign));
    core.pressure[j]=101325+700*thermalSign;
    core.windStateU[j]=core.windU[j]=localU-20*se;
    core.windStateV[j]=core.windV[j]=-20*sn;
  }
}

/* A broad thermal contrast alone is not enough: with no convergence or
   cross-front wind it must not mark an endless planetary front. */
prepareThermalBoundary(0);
core.windStateU.fill(0);core.windStateV.fill(0);core.windU.fill(0);core.windV.fill(0);
ctx.frontRefresh(core,climate);
assert.ok(core.frontTempGradientK100km[i]>0.1,'controlled boundary must have a thermal gradient');
assert.ok(core.frontStrength[i]<1e-6&&core.frontType[i]===0,'thermal gradient without dynamics must not become a front');

/* Cold advection through the same convergent boundary diagnoses a cold front. */
prepareThermalBoundary(14);ctx.frontRefresh(core,climate);
assert.ok(core.frontConvergence1e5[i]>0,'convergent winds must produce positive convergence diagnostic');
assert.ok(core.frontStrength[i]>0.08,'convergent thermal boundary must become a resolved front');
assert.equal(core.frontType[i],1,'negative thermal advection must diagnose a cold front');
assert.ok(core.frontThermalAdvectionKHour[i]<0);
assert.ok(core.frontVerticalVelocity[i]>0,'resolved front must create bounded frontal ascent');

/* Reverse cross-front flow: same boundary becomes a warm front. */
prepareThermalBoundary(-14);ctx.frontRefresh(core,climate);
assert.equal(core.frontType[i],2,'positive thermal advection must diagnose a warm front');
assert.ok(core.frontThermalAdvectionKHour[i]>0);

/* Strong convergence with negligible cross-front thermal advection is a
   stationary front, not an invented warm/cold sign. */
prepareThermalBoundary(0);ctx.frontRefresh(core,climate);
assert.ok(core.frontStrength[i]>0.08);assert.equal(core.frontType[i],3,'near-zero advection must diagnose stationary front');

/* Frontal ascent feeds the already-existing vertical column model, but does
   not itself modify temperature or condensate. */
core.relativeHumidity[i]=0.92;core.surfaceTemp[i]=294;core.airTemp[i]=291;core.cloudWaterState[i]=0.8;core.scaleHeight[i]=8400;
const frontLift=core.frontVerticalVelocity[i];
ctx.verticalRefresh(core,climate);const liftedTop=core.cloudTopHeightM[i],liftedConv=core.convectiveIndex[i];
core.frontVerticalVelocity[i]=0;ctx.verticalRefresh(core,climate);const baseTop=core.cloudTopHeightM[i],baseConv=core.convectiveIndex[i];
assert.ok(frontLift>0&&liftedTop>baseTop+50,'front lift must deepen the diagnosed cloud column');
assert.ok(liftedConv>=baseConv,'front lift must not reduce convective potential');
core.frontVerticalVelocity[i]=frontLift;

/* frontRefresh is diagnostic/forcing-only: it must not mutate the conserved
   thermodynamic or H2O state. */
const beforeT=Array.from(core.airTemp),beforeP=Array.from(core.pressure),beforeV=Array.from(core.vaporColumn),beforeC=Array.from(core.cloudWaterState);
ctx.frontRefresh(core,climate);
assert.deepEqual(Array.from(core.airTemp),beforeT);assert.deepEqual(Array.from(core.pressure),beforeP);
assert.deepEqual(Array.from(core.vaporColumn),beforeV);assert.deepEqual(Array.from(core.cloudWaterState),beforeC);

const live=ctx.weatherCoreCreate(77,12,climate,axis);
for(let n=0;n<16;n++)ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live),'coupled front weather ticks must remain finite');
assert.ok(live.frontStrength.every(v=>v>=0&&v<=1&&Number.isFinite(v)));
assert.ok(live.frontVerticalVelocity.every(v=>v>=0&&v<=2.000001&&Number.isFinite(v)));
assert.ok(src['weather-fronts.js'].includes('frontScalarGradient')&&src['weather-fronts.js'].includes('frontWindDivergence'),
  'fronts must derive from resolved gradients and wind convergence');
assert.ok(src['weather-fronts.js'].includes('frontThermalAdvectionKHour')&&src['weather-fronts.js'].includes('frontType'),
  'front type must derive from resolved thermal advection');
assert.ok(!src['weather-fronts.js'].includes('Math.random'),'fronts must not use random morphology');
assert.ok(!src['weather-fronts.js'].includes('requestAnimationFrame'),'front diagnosis must stay on fixed Weather Core clock');
assert.ok(!/airTemp\s*\[[^\]]+\]\s*=/.test(src['weather-fronts.js']),'front layer must not overwrite air temperature');
assert.ok(!/cloudWaterState\s*\[[^\]]+\]\s*=/.test(src['weather-fronts.js']),'front layer must not overwrite condensate');
console.log('weather-fronts.test.js: OK');
