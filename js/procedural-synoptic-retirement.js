/* ============ 0.5.50: retire seeded cycA/cycB synoptic weather ============ */
/*
   Historical releases generated five random cyclone centres in deriveWorld()
   and sent them to clouds.glsl through uCycA/uCycB. Those arrays drove a
   synthetic spiral warp and front mask independently of Weather Core.

   0.5.50 retires that behaviour. The legacy arrays are kept only as zeroed
   compatibility slots until the cloud-shader ABI is rebuilt around Weather
   Core fields in 0.5.53. They contain no centres, strengths, radii, spin or
   fronts and therefore cannot influence cloud morphology.
*/

const LEGACY_SYNOPTIC_ZERO = new Float32Array(20);

function retireLegacySynopticArrays(){
  if(typeof world==='undefined'||!world) return false;
  world.cycA=new Float32Array(LEGACY_SYNOPTIC_ZERO);
  world.cycB=new Float32Array(LEGACY_SYNOPTIC_ZERO);
  return true;
}

/* Current world has already been derived when this module loads. */
retireLegacySynopticArrays();

/* Future seed/world rebuilds are neutralised immediately as well. */
if(typeof deriveWorld==='function'){
  const deriveWorldBeforeSynopticRetirement=deriveWorld;
  deriveWorld=function(){
    const result=deriveWorldBeforeSynopticRetirement.apply(this,arguments);
    retireLegacySynopticArrays();
    return result;
  };
}
