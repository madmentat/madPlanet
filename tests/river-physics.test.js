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
assert.match(refine,/RIVER_AREA_START_CELLS=0\.72/,'a headwater still needs most of one resolved catchment cell');
assert.match(refine,/RIVER_Q_START_LOCAL_MULT=1\.05/,'cell-local runoff alone must not turn every wet coarse cell into a river');
assert.match(refine,/riverSmooth\(1e-8,1\.5e-6,core\.riverSlope\[i\]\)/,'slope support must be scaled to the resolved macro slopes');
assert.match(refine,/riverRoutingCarryChannelsDownstream/,'real channel support must be carried along its diagnosed downstream graph');
assert.match(refine,/RIVER_CONTINUITY_DECAY=0\.90/,'downstream visual continuity needs a bounded decay');
assert.match(refine,/RIVER_ROUTING_REFINEMENT_MODEL=5/,'conservative coast-aware river routing refinement model must be active');
assert.match(refine,/function riverRoutingBuildCoastDistance\(core\)/,'routing must diagnose distance from every land cell to the coast');
assert.match(refine,/coastSourceGate=\(core\.riverCoastDistance\[i\]\|0\)<=1/,'single-cell coastal runoff must not become a headwater');
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
assert.match(shader,/riverHydroTex\s*=\s*texture\(uRiverTex, normalize\(sN\)\)/,'the physical corridor must be sampled without a geometry-distorting warp');
/* The coarse map owns river existence but never becomes visible water. FBM
   supplies only sub-grid morphology inside a diagnosed corridor. */
