const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/ocean-circulation.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=110),'ocean circulation requires 0.5.110+');
assert.ok(buildSh.indexOf('js/ocean-circulation.js')>buildSh.indexOf('js/cryosphere.js'),'shell build must load circulation after cryosphere');
assert.ok(buildPs.indexOf('js/ocean-circulation.js')>buildPs.indexOf('js/cryosphere.js'),'PowerShell build must load circulation after cryosphere');
assert.ok(!/requestAnimationFrame|Math\.random/.test(src),'circulation must stay deterministic and off render FPS');
assert.match(src,/windStateU/);assert.match(src,/h2oEdgeI/);assert.match(src,/seaIceThicknessM/);

const makeCore=()=>({
  count:2,N:4,seed:7,
  dirX:new Float32Array([1,0.9805807]),dirY:new Float32Array([0,0]),dirZ:new Float32Array([0,0.1961161]),
  surfaceWaterFraction:new Float32Array([1,1]),areaWeight:new Float32Array([1,1]),
  seaSurfaceTemp:new Float32Array([276,268]),surfaceTemp:new Float32Array([276,268]),
  oceanHeatCapacity:new Float32Array([1.4e8,1.4e8]),
  seaIceThicknessM:new Float32Array([1,0]),seaIceConcentration:new Float32Array([1,0]),
  windStateU:new Float32Array([-24,-24]),windStateV:new Float32Array([0,0]),windU:new Float32Array(2),windV:new Float32Array(2),
  h2oEdgeI:new Int32Array([0]),h2oEdgeJ:new Int32Array([1]),h2oEdgeDistance:new Float32Array([120000]),
});
const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,
  WEATHER_CORE_FIXED_DT_SEC:300,CRYO_SEA_ICE_MAX_M:6,
  weatherCoreAxis:()=>[0,1,0],
  weatherCoreCreate:()=>makeCore(),
  weatherCoreStep:core=>core,
  weatherCoreFinite:()=>true,
  oceanPublishSurface:core=>{for(let i=0;i<core.count;i++)core.surfaceTemp[i]=core.seaSurfaceTemp[i];return core;},
  cryoRefreshCovers:core=>{for(let i=0;i<core.count;i++)core.seaIceConcentration[i]=Math.min(1,core.seaIceThicknessM[i]);return core;},
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'ocean-circulation.js'});
const core=ctx.weatherCoreCreate();
assert.equal(core.oceanCirculationModel,1);
assert.ok(core.oceanCurrentE instanceof Float32Array&&core.oceanCurrentN instanceof Float32Array);
assert.ok(Math.hypot(core.oceanCurrentE[0],core.oceanCurrentN[0])>0,'resolved wind must drive an ocean current');

const heat0=core.seaSurfaceTemp[0]*core.oceanHeatCapacity[0]+core.seaSurfaceTemp[1]*core.oceanHeatCapacity[1];
const contrast0=core.seaSurfaceTemp[0]-core.seaSurfaceTemp[1];
ctx.oceanCircStep(core,300);
const heat1=core.seaSurfaceTemp[0]*core.oceanHeatCapacity[0]+core.seaSurfaceTemp[1]*core.oceanHeatCapacity[1];
assert.ok(Math.abs(heat1-heat0)/Math.max(1,Math.abs(heat0))<2e-6,'current-bearing heat exchange must conserve mixed-layer heat');
assert.ok(Math.abs(core.seaSurfaceTemp[0]-core.seaSurfaceTemp[1])<Math.abs(contrast0),'current-bearing edge must reduce cross-edge SST contrast');

/* Wind/current points from cell 0 toward cell 1 for this geometry. Sea-ice volume must move, not appear/disappear. */
const ice0=core.seaIceThicknessM[0]+core.seaIceThicknessM[1];
ctx.oceanCircAdvectSeaIce(core,300,[0,1,0]);
const ice1=core.seaIceThicknessM[0]+core.seaIceThicknessM[1];
assert.ok(Math.abs(ice1-ice0)<1e-6,'sea-ice drift must conserve equal-area ice volume');
assert.ok(core.seaIceThicknessM[0]<1&&core.seaIceThicknessM[1]>0,'sea ice must drift away from its original cell');
assert.ok(ctx.weatherCoreFinite(core),'circulation fields must remain finite');
console.log('ocean-circulation.test.js: OK');
