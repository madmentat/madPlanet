/* End of the surface-only guards.
   Keep the cryosphere texture wrapper local to surface.glsl. gSeamNear is no
   longer a temporary macro as of 0.5.88; it is the real terrain diagnostic
   global and must not be shadowed or undefined here. */
#undef texture
