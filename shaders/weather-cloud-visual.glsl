/* ============ 0.5.54: Weather Core cloud visual entry points ============ */
/*
   Cloud geography now comes from the body-fixed Weather Core cubemap. The
   old procedural cloud code remains available only as morphology helpers:
   cumulusShape/cloudBody/puffDetail/noise may roughen edges INSIDE a physical
   condensate field, but can no longer decide where a cloud system exists.
*/
#undef lowCover
#undef midCover
#undef lowDeck
#undef midDeck
#undef highDeck
#undef volumeLow

vec4 weatherCloudSample(vec3 dirW){
  vec3 body=normalize(uRotS*normalize(dirW));
#if __VERSION__ >= 300
  return texture(uWeatherCloudTex,body);
#else
  return textureCube(uWeatherCloudTex,body);
#endif
}

float weatherCloudLayerGain(float slider){
  /* Keep the familiar layer controls as modest visual/manual gain. At zero
     the user can still explicitly hide a layer; otherwise geography remains
     authoritative from Weather Core rather than from this scalar. */
  return ss(0.0,0.045,slider)*mix(0.84,1.16,clamp(slider,0.0,1.0));
}

float weatherCloudPhysicalDensity(float q,float shape,float edgeAmount){
  q=clamp(q,0.0,1.0);
  /* Noise perturbs only the transition of an existing physical field. As q
     tends to zero edgeAmp also tends to zero, so procedural noise cannot seed
     a cloud in a physically clear cell. Dense condensate becomes a blanket. */
  float edgeGate=ss(0.010,0.20,q)*(1.0-ss(0.52,0.94,q));
  float support=q+(shape-0.5)*edgeAmount*edgeGate;
  float body=ss(0.024,0.235,support);
  float physicalGate=ss(0.004,0.050,q);
  float optical=mix(0.48,1.0,ss(0.055,0.52,q));
  return clamp(body*physicalGate*optical,0.0,1.0);
}

float weatherLowDensity(vec3 dir,float foot,out float cauliflower,out float tower){
  vec4 phys=weatherCloudSample(dir);
  float q=phys.r*weatherCloudLayerGain(uCloudLow);
  if(q<0.003){cauliflower=0.5;tower=phys.a;return 0.0;}
  vec3 p=cumulusCoord(uRotC*dir,2.58,uSeedC+vec3(3.0,9.0,15.0));
  float shape=cumulusShape(p);
  float d=weatherCloudPhysicalDensity(q,shape,0.30);
  float fd=detailFade(82.0,foot);
  if(fd>0.02){
    float micro=0.5+0.5*fbm(p*8.2+vec3(83.0),2);
    d*=mix(0.94,1.055,micro*fd);
  }
  cauliflower=0.5+0.5*fbm(p*4.6+vec3(131.0,17.0,29.0),2);
  tower=clamp(phys.a,0.0,1.0);
  return clamp(d,0.0,1.0);
}

float weatherMidDensity(vec3 dir,float foot,out float body,out float tower){
  vec4 phys=weatherCloudSample(dir);
  float q=phys.g*weatherCloudLayerGain(uCloudMid);
  if(q<0.003){body=0.5;tower=phys.a;return 0.0;}
  vec3 p=cloudCoord(uRotC2*dir,3.35,-0.0075,uSeedC*1.55+vec3(23.0,5.0,37.0));
  body=cloudBody(p*0.95+vec3(4.0));
  float d=weatherCloudPhysicalDensity(q,body,0.24);
  float detail=puffDetail(p*1.1+vec3(9.0));
  d*=mix(0.78,1.10,detail);
  float fd=detailFade(70.0,foot);
  if(fd>0.02) d*=mix(0.95,1.055,0.5+0.5*fbm(p*9.0+vec3(101.0),2));
  tower=clamp(phys.a,0.0,1.0);
  return clamp(d,0.0,0.94);
}

float weatherHighDensity(vec3 dir,float foot,out float body,out float tower){
  vec4 phys=weatherCloudSample(dir);
  float q=phys.b*weatherCloudLayerGain(uCloudHigh);
  if(q<0.002){body=0.5;tower=phys.a;return 0.0;}
  vec3 p=cloudCoord(uRotC3*dir,4.0,-0.011,uSeedC*1.3+vec3(31.0,11.0,53.0));
  body=0.5+0.5*fbm(p*1.45,3);
  float broad=weatherCloudPhysicalDensity(q,body,0.20);
  float wispBase=0.5+0.5*fbm(p*4.1+vec3(71.0),3);
  float wispFine=0.5+0.5*fbm(p*8.2+vec3(13.0),2);
  float wisps=clamp(wispBase*0.72+wispFine*0.28,0.0,1.0);
  /* High condensate remains optically thinner than a low deck, but a deep
     convective tower can make its anvil visibly substantial. */
  tower=clamp(phys.a,0.0,1.0);
  float d=broad*mix(0.30,0.62,ss(0.03,0.60,q))*mix(0.58,1.10,wisps);
  d*=mix(0.86,1.28,tower);
  return clamp(d,0.0,0.66);
}

float lowCover(vec3 dir,float climate){
  if(uLowOn<0.5)return 0.0;
  float puff,tower;
  return pow(weatherLowDensity(dir,0.0055,puff,tower),1.10);
}
float midCover(vec3 dir){
  if(uMidOn<0.5)return 0.0;
  float body,tower;
  return weatherMidDensity(dir,0.0065,body,tower)*0.90;
}

vec3 lowDeck(vec3 dir,float foot,float climate){
  if(uLowOn<0.5)return vec3(0.0);
  float cauliflower,tower;
  float density=weatherLowDensity(dir,foot,cauliflower,tower);
  /* m.z controls cumuliform shading and vertical tower emphasis. Real deep
     convection now owns it instead of the old latitude/noise weather(). */
  float typ=clamp(0.28+0.72*tower,0.20,1.0);
  return vec3(density,cauliflower,typ);
}

vec3 midDeck(vec3 dir,float foot){
  if(uMidOn<0.5)return vec3(0.0);
  float body,tower;
  float density=weatherMidDensity(dir,foot,body,tower);
  return vec3(density,body,clamp(0.18+0.82*tower,0.0,1.0));
}

vec3 highDeck(vec3 dir,float foot){
  if(uHighOn<0.5||uDraft>0.5)return vec3(0.0);
  float body,tower;
  float density=weatherHighDensity(dir,foot,body,tower);
  return vec3(density,body,clamp(0.65+0.35*tower,0.0,1.0));
}

/* Copy of the existing inexpensive three-slice low-cloud volume, but calling
   the new physical lowDeck(). The legacy version was macro-renamed before
   clouds.glsl so its body cannot accidentally keep using procedural geography. */
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
