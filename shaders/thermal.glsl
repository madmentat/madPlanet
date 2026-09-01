/* ============ 0.5.117 physical surface thermal view ============ */
/* Weather Core publishes surface temperature in the A channel of the shared
   fog/soil cubemap, normalized from 180 K to 380 K. The thermal instrument
   only recolors that already-computed physical field; it does not invent a
   second temperature model or add another texture/upload path. */
uniform float uThermalOn;

vec3 thermalPalette(float t){
  t=clamp(t,0.0,1.0);
  vec3 c0=vec3(0.035,0.010,0.090);
  vec3 c1=vec3(0.080,0.120,0.620);
  vec3 c2=vec3(0.000,0.760,0.900);
  vec3 c3=vec3(0.980,0.900,0.120);
  vec3 c4=vec3(0.960,0.180,0.030);
  vec3 c5=vec3(1.000,0.970,0.900);
  if(t<0.20)return mix(c0,c1,t/0.20);
  if(t<0.42)return mix(c1,c2,(t-0.20)/0.22);
  if(t<0.64)return mix(c2,c3,(t-0.42)/0.22);
  if(t<0.84)return mix(c3,c4,(t-0.64)/0.20);
  return mix(c4,c5,(t-0.84)/0.16);
}

vec3 thermalSurfaceColor(float t){
  t=clamp(t,0.0,1.0);
  vec3 c=thermalPalette(t);
  /* Fine 20 K isolines keep broad gradients readable without masking them. */
  float band=abs(fract(t*10.0)-0.5);
  float contour=smoothstep(0.035,0.090,band);
  return c*mix(0.78,1.0,contour);
}
