const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const gpu=read('js/fog-gpu.js');
const surface=read('shaders/surface.glsl');

assert.match(gpu,/FOG_GPU_MODEL=2/,'surface-state packing must use fog GPU model v2');
assert.match(gpu,/fogGpuSoilWetness/,'soil wetness encoder missing');
assert.match(gpu,/soilMoisture/);assert.match(gpu,/soilCapacity/);
assert.match(gpu,/SURFACE_TEMP_GPU_MIN_K=180/);assert.match(gpu,/SURFACE_TEMP_GPU_MAX_K=380/);
assert.ok(!/requestAnimationFrame\s*\(/.test(gpu),'biome surface-state publication must stay fixed-tick, not FPS driven');

const ctx={console,Math,Number,Uint8Array,Array,Date,UNIFORM_NAMES:[],
  weatherCoreCreate(){return null;},weatherCoreStep(core){return core;},weatherCoreEnsure(){return null;}};
vm.createContext(ctx);vm.runInContext(gpu,ctx,{filename:'fog-gpu.js'});
const core={
  surfaceWaterFraction:new Float32Array([0,0,1]),
  soilCapacity:new Float32Array([100,100,0]),
  soilMoisture:new Float32Array([12,74,0]),
  surfaceTemp:new Float32Array([286,313,295])
};
assert.ok(Math.abs(ctx.fogGpuSoilWetness(core,0)-0.12)<1e-6,'dry land wetness must come from soil reservoir');
assert.ok(Math.abs(ctx.fogGpuSoilWetness(core,1)-0.74)<1e-6,'wet land wetness must come from soil reservoir');
assert.equal(ctx.fogGpuSoilWetness(core,2),1,'ocean must publish saturated surface wetness');
assert.ok(ctx.fogGpuSurfaceTemp01(core,1)>ctx.fogGpuSurfaceTemp01(core,0),'hotter physical surface must encode a larger thermal state');

assert.match(surface,/vec4 surfaceWx = physicalFogSample\(n0\)/,'surface must consume interpolated Weather Core surface state');
assert.match(surface,/float soilMoistPhys = clamp\(surfaceWx\.b/,'surface drought must use physical soil moisture');
assert.match(surface,/float surfaceK = mix\(180\.0,380\.0/,'surface drought must use physical surface temperature');
assert.match(surface,/float floodplain = 1\.0-ss\(/,'river floodplain wetness must exist');
assert.match(surface,/float lakeMargin = ss\(/,'lake-adjacent wetness must exist');
assert.match(surface,/float hydroWet = clamp\(/,'hydrology must feed ecological wetness');
assert.match(surface,/float ecoPatch = clamp\(/,'fine sub-cell ecological breakup missing');
assert.match(surface,/float localWetGain = mix\(/,'coarse Weather Core wetness must be an envelope, not the visible biome mask');
assert.match(surface,/drought \*= 1\.0-0\.82\*hydroWet/,'river/lake corridors must resist drought');
assert.ok(!/mix\(moist,soilGreen,0\.58\)/.test(surface),'low-resolution Weather Core cells must not directly dominate biome colour');
assert.match(surface,/STRAW=vec3/);assert.match(surface,/DRYSOIL=vec3/);
assert.match(surface,/droughtMild/);assert.match(surface,/droughtHard/);assert.match(surface,/droughtExtreme/);
assert.match(surface,/float riparian = hydroWet/,'riparian vegetation response missing');

/* 0.5.69: water is only potential habitability. Local physical temperature
   must suppress green cover before snow/ice has had time to accumulate. */
assert.match(surface,/float ecologyK = surfaceK \+ \(ecoPatch-0\.5\)\*5\.0/,'fine thermal breakup must hide coarse Weather Core cell edges');
assert.match(surface,/float bioThermal = ss\(268\.0,285\.0,ecologyK\)/,'living green cover needs a cold-stress gate');
assert.match(surface,/float deepFreeze = 1\.0-ss\(245\.0,265\.0,ecologyK\)/,'deep-freeze surface state missing');
assert.match(surface,/float riparian = [^\n]*\*bioThermal/,'wet river banks must not stay summer-green through deep frost');
assert.match(surface,/WINTER=vec3/);assert.match(surface,/FROST=vec3/);

/* 0.5.71: lake freeze morphology follows basin depth. The low lakeN edge
   must freeze at a warmer threshold than the high-lakeN interior, while
   moving rivers retain their own slightly colder freezing response. */
assert.match(surface,/float lakeInterior = ss\(lth\+0\.045,lth\+0\.16,lakeN\)/,'lake basin needs a shore-to-interior proxy');
assert.match(surface,/float lakeFreezeLo = mix\(272\.2,268\.5,lakeInterior\)/,'shallow lake margins must receive the warmer freeze threshold');
assert.match(surface,/float lakeFreezeHi = mix\(273\.9,271\.8,lakeInterior\)/,'deep lake centre must lag the shore during initial freeze-up');
assert.match(surface,/float riverFreeze = 1\.0-ss\(268\.8,272\.2,ecologyK\)/,'moving rivers need a separate later freeze response');
assert.match(surface,/float inlandLiquid = 0\.0/,'liquid inland-water fraction must be tracked separately from ice');
assert.match(surface,/alb = mix\(alb, inlandIce, frozenRv\*0\.96\)/,'inland ice colour must use the spatial frozen fraction');
assert.match(surface,/inlandLiquid\*land\*0\.40/,'only liquid inland water may retain liquid-water specular');

/* Ocean pack ice stays physically gated. Shore bias is allowed only inside
   partially frozen physical cells and must mathematically vanish at f=0/1. */
assert.match(surface,/float coastalShallow = 1\.0-ss\(0\.03,0\.24,depth\)/,'ocean edge morphology needs a bathymetric shallow-water proxy');
assert.match(surface,/float seaTransition = 4\.0\*seaIcePhys\*\(1\.0-seaIcePhys\)/,'shore bias must vanish at zero and complete physical sea-ice cover');
assert.match(surface,/float shoreBiasedSea = clamp\(seaIcePhys \+ \(coastalShallow-0\.38\)\*0\.22\*seaTransition/,'partial pack ice should preferentially occupy shallow coastal water');

/* Hydrology noise is moved before biome colour and reused later. Do not pay
   twice for river/lake FBM just to green the banks. */
assert.equal((surface.match(/float rn = fbm\(/g)||[]).length,1,'river geometry should be evaluated once');
assert.equal((surface.match(/float lakeN = fbm\(/g)||[]).length,1,'lake geometry should be evaluated once');
const hydro=surface.indexOf('float riverWarpX');
const drought=surface.indexOf('float drought =');
const biome=surface.indexOf('/* биомы */');
assert.ok(hydro>=0&&hydro<drought&&drought<biome,'hydrology must disaggregate coarse moisture before biome colour selection');

const dense=surface.indexOf('alb = mix(alb, denseC');
const inlandWater=surface.indexOf('vec3 inlandWater=');
const inlandIce=surface.indexOf('vec3 inlandIce=');
const snow=surface.indexOf('alb = mix(alb, snowC, snowM);');
const volcano=surface.indexOf('/* ---- вулканизм ----');
assert.ok(dense>=0&&inlandWater>dense&&inlandIce>inlandWater&&snow>inlandIce,
  'cryosphere must be composited after vegetation and both liquid/frozen inland hydrology');
assert.ok(volcano>snow,'active volcanic surface may break through final snow layer, not be buried by later biome paint');
assert.equal(surface.lastIndexOf('alb = mix(alb, snowC, snowM);'),snow,'snow overlay must occur exactly once and at final land-state stage');

console.log('biome-state.test.js: OK');
