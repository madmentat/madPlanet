/* ---------- поверхность ---------- */
vec3 shadeSurface(vec3 pos, vec3 rd, float tHit, out float dayOut){
  vec3 n0 = normalize(pos);
  vec3 atmC = atmoColor();
  float ridge, mount, lee;
  float h = terrain(n0, ridge, mount, lee);
  vec3 sN = uRotS*n0;
  vec4 cryoTex = texture(uCryosphereTex, normalize(sN));
  float landCryoPhys = mix(cryoTex.r, cryoTex.b, uCryosphereBlend);
  float seaIcePhys = mix(cryoTex.g, cryoTex.a, uCryosphereBlend);
  /* 0.5.66: B/A of the existing double-buffered fog/weather texture carry
     coarse physical soil wetness and Weather Core surface temperature. 0.5.67
     deliberately treats these as a broad envelope only: direct thresholding
     of the low-resolution cubemap painted its cubed-sphere cells onto biomes. */
  vec4 surfaceWx = physicalFogSample(n0);
  float soilMoistPhys = clamp(surfaceWx.b,0.0,1.0);
  float surfaceK = mix(180.0,380.0,clamp(surfaceWx.a,0.0,1.0));

  /* нормали по конечным разностям (только у суши/мелководья) */
  vec3 nS = n0;
  float gradH = 0.0;
  float eps = clamp(tHit*uPixA*2.0, 0.0006, 0.02);
  if(h > -0.05){
    vec3 tg = normalize(cross(n0, (abs(n0.y)<0.99) ? vec3(0,1,0) : vec3(1,0,0)));
    vec3 bt = cross(n0, tg);
    float rr1, rr2, mm1, mm2, ll1, ll2;
    float h1 = terrain(normalize(n0 + tg*eps), rr1, mm1, ll1);
    float h2 = terrain(normalize(n0 + bt*eps), rr2, mm2, ll2);
    gradH = length(vec2(h1-h, h2-h))/eps;
    float bmp = (0.03 + 0.095*uTect) * (1.0 + 1.3*(1.0-ss(1.7, 3.4, uCamDist)));
    nS = normalize(n0 - (tg*(h1-h) + bt*(h2-h)) * (bmp/eps));
  }

  /* Ширина береговой линии — ровно пиксель. Раньше порог задавался в единицах
     высоты, и на пологом побережье, где рельеф почти горизонтален, кромка
     расплывалась на десятки пикселей. Теперь след пикселя пересчитывается
     через настоящий градиент высоты. */
  float pixH = gradH * tHit * uPixA;
  float aa = clamp(pixH*1.1, 1.0e-5, 0.02);
  float land = ss(-aa, aa, h);

  /* Поверхность океана плоская: раньше её нормаль бралась из рельефа дна,
     и мелководье затенялось как склон — лагуны выглядели горами воды. */
  nS = normalize(mix(n0, nS, land));

  /* климат */
  float lat = abs(dot(n0, uAxis));
  float temp = mix(-0.55, 1.55, uTemp) - pow(lat,3.0)*1.55 - max(h,0.0)*0.95
             + 0.22*fbm(sN*1.3+uSeedS*1.1+vec3(61.0),3)
             + 0.16*fbm(sN*3.2+uSeedS+vec3(5.5),3) + 0.10*fbm(sN*7.8+uSeedS,3);
  /* Два слагаемых ниже алгебраически равны прежнему
     temp -= mix(3.6,0.55,uSnowAlt)*mount. Базовый орографический lapse
     остаётся явным для старого regression guard; uSnowAlt лишь корректирует
     его, но физическое наличие снега теперь всё равно приходит из Weather Core. */
  temp -= 2.0*mount;
  temp -= (mix(3.6, 0.55, uSnowAlt)-2.0)*mount;
  float moist = 0.5 + 0.5*fbm(sN*2.4 + uSeedS*1.3 + vec3(17.0), 4);

  /* ---- опустынивание и приморское озеленение ---- */
  float baseH = h - mount;
  float contin = ss(0.02, 0.30, baseH);
  float coastal = 1.0 - contin;
  float arid = ss(0.46, 1.00, temp) * contin * (0.30 + 0.70*ss(0.06, 0.55, lee));
  moist = clamp(moist*(1.0 - 0.78*arid) + 0.22*coastal*coastal, 0.0, 1.0);

  /* 0.5.67: fine ecological geography is resolved from fields we already
     needed later for rivers/lakes and vegetation. Weather Core remains coarse
     and cheap, but its cells no longer become visible green rectangles. */
  float riverWarpX = fbm(sN*3.1+uSeedS,3);
  float riverWarpY = fbm(sN*3.1+uSeedS+vec3(7.7),3);
  float rn = fbm(sN*5.2 + uSeedS*1.9 + 0.5*vec3(riverWarpX,riverWarpY,0.0), 4);
  float wVar = 0.45 + 1.15*(0.5+0.5*fbm(sN*19.0 + uSeedS + vec3(71.0), 3));
  float wReal = mix(0.013, 0.0030, ss(0.02,0.22,h)) * wVar;
  float wPix = tHit*uPixA*1.6;
  float w = max(wReal, wPix);
  float riverSignal = abs(rn) + 0.0016*fbm(sN*260.0+uSeedS,2);
  float riverGeom = 1.0 - ss(w*0.82, w*1.06, riverSignal);
  /* Floodplain width is world-space, not pixel-space: zooming cannot change
     which soil is ecologically close to a river. */
  float floodplain = 1.0-ss(wReal*1.7,wReal*6.2,abs(rn));
  floodplain *= 1.0-ss(0.14,0.32,h);

  float lakeN = fbm(sN*3.4 + uSeedS*3.7 + vec3(53.0), 4);
  float lth = mix(0.46, 0.20, uLake);
  float lakeGeom = ss(lth,lth+0.07,lakeN) * (1.0-ss(0.05,0.14,h)) * ss(0.02,0.10,uLake);
  float lakeMargin = ss(lth-0.12,lth+0.025,lakeN) * (1.0-ss(0.07,0.18,h)) * ss(0.02,0.10,uLake);

  /* These three fields existed in 0.5.66 as cosmetic vegetation breakup.
     Reuse them earlier as sub-cell ecological structure instead of adding new
     FBM calls. This makes patches smaller/more numerous at almost no extra
     fragment cost. */
  float mo1 = 0.5+0.5*fbm(sN*9.0  + uSeedS*2.1 + vec3(101.0), 3);
  float mo2 = 0.5+0.5*fbm(sN*19.0 + uSeedS*3.3 + vec3(202.0), 3);
  float mo3 = 0.5+0.5*fbm(sN*38.0 + uSeedS*1.5 + vec3(303.0), 2);
  float ecoPatch = clamp(0.42*mo1+0.36*mo2+0.22*mo3,0.0,1.0);
  float lowlandWet = coastal*coastal*(0.30+0.70*soilMoistPhys);
  float hydroWet = clamp(max(floodplain*0.92,lakeMargin*0.82)+0.18*lowlandWet,0.0,1.0);

  /* Static climate says what biome can exist here. Low-resolution physical
     soil water only bends that potential up/down; local ecological texture and
     hydrology decide where living cover actually concentrates inside a cell. */
  float soilGreen = ss(0.08,0.72,soilMoistPhys);
  float soilDry = 1.0-ss(0.16,0.58,soilMoistPhys);
  float heatStress = ss(289.0,315.0,surfaceK);
  float localWetGain = mix(0.82,1.16,soilGreen) * mix(0.90,1.10,ecoPatch);
  moist = clamp(moist*localWetGain + 0.34*hydroWet,0.0,1.0);
  float localDryBreakup = mix(1.12,0.72,ecoPatch);
  float drought = clamp(soilDry*(0.30+0.70*heatStress)*localDryBreakup*land,0.0,1.0);
  drought *= 1.0-0.82*hydroWet;
  moist = clamp(moist*(1.0-0.38*drought),0.0,1.0);
  moist = clamp(moist + 0.20*ss(0.0004, 0.040, uCO2)*(1.0-max(arid,drought)), 0.0, 1.0);

  /* биомы */
  vec3 SAND=vec3(0.42,0.36,0.25), REDR=vec3(0.31,0.19,0.12), STEP=vec3(0.25,0.23,0.13),
       GRAS=vec3(0.15,0.22,0.09), FORS=vec3(0.070,0.125,0.060), JUNG=vec3(0.050,0.115,0.050),
       TUND=vec3(0.26,0.245,0.20), ROCK=vec3(0.25,0.22,0.19), SNOW=vec3(0.78,0.81,0.86),
       STRAW=vec3(0.30,0.265,0.135), DRYSOIL=vec3(0.285,0.225,0.155);
  float rocky = 0.5+0.5*fbm(sN*3.7+uSeedS+vec3(27.0),3);
  vec3 hot  = mix(mix(SAND,REDR,ss(0.35,0.75,rocky)), JUNG, ss(0.48,0.75,moist));
  vec3 midc = mix(STEP, mix(GRAS,FORS,ss(0.35,0.7,moist)), ss(0.15,0.48,moist));
  vec3 cold = mix(TUND, FORS*0.8+vec3(0.02), ss(0.5,0.8,moist));
  vec3 alb = mix(cold, midc, ss(0.02,0.3,temp));
  alb = mix(alb, hot, ss(0.55,0.95,temp));

  /* Drought progression is not one brown overlay. Mild stress yellows living
     cover, stronger stress exposes dull soil, and only hot prolonged extreme
     dryness approaches sand/red-rock colours. Fine ecological breakup is now
     reused here, so coarse Weather Core cells cannot define the patch edge. */
  float dryPatch=0.58+0.42*(0.56*mo1+0.44*mo2);
  float droughtMild=ss(0.10,0.45,drought);
  float droughtHard=ss(0.42,0.78,drought);
  float droughtExtreme=ss(0.74,0.96,drought)*heatStress;
  vec3 wither=mix(STRAW,DRYSOIL,0.22+0.42*rocky);
  alb=mix(alb,wither,droughtMild*(1.0-0.70*droughtHard)*0.72*dryPatch);
  vec3 severe=mix(DRYSOIL,mix(SAND,REDR,ss(0.42,0.78,rocky)),droughtExtreme);
  alb=mix(alb,severe,droughtHard*(0.68+0.32*dryPatch));

  /* 0.5.60: снег/ледник больше не рождаются из temp+latitude threshold.
     Weather Core передаёт только физическую долю покрытия; непрерывный noise
     слегка разбивает фактуру, но при нулевом physical cover снег невозможен. */
  float cdet = (uDraft > 0.5) ? 0.0 : 1.0-ss(1.6, 3.2, uCamDist);
  /* capEdge — историческое имя regression-якоря. Теперь это НЕ маска шапки:
     значение выводится только из уже физического coverage и применяется лишь
     к цветовой фактуре у его края. Оно не может создать снег при cover=0. */
  float capEdge = 4.0*landCryoPhys*(1.0-landCryoPhys);
  float snowMicro = 0.88 + 0.12*(0.5+0.5*fbm(sN*11.0+uSeedS+vec3(31.0),3));
  float snowM = clamp(landCryoPhys*snowMicro, 0.0, 1.0);
  if(mount > 0.02){
    float rough = 0.5+0.5*fbm(sN*26.0+uSeedS*1.6+vec3(211.0),3);
    float steepBare = ss(1.1, 3.4, gradH);
    float bare = clamp(steepBare*0.75 + (1.0-rough)*0.55, 0.0, 1.0);
    snowM *= 1.0 - bare*ss(0.02, 0.13, mount)*0.85;
  }

  float warmN = 0.5 + 0.5*fbm(sN*2.9 + uSeedS*3.3 + vec3(407.0,29.0,71.0), 3);
  float warmRock = ss(0.40, 0.90, temp)
                 * (1.0 - 0.78*ss(0.30, 0.70, moist))
                 * ss(0.38, 0.78, warmN)
                 * (1.0 - ss(0.66, 0.90, lat));
  vec3 SLOPE = mix(vec3(0.188,0.178,0.162), vec3(0.268,0.222,0.162), warmRock);
  vec3 ALPINE= mix(vec3(0.118,0.116,0.120), vec3(0.196,0.156,0.126), warmRock);
  float rocky2 = 0.55 + 0.45*ss(0.20,0.70,ridge);
  float bMid  = ss(0.060, 0.145, mount*rocky2);
  float bHigh = ss(0.125, 0.255, mount*rocky2);
  alb = mix(alb, SLOPE,  bMid *0.88*(1.0-snowM));
  alb = mix(alb, ALPINE, bHigh*0.82*(1.0-snowM));
  alb = mix(alb, ROCK, ss(0.45,0.90,ridge)*(1.0-snowM)*0.45);
  vec3 snowC = SNOW*(0.88+0.16*(0.5+0.5*fbm(sN*16.0+uSeedS+vec3(9.0),3)));
  float capTex = 0.5+0.5*fbm(sN*1.45+uSeedS*2.2+vec3(163.0,17.0,59.0),3);
  snowC *= 1.0 + capEdge*0.04*(capTex-0.5);
  if(cdet > 0.02){
    float cr = ridged(sN*110.0 + uSeedS*1.4, 3);
    snowC *= 1.0 - cdet*0.30*ss(0.52,1.0,cr);
  }

  float beach = ss(0.0,0.0014,h)*(1.0-ss(0.002,0.0055,h));
  beach *= 0.35+0.65*(0.5+0.5*fbm(sN*21.0+uSeedS+vec3(43.0),2));
  beach *= ss(0.22,0.65,temp)*(1.0-0.75*ss(0.55,0.85,moist));
  alb = mix(alb, SAND*1.02, beach*0.55*(1.0-snowM));
  float veg = fbm(sN*7.5 + uSeedS*4.0, 3);
  /* Vegetation texture belongs below the cryosphere. It may vary the living
     biome, but it must never repaint physical snow green afterwards. */
  alb *= 1.0 + 0.18*veg*(1.0-0.72*drought);
  vec3 bareC  = mix(vec3(0.20,0.165,0.115), REDR, ss(0.40,0.92,temp));
  vec3 denseC = FORS*0.82;
  alb = mix(alb, bareC,  ss(0.46,0.63,mo1)*0.80*(1.0-0.75*ss(0.52,0.70,moist)));
  alb = mix(alb, denseC, ss(0.45,0.62,mo2)*0.70*ss(0.34,0.55,moist)*(1.0-droughtHard));
  alb *= 0.80 + 0.42*mo3;

  /* Riparian vegetation is an ecological response to water geometry, not a
     square Weather Core cell. It stays irregular because river/lake corridors
     are intersected with the pre-existing fine vegetation fields. */
  float riparian = hydroWet*ss(0.18,0.58,moist)*(0.68+0.32*mo2)*(1.0-droughtHard);
  vec3 riparianC = mix(GRAS,mix(FORS,JUNG,ss(0.62,0.96,temp)),ss(0.36,0.70,moist));
  alb = mix(alb,riparianC,riparian*0.48);

  /* реки и озёра: geometry was computed before biome colouring and is reused
     here, so adding river-fed greening costs no duplicate hydrology FBM. */
  float rv = 0.0;
  if(h > 0.0 && snowM < 0.85){
    float riv = riverGeom;
    riv *= clamp(wReal/wPix*0.8, 0.0, 1.0);
    riv *= ss(0.24,0.44,moist) * (1.0-ss(0.16,0.30,h));
    float lake = lakeGeom * ss(0.20,0.38,moist);
    rv = clamp(riv + lake, 0.0, 1.0) * (1.0 - snowM*0.9);
    alb = mix(alb, mix(vec3(0.022,0.062,0.090), vec3(0.045,0.135,0.155), ss(0.30,0.85,temp)), rv*0.90);
  }

  /* 0.5.66: the cryosphere is a surface state, not a biome. Apply it after
     vegetation, drought, beaches and hydrology so a frozen forest/grassland
     really becomes white instead of later biome detail painting through it. */
  alb = mix(alb, snowC, snowM);

  /* ---- вулканизм ----
     Active vents are allowed to break through snow after the final cryosphere
     layer; emissive lava is added later in lighting space as before. */
  float volc = 0.0;
  if(uVolcano > 0.01){
    float arc = 1.0 - ss(0.008, 0.075, gSeamNear);
    float hotspot = ss(0.575, 0.655, 0.5+0.5*fbm(sN*3.3+uSeedS*4.1+vec3(521.0,19.0,67.0),3));
    float vents = ss(0.520, 0.600, 0.5+0.5*fbm(sN*44.0+uSeedS*2.9+vec3(83.0,151.0,7.0),3));
    volc = clamp((arc*1.05 + hotspot*0.85)*vents*uVolcano*1.35, 0.0, 1.0);
    alb = mix(alb, vec3(0.052,0.048,0.047), volc*0.88*land);
  }

  /* океан */
  float dRaw = -h + 0.0045*fbm(sN*26.0 + uSeedS + vec3(63.0), 3)
                  + 0.0020*fbm(sN*90.0 + uSeedS + vec3(11.0), 2);
  float depth = clamp(dRaw*46.0, 0.0, 1.0);
  vec3 shallowC = mix(vec3(0.028,0.100,0.145), vec3(0.075,0.30,0.34), ss(0.30,0.85,temp));
  vec3 oc = mix(shallowC, vec3(0.013,0.072,0.130), ss(0.0,0.5,pow(depth,0.55)));
  oc = mix(oc, vec3(0.004,0.020,0.050), ss(0.34,1.0,pow(depth,0.45)));
  float chop = 1.0-ss(1.5,3.0,uCamDist);
  if(chop > 0.02)
    oc *= 1.0 + chop*0.13*fbm(sN*420.0 + vec3(uTime*0.35, 0.0, uTime*0.2), 3);
  /* 0.5.60: sea-ice area comes only from physical SST/latent-heat state. */
  float iceMicro = 0.92 + 0.08*(0.5+0.5*fbm(sN*18.0+uSeedS+vec3(3.0),2));
  float ice = clamp(seaIcePhys*iceMicro,0.0,1.0);
  if(ice > 0.01){
    vec3 iceCol = vec3(0.80,0.86,0.92)*(0.86+0.24*(0.5+0.5*fbm(sN*30.0+uSeedS,2)));
    oc = mix(oc, iceCol, ice*0.95);
  }
  vec3 albF = mix(oc, alb, land);

  /* зернистость */
  float g1 = fbm(sN*24.0 + uSeedS*3.0, 3);
  albF *= 1.0 + 0.20*g1*mix(0.35,1.0,land);
  float fade = 1.0-ss(1.6,2.8,uCamDist);
  if(fade > 0.02){
    float g2 = fbm(sN*75.0 + uSeedS*5.0, 3);
    albF *= 1.0 + fade*0.22*g2*mix(0.3,1.0,land);
  }
  float fade2 = 1.0-ss(1.3,1.9,uCamDist);
  if(fade2 > 0.02){
    float g3 = fbm(sN*300.0 + uSeedS*7.0, 3);
    albF *= 1.0 + fade2*0.18*g3*mix(0.3,1.0,land);
  }

  /* освещение */
  float ndlG = dot(n0, uSunDir);
  float dayF = ss(-0.02, 0.12, ndlG);
  dayOut = dayF;
  float dif = max(dot(nS, uSunDir), 0.0);
  float steep = ss(0.55, 2.60, gradH);
  if(steep > 0.01)
    dif = mix(dif, ss(-0.02, 0.20, dot(nS, uSunDir))*max(dot(nS,uSunDir),0.0), steep*0.75);
  float shad = ringShadow(pos);
  if(dayF > 0.01){
    float cs = (uLowOn > 0.5) ? lowCover(normalize(n0 + uSunDir*0.030), gClimLow) : 0.0;
    float cm = (uMidOn > 0.5) ? midCover(normalize(n0 + uSunDir*0.055)) : 0.0;
    shad *= (1.0 - 0.76*cs*dayF) * (1.0 - 0.35*cm*dayF);
  }
  vec3 sunC = uStarCol * 1.25 * clamp(0.34 + 0.66*sqrt(max(uStarFlux,0.0)), 0.22, 1.65);
  vec3 col = albF * dif * shad * sunC;

  /* блик солнца на воде */
  float waterM = max((1.0-land)*(1.0-ice), rv*land*0.40);
  if(waterM > 0.01){
    vec3 hv = normalize(uSunDir - rd);
    float cosH = max(dot(nS, hv), 0.0);
    float waveTx = 0.65 + 0.7*noise3(sN*150.0 + vec3(uTime*0.6));
    float spec = pow(cosH, 650.0)*1.5*waveTx + pow(cosH, 90.0)*0.06;
    col += vec3(1.0,0.93,0.78) * sunC * spec * waterM * shad * dayF;
  }
  col += sunC * pow(max(dot(nS, normalize(uSunDir-rd)),0.0), 200.0) * ice * (1.0-land) * 0.06 * dayF;

  vec3 skyScat = mix(atmC, uStarCol, 0.25);
  col += albF * dayF * 0.05 * skyScat * uAtmo;
  float twi = exp(-pow(ndlG*12.0, 2.0));
  vec3 sunsetCol = mix(vec3(0.95,0.45,0.18), uStarCol*1.2, 0.55);
  col += albF * twi * sunsetCol * 0.18 * uAtmo;

  /* ночь: огни городов */
  float nightF = 1.0 - dayF;
  if(nightF > 0.01 && uCity > 0.01 && land > 0.01){
    float pop = 0.5+0.5*fbm(sN*9.0 + uSeedS*2.7 + vec3(41.0), 4);
    float th = mix(0.66, 0.42, uCity);
    float gate = ss(th, th+0.26, pop);
    if(gate > 0.003){
      float core = ss(th+0.22, th+0.32, pop);
      float coast = 1.0-ss(0.0,0.045,h);
      float low   = 1.0-ss(0.02,0.30,h);
      float habit = 0.35 + 1.0*max(coast, low*0.65) + 0.5*rv;
      float w1 = 1.0-abs(fbm(sN*11.0 + uSeedS*1.7, 3));
      float w2 = 1.0-abs(fbm(sN*27.0 + uSeedS*2.3 + vec3(7.0), 3));
      float web = pow(clamp(w1,0.0,1.0), 4.0) + 0.8*pow(clamp(w2,0.0,1.0), 6.0);
      float fine = 1.0-ss(1.3, 2.3, uCamDist);
      if(fine > 0.02){
        float w3 = 1.0-abs(fbm(sN*74.0 + uSeedS*3.1 + vec3(17.0), 3));
        web += fine*0.8*pow(clamp(w3,0.0,1.0), 7.0);
      }
      float quarters = clamp(0.55 + 0.9*fbm(sN*mix(16.0, 85.0, fine) + uSeedS*4.3, 3), 0.15, 1.6);
      float urban = clamp(gate*habit*quarters*(0.30 + 1.0*web), 0.0, 1.0);
      float mask = land*(1.0-snowM)*(1.0 - ss(0.02, 0.22, volc));
      vec3 pts = vec3(0.0);
      float limb = 1.0-abs(dot(n0,-rd));
      float twA = 0.04 + 0.11*limb;
      int nLvl = (uDraft > 0.5) ? 2 : 5;
      vec3 q = sN;
      for(int L=0; L<5; L++){
        if(L >= nLvl) break;
        q = M3*q;
        float sc = 45.0*pow(2.72, float(L));
        float pxc = tHit*uPixA*sc;
        if(pxc > 2.5) continue;
        vec3 p = q*sc + uSeedS*3.0;
        vec3 idc = floor(p), fc = fract(p);
        vec3 ha = hash33(idc + vec3(float(L)*31.7));
        float thr = mix(0.972, 0.20, urban);
        float lit = ss(thr, thr+0.05, ha.z);
        if(lit < 0.002) continue;
        vec3 hb = hash33(idc*1.37 + vec3(11.3 + float(L)*7.1));
        float dd = length(fc - (0.08 + 0.84*hb));
        float r0  = 0.030 + 0.050*pow(ha.x, 3.0);
        r0 = min(r0, max(pxc*4.0, 0.006));
        float sg  = max(r0, pxc*0.85);
        float peak = (r0*r0)/(sg*sg);
        float br = (0.18 + 5.5*pow(ha.x, 5.0)) * (0.30 + 1.5*urban) * pow(0.62, float(L));
        float tw = 1.0 - twA*(0.5+0.5*sin(uTime*(0.7+1.6*hb.x) + hb.y*61.0));
        vec3 cc = mix(vec3(1.0,0.60,0.24), vec3(1.0,0.93,0.80), clamp(br*peak*0.18,0.0,1.0));
        cc = mix(cc, vec3(0.84,0.90,1.06), ss(0.82,0.97,hb.z)*0.65);
        pts += cc * lit * br * peak * exp(-dd*dd/(sg*sg)) * tw;
      }
      float unres = 1.0 - clamp(0.05/max(tHit*uPixA*60.0, 1e-5), 0.0, 1.0);
      vec3 glowC = mix(vec3(1.0,0.68,0.34), vec3(0.85,0.88,1.0), ss(0.65,0.92,pop)*0.4);
      col += nightF * uCity * mask
           * (glowC*urban*(0.20+0.7*core)*0.25*(0.35+0.65*unres) + pts*1.1);
    }
  }
  if(uLava > 0.01 && volc > 0.02){
    float hotFlow = ss(0.18, 0.70, volc);
    float pulse = 0.55 + 0.45*sin(uTime*0.7 + volc*37.0 + uSeedS.x*11.0);
    col += vec3(1.0,0.34,0.07)*hotFlow*uLava*(0.18 + 1.15*nightF)*pulse*land;
  }

  col += nightF * albF * 0.020 * vec3(0.4,0.55,0.9);

  /* ---- схема литосферных плит ---- */
  if(uPlatesOn > 0.5){
    float w = max(tHit*uPixA*1.4, 0.0022);
    float line = 1.0 - ss(w*0.7, w*2.2, gSeamNear);
    vec3 lc = (gSeamConv > 0.0) ? vec3(1.00,0.36,0.18) : vec3(0.28,0.72,1.00);
    vec3 tint = mix(vec3(dot(gPlateTint, vec3(0.33))), gPlateTint, 0.75);
    col = mix(col, tint*0.62 + 0.12, 0.13);
    col = mix(col, lc, line*0.92);
  }
  return col;
}