assert.match(shader,/float riverGeomPhys = max\(riverGeomProc\*physRiverHalo, trunkChannel\*physRiverCore\);/,'physical support must confine both normal and trunk morphology');
assert.doesNotMatch(shader,/riverGeomPhys\s*=\s*max\(riverGeomProc,\s*trunkChannel/,'procedural FBM must not own river existence outside diagnosed corridors');
assert.match(shader,/float trunkChannel = 1\.0 - ss\(w\*1\.05, w\*1\.65, riverSignal\);/,'a diagnosed stem needs a bounded morphology continuity gate');
assert.match(shader,/float trunkGain = mix\(1\.0, 1\.55, physRiverCore\);/,'discharge may widen sub-grid morphology without exposing the coarse brush');
assert.doesNotMatch(shader,/\btrunkLine\b/,'the cubemap ridge must never be painted directly as water');
assert.doesNotMatch(shader,/\btapA\b|riverHydroTex\s*=\s*max/,'max footprint taps would dilate channels at distance');
assert.doesNotMatch(shader,/\briverDir\b|\briverWarp\b/,'texture-coordinate warping must not detach the permission corridor from the graph');
assert.match(shader,/float riverCoverage = clamp\(wReal\/max\(wPix,1\.0e-6\)\*0\.8, 0\.0, 1\.0\);/,'sub-pixel river coverage must remain numerically safe');
assert.match(shader,/float riverLodFloor = mix\(0\.34,0\.52,physRiverCore\);/,'physical rivers need a bounded orbit-scale visibility floor');
assert.match(shader,/riverCoverage = mix\(riverCoverage,max\(riverCoverage,riverLodFloor\),uRiverPhysicsOn\);/,'only diagnosed physical rivers may bypass the legacy distance fade');
assert.doesNotMatch(shader,/riv \*= clamp\(wReal\/wPix/,'the old unbounded distance fade must not erase physical rivers');
assert.doesNotMatch(header,/uRiverTexel/,'the retired footprint dilation uniform must be removed');
assert.doesNotMatch(render,/uRiverTexel/,'the renderer must not upload the retired footprint dilation uniform');
assert.doesNotMatch(shader,/riverGeomPhys\s*=\s*max\(physRiverCore,/,'the coarse river texel must never be painted as a fat brush');
assert.match(gpu,/return 0\.045\+0\.10\*Math\.pow\(riverGpuClamp\(strength,0,1\),0\.9\)\+0\.22\*widthScale\*widthScale;/,'even the strongest trunk must remain a one-texel permission corridor');
assert.match(gpu,/0\.035\+0\.055\*Math\.sqrt\(strength\)/,'visual branches must stay thinner than trunks');
assert.match(shader,/riverClimateGate = mix\(ss\(0\.24,0\.44,moist\),ss\(0\.12,0\.40,max\(soilMoistPhys,physRiverHalo\)\),uRiverPhysicsOn\)/,'river density must follow resolved soil water');
assert.match(shader,/float lthPhys = lth - 0\.22\*ss\(0\.15,0\.75,lakePhys\)/,'physical lakes must keep noise-shaped shorelines');
assert.ok(gpu.includes('riverDownstream'),'GPU river map must rasterize the diagnosed drainage graph');
assert.ok(gpu.includes('riverGpuPaintEdge')&&gpu.includes('ds[j]|0'),'GPU river map must paint diagnosed graph edges with downstream context');
assert.ok(gpu.includes('riverGpuEdgeHash')&&gpu.includes('function riverGpuEdgeBend('),'coarse graph edges need deterministic node-anchored meanders');
assert.match(gpu,/RIVER_GPU_MODEL=16/,'river display bridge must use coverage-preserving minification');
assert.match(gpu,/RIVER_GPU_UPSCALE=16/,'river cubemap must resolve well below the Weather Core cell size');
assert.match(gpu,/gl\.LINEAR_MIPMAP_LINEAR/,'WebGL2 must minify the corridor from mip levels instead of undersampling level zero');
assert.match(gpu,/if\(riverGpuUseMipmaps\(\)\)gl\.generateMipmap\(gl\.TEXTURE_CUBE_MAP\);/,'river uploads must rebuild the coverage mip chain');
assert.match(gpu,/Math\.min\(96,Math\.ceil\(Math\.max\(ang,cellAng\)\*riverGpuN\*3\.2\)\)/,'Catmull edges need dense spherical samples rather than chunky segments');
assert.match(gpu,/const envelope=Math\.sin\(Math\.PI\*t\);/,'meander offsets must be zero at graph nodes to avoid angular joins');
assert.match(gpu,/const wave=envelope\*envelope\*/,'the meander tangent must also vanish at graph nodes');
assert.doesNotMatch(gpu,/riverGpuChaikin|riverGpuDisplace|riverGpuPaintTrunkChains/,'whole-chain averaging must not recreate straight diagonal canals');
assert.match(gpu,/function riverGpuDetailedLandAt\(core,dx,dy,dz\)/,'spline rasterization must sample the continuous coastline');
assert.match(gpu,/new Uint8Array\(6\*N\*N\)/,'continuous coast samples must be memoized instead of rerunning terrain noise for every spline sample');
assert.match(gpu,/\*4\)\)\)/,'coast guard must resolve below the synoptic Weather Core grid');
assert.match(gpu,/if\(!riverGpuDetailedLandAt\(core,dx,dy,dz\)\)return false;/,'a raster path must terminate at its first ocean sample');
assert.ok(gpu.includes('riverGpuPaintVisualBranches'),'GPU bridge must paint the fine tributary overlay');
assert.ok(!gpu.includes('requestAnimationFrame'),'river texture must not upload from render FPS');
assert.ok(render.includes('uRiverPhysicsOn')&&render.includes('uRiverTex'));

/* Numeric guards for the two visual regressions that regex-only tests blessed
   in 0.5.154: endpoint jumps and a multi-texel trunk brush. */
const gpuCtx={console,Math,Number,Date,Array,Map,Set,Float32Array,Float64Array,Int32Array,Int16Array,Uint8Array,
  UNIFORM_NAMES:[],weatherCoreCreate:()=>({count:1}),weatherCoreStep:c=>c};
