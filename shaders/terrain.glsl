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

float terrain(vec3 dir, out float ridgeOut){
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
  ridgeOut = 0.0;
  if(h > -0.06){
    float belts = 0.3 + 0.7*ss(-0.1,0.4, fbm(sN*1.8+uSeedS+vec3(13.7),3));
    float r = ridged(sN*4.2 + uSeedS*2.0, 5);
    ridgeOut = r * belts * ss(-0.02,0.12,h);
    h += (0.08 + 0.5*uMount) * ridgeOut * 0.38;
    h += 0.02*fbm(sN*12.0+uSeedS,2);
  }
  /* Мелкий рельеф проявляется при приближении: без него вблизи нет ни
     светотени, ни изрезанного берега — поверхность читается как заливка.
     Гребневой шум, а не обычный: даёт сеть хребтов и долин вместо ряби,
     и слабеет на равнинах, где эрозия всё сгладила. */
  float det = (uDraft > 0.5) ? 0.0 : 1.0-ss(1.7, 3.4, uCamDist);
  if(det > 0.02){
    float rough = 0.07 + 1.15*ss(0.0,0.30,ridgeOut) + 0.22*ss(0.10,0.40,h);
    h += det*0.030*(ridged(sN*32.0 + uSeedS*2.3, 4) - 0.55)*rough;
    float det2 = 1.0-ss(1.12, 1.9, uCamDist);
    if(det2 > 0.02)
      h += det2*0.010*(ridged(sN*160.0 + uSeedS*3.7, 3) - 0.55)*rough;
  }
  return h;
}

float iSphere(vec3 ro, vec3 rd, float r);   /* определена ниже */

