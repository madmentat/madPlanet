/* One RGBA8 texture lookup: the red channel is a painted river.
   No per-fragment geometry, integer samplers, neighboring texel search,
   artificial dark banks, or camera-dependent stroke widths. */
vec2 riverChannelSample(vec3 d,float footprint){
  if(uRiverLoopOn<0.5)return vec2(0.0);
  return vec2(texture(uRiverLoopTex,normalize(d)).r,0.0);
}
