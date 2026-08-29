/* ============ 0.5.54 hotfix: legacy morphology inside physical Weather Core envelope ============ */
/*
   The first 0.5.54 visual bridge converted each coarse Weather Core texel
   almost directly into optical cloud density. On a 48x48x6 grid that exposed
   the grid itself as repeated round/square "tokens" on the planet.

   Keep the important 0.5.54 ownership rule -- Weather Core decides WHERE
   condensate is allowed -- but restore the mature 0.5.53 morphology for HOW
   cloud bodies look. The old low/mid/high implementations were already kept
   under legacy* names by weather-cloud-prelude.glsl, so reuse them here and
   multiply their continuous FBM/cumulus bodies by a smooth physical envelope.

   Consequences:
     - q == 0 => visible density is exactly zero; procedural noise cannot seed
       a cloud in physically clear air.
     - q > 0 => old connected cloud banks / cumulus lobes / wisps shape the
       cloud, so the 48x48 Weather Core texel footprint is not the silhouette.
     - deepConvectiveState still strengthens tower/anvil character.
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
  /* Layer sliders remain a modest visual/manual gain and an explicit hide
     control. They do not invent spatial cloud morphology. */
  return ss(0.0,0.045,slider)*mix(0.86,1.14,clamp(slider,0.0,1.0));
}

float weatherCloudEnvelope(float q){
  /* No threshold-derived circular body. A continuous power curve turns the
     linearly filtered physical field into opacity support. The exact zero is
     preserved, while weak neighbouring condensate fades gradually. */
  q=clamp(q,0.0,1.0);
  return (q<=0.0)?0.0:pow(q,0.56);
}

float weatherCloudOpticalGain(float q){
  q=clamp(q,0.0,1.0);
  return mix(0.70,1.16,pow(q,0.42));
}

float weatherCloudLowGate(vec3 dir,out float deep){
  vec4 phys=weatherCloudSample(dir);
  deep=clamp(phys.a,0.0,1.0);
  float q=clamp(phys.r*weatherCloudLayerGain(uCloudLow),0.0,1.0);
  return weatherCloudEnvelope(q)*weatherCloudOpticalGain(q);
}
float weatherCloudMidGate(vec3 dir,out float deep){
  vec4 phys=weatherCloudSample(dir);
  deep=clamp(phys.a,0.0,1.0);
  float q=clamp(phys.g*weatherCloudLayerGain(uCloudMid),0.0,1.0);
  return weatherCloudEnvelope(q)*weatherCloudOpticalGain(q);
}
float weatherCloudHighGate(vec3 dir,out float deep){
  vec4 phys=weatherCloudSample(dir);
  deep=clamp(phys.a,0.0,1.0);
  float q=clamp(phys.b*weatherCloudLayerGain(uCloudHigh),0.0,1.0);
  return weatherCloudEnvelope(q)*weatherCloudOpticalGain(q);
}

/* ---------- shadows use the same physical envelope + old morphology ---------- */
float lowCover(vec3 dir,float climate){
  if(uLowOn<0.5||uCloudLow<0.015)return 0.0;
  float deep;
  float gate=weatherCloudLowGate(dir,deep);
  if(gate<=0.0001)return 0.0;
  return clamp(legacyLowCover(dir,1.0)*gate,0.0,1.0);
}
float midCover(vec3 dir){
  if(uMidOn<0.5||uCloudMid<0.025)return 0.0;
  float deep;
  float gate=weatherCloudMidGate(dir,deep);
  if(gate<=0.0001)return 0.0;
  return clamp(legacyMidCover(dir)*gate,0.0,1.0);
}

/* ---------- visible cloud decks: 0.5.53 bodies, 0.5.54 geography ---------- */
vec3 lowDeck(vec3 dir,float foot,float climate){
  if(uLowOn<0.5||uCloudLow<0.015)return vec3(0.0);
  float deep;
  float gate=weatherCloudLowGate(dir,deep);
  if(gate<=0.0001)return vec3(0.0);

  /* climate=1 intentionally disables the old terrain/shoreline ownership.
     legacyLowDeck contributes only its connected cumulus morphology. */
  vec3 m=legacyLowDeck(dir,foot,1.0);
  m.x=clamp(m.x*gate,0.0,1.0);
  /* Preserve the familiar old cloud type but let real deep convection turn
     the same cloud bank into a stronger vertical tower. */
  m.z=max(m.z,0.26+0.74*deep);
  return m;
}

vec3 midDeck(vec3 dir,float foot){
  if(uMidOn<0.5||uCloudMid<0.025)return vec3(0.0);
  float deep;
  float gate=weatherCloudMidGate(dir,deep);
  if(gate<=0.0001)return vec3(0.0);
  vec3 m=legacyMidDeck(dir,foot);
  m.x=clamp(m.x*gate,0.0,0.94);
  m.z=max(m.z,0.14+0.76*deep);
  return m;
}

vec3 highDeck(vec3 dir,float foot){
  if(uHighOn<0.5||uCloudHigh<0.02||uDraft>0.5)return vec3(0.0);
  float deep;
  float gate=weatherCloudHighGate(dir,deep);
  if(gate<=0.0001)return vec3(0.0);
  vec3 m=legacyHighDeck(dir,foot);
  /* Real deep convection thickens the anvil without changing its old wispy
     morphology. */
  m.x=clamp(m.x*gate*mix(0.92,1.32,deep),0.0,0.66);
  m.z=max(m.z,0.62+0.38*deep);
  return m;
}

/* Same inexpensive three-slice low-cloud volume as before. Its samples call
   the hybrid lowDeck above, so the physical envelope and old morphology stay
   aligned through the whole cloud thickness. */
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
