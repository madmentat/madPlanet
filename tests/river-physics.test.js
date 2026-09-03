'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/river-physics.js'),'utf8');
const refine=fs.readFileSync(path.join(root,'js/river-routing-refinement.js'),'utf8');
const visual=fs.readFileSync(path.join(root,'js/river-visual-tributaries.js'),'utf8');
const gpu=fs.readFileSync(path.join(root,'js/river-gpu.js'),'utf8');
const render=fs.readFileSync(path.join(root,'js/river-render.js'),'utf8');
const shader=fs.readFileSync(path.join(root,'shaders/surface.glsl'),'utf8');
const header=fs.readFileSync(path.join(root,'shaders/header.glsl'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');

assert.ok(!/Math\.random|requestAnimationFrame/.test(src),'river physics must stay deterministic and off render FPS');
assert.ok(!/Math\.random|requestAnimationFrame/.test(refine),'river routing refinement must stay deterministic and off render FPS');
const executableVisual=visual.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'$1');
assert.ok(!/Math\.random|requestAnimationFrame/.test(executableVisual),'visual tributaries must stay deterministic and off render FPS');
for(const k of ['runoffGenerationRate','macroTerrain','surfaceWaterFraction','riverDownstream','riverDischarge','riverWidthM','riverStreamPower'])
  assert.ok(src.includes(k),'missing physical river dependency '+k);
assert.ok(src.includes('RiverMinHeap')&&src.includes('riverPriorityFlood'),'drainage must hydro-condition depressions');
assert.ok(src.includes('Math.pow(Q,RIVER_WIDTH_EXP)'),'channel width must derive from discharge hydraulic geometry');
const executable=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
assert.ok(!/latitude|latGate|riverBand/.test(executable),'river placement must not contain a latitude band');

/* Weather Core cells are catchment elements, not display pixels. Routing must
   have diagonal choices, headwater initiation must still require real runoff,
   and an established graph channel must remain continuous downstream. */
assert.match(refine,/Array\.from\(\{length:8\}/,'river routing needs an eight-neighbour D8-like stencil');
assert.match(refine,/riverContributingArea/,'resolved contributing area gate is missing');
assert.match(refine,/RIVER_AREA_START_CELLS=0\.72/,'coarse Weather Core must allow a runoff-supported fractional-cell headwater');
assert.match(refine,/RIVER_Q_START_LOCAL_MULT=1\.05/,'headwaters must still require more than the climate baseflow reference');
assert.match(refine,/riverRoutingCarryChannelsDownstream/,'real channel support must be carried along its diagnosed downstream graph');
assert.match(refine,/RIVER_CONTINUITY_DECAY=0\.90/,'downstream visual continuity needs a bounded decay');
assert.match(refine,/RIVER_ROUTING_REFINEMENT_MODEL=2/,'river routing refinement model must be bumped');
assert.match(visual,/riverVisualBasin/,'fine tributaries must be basin constrained');
assert.match(visual,/riverVisualDistToTrunk/,'fine tributaries must converge toward a physical receiver');

for(const file of [buildSh,buildPs]){
  assert.ok(file.indexOf('js/soil-hydrology.js')<file.indexOf('js/river-physics.js'));
  assert.ok(file.indexOf('js/river-physics.js')<file.indexOf('js/river-routing-refinement.js'));
  assert.ok(file.indexOf('js/river-routing-refinement.js')<file.indexOf('js/river-visual-tributaries.js'));
  assert.ok(file.indexOf('js/river-visual-tributaries.js')<file.indexOf('js/river-gpu.js'));
  assert.ok(file.indexOf('js/render.js')<file.indexOf('js/river-render.js'));
}
assert.match(header,/uniform samplerCube uRiverTex;/);
assert.match(header,/uniform float uRiverBlend;/);
assert.match(shader,/riverHydroTex\s*=\s*texture\(uRiverTex/);
/* 0.5.146: the coarse corridor map is never shown as water; thin sub-grid
   channels stay, the trunk corridor only keeps one main channel continuous. */
assert.match(shader,/riverGeomPhys\s*=\s*max\(riverGeomProc,\s*trunkChannel\*physRiverCore\)/,'physical corridor must gate sub-grid channels, not replace them');
assert.doesNotMatch(shader,/riverGeomPhys\s*=\s*max\(physRiverCore,/,'the coarse river texel must never be painted as water directly');
assert.match(shader,/float trunkChannel = 1\.0 - ss\(w\*1\.05, w\*1\.65, riverSignal\)/,'trunk corridor needs a wider acceptance band for a continuous main channel');
assert.match(shader,/riverClimateGate = mix\(ss\(0\.24,0\.44,moist\),ss\(0\.12,0\.40,max\(soilMoistPhys,physRiverHalo\)\),uRiverPhysicsOn\)/,'river density must follow resolved soil water');
assert.match(shader,/float lthPhys = lth - 0\.22\*ss\(0\.15,0\.75,lakePhys\)/,'physical lakes must keep noise-shaped shorelines');
assert.ok(gpu.includes('riverDownstream'),'GPU river map must rasterize the diagnosed drainage graph');
assert.ok(gpu.includes('riverGpuPaintEdge'),'GPU river map must paint graph edges rather than hydrology cells');
assert.ok(gpu.includes('riverGpuEdgeHash')&&gpu.includes('Math.sin(Math.PI*t)'),'coarse graph edges need deterministic sub-cell bending to hide lattice directions');
assert.match(gpu,/RIVER_GPU_MODEL=10/,'river display bridge must be the corridor-mask model');
assert.match(gpu,/RIVER_GPU_UPSCALE=16/,'river cubemap must resolve well below the Weather Core cell size');
assert.match(gpu,/Math\.min\(96,Math\.ceil\(Math\.max\(ang,cellAng\)\*riverGpuN\*3\.2\)\)/,'long physical graph links need dense spherical samples rather than chunky segments');
assert.match(gpu,/const amp=cellAng\*\(0\.12\+0\.06\*Math\.abs\(h2\)\)/,'corridor meander must stay small: visible wiggles belong to the sub-grid channel');
assert.ok(gpu.includes('riverGpuPaintVisualBranches'),'GPU bridge must paint the fine tributary overlay');
assert.ok(!gpu.includes('requestAnimationFrame'),'river texture must not upload from render FPS');
assert.ok(render.includes('uRiverPhysicsOn')&&render.includes('uRiverTex'));

const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,Uint8Array,
  WEATHER_CORE_FIXED_DT_SEC:300,
  weatherCoreCreate:()=>({count:1}),
  weatherCoreStep:(c)=>c,
  weatherCoreFinite:()=>true
};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'river-physics.js'});
vm.runInContext(refine,ctx,{filename:'river-routing-refinement.js'});

function chainCore(terrain){
  const n=terrain.length,N=1;
  const c={count:n,N,seed:7,
    macroTerrain:Float32Array.from(terrain),
    orographicRoughness:new Float32Array(n),
    surfaceWaterFraction:new Float32Array(n),
    areaWeight:new Float32Array(n),
    dirX:new Float32Array(n),dirY:new Float32Array(n),dirZ:new Float32Array(n),
    relativeHumidity:new Float32Array(n),soilCapacity:new Float32Array(n),soilMoisture:new Float32Array(n),
    runoffGenerationRate:new Float32Array(n),surfaceTemp:new Float32Array(n),
    h2oSurfaceSignature:'synthetic',orographySignature:'synthetic',
    windNeighbor:Array.from({length:4},()=>new Int32Array(n))};
  c.surfaceWaterFraction[n-1]=1;
  for(let i=0;i<n;i++){
    c.areaWeight[i]=1;c.relativeHumidity[i]=0.72;c.soilCapacity[i]=100;c.soilMoisture[i]=60;c.surfaceTemp[i]=288;
    const a=(i/(Math.max(1,n-1)))*0.30;
    c.dirX[i]=Math.cos(a);c.dirY[i]=0;c.dirZ[i]=Math.sin(a);
    const prev=Math.max(0,i-1),next=Math.min(n-1,i+1);
    c.windNeighbor[0][i]=prev;c.windNeighbor[1][i]=next;c.windNeighbor[2][i]=prev;c.windNeighbor[3][i]=next;
  }
  return c;
}

// A simple slope must form one acyclic route to the ocean.
{
  const c=chainCore([5,4,3,2,0]);ctx.riverEnsureFields(c);ctx.riverRebuildTopology(c,{radiusM:6371000});
  assert.deepEqual(Array.from(c.riverDownstream),[1,2,3,4,-1]);
  assert.equal(c.riverTopoCount,4);

  c.riverRunoffMean.fill(2e-5);
  ctx.riverAccumulateDischarge(c,300,{radiusM:6371000});
  assert.ok(c.riverDischargeTarget[1]>c.riverDischargeTarget[0]);
  assert.ok(c.riverDischargeTarget[2]>c.riverDischargeTarget[1]);
  assert.ok(c.riverDischargeTarget[3]>c.riverDischargeTarget[2],'discharge must grow downstream as contributing area grows');
  assert.ok(c.riverWidthM[3]>c.riverWidthM[0],'hydraulic geometry must widen a larger river');
  assert.ok(c.riverChannelStrength[0]>=0&&c.riverChannelStrength[0]<c.riverChannelStrength[3],
    'a runoff-supported headwater may appear, but the accumulated trunk must be stronger');
  assert.ok(c.riverChannelStrength[3]>0.20,'multi-cell accumulated basin must produce a visible trunk channel');
  assert.ok(c.riverContributingArea[3]>c.riverContributingArea[1],'contributing area must accumulate downstream');

  for(let i=0;i<3;i++)if(c.riverChannelStrength[i]>0.025){
    assert.ok(c.riverChannelStrength[i+1]>=c.riverChannelStrength[i]*0.50,
      'a diagnosed channel must not visually vanish in the next downstream land cell');
  }
}

// Continuity is graph-bound: it strengthens only the diagnosed downstream cell.
{
  const c=chainCore([5,4,3,2,0]);ctx.riverEnsureFields(c);ctx.riverRebuildTopology(c,{radiusM:6371000});
  ctx.riverRoutingEnsureFields(c);
  const area=ctx.riverCellAreas(c,{radiusM:6371000});
  c.riverChannelStrength.fill(0);c.riverChannelStrength[0]=0.8;
  c.riverDischarge.fill(0);c.riverDischarge[1]=10*ctx.riverRoutingReferenceQ(area[1]);
  ctx.riverRoutingCarryChannelsDownstream(c,area);
  assert.ok(c.riverChannelStrength[1]>0.4,'supported downstream receiver must inherit channel continuity');
  assert.equal(c.riverChannelStrength[2],0,'continuity must stop when the next receiver has no physical discharge');
}

// A closed pit must be lifted to its spill elevation and still drain.
{
  const c=chainCore([6,1,5,3,0]);ctx.riverEnsureFields(c);ctx.riverRebuildTopology(c,{radiusM:6371000});
  assert.ok(c.riverFillDepth[1]>3.5,'Priority-Flood must hydro-condition an interior depression');
  let i=0,guard=0;while(i>=0&&i<c.count-1&&guard++<10)i=c.riverDownstream[i];
  assert.equal(i,c.count-1,'conditioned drainage must reach the ocean instead of terminating in the pit');
}

// Hydraulic geometry and stream power respond monotonically to Q and slope.
{
  const a={},b={},c={};ctx.riverHydraulicGeometry(10,1e-4,a);ctx.riverHydraulicGeometry(100,1e-4,b);ctx.riverHydraulicGeometry(100,1e-3,c);
  assert.ok(b.width>a.width&&b.depth>a.depth,'larger discharge must make a wider/deeper channel');
  assert.ok(b.power>a.power,'stream power must increase with discharge');
  assert.ok(c.power>b.power,'stream power must increase with slope');
}

// Truly dry cells have no physically supported discharge/channel.
{
  const c=chainCore([5,4,3,2,0]);ctx.riverEnsureFields(c);ctx.riverRebuildTopology(c,{radiusM:6371000});
  c.relativeHumidity.fill(0);c.soilMoisture.fill(0);c.runoffGenerationRate.fill(0);c.riverRunoffMean.fill(0);
  ctx.riverUpdateRunoffMemory(c,300);ctx.riverAccumulateDischarge(c,300,{radiusM:6371000});
  for(let i=0;i<c.count-1;i++)assert.equal(c.riverChannelStrength[i],0,'dry basin must not get a decorative river');
}

console.log('river-physics.test.js: OK');
