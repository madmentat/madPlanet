const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['weather-core.js','orographic-lift.js','local-energy-balance.js','baric-field.js','wind-dynamics.js','h2o-advection.js','condensation.js','precipitation.js','soil-hydrology.js','weather-fronts.js','pressure-systems.js','deep-convection.js','vertical-stability.js','deep-convection-coupling.js'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'js',f),'utf8')]));
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'deep-convection test must see a semantic version');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/weather-fronts.js','js/pressure-systems.js','js/deep-convection.js','js/vertical-stability.js','js/deep-convection-coupling.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell deep-convection order');
assertOrdered(buildSh,order,'shell deep-convection order');

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.72,star:0.43,luminosity:0.43};
const world={seedS:[2.3,-4.1,7.7],plateN:4,
  plateP:new Float32Array([1,0,0,0,0,0,1,0,-1,0,0,0,0,0,-1,0]),
  plateW:new Float32Array([0,.45,0,0,0,-.35,0,0,0,.30,0,0,0,-.40,0,0])};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,Int8Array,state,world};
vm.createContext(ctx);for(const f of files)vm.runInContext(src[f],ctx,{filename:f});
const axis=[0,1,0];
const climate={T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:.45,iceArea:.02,waterAvail:1,S:1,regime:'temperate',A:.30,tau:.76,globalASR:239,globalOLR:239,sea:.58,iceAlbedo:.62,meanMolarMassKg:.02897,gravityMS2:9.80665,radiusM:6371000,rotationPeriodSec:86400};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);
assert.equal(core.deepConvectionModel,1);assert.equal(core.deepConvectionCouplingModel,1);
for(const k of ['capeProxyJkg','cinProxyJkg','deepConvectionTarget','deepConvectiveState','deepUpdraftMS','deepPlumeAreaFraction','deepMoistureFluxKgM2S','deepConvectiveTopTargetM','deepForcingIndex','deepMoistureGate']){
  assert.ok(core[k] instanceof Float32Array,k);assert.equal(core[k].length,core.count,k+' length');
}
assert.ok(ctx.weatherCoreFinite(core));

const q=55;
function setColumn(Ts,Ta,rh){
  core.surfaceTemp[q]=Ts;core.airTemp[q]=Ta;core.relativeHumidity[q]=rh;core.humidity[q]=Math.min(1,rh);
  core.scaleHeight[q]=8400;core.pressure[q]=101325;core.airDensity[q]=1.18;
  core.orographicVerticalVelocity[q]=0;core.frontVerticalVelocity[q]=0;core.frontStrength[q]=0;
  core.systemVerticalVelocity[q]=0;core.cycloneStrength[q]=0;core.anticycloneStrength[q]=0;
  core.vaporColumn[q]=75;core.cloudWaterState[q]=0.25;
}

/* Warm + humid + steep environmental lapse => substantial CAPE and a real
   sub-grid updraft. */
setColumn(307,291,0.92);ctx.deepRefresh(core,300,climate,true);
const humidCAPE=core.capeProxyJkg[q],humidTarget=core.deepConvectionTarget[q],humidW=core.deepUpdraftMS[q];
assert.ok(humidCAPE>1000,'warm humid unstable column must have meaningful CAPE');
assert.ok(humidTarget>0.35,'warm humid unstable column must trigger deep convection');
assert.ok(humidW>8&&humidW<=45.0001,'deep plume updraft must be energetic but bounded');
assert.ok(core.deepConvectiveTopTargetM[q]>core.scaleHeight[q],'deep plume should target an upper-tropospheric cloud top');

/* Same thermal instability but dry air/high LCL should not become a mature
   thunderstorm just because CAPE exists. */
setColumn(307,291,0.35);ctx.deepRefresh(core,300,climate,true);
assert.ok(core.capeProxyJkg[q]>100,'dry column may retain thermal CAPE');
assert.ok(core.deepMoistureGate[q]<0.08&&core.deepConvectionTarget[q]<0.08,'dry/high-LCL air must suppress the deep trigger');
assert.ok(core.deepUpdraftMS[q]<2,'dry suppressed plume should have little resolved sub-grid updraft');

/* A stable/inverted column has no useful CAPE. */
setColumn(289,294,0.95);ctx.deepRefresh(core,300,climate,true);
assert.ok(core.capeProxyJkg[q]<1&&core.deepConvectionTarget[q]<0.02,'stable inversion must not launch deep convection');

/* Synoptic subsidence is an actual cap on otherwise favourable convection. */
setColumn(307,291,0.92);ctx.deepRefresh(core,300,climate,true);const freeTarget=core.deepConvectionTarget[q];
core.systemVerticalVelocity[q]=-0.60;ctx.deepRefresh(core,300,climate,true);
assert.ok(core.cinProxyJkg[q]>0&&core.deepConvectionTarget[q]<freeTarget*0.35,'anticyclonic subsidence must rebuild inhibition and suppress the trigger');

