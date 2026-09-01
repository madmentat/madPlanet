/* Surface-only guards.
   0.5.83: the cryosphere display texture is LINEAR-filtered so its reconstructed
   cubemap does not expose every texel as a square staircase. This helper turns
   the filtered scalar field back into a material boundary with roughly one
   pixel of screen-space antialiasing. Fractional values here are raster edge
   coverage, not kilometres of semi-transparent ice.

   0.5.88: IMPORTANT — do not redefine gSeamNear here. A legacy 0.5.80
   workaround replaced the real tectonic seam with a function of mount while
   surface.glsl was being preprocessed. The real terrain global now passes
   through untouched.

   0.5.89: surface.glsl historically multiplied the finite-difference normal
   gain of EVERY land pixel by the global Tectonics slider. That made harmless
   base-terrain gradients far inside a plate become dark/light stripes when
   uTect increased. Within surface.glsl only, remap the slider through a local
   support made from actual orogenic relief (mount/ridge) or proximity to the
   real nearest/second-nearest plate margin captured in seamNearCenter. Full
   tectonic bump strength is retained where it belongs; deep plate interiors
   fall back to the neutral 0.03 base normal gain.

   GLSL preprocessing follows the usual self-disable rule while expanding a
   macro, so the uTect token inside this replacement resolves to the real
   uniform rather than recursively expanding forever. The macro is removed in
   the matching postlude immediately after surface.glsl.

   Define the texture macro only after the helper so its own built-in texture()
   call is not recursively rewritten. surface.glsl has one direct cryosphere
   texture() read which this wrapper intentionally intercepts. */
vec4 cryoSurfaceTextureAA(samplerCube tex, vec3 dir){
  vec4 q=texture(tex,dir);
  vec4 w=max(fwidth(q)*0.72,vec4(0.0035));
  return smoothstep(vec4(0.5)-w,vec4(0.5)+w,q);
}
#define texture(TEX,COORD) cryoSurfaceTextureAA(TEX,COORD)
#define uTect (uTect * max(max(ss(0.004,0.065,mount),ss(0.010,0.120,ridge)),1.0-ss(0.080,0.240,seamNearCenter)))
