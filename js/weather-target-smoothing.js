/* ============ 0.5.60 / 0.5.72: smooth mean-neutral Weather Core targets ============ */
/*
   The original 0.5.39 bootstrap put a per-cell hash perturbation directly into
   weatherCoreTargetsForCell(). Once later physics started relaxing toward
   those targets every fixed tick, the bootstrap stopped being a seed and
   became permanent grid-scale forcing: neighbouring cells were forever a few
   kelvin apart for no physical reason. Fog/pressure thresholds could then lock
   onto single cubemap texels.

   0.5.72 fixes a second bootstrap error exposed by warm worlds with giant polar
   caps. climateModel().T is explicitly the planet-wide mean surface climate,
   but the old latitude profile treated it as the EQUATOR value and then only
   subtracted up to 38 K poleward. The sphere-wide target therefore started
   about 38/(2.4+1) = 11.18 K colder than the headline thermometer. A +23 C
   world physically bootstrapped close to +12 C and accumulated far too much
   transient snow/ice before the later local-energy model could recover it.

   |sin(latitude)| is uniformly distributed on a sphere, so the spherical mean
   of |sin(latitude)|^p is exactly 1/(p+1). Subtract that mean from the latitude
   term: the equator stays warmer and the poles colder, but their AREA-WEIGHTED
   mean remains climateModel().T. No seed hash and no allocation lives here.
*/

const WEATHER_TARGET_SMOOTH_MODEL=3;
const WEATHER_TARGET_LAT_GRADIENT_K=38.0;         /* Earth: +15 C mean */
const WEATHER_TARGET_LAT_GRADIENT_REF_K=288.15;
const WEATHER_TARGET_LAT_GRADIENT_SLOPE=1.5;       /* K of contrast lost per K of warming */
const WEATHER_TARGET_LAT_GRADIENT_MIN_K=14.0;
const WEATHER_TARGET_LAT_GRADIENT_MAX_K=60.0;
const WEATHER_TARGET_LAT_POWER=2.4;
const WEATHER_TARGET_LAT_MEAN=Math.pow(1.0,WEATHER_TARGET_LAT_POWER)/(WEATHER_TARGET_LAT_POWER+1.0);

/* 0.5.113: the equator-pole contrast is not a constant of nature. Polar
   amplification (ice-albedo, lapse-rate and latent-heat transport feedbacks)
   flattens it in warm climates and steepens it in cold ones: Eocene worlds at
   about +22..+25 C had roughly 20 K of contrast and no permanent ice, the
   last glacial maximum about 50 K. A fixed 38 K made every +22 C world
   freeze its poles at -5 C exactly like a +15 C one. */
function weatherTargetLatGradientK(meanK){
  const T=Number.isFinite(Number(meanK))?Number(meanK):WEATHER_TARGET_LAT_GRADIENT_REF_K;
  return weatherClamp(WEATHER_TARGET_LAT_GRADIENT_K-WEATHER_TARGET_LAT_GRADIENT_SLOPE*(T-WEATHER_TARGET_LAT_GRADIENT_REF_K),
    WEATHER_TARGET_LAT_GRADIENT_MIN_K,WEATHER_TARGET_LAT_GRADIENT_MAX_K);
}

weatherCoreTargetsForCell=function(c,dx,dy,dz,axis,seed,index,out){
  const lat=Math.abs(dx*axis[0]+dy*axis[1]+dz*axis[2]);
  const thermalLat=weatherTargetLatGradientK(c.T)*(Math.pow(lat,WEATHER_TARGET_LAT_POWER)-WEATHER_TARGET_LAT_MEAN);
  const surfaceTemp=weatherClamp(c.T-thermalLat,120,1200);
  out.surfaceTemp=surfaceTemp;
  out.airTemp=weatherClamp(surfaceTemp-6.0,110,1200);

  const thermalAnomaly=(surfaceTemp-c.T)/Math.max(80,c.T);
  out.pressurePa=Math.max(0,c.pressureBar*1e5*(1-0.12*thermalAnomaly));

  const vaporScale=weatherClamp((Math.log10(Math.max(1e-8,c.h2oBar))+5)/3.0,0,1);
  const polarDry=0.35+0.65*(1-Math.pow(lat,1.7));
  out.humidity=weatherClamp((0.18+0.72*vaporScale)*polarDry*c.waterAvail,0,1);

  /* This field is only a bootstrap/scaffold quantity now. Local condensate is
     owned by condensation.js; do not stamp one-cell morphology into it. */
  out.cloudWater=weatherClamp(c.cloudCov*out.humidity,0,1);
  return out;
};
