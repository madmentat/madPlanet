/* ============ 0.5.56: physical near-surface fog ============ */
/*
   Fog geography no longer comes from latitude belts, coastline heuristics or
   the terminator. Weather Core owns a persistent near-surface fog state; the
   renderer only interpolates its fixed-tick cubemaps and adds subtle internal
   texture. The procedural noise can modulate optical depth but can never
   create fog where the physical field is zero.
*/

vec4 physicalFogSample(vec3 dir){
  vec3 body=normalize(uRotS*normalize(dir));
  float b=clamp(uFogBlend,0.0,1.0);
#if __VERSION__ >= 300
  vec4 prev=texture(uFogTexPrev,body);
  vec4 curr=texture(uFogTex,body);
#else
  vec4 prev=textureCube(uFogTexPrev,body);
  vec4 curr=textureCube(uFogTex,body);
#endif
  return mix(prev,curr,b);
}

vec3 fogLayer(vec3 dir,float foot){
  if(uLowOn<0.5)return vec3(0.0);
  vec4 phys=physicalFogSample(dir);
  float optical=clamp(phys.r,0.0,1.0);
  if(optical<0.002)return vec3(0.0);

  /* Fine structure only. It changes density inside an existing physical fog
     bank and is deliberately too weak to turn a clear Weather Core cell into
     visible fog. A tiny slow drift prevents the layer from looking painted on
     while bulk motion is still owned by CPU advection. */
  vec3 p=uRotS*normalize(dir)*3.2 + uSeedC*0.37 + vec3(uTime*0.0017,0.0,-uTime*0.0011);
  float n=0.5+0.5*fbm(p,2);
  float textureMod=mix(0.78,1.16,n);
  float depth=clamp(phys.g,0.0,1.0);
  float density=optical*textureMod*mix(0.72,1.18,depth);
  density*=detailFade(46.0,foot);
  return vec3(clamp(density,0.0,1.0),depth,0.0);
}
