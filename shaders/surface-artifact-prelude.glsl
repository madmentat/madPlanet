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
   still prevents Tectonics from amplifying unrelated terrain across a plate.

   0.5.141: surface.glsl still contains the historical procedural-river width
   and climate gates. The CPU/GPU river bridge is now authoritative enough that
   those legacy gates may no longer be allowed to erase a diagnosed fine stream.
   Rename the original surface function locally; the postlude adds a very cheap
   river-visibility wrapper that reads only the physical river cubemap.
*/
vec4 cryoSurfaceSample(samplerCube tex, vec3 dir){
  vec4 q = texture(tex, dir);
  /* soft heel only — continuous coverage, no hard mid-threshold polygons */
  return smoothstep(vec4(0.02), vec4(0.18), q);
}

#define uTect (1.75*uTect)
#define shadeSurface shadeSurfaceLegacy
