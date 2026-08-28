const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['weather-core.js','orographic-lift.js','local-energy-balance.js','baric-field.js','wind-dynamics.js','h2o-advection.js','condensation.js','precipitation.js'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,'js',f),'utf8')]));
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+0\.5\.46\s*$/m,'orographic milestone must be 0.5.46');
function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/weather-core.js','js/orographic-lift.js','js/local-energy-balance.js','js/baric-field.js','js/wind-dynamics.js','js/h2o-advection.js','js/condensation.js','js/precipitation.js','js/render.js'];
assertOrdered(buildPs,order,'PowerShell orographic order');
assertOrdered(buildSh,order,'shell orographic order');

const state={seed:123,draft:true,sea:0.58,cont:0.45,tect:0.72,star:0.43,luminosity:0.43};
const world={seedS:[2.3,-4.1,7.7],plateN:4,
  plateP:new Float32Array([1,0,0,0,0,0,1,0,-1,0,0,0,0,0,-1,0]),
  plateW:new Float32Array([0,.45,0,0,0,-.35,0,0,0,.30,0,0,0,-.40,0,0])};
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,state,world};
vm.createContext(ctx);for(const f of files)vm.runInContext(src[f],ctx,{filename:f});
const axis=[0,1,0];
const climate={T:288.15,pressureBar:1.01325,h2oBar:0.0042,cloudCov:.45,iceArea:.02,waterAvail:1,S:1,regime:'temperate',A:.30,tau:.76,globalASR:239,globalOLR:239,sea:.58,iceAlbedo:.62,meanMolarMassKg:.02897,gravityMS2:9.80665,radiusM:6371000,rotationPeriodSec:86400};
const core=ctx.weatherCoreCreate(12345,12,climate,axis);
assert.equal(core.orographicLiftModel,1);
for(const k of ['orographicSlopeE','orographicSlopeN','orographicVerticalVelocity','orographicDeltaT','windwardLiftIndex','rainShadowIndex']){
  assert.ok(core[k] instanceof Float32Array,k);assert.equal(core[k].length,core.count,k+' length');
}
ctx.orographicRebuildSlopes(core);
let slopeMax=0;for(let n=0;n<core.count;n++)slopeMax=Math.max(slopeMax,Math.hypot(core.orographicSlopeE[n],core.orographicSlopeN[n]));
assert.ok(slopeMax>0,'tectonic mountain belts must create a non-zero resolved orographic slope');

/* Controlled 5% upslope flow: cooling must occur without changing H2O mass. */
const i=17;
core.orographicSlopeE.fill(0);core.orographicSlopeN.fill(0);core.orographicSlopeE[i]=0.05;
core.orographicSlopeSignature=ctx.oroSlopeSignature(core);
core.windStateU.fill(0);core.windStateV.fill(0);core.windU.fill(0);core.windV.fill(0);
core.windStateU[i]=core.windU[i]=20;
core.airTemp[i]=290;core.surfaceTemp[i]=292;core.cloudWaterState[i]=0;core.surfaceWaterFraction[i]=0;
const sat=ctx.h2oSaturationColumnKgM2(290,climate);core.vaporColumn[i]=sat*0.995;
const h0=core.vaporColumn[i]+core.cloudWaterState[i],t0=core.airTemp[i];
ctx.orographicApplyThermodynamics(core,300,climate);
assert.ok(core.orographicVerticalVelocity[i]>0.9,'upslope wind must produce positive vertical velocity');
assert.ok(core.airTemp[i]<t0&&core.orographicDeltaT[i]<0,'upslope flow must cool the air column');
assert.ok(core.windwardLiftIndex[i]>0.5&&core.rainShadowIndex[i]<0.01,'upslope flow must be classified as windward lift');
assert.ok(Math.abs(core.vaporColumn[i]+core.cloudWaterState[i]-h0)<1e-6,'orographic thermodynamics alone must not create/delete H2O');
ctx.condPhaseChange(core,300,climate);ctx.precipApply(core,300,climate);
const windwardPrecip=core.precipRate[i],windwardCloud=core.cloudWaterState[i];
assert.ok(windwardPrecip>0||windwardCloud>0.08,'orographic cooling must be able to create mature windward condensate/precipitation');

/* Same slope, reverse flow: descent warms and suppresses condensation. */
const j=31;
core.orographicSlopeE[j]=0.05;core.orographicSlopeN[j]=0;core.orographicSlopeSignature=ctx.oroSlopeSignature(core);
core.windStateU[j]=core.windU[j]=-20;core.windStateV[j]=core.windV[j]=0;
core.airTemp[j]=290;core.surfaceTemp[j]=292;core.cloudWaterState[j]=0;core.surfaceWaterFraction[j]=0;
core.vaporColumn[j]=sat*0.995;const tj0=core.airTemp[j];
ctx.orographicApplyThermodynamics(core,300,climate);
assert.ok(core.orographicVerticalVelocity[j]<-0.9,'downslope wind must produce negative vertical velocity');
assert.ok(core.airTemp[j]>tj0&&core.orographicDeltaT[j]>0,'leeward descent must warm the air column');
assert.ok(core.rainShadowIndex[j]>0.5&&core.windwardLiftIndex[j]<0.01,'descending flow must be classified as rain shadow');
ctx.condPhaseChange(core,300,climate);ctx.precipApply(core,300,climate);
assert.ok(core.precipRate[j]<windwardPrecip+1e-12,'leeward warming must not produce more precipitation than the matched windward case');
assert.ok(core.cloudWaterState[j]<windwardCloud+0.08,'leeward column must remain drier than the matched windward column');

/* No tectonic relief means no orographic slope/lift source. */
state.tect=0;ctx.windRefreshOrography(core,axis);ctx.orographicRebuildSlopes(core);
slopeMax=0;for(let n=0;n<core.count;n++)slopeMax=Math.max(slopeMax,Math.hypot(core.orographicSlopeE[n],core.orographicSlopeN[n]));
assert.ok(slopeMax<1e-12,'tect=0 must remove the orographic lift source');

const live=ctx.weatherCoreCreate(77,12,climate,axis);for(let n=0;n<12;n++)ctx.weatherCoreStep(live,300,climate,axis);
assert.ok(ctx.weatherCoreFinite(live),'coupled orographic weather ticks must remain finite');
assert.ok(src['orographic-lift.js'].includes('orographicRoughness')&&src['orographic-lift.js'].includes('windStateU'),
  'orographic forcing must use resolved relief and real wind');
assert.ok(!src['orographic-lift.js'].includes('Math.random'),'orographic weather must not be random morphology');
assert.ok(!src['orographic-lift.js'].includes('requestAnimationFrame'),'orographic physics must stay on the fixed Weather Core clock');
assert.ok(!/vaporColumn\s*\[[^\]]+\]\s*=/.test(src['orographic-lift.js']),
  'rain shadow thermodynamics must not delete vapor by fiat');
console.log('orographic-lift.test.js: OK');
