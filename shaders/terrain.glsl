/* ---------- рельеф ---------- */
float contFreq(){ return mix(0.7, 2.6, uCont); }
float seaLvl(){ return mix(-0.25, 0.34, uSea); }

/* Только макроконтур материков: ни островов, ни среднего масштаба, ни
   хребтов. Это втрое дешевле terrain() и ровно то, что нужно карте влаги —
   знать, над океаном или над материком шёл воздух. Начало намеренно
   повторяет terrain(): удешевление здесь важнее, чем общий код, потому что
   поле берётся несколькими отсчётами на каждый пиксель. */
float continentH(vec3 dir){
  vec3 sN = uRotS * dir;
  vec3 p = sN*contFreq() + uSeedS;
  vec3 w = vec3(fbm(p+vec3(1.7,9.2,3.1),2),
                fbm(p+vec3(8.3,2.8,5.9),2),
                fbm(p+vec3(4.6,7.1,0.7),2));
  return fbm(p + 0.9*w, 5)*0.95 - seaLvl();
}

/* ---------- тектоника ----------
   Плиты по-прежнему задают крупный каркас орогенеза, но их аналитическая
   power-Voronoi граница больше не должна быть непосредственно видимой как
   идеальная сферическая дуга. В 0.5.84 локальная координата каждого шва
   дополнительно коробится уже ПОСЛЕ вычисления пары плит, то есть даже
   остаточная математическая дуга не может пережить domain warp как ровная
   траншея/полоса. Расходящиеся границы стали шире, мельче и прерывистее;
   сходящиеся больше не рисуют обязательную параллельную тёмную траншею на
   любой поверхности. */
float gSeamNear, gSeamConv;
vec3  gPlateTint;

float tectonicSmoothMin(float a,float b){
  const float k=0.12;
  float h=max(k-abs(a-b),0.0)/k;
  return min(a,b)-0.25*k*h*h;
}

vec3 tectonicBelt(vec3 sN){
  vec3 wv = vec3(fbm(sN*1.9 + uSeedS*1.9 + vec3(59.0,13.0,101.0), 3),
                 fbm(sN*1.9 + uSeedS*1.9 + vec3(163.0,71.0,29.0), 3),
                 fbm(sN*1.9 + uSeedS*1.9 + vec3(233.0,37.0,89.0), 3));
  vec3 wv2 = vec3(noise3(sN*7.5 + uSeedS*2.6 + vec3(17.0)),
                  noise3(sN*7.5 + uSeedS*2.6 + vec3(83.0)),
                  noise3(sN*7.5 + uSeedS*2.6 + vec3(149.0)));
  sN = normalize(sN + wv*0.28 + wv2*0.060);

  float orogN = 0.5 + 0.5*fbm(sN*1.15 + uSeedS*3.1 + vec3(311.0,43.0,7.0), 2);
  float seg   = 0.5 + 0.5*fbm(sN*2.6 + uSeedS*2.7 + vec3(211.0,17.0,53.0), 3);
  float bw = 0.073*(0.45 + 1.15*seg)*(0.60 + 1.15*orogN);
  vec3 windS = normalize(cross(uRotS*uAxis, sN) + vec3(1e-6));

  float dmin = 1e9;
  float dRef = -dot(sN, uPlateP[0].xyz) - uPlateP[0].w;
  vec3 nearSite = uPlateP[0].xyz;
  for(int i=0;i<uPlateN;i++){
    float d = -dot(sN, uPlateP[i].xyz) - uPlateP[i].w;
    if(i>0) dRef=tectonicSmoothMin(dRef,d);
    if(d < dmin){ dmin = d; nearSite = uPlateP[i].xyz; }
  }
  gPlateTint = fract(nearSite*vec3(13.71, 7.39, 21.17) + 0.5);
  gSeamNear = 1e9; gSeamConv = 0.0;

  const float REACH = 0.62;
  float num = 0.0, den = 1e-6, leeNum = 0.0, seamNum = 0.0;
  float seamVisNum=0.0, seamVisDen=1e-6, seamConvNum=0.0;
  /* One broad breakup field is shared by all pairs. It is intentionally not a
     latitude/screen/cubemap function, so a plate boundary cannot acquire a
     globally coherent stripe direction. */
  float ruptureField = clamp(0.52*seg + 0.28*orogN + 0.20*(0.5+0.5*wv2.z),0.0,1.0);
  float rupture = 0.18 + 0.82*ss(0.26,0.66,ruptureField);

  for(int i=0;i<uPlateN;i++){
    vec3 pi = uPlateP[i].xyz;
    float di = -dot(sN, pi) - uPlateP[i].w - dRef;
    if(di > REACH) continue;
    for(int j=i+1;j<uPlateN;j++){
      vec3 pj = uPlateP[j].xyz;
      float dj = -dot(sN, pj) - uPlateP[j].w - dRef;
      float sum2 = di + dj;
      if(sum2 > REACH) continue;
      float wgt = exp(-sum2*9.0) * ss(REACH, REACH*0.7, sum2);

      vec3 db = pj - pi;
      float base = max(length(db), 1e-4);
      vec3 dbT = db - sN*dot(db, sN);
      float dbTl = length(dbT);
      vec3 bdir = dbT/max(dbTl, 1e-4);
      float bValid = ss(0.06, 0.32, dbTl);

      /* The raw weighted-Voronoi coordinate is an analytic spherical arc.
         Displace that coordinate itself with the already-computed 3-D warp,
         projected onto this particular pair's boundary normal. This costs no
         extra noise calls in the O(N²) pair loop and destroys the exact arc. */
      float seamS = (dj - di)/base;
      float seamWarp = 0.052*dot(wv2,bdir) + 0.020*dot(wv,bdir);
      seamS += seamWarp;
      float seam = abs(seamS);

      float conv = dot(cross(uPlateW[i].xyz - uPlateW[j].xyz, sN), bdir)*bValid;
      float convC = clamp(conv*2.4, -1.0, 1.0);
      float bwEff = bw*(0.66 + 1.00*abs(convC));
      float sb = seam/bwEff;
      float band = exp(-sb*sb);
      float over = (uPlateP[i].w >= uPlateP[j].w) ? 1.0 : -1.0;
      float sS = seamS*over;
      float su = (sS - 0.36*bwEff)/bwEff;
      float arc = exp(-su*su);

      float side = clamp(seamS/0.04, -1.0, 1.0);
      float lee = max(conv, 0.0) * ss(0.10, 0.70, dot(bdir*side, -windS))
                * exp(-seam/0.095) * rupture;

      float seamVisW=wgt*(1.0-ss(0.018,0.125,seam))*rupture;
      seamVisNum+=seamVisW*seam;
      seamConvNum+=seamVisW*convC;
      seamVisDen+=seamVisW;

      /* Convergence makes an uplift belt; do not engrave a compulsory dark
         parallel trench across continents. Divergent rifts remain possible,
         but are deliberately shallow/broken rather than a planet-spanning
         mathematically perfect groove. */
      float contrib = (convC > 0.0)
        ? convC*arc*(0.56+0.44*rupture)
        : convC*band*(0.16+0.44*rupture);
      num    += wgt*contrib;
      leeNum += wgt*lee;
      seamNum+= wgt*seam;
      den    += wgt;
    }
  }
  if(seamVisDen>1e-5){
    gSeamNear=seamVisNum/seamVisDen;
    gSeamConv=seamConvNum/seamVisDen;
  }
  return vec3(num/den, seamNum/den, clamp(leeNum/den, 0.0, 1.0));
}

