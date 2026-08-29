/* ============ 0.5.56 / 0.5.60 hotfix: physical near-surface fog ============ */
/*
   Fog geography comes only from the persistent Weather Core state. The GPU
   interpolates previous/current fixed-tick cubemaps and may only *erode* or
   texture an existing optical field; noise is never allowed to create fog in
   a physically clear region.

   0.5.60 hotfix removes the old optical<0.002 binary contour. With an RGBA8
   low-resolution cubemap that cutoff exposed the finite support of a single
   bilinear texel as a rectangle/cross. Weak fog now fades continuously and a
   low-frequency subtractive erosion breaks residual grid-shaped edges.
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
  if(optical<=0.0)return vec3(0.0);

  vec3 body=uRotS*normalize(dir);

  /* Large-scale erosion is strictly subtractive. It destroys the rectangular
     contour of a magnified physical texel but cannot paint fog outside a zero
     optical field. */
  vec3 pe=body*1.55+uSeedC*0.23+vec3(uTime*0.00032,0.0,-uTime*0.00021);
  float edgeNoise=0.5+0.5*fbm(pe,3);
  float erosion=mix(0.018,0.105,1.0-edgeNoise)*(1.0-0.55*smoothstep(0.28,0.78,optical));
  float shaped=max(0.0,optical-erosion);
  float softVisibility=smoothstep(0.004,0.060,shaped);
  if(softVisibility<=0.0)return vec3(0.0);

  /* Fine texture only. Bulk position and motion remain CPU-owned. */
  vec3 p=body*3.2+uSeedC*0.37+vec3(uTime*0.0017,0.0,-uTime*0.0011);
  float n=0.5+0.5*fbm(p,2);
  float textureMod=mix(0.68,1.18,n);
  float depth=clamp(phys.g,0.0,1.0);
  float density=shaped*softVisibility*textureMod*mix(0.72,1.18,depth);
  density*=detailFade(46.0,foot);
  return vec3(clamp(density,0.0,1.0),depth,0.0);
}
