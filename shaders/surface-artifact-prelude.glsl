/* Surface-only guards.
   0.5.83 / 0.5.97 / 0.5.98: cryosphere display.

   0.5.98: STOP hijacking the global texture() builtin with a #define.
   Cryosphere is sampled only via cryoSurfaceSample() from surface.glsl.
   Coverage stays continuous (no hard 0.5 isosurface on the cubemap grid).

   0.5.107: surface.glsl already computes localTectSupport explicitly from
   real mount / ridge / seam data. Keep only an amplitude calibration here:
   0.06*1.75 ~= 0.105, restoring the pre-Grok maximum mountain normal strength
   while the explicit local support still prevents Tectonics from amplifying
   unrelated terrain across a plate.

   0.5.142: retire 0.5.141's shadeSurface wrapper. The wrapper sampled the
   physical river cubemap a second time and, around rivers, called the expensive
   five-tap/two-texture physicalFogSample() a second time. Fine rivers are now
   kept visible by a stronger narrow river-texture signal instead, so the base
   surface shader remains the only surface shading pass on mobile and desktop.
*/
vec4 cryoSurfaceSample(samplerCube tex, vec3 dir){
  vec4 q = texture(tex, dir);
  /* soft heel only — continuous coverage, no hard mid-threshold polygons */
  return smoothstep(vec4(0.02), vec4(0.18), q);
}

#define uTect (1.75*uTect)
