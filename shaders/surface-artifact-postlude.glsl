/* 0.5.80 end of the surface-only tectonic pigment guard.
   Do not let the temporary macro leak into sphere/main code or any future
   shader module. The actual terrain global remains gSeamNear everywhere else;
   only surface colouring used the broad proxy above. */
#undef gSeamNear
