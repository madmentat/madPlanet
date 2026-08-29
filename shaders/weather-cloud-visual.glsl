/* ============ 0.5.54 hotfix v3: inertial cloud influence + temporal interpolation ============ */
/*
   Weather Core never masks visible cloud pixels. RGB is a slowly evolving
   signed influence (-1 disperser .. 0 neutral .. +1 growth magnet) and the
   mature 0.5.53 procedural morphology remains the cloud itself.

   The CPU publishes fixed-tick influence targets into a double-buffered
   cubemap. The renderer continuously blends previous -> current between
   Weather Core ticks. This removes the last temporal staircase: formation,
   dissipation and horizontal influence changes can no longer jump once per
   weather tick even though the physics itself remains fixed-step.
*/
#undef lowCover
#undef midCover
#undef lowDeck
#undef midDeck
#undef highDeck
#undef volumeLow

vec4 weatherCloudSample(vec3 dirW){
  vec3 body=normalize(uRotS*normalize(dirW));
  float b=clamp(uWeatherCloudBlend,0.0,1.0);
#if __VERSION__ >= 300
  vec4 prev=texture(uWeatherCloudTexPrev,body);
  vec4 curr=texture(uWeatherCloudTex,body);
#else
  vec4 prev=textureCube(uWeatherCloudTexPrev,body);
  vec4 curr=textureCube(uWeatherCloudTex,body);
#endif
  return mix(prev,curr,b);
}
vec4 weatherCloudInfluence(vec3 dirW){
  vec4 s=weatherCloudSample(dirW);
  return vec4(s.rgb*2.0-1.0,clamp(s.a,0.0,1.0));
}

float weatherLowClimateFromInfluence(float f){
  /* Neutral approximates the useful mean of the old 0.5.53 climate field.
     Positive influence lowers formation thresholds through the legacy climate
     parameter; negative influence raises them. There is no geometric gate. */
  return clamp(0.72+0.60*clamp(f,-1.0,1.0),0.12,1.0);
}
float weatherLocalAmount(float base,float f,float span){
  return clamp(base+span*clamp(f,-1.0,1.0),0.0,1.0);
}

/* ---------- low deck: exact mature morphology, physical threshold bias ---------- */
float lowCover(vec3 dir,float climate){
  if(uLowOn<0.5||uCloudLow<0.015)return 0.0;
  vec4 inf=weatherCloudInfluence(dir);
  return legacyLowCover(dir,weatherLowClimateFromInfluence(inf.r));
}
vec3 lowDeck(vec3 dir,float foot,float climate){
  if(uLowOn<0.5||uCloudLow<0.015)return vec3(0.0);
  vec4 inf=weatherCloudInfluence(dir);
  vec3 m=legacyLowDeck(dir,foot,weatherLowClimateFromInfluence(inf.r));
  /* Deep convection changes vertical character, not horizontal permission. */
  m.z=max(m.z,0.24+0.76*inf.a);
  return m;
}

/* ---------- middle deck: same old noise field, local coverage threshold ---------- */
float weatherMidDensity(vec3 dir,float foot,out float body,out float typ){
  vec4 inf=weatherCloudInfluence(dir);
  vec3 p=cloudCoord(uRotC2*dir,3.35,-0.0075,uSeedC*1.55+vec3(23.0,5.0,37.0));
  body=cloudBody(p*0.95+vec3(4.0));
  float detail=puffDetail(p*1.1+vec3(9.0));
  const float midBaselineClimate=1.0;
  float amount=weatherLocalAmount(uCloudMid*midBaselineClimate,inf.g,0.32);
  float cover=coverageMask(body,amount)*0.88;
  float scMask=clamp(0.30*inf.a+0.20*max(inf.g,0.0),0.0,1.0);
  float density=cover*(0.72+0.34*detail)*mix(0.72,1.08,scMask);
  float cells=cellNoise(p*2.7+vec3(47.0));
  density*=mix(0.62,1.18,cells);
  float fd=detailFade(70.0,foot);
  if(fd>0.02)density*=mix(0.94,1.08,fbm(p*9.0+vec3(101.0),2)*0.5+0.25);
  typ=clamp(0.16+0.76*inf.a+0.08*max(inf.g,0.0),0.0,1.0);
  return clamp(density,0.0,0.92);
}
float midCover(vec3 dir){
  if(uMidOn<0.5||uCloudMid<0.025)return 0.0;
  vec4 inf=weatherCloudInfluence(dir);
  vec3 p=cloudCoord(uRotC2*dir,3.1,-0.0062,uSeedC*1.7+vec3(23.0,5.0,37.0));
  float body=cloudBody(p);
  float amount=weatherLocalAmount(uCloudMid,inf.g,0.32);
  return coverageMask(body,amount)*0.88;
}
vec3 midDeck(vec3 dir,float foot){
  if(uMidOn<0.5||uCloudMid<0.025)return vec3(0.0);
  float body,typ;
  float density=weatherMidDensity(dir,foot,body,typ);
  return vec3(density,body,typ);
}

