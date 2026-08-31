/* Surface-only guards.
   0.5.83: the cryosphere display texture is LINEAR-filtered so its reconstructed
   cubemap does not expose every texel as a square staircase. This helper turns
   the filtered scalar field back into a material boundary with roughly one
   pixel of screen-space antialiasing. Fractional values here are raster edge
   coverage, not kilometres of semi-transparent ice.

   0.5.88: IMPORTANT — do not redefine gSeamNear here. A legacy 0.5.80
   workaround replaced the real tectonic seam with a function of mount while
   surface.glsl was being preprocessed. After 0.5.86 terrain.glsl already
   publishes the true nearest/second-nearest weighted-Voronoi boundary, but the
   old macro silently discarded it inside surface shading. That manufactured
   smooth mount contours which could cross a single displayed plate and were
   then reused by both volcanism and the Plates diagnostic. The real terrain
   global must now pass through untouched.

   Define the texture macro only after the helper so its own built-in texture()
   call is not recursively rewritten. surface.glsl has one direct cryosphere
   texture() read which this wrapper intentionally intercepts. */
vec4 cryoSurfaceTextureAA(samplerCube tex, vec3 dir){
  vec4 q=texture(tex,dir);
  vec4 w=max(fwidth(q)*0.72,vec4(0.0035));
  return smoothstep(vec4(0.5)-w,vec4(0.5)+w,q);
}
#define texture(TEX,COORD) cryoSurfaceTextureAA(TEX,COORD)
