/* ============ 0.5.117 / 0.5.120 / 0.5.124 / 0.5.125 / 0.5.129 physical surface thermal view ============ */
/*
   Weather Core publishes visible/radiating surface-skin temperature in the A
   channel of the shared fog/soil cubemap using the piecewise 80..180 /
   180..380 / 380..1000 K encoding from fog-gpu.js.

   0.5.124 reserves most palette resolution for -100..+60 C. 0.5.125 makes
   mountain relief legible as temperature rather than merely as colour/terrain:
   the CPU climate now cools broad tectonic belts through orographicRoughness,
   while this instrument applies only a bounded sub-grid lapse correction to
   individual peaks that the 36-cell Weather Core cannot spatially resolve.
   Active lava remains a local high-temperature skin overlay.

   0.5.129 also samples the exact cryosphere display mask. The temperature
   cubemap is intentionally linearly filtered, while the resolved ice edge is a
   much denser nearest-filtered mask; without a phase clamp a white ice pixel at
   that sub-grid boundary could inherit +2..+4 C from neighbouring open water.
   Exposed snow/ice therefore cannot render above 0 C unless the later explicit
   lava overlay supplies a real local heat source.
*/
uniform float uThermalOn;

float thermalDecodeSurfaceK(float code){
  code=clamp(code,0.0,1.0);
  if(code < 0.05) return mix(80.0,180.0,code/0.05);
  if(code < 0.90) return mix(180.0,380.0,(code-0.05)/0.85);
  return mix(380.0,1000.0,(code-0.90)/0.10);
}

/* Instrument coordinate, deliberately NOT linear in the full physical range.
   78% of the palette resolves -100..+60 C, where weather/ice diagnostics live.
   Temperatures above +150 C occupy only the last 10% and are chiefly volcanic. */
float thermalDisplayCoordK(float K){
  float C=clamp(K-273.15,-193.15,1200.0);
  if(C < -100.0) return 0.04*clamp((C+193.15)/93.15,0.0,1.0);
  if(C <= 60.0) return 0.04 + 0.78*clamp((C+100.0)/160.0,0.0,1.0);
  if(C <= 150.0) return 0.82 + 0.08*clamp((C-60.0)/90.0,0.0,1.0);
  return 0.90 + 0.10*clamp((C-150.0)/1050.0,0.0,1.0);
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

/* The physical Weather Core resolves the mean altitude of a mountain belt but
   not each fragment-shader peak. mountOut/rockOut come from the SAME terrain()
   call used by the visible surface. Treat only a conservative fraction as
   unresolved relief above the coarse cell mean: at most ~2.4 km, or 14.4 K at
   the same 6 K/km lapse rate used by the CPU model. */
float thermalSubgridMountainCoolingK(float mountOut,float rockOut){
  float unresolvedKm=clamp(max(0.0,mountOut)*8.0*0.45 + max(0.0,rockOut)*0.45,0.0,2.4);
  return unresolvedKm*6.0;
}

/* Same geography as surface.glsl's visible volcanoes. terrain() is evaluated
   once by thermalInstrumentSurfaceK(); capture gSeamNear immediately and pass
   it here so mountain thermography does not add another expensive terrain call. */
float thermalVolcanicMaskFromTerrain(vec3 n0,float h,float seamNearCenter){
  if(uVolcano <= 0.01) return 0.0;
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
  float ridge,mount,lee;
  float h=terrain(n0,ridge,mount,lee);
  float seamNearCenter=gSeamNear;

  /* The cryosphere texture is the same dense binary geography used by the
     normal surface renderer. Its edge can resolve well inside one coarse
     temperature texel, so enforce the water-ice phase boundary on the exact
     visible ice pixel instead of letting linear temperature filtering paint
     +3 C snow or pack ice. */
  vec3 sN=uRotS*n0;
  vec4 cryoTex=cryoSurfaceSample(uCryosphereTex,normalize(sN));
  float landCryo=mix(cryoTex.r,cryoTex.b,uCryosphereBlend);
  float seaIce=mix(cryoTex.g,cryoTex.a,uCryosphereBlend);
  float landMask=ss(-0.0025,0.0025,h);
  float visibleCryo=max(landMask*landCryo,(1.0-landMask)*seaIce);
  if(visibleCryo>0.5)baseK=min(baseK,273.15);

  /* Broad mountain cooling already lives in the CPU Weather Core. This is the
     physically justified sub-grid residual that makes individual cold crests
     visible to an IR instrument rather than inventing a second climate. */
  baseK=max(80.0,baseK-thermalSubgridMountainCoolingK(mount,ridge));

  float volc=thermalVolcanicMaskFromTerrain(n0,h,seamNearCenter);
  if(volc<=0.001)return baseK;
  float lavaK=mix(873.15,1473.15,clamp(uLava,0.0,1.0)); /* 600..1200 °C */
  return mix(baseK,max(baseK,lavaK),pow(volc,0.58));
}

vec3 thermalSurfaceColorK(float K){
  float t=thermalDisplayCoordK(K);
  vec3 c=thermalPalette(t);
  float C=K-273.15;
  /* 10 C contours in the climate range make polar/topographic gradients
     legible; the volcanic tail keeps wide 100 C bands so lava stays clean. */
  float stepC=(C<=80.0)?10.0:100.0;
  float band=abs(fract((C+200.0)/stepC)-0.5);
  float contour=smoothstep(0.035,0.090,band);
  return c*mix(0.80,1.0,contour);
}
