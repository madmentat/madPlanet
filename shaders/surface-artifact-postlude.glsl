/* 0.5.80 / 0.5.83 end of the surface-only guards.
   Do not let temporary macros leak into sphere/main code or future shader
   modules. The actual terrain global remains gSeamNear everywhere else, and
   texture() outside surface.glsl must remain the built-in sampler. */
#undef texture
#undef gSeamNear
