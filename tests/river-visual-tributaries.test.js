'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const phys=read('js/river-physics.js');
const refine=read('js/river-routing-refinement.js');
const visual=read('js/river-visual-tributaries.js');
const gpu=read('js/river-gpu.js');
const pacing=read('js/river-frame-pacing.js');
const surfacePre=read('shaders/surface-artifact-prelude.glsl');
const surfacePost=read('shaders/surface-artifact-postlude.glsl');
const sh=read('build.sh'),ps=read('build.ps1');

const executableVisual=visual.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'$1');
assert.ok(!/Math\.random|requestAnimationFrame/.test(executableVisual),'visual tributaries must be deterministic and off render FPS');
for(const token of ['riverVisualBasin','riverVisualDistToTrunk','riverVisualWetness','riverVisualTraceBranch','riverVisualChooseNext','riverVisualTraceFeeder','riverVisualChooseUpstream'])
  assert.ok(visual.includes(token),'missing tributary constraint '+token);
assert.match(visual,/RIVER_VISUAL_TRIBUTARY_MODEL=7/);
assert.match(visual,/probability=riverClamp\(\(score-RIVER_VISUAL_SOURCE_MIN\)\*1\.05\+0\.12,0\.12,0\.62\)/,'decorative headwaters must remain sparse instead of filling every eligible coarse cell');
assert.match(visual,/RIVER_VISUAL_MAX_TRUNK_DISTANCE=22/);
assert.match(visual,/RIVER_VISUAL_REBUILD_TICKS=12/,'fine display network must not churn every few x4 weather ticks');
assert.match(visual,/hj>h0\+RIVER_PRIORITY_EPS\*6/,'downstream visual branches must reject uphill neighbours');
assert.match(visual,/hj\+RIVER_PRIORITY_EPS\*6<h0/,'reverse feeder tracing must reject land lower than its receiver');
assert.match(visual,/\(basin\[j\]\|0\)!==b0/,'visual branches must stay inside the physical basin');
assert.match(visual,/dj<d0/,'visual branches must move toward a diagnosed receiver');
assert.match(visual,/dj>d0/,'reverse feeder tracing must move away from the receiver before reversal');
assert.match(visual,/kind:'feeder'/,'display graph needs explicit fine side feeders');
assert.match(visual,/riverCoastDistance&&\(core\.riverCoastDistance\[i\]\|0\)<=1/,'visual tributaries must not originate in the coastal ring');
assert.match(visual,/riverCoastDistance&&\(core\.riverCoastDistance\[j\]\|0\)<=1/,'reverse feeders must not recruit a coastal source');
assert.match(gpu,/RIVER_GPU_MODEL=15/);
assert.match(gpu,/RIVER_GPU_UPSCALE=16/,'desktop authoritative river reconstruction is 16x');
assert.ok(gpu.includes('riverGpuPaintVisualBranches')&&gpu.includes('riverVisualBranches'),'GPU bridge must rasterize fine tributaries');
assert.match(gpu,/function riverGpuDetailedLandAt\(core,dx,dy,dz\)/,'river rasterizer must sample the detailed coastline');
assert.match(gpu,/if\(!riverGpuDetailedLandAt\(core,dx,dy,dz\)\)return false;/,'base spline rasterizer must stop at first ocean crossing');
assert.doesNotMatch(pacing,/riverGpuPaintVisualEdge=function/,'frame pacing must not replace the authoritative geometry painter');

/* 0.5.142: the second shadeSurface wrapper was expensive on mobile because it
   duplicated river sampling and could call the 5-tap/two-texture fog sampler a
   second time near every stream. The normal surface shader is again the only
   surface pass; fine-stream visibility is carried by a narrow high-confidence
   river texture signal instead. */
