const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/cryosphere.js'),'utf8');
const gpu=fs.readFileSync(path.join(root,'js/cryosphere-gpu.js'),'utf8');
const surface=fs.readFileSync(path.join(root,'shaders/surface.glsl'),'utf8');
const header=fs.readFileSync(path.join(root,'shaders/header.glsl'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=60),'cryosphere requires 0.5.60+');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/ocean-thermal.js','js/cryosphere.js','js/physical-fog.js'],'shell cryosphere order');
ordered(buildPs,['js/ocean-thermal.js','js/cryosphere.js','js/physical-fog.js'],'PowerShell cryosphere order');
ordered(buildSh,['js/fog-gpu.js','js/cryosphere-gpu.js','js/planet-export.js'],'shell cryo GPU order');
ordered(buildSh,['js/fog-render.js','js/cryosphere-render.js','js/screenshot-trigger.js'],'shell cryo render order');
assert.ok(!/requestAnimationFrame|Math\.random/.test(src),'cryosphere physics must stay deterministic and off FPS');
assert.ok(!/requestAnimationFrame/.test(gpu),'cryo texture uploads must not be render-driven');
assert.match(header,/uniform samplerCube uCryosphereTex/);assert.match(header,/uniform float uCryosphereBlend/);
assert.match(surface,/texture\(uCryosphereTex/);
assert.doesNotMatch(surface,/float\s+snowN\s*=\s*temp/,'surface shader must not recreate polar snow from decorative temperature');
assert.doesNotMatch(surface,/float\s+iceN\s*=\s*temp/,'surface shader must not recreate sea ice from decorative temperature');
assert.match(surface,/landCryoPhys/);assert.match(surface,/seaIcePhys/);
assert.match(gpu,/R\/G = previous land-cryosphere \/ sea-ice coverage/);
assert.match(gpu,/B\/A = current\s+land-cryosphere \/ sea-ice coverage/);

const makeCore=()=>({
  count:2,N:4,seed:7,ticks:0,
  surfaceTemp:new Float32Array([268,268]),
  landSurfaceTemp:new Float32Array([268,268]),
  seaSurfaceTemp:new Float32Array([268,268]),
  surfaceWaterFraction:new Float32Array([0,1]),
  surfaceSnowWater:new Float32Array([0,0]),surfaceLiquidWater:new Float32Array([0,0]),surfaceMeltRate:new Float32Array(2),
  oceanHeatCapacity:new Float32Array([1.4e8,1.4e8]),areaWeight:new Float32Array([1,1]),
  vaporColumn:new Float32Array([20,20]),cloudWaterState:new Float32Array([0.1,0.1]),pressure:new Float32Array([101325,101325]),
  dirX:new Float32Array([1,0]),dirY:new Float32Array([0,0]),dirZ:new Float32Array([0,1]),
});
const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,
  WEATHER_CORE_FIXED_DT_SEC:300,
  weatherCoreCreate:()=>makeCore(),weatherCoreStep:(core)=>{core.ticks++;return core;},weatherCoreFinite:()=>true,
  localEnergyCellAlbedo:(T,cw,c)=>0.2,
  localEnergyFluxes:(T,cw,dx,dy,dz,axis,c,out)=>{out.albedo=ctx.localEnergyCellAlbedo(T,cw,c);return out;},
  localEnergyIceAlbedo:()=>0.65,localEnergyNonIceAlbedo:()=>0.18,
  cloudRadClearGlobalAlbedo:()=>0.30,
  oceanPublishSurface:(core)=>{for(let i=0;i<core.count;i++){const w=core.surfaceWaterFraction[i];core.surfaceTemp[i]=core.landSurfaceTemp[i]*(1-w)+core.seaSurfaceTemp[i]*w;}return core;},
  precipMeltSurfaceSnow:()=>123,
  precipAreaMeanStore:()=>0,precipScaleSurfaceStore:()=>{},
  h2oApplyEvaporation:()=>0,
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'cryosphere.js'});
const core=ctx.weatherCoreCreate();
assert.equal(core.cryosphereModel,1);
assert.equal(core.seaIceThicknessM[1],0,'cold startup must not paint an instant precomputed sea-ice cap');
assert.equal(core.landIceWater[0],0,'cold startup must not paint an instant land-ice cap');

/* Sustained sub-freezing SST grows ice, but the per-day growth cap prevents a
   many-metre slab from appearing in one five-minute weather tick. */
ctx.weatherCoreStep(core,300,{},[0,1,0]);
assert.ok(core.seaIceThicknessM[1]>0&&core.seaIceThicknessM[1]<0.001,'one cold tick must grow only a sub-mm sea-ice layer');
assert.ok(core.seaIceConcentration[1]>0&&core.seaIceConcentration[1]<0.02,'first cold tick must not create a giant opaque polar cap');

/* Warm SST melts the existing pack gradually. */
core.seaIceThicknessM[1]=0.20;core.seaSurfaceTemp[1]=276;
ctx.cryoStepSea(core,300);
assert.ok(core.seaIceThicknessM[1]<0.20&&core.seaIceThicknessM[1]>0.19,'warm tick must melt sea ice gradually, not erase it');

/* Snow is a real landed-water store and latent heat turns melt into liquid. */
core.surfaceSnowWater[0]=20;core.landSurfaceTemp[0]=278;core.surfaceLiquidWater[0]=0;
ctx.cryoStepLand(core,300);
assert.ok(core.surfaceSnowWater[0]<20,'warm land must melt snow');
assert.ok(core.surfaceLiquidWater[0]>0,'snow melt must return water to landed liquid store');
assert.ok(core.landSurfaceTemp[0]<=278,'latent melt must consume sensible heat');

/* Persistent cold + a deep snowpack compacts slowly into land ice. */
core.surfaceSnowWater[0]=120;core.landSurfaceTemp[0]=260;core.landIceWater[0]=0;
ctx.cryoStepLand(core,300);
assert.ok(core.landIceWater[0]>0&&core.landIceWater[0]<1,'one tick may compact a little snow but never create an instant glacier');

const clear=ctx.cryoPhysicalClearAlbedo(280,{iceArea:0.4},0);
const icy=ctx.cryoPhysicalClearAlbedo(260,{iceArea:0.4},1);
assert.ok(icy>clear+0.25,'physical cryosphere must raise clear-sky surface albedo');
assert.ok(ctx.weatherCoreFinite(core),'cryosphere fields must remain finite');
console.log('cryosphere.test.js: OK');
