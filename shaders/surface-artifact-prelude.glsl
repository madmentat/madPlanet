/* Surface-only guards.
   0.5.83 / 0.5.97 / 0.5.98: cryosphere display.

   0.5.98: STOP hijacking the global texture() builtin with a #define.
   Cryosphere is sampled only via cryoSurfaceSample() from surface.glsl.
   Coverage stays continuous (no hard 0.5 isosurface on the cubemap grid).

   0.5.107: surface.glsl now already computes localTectSupport explicitly from
   real mount / ridge / seam data. The older preprocessor macro repeated that
   localisation a second time, so legitimate mountains were visually flattened.
   Keep only an amplitude calibration here: 0.06*1.75 ~= 0.105, restoring the
   pre-Grok maximum mountain normal strength while the explicit local support
   still prevents Tectonics from amplifying unrelated terrain across a plate. */
vec4 cryoSurfaceSample(samplerCube tex, vec3 dir){
  vec4 q = texture(tex, dir);
  /* soft heel only — continuous coverage, no mid-threshold polygons */
  return smoothstep(vec4(0.02), vec4(0.18), q);
}

#define uTect (1.75*uTect)
