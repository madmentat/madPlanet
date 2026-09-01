/* Surface-only guards.
   0.5.83: cryosphere display texture is LINEAR-filtered.

   0.5.88: do not redefine gSeamNear here.

   0.5.89: local Tectonics normal-support remap for surface.glsl only.

   0.5.97: CRITICAL — the old cryoSurfaceTextureAA forced every coverage
   channel through smoothstep(0.5 ± fwidth). Continuous CPU ice (already
   anti-aliased and edge-noised) was re-binarized into a hard isosurface on
   the cubemap. On a 5× upscaled 32² physics grid that isosurface exposes
   cube-face polygons, triangles and "Malevich" ice islands everywhere,
   independent of Tectonics. Keep the continuous field; only a soft heel
   remains so residual encoding noise does not sparkle. */
vec4 cryoSurfaceTextureAA(samplerCube tex, vec3 dir){
  vec4 q = texture(tex, dir);
  /* soft heel only — do NOT threshold at 0.5 */
  return smoothstep(vec4(0.04), vec4(0.22), q);
}
#define texture(TEX,COORD) cryoSurfaceTextureAA(TEX,COORD)
#define uTect (uTect * max(max(ss(0.004,0.065,mount),ss(0.010,0.120,ridge)),1.0-ss(0.080,0.240,seamNearCenter)))