/* The diagnosis itself owns no thermodynamic reservoir. */
setColumn(307,291,0.92);
const beforeT=core.airTemp[q],beforeP=core.pressure[q],beforeV=core.vaporColumn[q],beforeC=core.cloudWaterState[q];
ctx.deepRefresh(core,300,climate,true);
assert.equal(core.airTemp[q],beforeT);assert.equal(core.pressure[q],beforeP);assert.equal(core.vaporColumn[q],beforeV);assert.equal(core.cloudWaterState[q],beforeC);

/* Plume microphysics may move vapor to cloud, but must preserve local H2O. */
core.deepConvectiveState[q]=1;core.deepPlumeAreaFraction[q]=0.085;core.deepConvectiveTopTargetM[q]=14500;
core.airTemp[q]=294;core.relativeHumidity[q]=0.96;core.vaporColumn[q]=110;core.cloudWaterState[q]=0.20;
const phaseBefore=core.vaporColumn[q]+core.cloudWaterState[q];
const assist=ctx.deepConvectiveCondensationAssist(core,300,climate);
const phaseAfter=core.vaporColumn[q]+core.cloudWaterState[q];
assert.ok(assist.condensed>0,'mature lifted plume must accelerate condensation');
assert.ok(Math.abs(phaseAfter-phaseBefore)<2e-5,'convective condensation must conserve vapor + cloud mass');

/* Convective autoconversion turns mature cloud water into a downpour while
   preserving cloud + landed liquid/snow on land. */
core.surfaceWaterFraction[q]=0;core.surfaceTemp[q]=295;core.airTemp[q]=294;
core.cloudWaterState[q]=1.20;core.surfaceLiquidWater[q]=0.10;core.surfaceSnowWater[q]=0;
core.precipRate[q]=0;core.rainRate[q]=0;core.snowRate[q]=0;core.precipOceanReturnRate[q]=0;
const precipBefore=core.cloudWaterState[q]+core.surfaceLiquidWater[q]+core.surfaceSnowWater[q];
const extra=ctx.deepConvectivePrecipAssist(core,300,climate);
const precipAfter=core.cloudWaterState[q]+core.surfaceLiquidWater[q]+core.surfaceSnowWater[q];
assert.ok(extra>0&&core.precipRate[q]>0,'mature deep cloud must produce extra convective precipitation');
assert.ok(core.surfaceLiquidWater[q]>0.10,'warm land must receive convective rain');
assert.ok(Math.abs(precipAfter-precipBefore)<2e-5,'convective precipitation must conserve local land-water mass');

/* Deep plume target must actually deepen the existing cloud-column partition
   without changing bulk condensate. */
setColumn(302,292,0.94);core.cloudWaterState[q]=1.0;core.deepConvectiveState[q]=0;
ctx.verticalRefresh(core,climate);const shallowTop=core.cloudTopHeightM[q];
core.deepConvectiveState[q]=1;core.deepConvectiveTopTargetM[q]=14500;
const bulk=core.cloudWaterState[q];ctx.deepCoupleVerticalColumn(core,climate);
assert.ok(core.cloudTopHeightM[q]>shallowTop+1000,'deep plume must raise diagnosed cloud top');
assert.ok(core.cloudHighMass[q]>0,'deep plume must detrain part of existing condensate into the high layer');
assert.ok(Math.abs(core.cloudLowMass[q]+core.cloudMidMass[q]+core.cloudHighMass[q]-bulk)<2e-5,'vertical deep coupling must conserve bulk condensate');

/* Lifecycle persistence: storms decay over a finite timescale rather than
   disappearing in one five-minute tick. */
core.deepConvectiveState[q]=1;setColumn(289,294,0.35);core.deepConvectiveState[q]=1;
ctx.deepRefresh(core,300,climate,false);
assert.ok(core.deepConvectiveState[q]>0.70&&core.deepConvectiveState[q]<1,'deep convective state must decay smoothly, not vanish instantly');

const live=ctx.weatherCoreCreate(77,12,climate,axis);for(let n=0;n<18;n++)ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live),'coupled deep-convection ticks must remain finite');
assert.ok(src['deep-convection.js'].includes('sqrt(2*available)')&&src['deep-convection.js'].includes('capeProxyJkg'),'updraft must derive from CAPE-like parcel energy');
assert.ok(src['deep-convection.js'].includes('cinProxyJkg')&&src['deep-convection.js'].includes('systemVerticalVelocity'),'trigger must include inhibition and resolved forcing/subsidence');
assert.ok(!src['deep-convection.js'].includes('Math.random'),'deep convection must not use procedural storm placement');
assert.ok(!src['deep-convection.js'].includes('requestAnimationFrame'),'deep convection must stay on fixed Weather Core clock');
console.log('deep-convection.test.js: OK');
