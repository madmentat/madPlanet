const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/polar-surface-thermodynamics.js'),'utf8');
const fogSkin=fs.readFileSync(path.join(root,'js/fog-skin-temperature.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
for(const [name,text] of [['shell',buildSh],['PowerShell',buildPs]]){
  ordered(text,['js/ocean-heat-transport.js','js/atmospheric-heat-transport.js','js/polar-surface-thermodynamics.js','js/cryosphere-sublimation.js'],name+' polar-physics order');
  ordered(text,['js/fog-gpu.js','js/fog-skin-temperature.js','js/cryosphere-gpu.js'],name+' skin-GPU order');
}
assert.match(src,/PST_LAPSE_K_PER_KM=6\.0/,'polar plateau must carry an explicit physical lapse-rate correction');
assert.match(src,/PST_INVERSION_MAX_K=15\.0/,'stable polar boundary layer must be represented');
assert.match(src,/surfaceSkinTemp/,'visible/radiating skin field missing');
assert.match(src,/seaIceSkinTemp/,'sea-ice skin field missing');
assert.match(src,/Math\.exp\(-h\/PST_ICE_CONDUCTION_SCALE_M\)/,'ice skin must thermally decouple from basal SST with thickness');
assert.match(src,/localEnergyFluxesBeforePolarSkin/,'OLR must be allowed to read the radiating skin rather than basal SST');
assert.match(fogSkin,/core\?\.surfaceSkinTemp/,'GPU temperature publication must prefer surface skin');
assert.ok(!/requestAnimationFrame|Math\.random/.test(src),'polar thermodynamics must stay deterministic and off render FPS');

const count=4;
const core={count,N:1,
  dirX:new Float32Array([0,0,1,0]),dirY:new Float32Array([-1,-1,0,-1]),dirZ:new Float32Array([0,0,0,0]),
  areaWeight:new Float32Array([1,1,1,1]),
  surfaceWaterFraction:new Float32Array([0,0,0,1]),
  macroTerrain:new Float32Array([0.44,0.04,0.44,-0.4]),
  landSurfaceTemp:new Float32Array([257,257,288,257]),seaSurfaceTemp:new Float32Array([271.35,271.35,288,271.35]),
  surfaceTemp:new Float32Array([257,257,288,271.35]),airTemp:new Float32Array([251,251,282,238]),
  outgoingLongwave:new Float32Array([180,180,240,180]),
  dayLengthHours:new Float32Array([12,12,12,0]),
  snowCoverFraction:new Float32Array([1,1,0,0]),landIceCoverFraction:new Float32Array([1,1,0,0]),
  seaIceThicknessM:new Float32Array([0,0,0,1.2]),seaIceConcentration:new Float32Array([0,0,0,1]),
  ohtFeedbackWm2K:3.3
};
let capturedT=NaN;
const ctx={
  console,Math,Number,Float32Array,window:{},WEATHER_CORE_FIXED_DT_SEC:300,CRYO_SEA_FREEZE_K:271.35,
  h2oSeaLevelProxy:()=>0,
  weatherCoreAxis:()=>[0,1,0],
  oceanPublishSurface:c=>{for(let i=0;i<c.count;i++){const w=c.surfaceWaterFraction[i];c.surfaceTemp[i]=c.landSurfaceTemp[i]*(1-w)+c.seaSurfaceTemp[i]*w;}return c;},
  cryoIndexForDir:()=>3,
  cryoActiveCore:core,
  localEnergyFluxes:(T,cloud,dx,dy,dz,axis,c,out)=>{capturedT=T;out.T=T;return out;},
  planetTemperatureBands:c=>({min:Math.min(...c.surfaceTemp),max:Math.max(...c.surfaceTemp)}),
  weatherCoreCreate:()=>null,weatherCoreStep:c=>c,weatherCoreFinite:()=>true,
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'polar-surface-thermodynamics.js'});
const axis=[0,1,0],climate={T:286.3};
const high=ctx.pstTargetLandOffsetK(core,0,climate,axis);
const low=ctx.pstTargetLandOffsetK(core,1,climate,axis);
const eq=ctx.pstTargetLandOffsetK(core,2,climate,axis);
assert.ok(high<-30,'a high Antarctic-like plateau must be >30 K below the old zonal target; got '+high.toFixed(1));
assert.ok(low< -8 && low> -20,'low polar continent should keep a stable-boundary-layer cold anomaly; got '+low.toFixed(1));
assert.ok(high<low-18,'3.5 km-class polar plateau must be much colder than polar lowland; '+high.toFixed(1)+' vs '+low.toFixed(1));
assert.ok(Math.abs(eq)<1e-9,'elevation alone must not create a polar inversion at the equator in this synthetic cell');

ctx.pstRefreshSkin(core,axis);
const basal=core.seaSurfaceTemp[3],skin=core.seaIceSkinTemp[3];
assert.ok(Math.abs(basal-271.35)<0.02,'sea-ice basal SST should remain near the seawater freezing point');
assert.ok(skin<248,'1.2 m winter sea ice over -35 C air should expose a sub -25 C skin; got '+(skin-273.15).toFixed(1)+' C');
assert.ok(core.surfaceSkinTemp[3]<basal-20,'thermal surface must no longer equal the warm basal SST under thick sea ice');

const out={};ctx.localEnergyFluxes(271.35,0,0,-1,0,axis,climate,out);
assert.ok(Math.abs(capturedT-core.surfaceSkinTemp[3])<1e-5,'radiative flux must use visible sea-ice skin temperature');
const bands=ctx.planetTemperatureBands(core,axis);
assert.equal(bands.min,Math.min(...core.surfaceSkinTemp),'user-facing surface diagnostics must use skin temperature');

/* GPU adapter keeps the existing piecewise packing but changes its source field. */
const gpuCtx={Math,Number,
  SURFACE_TEMP_GPU_COLD_MIN_K:80,SURFACE_TEMP_GPU_NORMAL_MIN_K:180,SURFACE_TEMP_GPU_NORMAL_MAX_K:380,SURFACE_TEMP_GPU_HOT_MAX_K:1000,
  SURFACE_TEMP_GPU_COLD_EDGE:0.05,SURFACE_TEMP_GPU_HOT_EDGE:0.90,
  fogGpuSurfaceTemp01:()=>0.5};
vm.createContext(gpuCtx);vm.runInContext(fogSkin,gpuCtx,{filename:'fog-skin-temperature.js'});
const packedSkin=gpuCtx.fogGpuSurfaceTemp01(core,3);
const skinExpected=0.05+0.85*(core.surfaceSkinTemp[3]-180)/200;
assert.ok(Math.abs(packedSkin-skinExpected)<1e-6,'GPU packed temperature must come from skin field');

console.log('polar-surface-thermodynamics.test.js: OK');