vm.createContext(gpuCtx);vm.runInContext(gpu,gpuCtx,{filename:'river-gpu.js'});
const gpuCalls=[];
gpuCtx.webglVersion=2;
gpuCtx.gl={TEXTURE_CUBE_MAP:1,TEXTURE_CUBE_MAP_POSITIVE_X:10,TEXTURE0:20,RGBA:30,UNSIGNED_BYTE:40,
  TEXTURE_MIN_FILTER:50,TEXTURE_MAG_FILTER:51,TEXTURE_WRAP_S:52,TEXTURE_WRAP_T:53,TEXTURE_WRAP_R:54,
  LINEAR:60,LINEAR_MIPMAP_LINEAR:61,CLAMP_TO_EDGE:62,
  createTexture:()=>({}),deleteTexture:()=>{},activeTexture:()=>{},bindTexture:()=>{},
  texParameteri:(...a)=>gpuCalls.push(['param',...a]),texImage2D:()=>{},texSubImage2D:()=>{},
  generateMipmap:(...a)=>gpuCalls.push(['mipmap',...a])};
gpuCtx.riverGpuEnsure(24);
assert.ok(gpuCalls.some(c=>c[0]==='param'&&c[2]===gpuCtx.gl.TEXTURE_MIN_FILTER&&c[3]===gpuCtx.gl.LINEAR_MIPMAP_LINEAR),
  'WebGL2 river texture must select trilinear minification');
const mipAfterEnsure=gpuCalls.filter(c=>c[0]==='mipmap').length;
gpuCtx.riverGpuPackUpload();
assert.equal(gpuCalls.filter(c=>c[0]==='mipmap').length,mipAfterEnsure+1,
  'publishing new river coverage must regenerate exactly one mip chain');
const bendCore={seed:7345730};
assert.ok(Math.abs(gpuCtx.riverGpuEdgeBend(bendCore,7,11,0,0.05))<1e-12,'meander must start on its graph node');
assert.ok(Math.abs(gpuCtx.riverGpuEdgeBend(bendCore,7,11,1,0.05))<1e-12,'meander must end on its graph node');
assert.ok(Math.abs(gpuCtx.riverGpuEdgeBend(bendCore,7,11,1e-5,0.05)/1e-5)<1e-5,'meander must not add a sharp departure tangent');
assert.ok(Math.abs(gpuCtx.riverGpuEdgeBend(bendCore,7,11,1-1e-5,0.05)/1e-5)<1e-5,'meander must not add a sharp arrival tangent');
const corridor=Array.from({length:6},()=>new Float32Array(32*32));
vm.runInContext('riverGpuN=32',gpuCtx);
const maxRadius=gpuCtx.riverGpuCorridorRadius(1,1e12);
assert.ok(maxRadius<0.40,'hydraulic width must not expand a trunk beyond one corridor texel');
gpuCtx.riverGpuPaint(corridor,0,16,16,maxRadius,1);
assert.equal(corridor[0].reduce((n,v)=>n+(v>0?1:0),0),1,'the maximum trunk brush must touch exactly one cubemap texel');

const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,Int16Array,Uint8Array,
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

// Opposing coasts on an island must remain separated by a watershed divide.
{
  const c=chainCore([0,2,5,2,0]);c.surfaceWaterFraction[0]=1;
  ctx.riverEnsureFields(c);ctx.riverRebuildTopology(c,{radiusM:6371000});
  assert.equal(c.riverCoastDistance[0],0);assert.equal(c.riverCoastDistance[4],0);
  assert.equal(c.riverCoastDistance[2],2,'island interior must be farther from the sea than both coastal rings');
  assert.equal(c.riverDownstream[1],0,'west slope must drain only to the west coast');
  assert.equal(c.riverDownstream[3],4,'east slope must drain only to the east coast');
  const path=[];let i=2;
  for(let guard=0;i>=0&&guard++<8;i=c.riverDownstream[i])path.push(i);
  assert.ok(path.includes(0)!==path.includes(4),'one river path may terminate at only one of the opposing coasts');
}

// A malformed downstream cycle must be cut instead of reaching the display.
{
  const c=chainCore([5,4,3,2,0]);ctx.riverEnsureFields(c);
  c.riverDownstream.set([1,2,0,4,-1]);
  ctx.riverBuildTopo(c);
  assert.equal(c.riverDownstream[0],-1);
  assert.equal(c.riverDownstream[1],-1);
  assert.equal(c.riverDownstream[2],-1);
  assert.equal(c.riverDownstream[3],4,'valid acyclic drainage must survive the defensive cycle cut');
  assert.equal(c.riverTopoCount,4,'topology must contain every remaining land cell exactly once');
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
