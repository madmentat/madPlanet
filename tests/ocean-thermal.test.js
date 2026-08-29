const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/ocean-thermal.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=59),'ocean thermal requires 0.5.59+');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/h2o-advection.js','js/cloud-radiative-feedback.js','js/ocean-thermal.js','js/physical-fog.js'];
ordered(buildSh,order,'shell ocean thermal order');ordered(buildPs,order,'PowerShell ocean thermal order');
assert.ok(!/requestAnimationFrame|Math\.random/.test(src),'ocean thermal must stay deterministic and off render FPS');
assert.match(src,/seaSurfaceTemp/);assert.match(src,/landSurfaceTemp/);assert.match(src,/surfaceWaterFraction/);

const makeCore=()=>({
  count:2,
  surfaceTemp:new Float32Array([288,288]),
  surfaceWaterFraction:new Float32Array([0,1]),
  netRadiation:new Float32Array([400,400]),
  areaWeight:new Float32Array([1,1]),
  windU:new Float32Array([0,0]),windV:new Float32Array([0,0]),
  pressure:new Float32Array([101325,101325]),
  vaporColumn:new Float32Array([20,20]),
  cloudWaterState:new Float32Array([0.1,0.1]),
  h2oEdgeI:new Int32Array([0]),h2oEdgeJ:new Int32Array([1]),
  h2oEdgeDistance:new Float32Array([100000]),
});
const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,
  WEATHER_CORE_FIXED_DT_SEC:300,
  weatherClamp:(x,a,b)=>Math.max(a,Math.min(b,x)),
  weatherCoreCreate:()=>makeCore(),
  weatherCoreStep:(core)=>{core.surfaceTemp[0]+=50;core.surfaceTemp[1]+=50;return core;},
  weatherCoreFinite:()=>true,
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'ocean-thermal.js'});

const core=ctx.weatherCoreCreate();
assert.equal(core.oceanThermalModel,1);
for(const k of ['landSurfaceTemp','seaSurfaceTemp','mixedLayerDepthM','oceanHeatCapacity','surfaceThermalInertia']){
  assert.ok(core[k] instanceof Float32Array,k+' must be persistent Float32Array');
  assert.equal(core[k].length,core.count);
}
const beforeLand=core.landSurfaceTemp[0],beforeSea=core.seaSurfaceTemp[1];
const pressure0=Array.from(core.pressure),vapor0=Array.from(core.vaporColumn),cloud0=Array.from(core.cloudWaterState);
ctx.weatherCoreStep(core,300);
const landRise=core.landSurfaceTemp[0]-beforeLand;
const seaRise=core.seaSurfaceTemp[1]-beforeSea;
assert.ok(landRise>seaRise*5,'same radiative forcing must move land temperature much faster than SST');
assert.ok(Math.abs(core.surfaceTemp[0]-core.landSurfaceTemp[0])<1e-6,'dry cell surfaceTemp must be land skin');
assert.ok(Math.abs(core.surfaceTemp[1]-core.seaSurfaceTemp[1])<1e-6,'ocean cell surfaceTemp must be SST');
assert.ok(core.surfaceTemp[0]<300&&core.surfaceTemp[1]<300,'old trial surfaceTemp update must not accumulate as a second heat source');
assert.deepEqual(Array.from(core.pressure),pressure0,'ocean thermal must not modify pressure');
assert.deepEqual(Array.from(core.vaporColumn),vapor0,'ocean thermal must not modify vapor');
assert.deepEqual(Array.from(core.cloudWaterState),cloud0,'ocean thermal must not modify cloud water');

/* Direct SST neighbour mixing must conserve heat for equal-area equal-capacity ocean cells. */
core.surfaceWaterFraction[0]=1;core.surfaceWaterFraction[1]=1;
core.seaSurfaceTemp[0]=300;core.seaSurfaceTemp[1]=280;
core.oceanHeatCapacity[0]=1.5e8;core.oceanHeatCapacity[1]=1.5e8;
const E0=core.seaSurfaceTemp[0]*core.oceanHeatCapacity[0]+core.seaSurfaceTemp[1]*core.oceanHeatCapacity[1];
ctx.oceanDiffuseSST(core,300);
const E1=core.seaSurfaceTemp[0]*core.oceanHeatCapacity[0]+core.seaSurfaceTemp[1]*core.oceanHeatCapacity[1];
assert.ok(Math.abs(E1-E0)/Math.max(1,Math.abs(E0))<1e-6,'SST neighbour exchange must conserve ocean heat');
assert.ok(core.seaSurfaceTemp[0]<300&&core.seaSurfaceTemp[1]>280,'SST diffusion must reduce a thermal contrast');

core.windU[1]=18;
assert.ok(ctx.oceanMixedLayerDepthM(core,1)>35,'strong wind must deepen the mixed layer above the calm 35 m baseline');
assert.ok(ctx.weatherCoreFinite(core),'ocean thermal fields must remain finite');
console.log('ocean-thermal.test.js: OK');