/* rockOut  — «скалистость» 0..1 для альбедо и выбора текстуры.
   mountOut — собственно орогенная прибавка к высоте. */
float terrain(vec3 dir, out float rockOut, out float mountOut, out float leeOut){
  vec3 sN = uRotS * dir;
  vec3 p = sN*contFreq() + uSeedS;
  vec3 w = vec3(fbm(p+vec3(1.7,9.2,3.1),2),
                fbm(p+vec3(8.3,2.8,5.9),2),
                fbm(p+vec3(4.6,7.1,0.7),2));
  vec3 q = p + 0.9*w;
  float c = fbm(q,5);
  c += 0.14*fbm(q*3.1+vec3(7.0),3);
  float isl = fbm(sN*5.5 + uSeedS*1.7 + vec3(23.1),4);
  float h = c*0.95 + uIsle*0.6*max(isl-0.22,0.0) - seaLvl();
  rockOut = 0.0;
  mountOut = 0.0;
  leeOut = 0.0;

  /* tectonicBelt() is one of the most expensive parts of terrain(): 9–12
     plates imply dozens of candidate pairs, and surface normals sample
     terrain several times per fragment. Do not pay that cost at all when
     tectonic relief and the diagnostic plate overlay are both disabled. */
  gSeamNear=1e9; gSeamConv=0.0; gPlateTint=vec3(0.5);
  vec3 belt=vec3(0.0);
  if(uTect > 0.01 || uPlatesOn > 0.5){
    belt = tectonicBelt(sN);
    if(uTect > 0.01) leeOut = belt.z;
  }

  if(uTect > 0.01 && abs(belt.x) > 0.004){
    if(belt.x > 0.0){
      /* 0.5.84: replace the old 12-octave secondary ridge/fold stack with a
         cheaper five-noise breakup. The plate field supplies macro-scale
         placement; detail noise only roughens and fragments the mountain chain. */
      float peaks = ridged(sN*6.6 + uSeedS*1.9, 3);
      float foldA = 0.5 + 0.5*noise3(sN*13.5 + uSeedS*2.2 + vec3(97.0,13.0,251.0));
      float foldB = 0.5 + 0.5*noise3(sN*27.0 + uSeedS*3.4 + vec3(181.0,317.0,43.0));
      float folds = clamp(0.62*foldA + 0.38*foldB,0.0,1.0);
      float ramp = belt.x*belt.x;
      mountOut = uTect * ramp * (0.34 + 0.66*peaks) * (0.58 + 0.42*folds) * 1.38;
      rockOut = ramp * (0.30 + 0.70*peaks);
      mountOut *= mix(0.40, 1.0, ss(-0.05, 0.03, h));
      h += mountOut;
    } else {
      /* Rifts are broad depressions, not ink lines. Most of their visual
         structure is already in the warped/broken belt field above. */
      h -= uTect * belt.x*belt.x * 0.075;
    }
  }
  if(h > -0.06) h += 0.02*fbm(sN*12.0+uSeedS,2);
  float det = (uDraft > 0.5) ? 0.0 : 1.0-ss(1.7, 3.4, uCamDist);
  if(det > 0.02){
    float rough = 0.07 + 1.15*ss(0.0,0.30,rockOut) + 0.22*ss(0.10,0.40,h);
    h += det*0.030*(ridged(sN*32.0 + uSeedS*2.3, 4) - 0.55)*rough;
    float det2 = 1.0-ss(1.12, 1.9, uCamDist);
    if(det2 > 0.02)
      h += det2*0.010*(ridged(sN*160.0 + uSeedS*3.7, 3) - 0.55)*rough;
  }
  return h;
}

float iSphere(vec3 ro, vec3 rd, float r);   /* определена ниже */
