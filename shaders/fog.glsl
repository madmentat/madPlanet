/* ============ 0.5.56 / 0.5.72 / 0.5.100 / 0.5.138 physical near-surface fog ============ */
/*
   Fog geography comes only from the persistent Weather Core state. The GPU
   interpolates previous/current fixed-tick cubemaps and may only *erode* or
   texture an existing optical field; noise is never allowed to create fog in
   a physically clear region.

   0.5.60 removed the old optical<0.002 binary contour.
   0.5.72 gives fog its own render-only switch.
   0.5.100 smooths B/A surface-state diagnostics across cube boundaries.
   0.5.138 also reconstructs the low-resolution R/G fog field from a compact
   five-tap spherical footprint. A 24..36-cell Weather Core texel is a synoptic
   sample, not the visible outline of a fog bank; rendering it single-tap made
   slowly forming marine fog appear as translucent squares. The reconstruction
   is still a weighted average of physical fog samples, so it cannot invent an
   unrelated procedural fog bank.
*/

vec4 physicalFogSample(vec3 dir){
  vec3 body=normalize(uRotS*normalize(dir));
  float b=clamp(uFogBlend,0.0,1.0);
#if __VERSION__ >= 300
  #define FOG_TAP(D) mix(texture(uFogTexPrev,(D)), texture(uFogTex,(D)), b)
#else
  #define FOG_TAP(D) mix(textureCube(uFogTexPrev,(D)), textureCube(uFogTex,(D)), b)
#endif
  vec4 c0 = FOG_TAP(body);

  /* About two angular degrees on the sphere. This is intentionally comparable
     to, but smaller than, a mobile Weather Core cell: enough to destroy a
     magnified square footprint without smearing synoptic banks over continents. */
  const float o = 0.035;
  vec3 e1 = normalize(body + vec3( o,  o, 0.0));
  vec3 e2 = normalize(body + vec3(-o,  o, 0.0));
  vec3 e3 = normalize(body + vec3(0.0,-o,  o));
  vec3 e4 = normalize(body + vec3(0.0,-o, -o));
  vec4 c1 = FOG_TAP(e1), c2 = FOG_TAP(e2), c3 = FOG_TAP(e3), c4 = FOG_TAP(e4);

  /* Keep the centre authoritative while allowing adjacent physical samples to
     round the cell footprint. R/G are fog optical depth/depth; B/A are the
     surface moisture/temperature diagnostics sharing the same cubemap. */
  c0.rg = c0.rg*0.56 + (c1.rg+c2.rg+c3.rg+c4.rg)*0.11;
  c0.ba = c0.ba*0.44 + (c1.ba+c2.ba+c3.ba+c4.ba)*0.14;
  return c0;
}

vec3 fogLayer(vec3 dir,float foot){
  if(uFogOn<0.5)return vec3(0.0);
  vec4 phys=physicalFogSample(dir);
  float optical=clamp(phys.r,0.0,1.0);
  if(optical<=0.0)return vec3(0.0);

  vec3 body=uRotS*normalize(dir);

  /* Large-scale erosion is strictly subtractive. It destroys the rectangular
     contour left by the physical reconstruction but cannot paint fog where
     the reconstructed physical optical field is zero. */
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
