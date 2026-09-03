/* End of the surface-only guards. */
#undef uTect
#undef shadeSurface

/* 0.5.141: decode the same Weather Core skin-temperature channel used by the
   legacy surface. This post-pass is display-only: it never creates a river,
   changes runoff or alters the physical phase inventory. */
float riverOverlaySurfaceK(vec3 n0){
  float c=clamp(physicalFogSample(n0).a,0.0,1.0);
  if(c<0.05) return mix(80.0,180.0,c/0.05);
  if(c<0.90) return mix(180.0,380.0,(c-0.05)/0.85);
  return mix(380.0,1000.0,(c-0.90)/0.10);
}

/* The historical surface code still contains procedural river width/climate
   gates for compatibility mode. Physical mode gets one final visibility pass
   from the authoritative river cubemap so a diagnosed sub-cell tributary cannot
   disappear merely because the old FBM width test rejects that pixel. The base
   colour is multiplied/tinted rather than replaced, preserving day/night and
   terrain lighting. */
vec3 shadeSurface(vec3 pos, vec3 rd, float tHit, out float dayOut){
  vec3 base=shadeSurfaceLegacy(pos,rd,tHit,dayOut);
  if(uRiverPhysicsOn<0.5) return base;

  vec3 n0=normalize(pos);
  vec3 sN=normalize(uRotS*n0);
  vec4 hydro=texture(uRiverTex,sN);
  float riverPhys=clamp(mix(hydro.r,hydro.b,uRiverBlend),0.0,1.0);
  float fineCore=smoothstep(0.095,0.205,riverPhys);
  float fineHalo=smoothstep(0.030,0.115,riverPhys);
  if(fineHalo<0.002) return base;

  float surfaceK=riverOverlaySurfaceK(n0);
  float liquid=smoothstep(268.5,275.5,surfaceK)*(1.0-smoothstep(368.0,398.0,surfaceK));
  if(liquid<0.002) return base;

  vec3 waterLit=base*vec3(0.54,0.69,0.86);
  base=mix(base,waterLit,fineCore*liquid*0.76);
  base*=1.0-0.045*fineHalo*liquid;
  return base;
}
