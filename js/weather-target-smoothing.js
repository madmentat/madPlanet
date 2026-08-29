/* ============ 0.5.60 hotfix: smooth Weather Core equilibrium targets ============ */
/*
   The original 0.5.39 bootstrap put a per-cell hash perturbation directly into
   weatherCoreTargetsForCell().  Once later physics started relaxing toward
   those targets every fixed tick, the bootstrap stopped being a seed and
   became permanent grid-scale forcing: neighbouring cells were forever a few
   kelvin apart for no physical reason.  Fog/pressure thresholds could then
   lock onto single cubemap texels.

   By 0.5.60 there are many real symmetry breakers (day/night, seasons,
   continents, SST, orography, pressure dynamics), so the equilibrium target
   must be smooth.  This replacement deliberately contains no index hash and
   allocates nothing in the hot loop.
*/

const WEATHER_TARGET_SMOOTH_MODEL=1;

weatherCoreTargetsForCell=function(c,dx,dy,dz,axis,seed,index,out){
  const lat=Math.abs(dx*axis[0]+dy*axis[1]+dz*axis[2]);
  const thermalLat=38*Math.pow(lat,2.4);
  const surfaceTemp=weatherClamp(c.T-thermalLat,120,1200);
  out.surfaceTemp=surfaceTemp;
  out.airTemp=weatherClamp(surfaceTemp-6.0,110,1200);

  const thermalAnomaly=(surfaceTemp-c.T)/Math.max(80,c.T);
  out.pressurePa=Math.max(0,c.pressureBar*1e5*(1-0.12*thermalAnomaly));

  const vaporScale=weatherClamp((Math.log10(Math.max(1e-8,c.h2oBar))+5)/3.0,0,1);
  const polarDry=0.35+0.65*(1-Math.pow(lat,1.7));
  out.humidity=weatherClamp((0.18+0.72*vaporScale)*polarDry*c.waterAvail,0,1);

  /* This field is only a bootstrap/scaffold quantity now.  Local condensate
     is owned by condensation.js; do not stamp one-cell morphology into it. */
  out.cloudWater=weatherClamp(c.cloudCov*out.humidity,0,1);
  return out;
};
