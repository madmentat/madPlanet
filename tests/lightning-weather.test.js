const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const weatherSrc=fs.readFileSync(path.join(root,'js','weather-core.js'),'utf8');
const lightningSrc=fs.readFileSync(path.join(root,'js','lightning-weather.js'),'utf8');
const shaderSrc=fs.readFileSync(path.join(root,'shaders','lightning.glsl'),'utf8');
const cloudsSrc=fs.readFileSync(path.join(root,'shaders','clouds.glsl'),'utf8');
const renderSrc=fs.readFileSync(path.join(root,'js','render.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

assert.match(version,/^VERSION\s+0\.5\.52\s*$/m,'lightning milestone must be 0.5.52');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/deep-convection.js','js/vertical-stability.js','js/deep-convection-coupling.js','js/lightning-weather.js','js/render.js'],'shell lightning order');
ordered(buildPs,['js/deep-convection.js','js/vertical-stability.js','js/deep-convection-coupling.js','js/lightning-weather.js','js/render.js'],'PowerShell lightning order');

const state={seed:321,draft:true,storm:1,stormRate:1,stormGlow:1};
const world={axis:[0,1,0],cycA:new Float32Array(20),cycB:new Float32Array(20)};
let dirty=0;
const ctx={console,Math,Number,Date,Float32Array,Float64Array,Int32Array,state,world,markRenderUniformsDirty(){dirty++;}};
vm.createContext(ctx);vm.runInContext(weatherSrc,ctx,{filename:'weather-core.js'});vm.runInContext(lightningSrc,ctx,{filename:'lightning-weather.js'});
const climate={T:288.15,pressureBar:1.01325,h2oBar:0.004,waterAvail:1,cloudCov:.4,iceArea:.02,S:1};
const core=ctx.weatherCoreCreate(12345,12,climate,[0,1,0]);
assert.equal(core.lightningWeatherModel,1);
for(const k of ['lightningPotential','lightningFlashRateHz','lightningMixedPhaseDepthM','lightningElectricalIntensity']){
  assert.ok(core[k] instanceof Float32Array,k);assert.equal(core[k].length,core.count,k+' length');
}
assert.ok(ctx.weatherCoreFinite(core));

/* Supply the 0.5.51/0.5.48 fields explicitly so this test isolates the
   lightning diagnosis rather than retesting the entire convection chain. */
for(const k of ['deepConvectiveState','deepUpdraftMS','cloudWaterState','cloudBaseHeightM','cloudTopHeightM','scaleHeight','frontStrength','cycloneStrength'])
  core[k]=new Float32Array(core.count);
core.precipRate.fill(0);core.airTemp.fill(295);
core.scaleHeight.fill(8400);core.cloudBaseHeightM.fill(1200);core.cloudTopHeightM.fill(2500);

function clearStorms(){
  core.deepConvectiveState.fill(0);core.deepUpdraftMS.fill(0);core.cloudWaterState.fill(0);
  core.precipRate.fill(0);core.frontStrength.fill(0);core.cycloneStrength.fill(0);
  core.cloudBaseHeightM.fill(1200);core.cloudTopHeightM.fill(2500);core.airTemp.fill(295);
}

/* Manual visual sliders at maximum cannot create lightning without a physical
   deep-convective/mixed-phase cell. */
clearStorms();state.storm=state.stormRate=state.stormGlow=1;ctx.lightningRefresh(core,climate);
assert.equal(core.lightningActiveCount,0,'visual storm sliders must not create physical lightning centres');
assert.ok(Array.from(core.lightningRenderB).every(x=>x===0),'no convection => empty render payload');

/* Warm, deep, wet plume spans the 0..-35 C mixed-phase region and must become
   electrically active. */
const q=55;
core.deepConvectiveState[q]=1;core.deepUpdraftMS[q]=36;core.cloudWaterState[q]=0.90;
core.cloudBaseHeightM[q]=1100;core.cloudTopHeightM[q]=12500;core.scaleHeight[q]=8400;
core.airTemp[q]=295;core.precipRate[q]=0.0040;core.frontStrength[q]=0.35;core.cycloneStrength[q]=0.40;
ctx.lightningRefresh(core,climate);
assert.ok(core.lightningMixedPhaseDepthM[q]>3000,'deep warm cumulonimbus must span a substantial mixed-phase layer');
assert.ok(core.lightningPotential[q]>0.45,'mature deep plume must have strong electrical potential');
assert.ok(core.lightningFlashRateHz[q]>1&&core.lightningFlashRateHz[q]<=4.5001,'physical storm must produce a bounded but potentially rapid flash cadence');
assert.equal(core.lightningActiveCount,1);assert.equal(core.lightningSelectedIndex[0],q);
assert.ok(Math.abs(core.lightningRenderA[0]-core.dirX[q])<1e-6&&Math.abs(core.lightningRenderA[1]-core.dirY[q])<1e-6&&Math.abs(core.lightningRenderA[2]-core.dirZ[q])<1e-6,'GPU centre must come from the actual Weather Core cell');
assert.equal(core.lightningRenderA[3],0,'legacy cyclone strength slot must remain exactly zero');
assert.equal(world.cycA[3],0,'published compatibility payload must not wake procedural synoptic weather');
assert.ok(world.cycB[1]>1&&world.cycB[2]>0,'GPU payload must carry physical cadence and intensity');
assert.ok(dirty>0,'changing physical storm payload must dirty render uniforms');

/* More vigorous plume gives a higher physical cadence, all else equal. */
const strongRate=core.lightningFlashRateHz[q];
core.deepUpdraftMS[q]=12;core.precipRate[q]=0.0004;ctx.lightningRefresh(core,climate);
assert.ok(core.lightningFlashRateHz[q]<strongRate,'weaker updraft/precipitation must reduce flash cadence');

/* A shallow warm cloud never reaches the mixed-phase charge-separation zone. */
clearStorms();core.deepConvectiveState[q]=1;core.deepUpdraftMS[q]=36;core.cloudWaterState[q]=0.9;
core.cloudBaseHeightM[q]=500;core.cloudTopHeightM[q]=2600;core.airTemp[q]=296;core.precipRate[q]=0.003;
ctx.lightningRefresh(core,climate);
assert.equal(core.lightningMixedPhaseDepthM[q],0,'shallow warm cloud must have no mixed-phase layer');
assert.ok(core.lightningPotential[q]<0.001&&core.lightningActiveCount===0,'shallow warm cloud must not produce lightning');

/* Every published A.w stays zero even with several strong cells. */
clearStorms();
for(const i of [20,55,91,130,180]){
  core.deepConvectiveState[i]=1;core.deepUpdraftMS[i]=40;core.cloudWaterState[i]=1;
  core.cloudBaseHeightM[i]=900;core.cloudTopHeightM[i]=13000;core.airTemp[i]=294;core.precipRate[i]=0.004;
}
ctx.lightningRefresh(core,climate);
for(let s=0;s<5;s++) assert.equal(core.lightningRenderA[s*4+3],0,'all compatibility strength slots must remain zero');
assert.ok(core.lightningActiveCount>=1&&core.lightningActiveCount<=5,'renderer exports at most five separated physical storm centres');
assert.ok(ctx.weatherCoreFinite(core));

assert.ok(!lightningSrc.includes('Math.random'),'physical lightning selection must be deterministic and weather-driven');
assert.ok(lightningSrc.includes('deepConvectiveState')&&lightningSrc.includes('deepUpdraftMS')&&lightningSrc.includes('lightningMixedPhaseDepth'),'lightning must derive from deep convection and mixed-phase depth');
assert.ok(shaderSrc.includes('vec4 A=uCycA[i]')&&shaderSrc.includes('float rate=max(0.0,B.y)'),'shader must consume CPU storm centre/cadence payload');
assert.ok(shaderSrc.includes('vec3 c=normalize(A.xyz)'),'shader strike centre must originate from physical payload');
assert.ok(!shaderSrc.includes('gWx.w'),'procedural weather storm field must no longer gate lightning');
assert.ok(!shaderSrc.includes('normalize(hh*2.0-1.0)'),'hash must not choose a global random storm centre anymore');
assert.match(cloudsSrc,/if\(A\.w\s*<\s*0\.02\)\s*continue/,'legacy cloud synoptic path must still reject A.w=0 lightning payloads');
assert.ok(renderSrc.includes('gl.uniform4fv(U.uCycA, world.cycA)')&&renderSrc.includes('gl.uniform4fv(U.uCycB, world.cycB)'),'existing compatibility uniforms must publish lightning payload');
console.log('lightning-weather.test.js: OK');
