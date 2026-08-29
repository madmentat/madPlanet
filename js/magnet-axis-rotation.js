/* ============ 0.5.63: body-fixed magnetic-axis rotation ============ */
/*
   currentMagAxis() defines the dipole orientation relative to the spin axis.
   A tilted dipole belongs to the rotating planet, so it must precess around
   that spin axis in inertial/world coordinates instead of hanging motionless
   while the surface turns underneath it. Keep the existing slider geometry
   as the body-fixed phase-zero vector and rotate only the world-space result.
*/
const currentMagAxisBodyFixed=currentMagAxis;
const magAxisRotationEpochMs=performance.now();
currentMagAxis=function(){
  const base=currentMagAxisBodyFixed();
  if(!world?.axis || !(Number(SPIN)>0)) return base;
  const t=Math.max(0,(performance.now()-magAxisRotationEpochMs)/1000);
  return m3v(m3axis(world.axis,t*SPIN),base);
};