/* ---------- high deck: old wisps, threshold shifted by slow influence ---------- */
vec3 highDeck(vec3 dir,float foot){
  if(uHighOn<0.5||uCloudHigh<0.02||uDraft>0.5)return vec3(0.0);
  vec4 inf=weatherCloudInfluence(dir);
  vec3 p=cloudCoord(uRotC3*dir,4.0,-0.011,uSeedC*1.3+vec3(31.0,11.0,53.0));
  float amount=weatherLocalAmount(uCloudHigh,inf.b,0.30);
  /* Deep convective anvils make high cloud easier to sustain but still by
     moving the threshold inside the existing wisp field, never by masking. */
  amount=clamp(amount+0.16*inf.a,0.0,1.0);
  float ca=amount*amount*(3.0-2.0*amount);
  float cloudPatch=0.5+0.5*fbm(p*0.75+vec3(127.0),3);
  float pth=mix(0.72,0.50,ca);
  cloudPatch=ss(pth,pth+0.12,cloudPatch);
  float body=0.5+0.5*fbm(p*1.45,3);
  float wispBase=0.5+0.5*fbm(p*4.1+vec3(71.0),3);
  float wispFine=0.5+0.5*fbm(p*8.2+vec3(13.0),2);
  float local=clamp(wispBase*0.72+wispFine*0.28,0.0,1.0);
  float density=cloudPatch*(0.22+0.48*body)*local*mix(0.28,0.62,ca);
  density*=smoothstep(0.18,0.55,uWind+0.15);
  density*=mix(1.0,1.22,inf.a);
  return vec3(clamp(density,0.0,0.62),body,clamp(0.72+0.28*inf.a,0.0,1.0));
}

/* Same three-slice low-cloud volume as the mature 0.5.53 renderer. */
vec4 volumeLow(vec3 ro,vec3 rd,float t0,float span,float boost,float climate){
  vec4 acc=vec4(0.0);
  int N=(uDraft>0.5)?1:3;
  for(int i=0;i<N;i++){
    float f=(float(i)+0.5)/float(N);
    float t=t0+span*f;
    vec3 nc=normalize(ro+rd*t);
    vec3 m=lowDeck(nc,t*uPixA,climate);
    float bottom=ss(0.03,0.20,f);
    float top=1.0-ss(0.70,0.98,f);
    float mid=ss(0.18,0.42,f)*(1.0-ss(0.68,0.90,f));
    float vert=0.48*bottom+0.92*mid+0.56*top;
    float tower=pow(ss(0.30,0.88,f),1.35)*m.z*0.35;
    float d=m.x*((N>1)?clamp(vert+tower,0.18,1.25):1.0);
    if(d<0.003)continue;
    vec4 c=shadeDeck(0,nc,rd,vec3(d,m.y,m.z),1.0,boost,t*uPixA);
    if(N>1)c.a=1.0-pow(max(1.0-c.a,0.0),0.68);
    acc.rgb+=(1.0-acc.a)*c.rgb*c.a;
    acc.a+=(1.0-acc.a)*c.a;
    if(acc.a>0.985)break;
  }
  return acc;
}
