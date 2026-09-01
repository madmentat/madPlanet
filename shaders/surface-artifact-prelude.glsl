/* Surface-only guards.
   0.5.83 / 0.5.97 / 0.5.98: cryosphere display.

   0.5.98: STOP hijacking the global texture() builtin with a #define.
   That macro forced every later sampler through an ice softstep and was a
   landmine for fog/soil/temperature channels. Cryosphere is sampled only via
   cryoSurfaceSample() from surface.glsl.

   Coverage stays continuous (no hard 0.5 isosurface on the cubemap grid). */
vec4 cryoSurfaceSample(samplerCube tex, vec3 dir){
  vec4 q = texture(tex, dir);
  /* soft heel only — continuous coverage, no mid-threshold polygons */
  return smoothstep(vec4(0.02), vec4(0.18), q);
}

/* Local Tectonics bump support: full strength near real plate margins /
   orogeny, fade to zero deep inside a plate. */
#define uTect (uTect * max(max(ss(0.004,0.065,mount),ss(0.010,0.120,ridge)),1.0-ss(0.080,0.240,seamNearCenter)))
