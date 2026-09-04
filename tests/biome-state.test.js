const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const gpu=read('js/fog-gpu.js');
const surface=read('shaders/surface.glsl');

assert.match(gpu,/FOG_GPU_MODEL=3/,'surface-state packing must use the extreme-temperature-aware fog GPU model');
assert.match(gpu,/fogGpuSoilWetness/,'soil wetness encoder missing');
assert.match(gpu,/soilMoisture/);assert.match(gpu,/soilCapacity/);
assert.match(gpu,/SURFACE_TEMP_GPU_COLD_MIN_K=80/);
assert.match(gpu,/SURFACE_TEMP_GPU_NORMAL_MIN_K=180/);
assert.match(gpu,/SURFACE_TEMP_GPU_NORMAL_MAX_K=380/);
assert.match(gpu,/SURFACE_TEMP_GPU_HOT_MAX_K=1000/);
assert.ok(!/requestAnimationFrame\s*\(/.test(gpu),'biome surface-state publication must stay fixed-tick, not FPS driven');

const ctx={console,Math,Number,Uint8Array,Array,Date,UNIFORM_NAMES:[],
  weatherCoreCreate(){return null;},weatherCoreStep(core){return core;},weatherCoreEnsure(){return null;}};
vm.createContext(ctx);vm.runInContext(gpu,ctx,{filename:'fog-gpu.js'});
const core={
  surfaceWaterFraction:new Float32Array([0,0,1,0,0]),
  soilCapacity:new Float32Array([100,100,0,100,100]),
  soilMoisture:new Float32Array([12,74,0,0,0]),
  surfaceTemp:new Float32Array([286,313,295,113,900])
};
assert.ok(Math.abs(ctx.fogGpuSoilWetness(core,0)-0.12)<1e-6,'dry land wetness must come from soil reservoir');
assert.ok(Math.abs(ctx.fogGpuSoilWetness(core,1)-0.74)<1e-6,'wet land wetness must come from soil reservoir');
assert.equal(ctx.fogGpuSoilWetness(core,2),1,'ocean must publish saturated surface wetness');
assert.ok(ctx.fogGpuSurfaceTemp01(core,1)>ctx.fogGpuSurfaceTemp01(core,0),'hotter physical surface must encode a larger thermal state');
assert.ok(ctx.fogGpuSurfaceTemp01(core,3)<0.05,'-160 C must survive as an explicit deep-cold tail, not clip to 180 K');
assert.ok(ctx.fogGpuSurfaceTemp01(core,4)>0.90,'+627 C must survive as an explicit hot tail, not clip to 380 K');

assert.match(surface,/vec4 surfaceWx = physicalFogSample\(n0\)/,'surface must consume interpolated Weather Core surface state');
assert.match(surface,/float soilCont = clamp\(/,'continuous sub-cell soil envelope must exist to suppress cubemap face seams');
assert.match(surface,/float soilMoistPhys = mix\(soilCont, clamp\(surfaceWx\.b,0\.0,1\.0\), 0\.50\)/,
  'surface drought must blend physical soil moisture with a continuous seam-safe envelope rather than expose coarse cubemap cells directly');
assert.match(surface,/float tempCode = clamp\(surfaceWx\.a/,'surface must decode the physical temperature channel');
assert.match(surface,/mix\(80\.0,180\.0,tempCode\/0\.05\)/,'surface must decode the deep-cold temperature tail');
assert.match(surface,/mix\(380\.0,1000\.0,\(tempCode-0\.90\)\/0\.10\)/,'surface must decode the extreme-hot temperature tail');
assert.match(surface,/float floodplainProc = 1\.0-ss\(/,'sub-grid river floodplain morphology must exist');
assert.match(surface,/float floodplainPhys = floodplainProc\*\(0\.55\+0\.45\*physRiverHalo\)/,'physical river corridor must strengthen, not blanket, floodplain wetness');
assert.match(surface,/float floodplain = mix\(floodplainProc,floodplainPhys,uRiverPhysicsOn\)/,'physical/legacy floodplain selection missing');
assert.match(surface,/float lakeMarginProc = ss\(/,'sub-grid lake-adjacent wetness must exist');
assert.match(surface,/float lakeMarginPhys = ss\(lthPhys-0\.12,lthPhys\+0\.025,lakeN\)[^\n]*lakeSupport/,'physical lake support must own lake-adjacent wetness with a noise-shaped shoreline');
assert.match(surface,/float lakeMargin = mix\(lakeMarginProc,lakeMarginPhys,uRiverPhysicsOn\)/,'physical/legacy lake margin selection missing');
assert.match(surface,/float hydroWet = clamp\(/,'hydrology must feed ecological wetness');
assert.match(surface,/float ecoPatch = clamp\(/,'fine sub-cell ecological breakup missing');
assert.match(surface,/float localWetGain = mix\(/,'coarse Weather Core wetness must be an envelope, not the visible biome mask');
assert.match(surface,/drought \*= 1\.0-0\.82\*hydroWet/,'river/lake corridors must resist drought');
assert.ok(!/mix\(moist,soilGreen,0\.58\)/.test(surface),'low-resolution Weather Core cells must not directly dominate biome colour');
assert.match(surface,/STRAW=vec3/);assert.match(surface,/DRYSOIL=vec3/);
assert.match(surface,/droughtMild/);assert.match(surface,/droughtHard/);assert.match(surface,/droughtExtreme/);
assert.match(surface,/float riparian = hydroWet/,'riparian vegetation response missing');

/* Water is only potential habitability. Local physical temperature must
   suppress green cover at both deep frost and extreme heat. */
assert.match(surface,/float ecologyK = surfaceK \+ \(ecoPatch-0\.5\)\*5\.0/,'fine thermal breakup must hide coarse Weather Core cell edges');
assert.match(surface,/float bioCold = ss\(268\.0,285\.0,ecologyK\)/,'living green cover needs a cold-stress gate');
assert.match(surface,/float bioHeat = 1\.0-ss\(308\.0,333\.0,ecologyK\)/,'living green cover needs a high-temperature kill gate');
assert.match(surface,/float bioThermal = bioCold\*bioHeat/,'thermal habitability must require both cold and heat support');
assert.match(surface,/float deepFreeze = 1\.0-ss\(245\.0,265\.0,ecologyK\)/,'deep-freeze surface state missing');
assert.match(surface,/float riparian = [^\n]*\*bioThermal/,'wet river banks must not stay green outside thermal habitability');
assert.match(surface,/WINTER=vec3/);assert.match(surface,/FROST=vec3/);
assert.match(surface,/alb=mix\(alb,heatGround,heatSterile\*land\)/,'extreme heat must replace living biome colours with sterile ground');

/* Lake freeze morphology follows basin depth near the phase boundary, while a
   deep-cold local floor closes sub-grid hydrology that the coarse physics grid
   cannot resolve. Physical lakes use their resolved interior support instead
   of allowing the old FBM basin to decide lake existence. */
assert.match(surface,/float lakeInteriorProc = ss\(lth\+0\.045,lth\+0\.16,lakeN\)/,'legacy lake basin still supplies sub-grid shore texture');
assert.match(surface,/float lakeInteriorPhys = ss\(lthPhys\+0\.045,lthPhys\+0\.16,lakeN\)/,'physical lake interior must follow the physics-lowered noise threshold');
assert.match(surface,/float lakeInterior = mix\(lakeInteriorProc,lakeInteriorPhys,uRiverPhysicsOn\)/,'physical/legacy lake interior selection missing');
assert.match(surface,/float lakeFreezeLo = mix\(272\.2,268\.5,lakeInterior\)/,'shallow lake margins must receive the warmer freeze threshold');
assert.match(surface,/float lakeFreezeHi = mix\(273\.9,271\.8,lakeInterior\)/,'deep lake centre must lag the shore during initial freeze-up');
assert.match(surface,/float lakeFreeze = max\(deepColdIce,1\.0-ss\(lakeFreezeLo,lakeFreezeHi,ecologyK\)\)/,'deep cold must close lakes regardless of sub-grid mapping');
assert.match(surface,/float riverFreeze = max\(deepColdIce,1\.0-ss\(268\.8,272\.2,ecologyK\)\)/,'deep cold must close moving rivers too');
assert.match(surface,/float inlandLiquid = 0\.0/,'liquid inland-water fraction must be tracked separately from ice');
assert.match(surface,/inlandLiquid = [^;]*\*hotLiquidGate/,'inland liquid water must disappear above the boiling/critical regime');
assert.match(surface,/alb = mix\(alb, inlandIce, frozenRv\*0\.96\)/,'inland ice colour must use the spatial frozen fraction');
assert.match(surface,/inlandLiquid\*land\*0\.40/,'only liquid inland water may retain liquid-water specular');

/* Ocean bathymetry still exists for shallow/deep colour and dry-basin phase
   rendering, but ice opacity itself is now deliberately binary. A previous
   shore-bias path multiplied partial pack-ice concentration back into opacity
   and recreated the grey Arctic disc that the hard cryosphere map had already
   eliminated. */
assert.match(surface,/float depth = clamp\(dRaw\*46\.0, 0\.0, 1\.0\)/,'ocean rendering must retain explicit bathymetric depth');
assert.match(surface,/float seaCover=max\(seaIcePhys,deepColdIce\)/,'effective sea cover must combine physical ice with deep-cold sub-grid closure');
assert.match(surface,/float ice=seaCover/,'surface sea-ice opacity must stay binary after cryosphere spatial resolution');
assert.doesNotMatch(surface,/shoreBiasedSea\*iceMicro/,'bathymetry must not be converted back into fractional ice opacity');
assert.match(surface,/if\(ice > 0\.5\)\{[\s\S]*?oc = iceCol;/,'covered ocean samples must receive solid ice colour');
assert.match(surface,/oc=mix\(dryBed,oc,hotLiquidGate\)/,'hot ocean geometry must render a dry basin rather than blue liquid');

/* Hydrology noise is evaluated once and reused as sub-grid texture. It may no
   longer own river/lake placement when the physical bridge is enabled. */
assert.equal((surface.match(/float rn = fbm\(/g)||[]).length,1,'river sub-grid geometry should be evaluated once');
assert.equal((surface.match(/float lakeN = fbm\(/g)||[]).length,1,'lake sub-grid geometry should be evaluated once');
assert.match(surface,/riverGeomPhys = max\(riverGeomProc\*physRiverHalo, trunkChannel\*physRiverCore\)/,'physical halo must confine procedural channels while the core keeps the trunk continuous');
assert.doesNotMatch(surface,/riverGeomPhys = max\(riverGeomProc, trunkChannel/,'FBM zero contours must not create rivers outside physical drainage corridors');
const hydro=surface.indexOf('float riverWarpX');
const drought=surface.indexOf('float drought =');
const biome=surface.indexOf('vec3 SAND=');
assert.ok(hydro>=0&&hydro<drought&&drought<biome,'hydrology must disaggregate coarse moisture before biome colour selection');

const dense=surface.indexOf('alb = mix(alb, denseC');
const inlandWater=surface.indexOf('vec3 inlandWater=');
const inlandIce=surface.indexOf('vec3 inlandIce=');
const snow=surface.indexOf('alb = mix(alb, snowC, snowM);');
const volcano=surface.indexOf('float volc = 0.0;');
assert.ok(dense>=0&&inlandWater>dense&&inlandIce>inlandWater&&snow>inlandIce,
  'cryosphere must be composited after vegetation and both liquid/frozen inland hydrology');
assert.ok(volcano>snow,'active volcanic surface may break through final snow layer, not be buried by later biome paint');
assert.equal(surface.lastIndexOf('alb = mix(alb, snowC, snowM);'),snow,'snow overlay must occur exactly once and at final land-state stage');

console.log('biome-state.test.js: OK');
