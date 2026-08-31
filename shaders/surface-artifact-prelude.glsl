/* 0.5.80 / 0.5.83 surface-only guards.
   0.5.80: surface.glsl used the exact tectonic seam distance as a pigment mask
   for volcanic vents. On a smooth hot barren world that became a one-pixel
   dotted arc drawn across the globe. During surface shading only, replace the
   seam read with a broad orographic support derived from mount. terrain.glsl
   itself was already parsed before this macro and keeps the real tectonic
   geometry.

   0.5.83: the cryosphere display texture is now LINEAR-filtered again so its
   5x/4x reconstruction cannot expose every texel as a square staircase. This
   helper converts the filtered scalar field into a material boundary with a
   screen-space anti-alias only about one pixel wide. The fractional values are
   therefore edge coverage for rasterisation, not semi-transparent kilometres
   of ice. Define the texture macro only after the helper so its own built-in
   texture() call is not recursively rewritten. surface.glsl has exactly one
   direct texture() call here: uCryosphereTex. */
vec4 cryoSurfaceTextureAA(samplerCube tex, vec3 dir){
  vec4 q=texture(tex,dir);
  vec4 w=max(fwidth(q)*0.72,vec4(0.0035));
  return smoothstep(vec4(0.5)-w,vec4(0.5)+w,q);
}
#define texture(TEX,COORD) cryoSurfaceTextureAA(TEX,COORD)
#define gSeamNear mix(0.145,0.052,ss(0.010,0.095,mount))