assert.doesNotMatch(surfacePre,/#define shadeSurface shadeSurfaceLegacy/,'surface shader must not be renamed for a second river pass');
assert.doesNotMatch(surfacePost,/vec3 shadeSurface\s*\(/,'postlude must not add a duplicate surface shader pass');
assert.doesNotMatch(surfacePost,/physicalFogSample|texture\s*\(\s*uRiverTex/,'postlude must not duplicate weather/river cubemap reads');
assert.match(pacing,/RIVER_VISUAL_POLISH_MODEL=1/,'late river visual polish missing');
assert.match(pacing,/return mobile\?Math\.max\(8,n\*6\):displayBefore\(coreN\)/,'mobile river display must use the cheaper 6x reconstruction');
assert.match(pacing,/claimedReceiver/,'adjacent feeder receivers must be pruned to prevent comb patterns');
assert.match(pacing,/cells\.length<3/,'one-cell feeder teeth must be rejected');
assert.match(gpu,/0\.035\+0\.055\*Math\.sqrt\(strength\)/,'fine branch brush must stay narrow');
assert.match(gpu,/0\.16\+0\.50\*strength/,'fine branch centre line must carry a weaker signal than trunks');
for(const build of [sh,ps]){
  assert.ok(build.indexOf('js/river-routing-refinement.js')<build.indexOf('js/river-visual-tributaries.js'));
  assert.ok(build.indexOf('js/river-visual-tributaries.js')<build.indexOf('js/river-gpu.js'));
  assert.ok(build.indexOf('js/render.js')<build.indexOf('js/river-frame-pacing.js'),'river polish must run after mobileDevice/render policy is defined');
}

const ctx={console,Math,Number,Array,Set,Float32Array,Float64Array,Int32Array,Int16Array,Uint8Array,
  WEATHER_CORE_FIXED_DT_SEC:300,
  weatherCoreCreate:()=>({count:1}),weatherCoreStep:c=>c,weatherCoreFinite:()=>true};
vm.createContext(ctx);
vm.runInContext(phys,ctx,{filename:'river-physics.js'});
vm.runInContext(refine,ctx,{filename:'river-routing-refinement.js'});
vm.runInContext(visual,ctx,{filename:'river-visual-tributaries.js'});

function chainCore(n=8){
  const c={count:n,N:1,seed:17,ticks:0,
    macroTerrain:new Float32Array(n),orographicRoughness:new Float32Array(n),surfaceWaterFraction:new Float32Array(n),
    areaWeight:new Float32Array(n),dirX:new Float32Array(n),dirY:new Float32Array(n),dirZ:new Float32Array(n),
    relativeHumidity:new Float32Array(n),soilCapacity:new Float32Array(n),soilMoisture:new Float32Array(n),
    runoffGenerationRate:new Float32Array(n),surfaceTemp:new Float32Array(n),
    h2oSurfaceSignature:'synthetic',orographySignature:'synthetic',windNeighbor:Array.from({length:4},()=>new Int32Array(n))};
  c.surfaceWaterFraction[n-1]=1;
  for(let i=0;i<n;i++){
    c.macroTerrain[i]=n-i;c.areaWeight[i]=1;c.relativeHumidity[i]=0.92;c.soilCapacity[i]=100;c.soilMoisture[i]=88;
    c.runoffGenerationRate[i]=1.8e-5;c.surfaceTemp[i]=291;
    const a=i*0.04;c.dirX[i]=Math.cos(a);c.dirY[i]=0;c.dirZ[i]=Math.sin(a);
    const prev=Math.max(0,i-1),next=Math.min(n-1,i+1);
    c.windNeighbor[0][i]=prev;c.windNeighbor[1][i]=next;c.windNeighbor[2][i]=prev;c.windNeighbor[3][i]=next;
  }
  ctx.riverEnsureFields(c);ctx.riverRebuildTopology(c,{radiusM:6371000});ctx.riverRoutingEnsureFields(c);
  c.riverRunoffMean.fill(1.8e-5);c.riverChannelStrength.fill(0);c.riverLakeFraction.fill(0);
  c.riverChannelStrength[n-3]=0.82;
  return c;
}

{
  const c=chainCore();ctx.riverVisualBuildBasins(c);
  const receiver=c.count-3;
  assert.equal(c.riverVisualDistToTrunk[receiver],0);
  for(let i=0;i<receiver;i++)assert.ok(c.riverVisualDistToTrunk[i]>c.riverVisualDistToTrunk[i+1],
    'distance to the confirmed trunk must decrease downstream');
  const cells=ctx.riverVisualTraceBranch(c,0,99);
  assert.ok(cells&&cells.length>=3,'wet uphill source must be traceable to the physical trunk');
  assert.equal(cells[cells.length-1],receiver,'visual tributary must terminate on the diagnosed trunk');
  const basin=c.riverVisualBasin[cells[0]];
  for(let k=1;k<cells.length;k++){
    assert.equal(c.riverVisualBasin[cells[k]],basin,'tributary may not cross its physical drainage basin');
    if(!ctx.riverIsOcean(c,cells[k]))assert.ok(c.riverVisualDistToTrunk[cells[k]]<c.riverVisualDistToTrunk[cells[k-1]],
      'every tributary step must get closer to the receiver');
    assert.ok(c.riverFilledTerrain[cells[k]]<=c.riverFilledTerrain[cells[k-1]]+1e-5,'tributary may not climb uphill');
  }

  const feeder=ctx.riverVisualTraceFeeder(c,receiver,123);
  assert.ok(feeder&&feeder.length>=2,'wet confirmed trunk must be able to recruit an uphill side feeder');
  assert.equal(feeder[feeder.length-1],receiver,'feeder must end at the diagnosed receiver after reversal');
  for(let k=1;k<feeder.length;k++){
    assert.equal(c.riverVisualBasin[feeder[k]],c.riverVisualBasin[feeder[0]],'feeder may not cross a basin divide');
    assert.ok(c.riverFilledTerrain[feeder[k]]<=c.riverFilledTerrain[feeder[k-1]]+1e-5,'reversed feeder must flow downhill');
  }
}

{
  const c=chainCore();
  c.riverCoastDistance.fill(4);c.riverCoastDistance[0]=1;
  assert.equal(ctx.riverVisualSourceStrength(c,0),0,'a coastal mixed cell may not seed a decorative river across an island');
}

{
  const c=chainCore();
  ctx.riverVisualHash01=()=>0;
  ctx.riverVisualBuildBranches(c);
  assert.ok(c.riverVisualBranches.length>0,'wet sloping basin should receive fine visual tributaries');
  assert.ok(c.riverVisualFeederCount>0,'wet physical trunk should receive deterministic fine feeder branches');
  assert.ok(c.riverVisualBranches.some(b=>b.kind==='feeder'),'feeder pass must contribute to the display graph');
  for(const b of c.riverVisualBranches){
    const end=b.cells[b.cells.length-1];
    assert.ok(ctx.riverVisualIsReceiver(c,end)||ctx.riverIsOcean(c,end),'every visual branch must join a physical receiver');
  }
}

{
  const c=chainCore();c.relativeHumidity.fill(0);c.soilMoisture.fill(0);c.runoffGenerationRate.fill(0);c.riverRunoffMean.fill(0);
  ctx.riverVisualHash01=()=>0;ctx.riverVisualBuildBranches(c);
  assert.equal(c.riverVisualBranches.length,0,'dry terrain must not grow decorative tributaries');
  assert.equal(c.riverVisualFeederCount,0,'dry physical channels must not recruit decorative feeders');
}

console.log('river-visual-tributaries.test.js: OK');
