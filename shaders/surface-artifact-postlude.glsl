/* End of the surface-only guards.
   Keep the cryosphere texture wrapper and the local Tectonics normal-support
   remap inside surface.glsl only. gSeamNear is the real terrain diagnostic
   global and must never be shadowed or undefined here. */
#undef texture
#undef uTect
