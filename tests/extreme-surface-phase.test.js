const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const gpu=fs.readFileSync(path.join(root,'js/fog-gpu.js'),'utf8');
const surface=fs.readFileSync(path.join(root,'shaders/surface.glsl'),'utf8');

/* The old 180..380 K linear codec made -160 C look like 180 K and +627 C
   look like 380 K. Keep high precision around habitable temperatures while
   reserving explicit cold/hot tails. */
assert.match(gpu,/FOG_GPU_MODEL=3/);
assert.match(gpu,/SURFACE_TEMP_GPU_COLD_MIN_K=80/);
assert.match(gpu,/SURFACE_TEMP_GPU_NORMAL_MIN_K=180/);
assert.match(gpu,/SURFACE_TEMP_GPU_NORMAL_MAX_K=380/);
assert.match(gpu,/SURFACE_TEMP_GPU_HOT_MAX_K=1000/);
assert.match(gpu,/SURFACE_TEMP_GPU_COLD_EDGE=0\.05/);
assert.match(gpu,/SURFACE_TEMP_GPU_HOT_EDGE=0\.90/);
assert.doesNotMatch(gpu,/\(k-SURFACE_TEMP_GPU_MIN_K\)\/\(SURFACE_TEMP_GPU_MAX_K-SURFACE_TEMP_GPU_MIN_K\)/,
  'single clipped 180..380 K codec must not return');
assert.match(surface,/if\(tempCode < 0\.05\)/);
assert.match(surface,/mix\(80\.0,180\.0,tempCode\/0\.05\)/);
assert.match(surface,/mix\(380\.0,1000\.0,\(tempCode-0\.90\)\/0\.10\)/);
assert.doesNotMatch(surface,/surfaceK = mix\(180\.0,380\.0,clamp\(surfaceWx\.a/,
  'surface shader must not collapse all furnace temperatures to 380 K');

/* Biology has a hot as well as cold envelope. */
assert.match(surface,/float bioCold = ss\(268\.0,285\.0,ecologyK\)/);
assert.match(surface,/float bioHeat = 1\.0-ss\(308\.0,333\.0,ecologyK\)/);
assert.match(surface,/float bioThermal = bioCold\*bioHeat/);
assert.match(surface,/float heatSterile = 1\.0-bioHeat/);
assert.match(surface,/alb=mix\(alb,heatGround,heatSterile\*land\)/,
  'sterile hot ground must replace living colours');
assert.match(surface,/bioThermal > 0\.01/,
  'city lights must disappear with the thermal biosphere');

/* Liquid water must respect both boiling/critical temperature and deep freeze.
   The emergency local cold closure supplements the coarse cryosphere cubemap
   only at genuinely deep cold. It must be binary: a smooth 0..1 temperature
   mask used as opacity creates a fake translucent Arctic disc. */
assert.match(surface,/float boilK = clamp/);
assert.match(surface,/1\.0-ss\(635\.0,647\.0,ecologyK\)/,
  'critical water temperature backstop missing');
assert.match(surface,/float deepColdIce = \(ecologyK < 258\.15\) \? 1\.0 : 0\.0;/,
  'deep-cold fallback must be a binary phase closure');
assert.doesNotMatch(surface,/deepColdIce\s*=\s*1\.0-ss\(/,
  'deep-cold fallback must not become fractional optical opacity');
assert.match(surface,/inlandLiquid = [^;]*\*hotLiquidGate/,
  'hot inland lakes/rivers must not stay liquid');
assert.match(surface,/float seaCover=max\(seaIcePhys,deepColdIce\)/,
  'deep-cold local phase closure must cover sub-grid bays');
assert.match(surface,/float ice=seaCover/,
  'resolved ocean ice must stay binary in the surface shader');
assert.match(surface,/oc=mix\(dryBed,oc,hotLiquidGate\)/,
  'superheated ocean basins must stop rendering as blue liquid');
assert.match(surface,/\(1\.0-land\)\*\(1\.0-ice\)\*hotLiquidGate/,
  'specular water highlight must obey liquid phase');

/* Finite-difference terrain samples may not overwrite the tectonic diagnostic
   used later by volcano and plate display. Volcanic arcs should be clustered,
   not continuous black ink along the seam. */
assert.match(surface,/float seamNearCenter = gSeamNear/);
assert.match(surface,/float seamConvCenter = gSeamConv/);
assert.match(surface,/vec3 plateTintCenter = gPlateTint/);
assert.match(surface,/float arc = 1\.0 - ss\(0\.012, 0\.105, seamNearCenter\)/);
assert.match(surface,/float arcPatch = /);
assert.match(surface,/arc\*0\.58\*arcPatch/);
assert.match(surface,/ss\(w\*0\.7, w\*2\.2, seamNearCenter\)/);

console.log('extreme-surface-phase.test.js: OK');