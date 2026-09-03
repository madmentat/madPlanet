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
const sh=read('build.sh'),ps=read('build.ps1');

assert.ok(!/Math\.random|requestAnimationFrame/.test(visual),'visual tributaries must be deterministic and off render FPS');
for(const token of ['riverVisualBasin','riverVisualDistToTrunk','riverVisualWetness','riverVisualTraceBranch','riverVisualChooseNext'])
  assert.ok(visual.includes(token),'missing tributary constraint '+token);
assert.match(visual,/RIVER_VISUAL_MAX_TRUNK_DISTANCE=11/);
assert.match(visual,/hj>h0\+RIVER_PRIORITY_EPS\*6/,'visual branches must reject uphill neighbours');
assert.match(visual,/\(basin\[j\]\|0\)!==b0/,'visual branches must stay inside the physical basin');
assert.match(visual,/dj<d0/,'visual branches must move toward a diagnosed receiver');
assert.match(gpu,/RIVER_GPU_MODEL=5/);
assert.match(gpu,/RIVER_GPU_UPSCALE=8/);
assert.ok(gpu.includes('riverGpuPaintVisualBranches')&&gpu.includes('riverVisualBranches'),'GPU bridge must rasterize fine tributaries');
for(const build of [sh,ps]){
  assert.ok(build.indexOf('js/river-routing-refinement.js')<build.indexOf('js/river-visual-tributaries.js'));
  assert.ok(build.indexOf('js/river-visual-tributaries.js')<build.indexOf('js/river-gpu.js'));
}

const ctx={console,Math,Number,Array,Float32Array,Float64Array,Int32Array,Int16Array,Uint8Array,
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
  c.riverChannelStrength[n-3]=0.82; // confirmed trunk before the ocean
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
}

{
  const c=chainCore();
  ctx.riverVisualHash01=()=>0; // force deterministic source acceptance for this unit test
  ctx.riverVisualBuildBranches(c);
  assert.ok(c.riverVisualBranches.length>0,'wet sloping basin should receive fine visual tributaries');
  for(const b of c.riverVisualBranches){
    const end=b.cells[b.cells.length-1];
    assert.ok(ctx.riverVisualIsReceiver(c,end)||ctx.riverIsOcean(c,end),'every visual branch must join a physical receiver');
  }
}

{
  const c=chainCore();c.relativeHumidity.fill(0);c.soilMoisture.fill(0);c.runoffGenerationRate.fill(0);c.riverRunoffMean.fill(0);
  ctx.riverVisualHash01=()=>0;ctx.riverVisualBuildBranches(c);
  assert.equal(c.riverVisualBranches.length,0,'dry terrain must not grow decorative tributaries');
}

console.log('river-visual-tributaries.test.js: OK');
