/* ============ 0.5.117 / 0.5.120 physical surface thermal view ============ */
/*
   Weather Core publishes surface temperature in the A channel of the shared
   fog/soil cubemap using the piecewise 80..180 / 180..380 / 380..1000 K
   encoding from fog-gpu.js. The thermal instrument must decode that exact
   format; treating the byte as a linear 180..380 K value clips extreme worlds.

   Active volcanic vents are sub-grid features: a 32..36 cell Weather Core
   cannot resolve a lava throat that is only a few render pixels wide. Thermal
   mode therefore adds a local surface-skin heat term from the exact same
   deterministic volcanic mask used by the visible surface. This does not alter
   the global climate reservoir; it is the resolved radiating skin temperature
   of lava/vents layered on top of the Weather Core background field.
*/
uniform float uThermalOn;

float thermalDecodeSurfaceK(float code){
  code=clamp(code,0.0,1.0);
  if(code < 0.05) return mix(80.0,180.0,code/0.05);
  if(code < 0.90) return mix(180.0,380.0,(code-0.05)/0.85);
  return mix(380.0,1000.0,(code-0.90)/0.10);
}

/* Preserve most palette precision for ordinary climate temperatures, while
   reserving a hot tail for furnaces and lava. Celsius and Kelvin have the same
   interval size, so only the displayed zero point changes. */
float thermalDisplayCoordK(float K){
  K=clamp(K,80.0,1473.15);
  if(K < 180.0) return 0.08*clamp((K-80.0)/100.0,0.0,1.0);
  if(K <= 380.0) return 0.08 + 0.70*clamp((K-180.0)/200.0,0.0,1.0);
  if(K <= 1000.0) return 0.78 + 0.16*clamp((K-380.0)/620.0,0.0,1.0);
  return 0.94 + 0.06*clamp((K-1000.0)/473.15,0.0,1.0);
}

vec3 thermalPalette(float t){
  t=clamp(t,0.0,1.0);
  vec3 c0=vec3(0.035,0.010,0.090);
  vec3 c1=vec3(0.080,0.120,0.620);
  vec3 c2=vec3(0.000,0.760,0.900);
  vec3 c3=vec3(0.980,0.900,0.120);
  vec3 c4=vec3(0.960,0.180,0.030);
  vec3 c5=vec3(1.000,0.970,0.900);
  if(t<0.20)return mix(c0,c1,t/0.20);
  if(t<0.42)return mix(c1,c2,(t-0.20)/0.22);
  if(t<0.64)return mix(c2,c3,(t-0.42)/0.22);
  if(t<0.84)return mix(c3,c4,(t-0.64)/0.20);
  return mix(c4,c5,(t-0.84)/0.16);
}

/* Same geography as surface.glsl's visible volcanoes. The extra terrain call
   happens only in thermal diagnostic mode and buys exact spatial agreement
   between the dark volcanic feature and its hot thermal signature. */
float thermalVolcanicMask(vec3 n0){
  if(uVolcano <= 0.01) return 0.0;
  float ridge,mount,lee;
  float h=terrain(n0,ridge,mount,lee);
  float seamNearCenter=gSeamNear;
  vec3 sN=uRotS*n0;
  float arc=1.0-ss(0.012,0.105,seamNearCenter);
  float arcPatch=ss(0.46,0.67,0.5+0.5*fbm(sN*7.2+uSeedS*3.8+vec3(193.0,47.0,311.0),3));
  float hotspot=ss(0.575,0.655,0.5+0.5*fbm(sN*3.3+uSeedS*4.1+vec3(521.0,19.0,67.0),3));
  float vents=ss(0.520,0.600,0.5+0.5*fbm(sN*44.0+uSeedS*2.9+vec3(83.0,151.0,7.0),3));
  float volc=clamp((arc*0.58*arcPatch+hotspot*0.85)*vents*uVolcano*1.35,0.0,1.0);
  float land=ss(-0.0025,0.0025,h);
  return volc*land;
}

float thermalInstrumentSurfaceK(vec3 n0,float encodedTemp){
  float baseK=thermalDecodeSurfaceK(encodedTemp);
  float volc=thermalVolcanicMask(n0);
  if(volc<=0.001)return baseK;
  /* Active basaltic/rhyolitic lava commonly radiates at many hundreds to over
     a thousand Celsius. uLava is visual activity/brightness, so map it to a
     plausible resolved skin-temperature envelope without heating the whole
     Weather Core cell. */
  float lavaK=mix(873.15,1473.15,clamp(uLava,0.0,1.0)); /* 600..1200 °C */
  float hotK=mix(baseK,max(baseK,lavaK),pow(volc,0.58));
  return hotK;
}

vec3 thermalSurfaceColorK(float K){
  float t=thermalDisplayCoordK(K);
  vec3 c=thermalPalette(t);
  float C=K-273.15;
  /* 20 °C contours in the climate range, wider 100 °C contours in the hot
     volcanic tail. The interval is numerically identical to kelvin. */
  float stepC=(C<=120.0)?20.0:100.0;
  float band=abs(fract((C+200.0)/stepC)-0.5);
  float contour=smoothstep(0.035,0.090,band);
  return c*mix(0.78,1.0,contour);
}
