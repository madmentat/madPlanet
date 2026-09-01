/* ---------- рельеф ---------- */
float contFreq(){ return mix(0.7, 2.6, uCont); }
float seaLvl(){ return mix(-0.25, 0.34, uSea); }

float continentH(vec3 dir){
  vec3 sN = uRotS * dir;
  vec3 p = sN*contFreq() + uSeedS;
  vec3 w = vec3(fbm(p+vec3(1.7,9.2,3.1),2),
                fbm(p+vec3(8.3,2.8,5.9),2),
                fbm(p+vec3(4.6,7.1,0.7),2));
  return fbm(p + 0.9*w, 5)*0.95 - seaLvl();
}

/* ---------- тектоника ----------
   0.5.84: the weighted-Voronoi plate network remains only the macro-scale
   organiser. The actual seam coordinate is displaced after a plate pair is
   known, so the analytic spherical arc cannot survive as a visible terrain
   stripe. Long belts are further broken by a 3-D rupture field.

   0.5.85: do not introduce a second artificial contour around that belt.
   Previous terrain() enabled tectonic relief only when abs(belt.x)>0.004.
   That tiny height discontinuity was strongly magnified by finite-difference
   normals and by the Tectonics-dependent bump gain, producing smooth dark or
   light arcs around mountain systems. Relief now approaches zero continuously.

   0.5.86: all-pair blending must not create "ghost boundaries" between two
   plates that are not the locally competing Voronoi cells. Such pairwise
   bisectors can cross inside an unrelated plate, exactly matching the reported
   smooth intersecting arcs. The visible plate boundary is now derived from the
   first/second nearest weighted sites, while relief from every all-pair term is
   smoothly attenuated unless BOTH members are locally competitive.

   0.5.87: residual faint arcs still appeared at high uTect because the
   pairCompetitive gate left enough micro-height for the Tectonics-scaled
   finite-difference bump to amplify into visible stripes far from real plate
   edges. Raised pairCompetitive to 280 and reduced the bump coefficient.

   0.5.87b: even the stronger pairCompetitive left interior stripes. The
   decisive fix is to hard-gate the physical relief by the real nearest/
   second-nearest seam distance (gSeamNear). Deep inside a plate the gate
   collapses to near-zero, so only genuine boundary-adjacent orography remains. */
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

  /* dRef stays differentiable for the physical all-pair blend. In parallel,
     dmin/dsecond track the real displayed weighted-Voronoi cell and its nearest
     competitor only. Order-statistic identities never feed terrain height. */
  float dmin = 1e9, dsecond = 1e9;
  float dRef = -dot(sN, uPlateP[0].xyz) - uPlateP[0].w;
  vec3 nearSite = uPlateP[0].xyz, secondSite = uPlateP[0].xyz;
  vec3 nearVel = uPlateW[0].xyz, secondVel = uPlateW[0].xyz;
  for(int i=0;i<uPlateN;i++){
    float d = -dot(sN, uPlateP[i].xyz) - uPlateP[i].w;
    if(i>0) dRef=tectonicSmoothMin(dRef,d);
    if(d < dmin){
      dsecond = dmin; secondSite = nearSite; secondVel = nearVel;
      dmin = d; nearSite = uPlateP[i].xyz; nearVel = uPlateW[i].xyz;
    } else if(d < dsecond){
      dsecond = d; secondSite = uPlateP[i].xyz; secondVel = uPlateW[i].xyz;
    }
  }
  gPlateTint = fract(nearSite*vec3(13.71, 7.39, 21.17) + 0.5);
  gSeamNear = 1e9; gSeamConv = 0.0;
  if(dsecond < 1e8){
    vec3 diagDb = secondSite-nearSite;
    float diagBase = max(length(diagDb),1e-4);
    vec3 diagDbT = diagDb-sN*dot(diagDb,sN);
    float diagTl = length(diagDbT);
    vec3 diagDir = diagDbT/max(diagTl,1e-4);
    float diagValid = ss(0.06,0.32,diagTl);
    /* Difference between the nearest and second-nearest weighted sites is zero
       exactly on a REAL cell boundary. Unlike the old all-pair average, this
       cannot draw pairwise bisectors through a third plate. */
    gSeamNear = max(0.0,(dsecond-dmin)/diagBase);
    float diagConv = dot(cross(nearVel-secondVel,sN),diagDir)*diagValid;
    gSeamConv = clamp(diagConv*2.4,-1.0,1.0);
  }

  const float REACH = 0.62;
  float num = 0.0, den = 1e-6, leeNum = 0.0, seamNum = 0.0;
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

      /* A pair may be geometrically close enough to enter the broad all-pair
         blend yet still be separated here by a third, nearer plate. Its own
         pairwise bisector is then NOT a physical plate boundary. Keep the
         differentiable all-pair reference, but suppress that ghost relief in
         amplitude (not in den, where normalisation would cancel the gate). */
      float pairCompetitive = exp(-280.0*(di*di + dj*dj));

      vec3 db = pj - pi;
      float base = max(length(db), 1e-4);
      vec3 dbT = db - sN*dot(db, sN);
      float dbTl = length(dbT);
      vec3 bdir = dbT/max(dbTl, 1e-4);
      float bValid = ss(0.06, 0.32, dbTl);

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
      float trench = band*rupture;

      float side = clamp(seamS/0.04, -1.0, 1.0);
      float lee = max(conv, 0.0) * ss(0.10, 0.70, dot(bdir*side, -windS))
                * exp(-seam/0.095) * rupture * pairCompetitive;

      float contrib = (convC > 0.0)
        ? convC*(arc*(0.56+0.44*rupture) - 0.035*trench*rupture)
        : convC*band*(0.16+0.44*rupture);
      contrib *= pairCompetitive;
      num    += wgt*contrib;
      leeNum += wgt*lee;
      seamNum+= wgt*pairCompetitive*seam;
      den    += wgt;
    }
  }
  return vec3(num/den, seamNum/den, clamp(leeNum/den, 0.0, 1.0));
}

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

  gSeamNear=1e9; gSeamConv=0.0; gPlateTint=vec3(0.5);
  vec3 belt=vec3(0.0);
  if(uTect > 0.01 || uPlatesOn > 0.5){
    belt = tectonicBelt(sN);
    if(uTect > 0.01) leeOut = belt.z;
  }

  if(uTect > 0.01){
    /* 0.5.87b: hard-gate by real plate boundary distance.
       gSeamNear is ~0 exactly on the nearest/second-nearest Voronoi edge and
       grows inside a plate. Only near that real edge do we allow tectonic
       height. This kills interior ghost arcs that survived the pairCompetitive
       attenuation. */
    float seamGate = exp(-28.0 * gSeamNear);
    belt.x *= seamGate;
    belt.z *= seamGate;
    leeOut *= seamGate;

    if(belt.x > 0.0){
      float peaks = ridged(sN*6.6 + uSeedS*1.9, 3);
      float foldA = 0.5 + 0.5*noise3(sN*13.5 + uSeedS*2.2 + vec3(97.0,13.0,251.0));
      float foldB = 0.5 + 0.5*noise3(sN*27.0 + uSeedS*3.4 + vec3(181.0,317.0,43.0));
      float folds = clamp(0.62*foldA + 0.38*foldB,0.0,1.0);
      float ramp = belt.x*belt.x;
      mountOut = uTect * ramp * (0.34 + 0.66*peaks) * (0.58 + 0.42*folds) * 1.38;
      rockOut = ramp * (0.30 + 0.70*peaks);
      mountOut *= mix(0.40, 1.0, ss(-0.05, 0.03, h));
      h += mountOut;
    } else if(belt.x < 0.0){
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
