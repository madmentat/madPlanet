/* End of the surface-only guards.
   0.5.142: no second shadeSurface wrapper. Physical fine rivers are kept
   visible by the river display texture itself, avoiding duplicate river/fog
   cubemap reads in the already large fragment shader. */
#undef uTect
