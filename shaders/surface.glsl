/* ---------- поверхность ---------- */
vec3 shadeSurface(vec3 pos, vec3 rd, float tHit, out float dayOut){
  vec3 n0 = normalize(pos);
  vec3 atmC = atmoColor();
  float ridge, mount, lee;
  float h = terrain(n0, ridge, mount, lee);
  vec3 sN = uRotS*n0;

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
  /* Высотный градиент был вчетверо завышен: любая суша выше уровня моря
     промерзала, и планета выцветала в снег. */
  float temp = mix(-0.55, 1.55, uTemp) - pow(lat,3.0)*1.55 - max(h,0.0)*0.95
             + 0.22*fbm(sN*1.3+uSeedS*1.1+vec3(61.0),3)      /* крупные климатические лопасти */
             + 0.16*fbm(sN*3.2+uSeedS+vec3(5.5),3) + 0.10*fbm(sN*7.8+uSeedS,3);
  /* Альпийское похолодание. Общий высотный градиент нарочно пологий, иначе
     любое плоскогорье промерзает и планета выцветает в снег. Но снеговая
     шапка нужна именно хребтам, поэтому добавка идёт только от орогенной
     высоты: чем жарче у подножия, тем выше по склону уходит линия снега. */
  temp -= 2.0*mount;
  float moist = 0.5 + 0.5*fbm(sN*2.4 + uSeedS*1.3 + vec3(17.0), 4);

  /* ---- опустынивание и приморское озеленение ----
     Сухо там, где жарко и далеко от моря, а наветренный хребет уже отжал
     влагу из воздуха. Дождевую тень lee приносит сама тектоника: она знает
     и направление на ближайший шов, и расстояние до него. Поэтому пустыня
     упирается в хребет и за ним обрывается, а у берега ей противостоит
     увлажнение с моря. */
  float baseH = h - mount;                       /* высота до орогенеза */
  float contin = ss(0.02, 0.30, baseH);          /* континентальность */
  float coastal = 1.0 - contin;
  float arid = ss(0.46, 1.00, temp) * contin * (0.30 + 0.70*ss(0.06, 0.55, lee));
  moist = clamp(moist*(1.0 - 0.78*arid) + 0.22*coastal*coastal, 0.0, 1.0);

  /* биомы */
  /* Альбедо близко к настоящим: песок ~0.4, лес ~0.12, снег ~0.8.
     С прежними завышенными значениями подсолнечная точка выбивалась в белый
     и вместе с ней исчезала вся детализация. */
  vec3 SAND=vec3(0.42,0.36,0.25), REDR=vec3(0.31,0.19,0.12), STEP=vec3(0.25,0.23,0.13),
       GRAS=vec3(0.15,0.22,0.09), FORS=vec3(0.070,0.125,0.060), JUNG=vec3(0.050,0.115,0.050),
       TUND=vec3(0.26,0.245,0.20), ROCK=vec3(0.25,0.22,0.19), SNOW=vec3(0.78,0.81,0.86);
  float rocky = 0.5+0.5*fbm(sN*3.7+uSeedS+vec3(27.0),3);
  vec3 hot  = mix(mix(SAND,REDR,ss(0.35,0.75,rocky)), JUNG, ss(0.48,0.75,moist));
  vec3 midc = mix(STEP, mix(GRAS,FORS,ss(0.35,0.7,moist)), ss(0.15,0.48,moist));
  vec3 cold = mix(TUND, FORS*0.8+vec3(0.02), ss(0.5,0.8,moist));
  vec3 alb = mix(cold, midc, ss(0.02,0.3,temp));
  alb = mix(alb, hot, ss(0.55,0.95,temp));
  /* Кромка ледника — резкая линия, как на снимках, а не плавный градиент.
     Форму задаёт многооктавный шум, а сам переход держим шириной в пиксель:
     раньше порог шириной 0.14 по температуре размазывал границу на градусы
     широты, и «Арктика» получалась без очертаний. */
  float climAA = max(2.2*tHit*uPixA, 2.0e-4);
  float cdet = (uDraft > 0.5) ? 0.0 : 1.0-ss(1.6, 3.2, uCamDist);
  float snowN = temp + 0.11*fbm(sN*5.5+uSeedS+vec3(31.0),3);
  if(abs(snowN) < 0.14){          /* мелкие октавы нужны только у самой кромки */
    snowN += 0.045*fbm(sN*19.0+uSeedS,3)
           + 0.018*fbm(sN*64.0+uSeedS+vec3(9.0),2);
    if(cdet > 0.02) snowN += cdet*0.009*fbm(sN*230.0+uSeedS+vec3(77.0),3);
  }
  float snowM = 1.0 - ss(-climAA, climAA, snowN);
  /* Гипсометрическая шкала по орогенной высоте. Зелень равнин выше лесной
     границы сменяется обнажённой породой: сначала жёлто-бурой, затем
     буро-красной, и лишь на вершинах ложится снег. Прежде склон переходил
     из зелёного прямо в белый — промежуточных тонов не было вовсе.
     Скалистость ridge только усиливает переход на крутых участках: на
     пологом плече хребта лес поднимается выше. */
  vec3 SLOPE = vec3(0.420,0.340,0.180);   /* жёлто-бурые среднегорья */
  vec3 ALPINE= vec3(0.340,0.190,0.120);   /* буро-красные высокогорья */
  float rocky2 = 0.55 + 0.45*ss(0.20,0.70,ridge);
  float bMid  = ss(0.012, 0.075, mount*rocky2);
  float bHigh = ss(0.065, 0.170, mount*rocky2);
  alb = mix(alb, SLOPE,  bMid *0.88*(1.0-snowM));
  alb = mix(alb, ALPINE, bHigh*0.82*(1.0-snowM));
  alb = mix(alb, ROCK, ss(0.45,0.90,ridge)*(1.0-snowM)*0.45);
  vec3 snowC = SNOW*(0.88+0.16*(0.5+0.5*fbm(sN*16.0+uSeedS+vec3(9.0),3)));
  if(cdet > 0.02){
    /* трещины и надувы: без них шапка читается как гладкая белая заливка */
    float cr = ridged(sN*110.0 + uSeedS*1.4, 3);
    snowC *= 1.0 - cdet*0.30*ss(0.52,1.0,cr);
  }
  alb = mix(alb, snowC, snowM);
  float beach = ss(0.0,0.0014,h)*(1.0-ss(0.002,0.0055,h));
  beach *= 0.35+0.65*(0.5+0.5*fbm(sN*21.0+uSeedS+vec3(43.0),2));
  beach *= ss(0.22,0.65,temp)*(1.0-0.75*ss(0.55,0.85,moist));  /* песок — в тепле и сухости */
  alb = mix(alb, SAND*1.02, beach*0.55*(1.0-snowM));
  /* пятнистость растительности */
  float veg = fbm(sN*7.5 + uSeedS*4.0, 3);
  alb *= 1.0 + 0.18*veg;
  /* Мозаика покрова внутри климатической зоны. Влажность и температура меняются
     медленно, поэтому в кадре всегда один биом, и без этой мозаики материк
     читается как ровная заливка одной краской. На снимках же рядом лежат
     тёмный лес, оливковый кустарник, охристая почва и серый камень. */
  vec3 bareC  = mix(vec3(0.20,0.165,0.115), REDR, ss(0.40,0.92,temp));
  vec3 denseC = FORS*0.82;
  float mo1 = 0.5+0.5*fbm(sN*9.0  + uSeedS*2.1 + vec3(101.0), 3);
  float mo2 = 0.5+0.5*fbm(sN*19.0 + uSeedS*3.3 + vec3(202.0), 3);
  float mo3 = 0.5+0.5*fbm(sN*38.0 + uSeedS*1.5 + vec3(303.0), 2);
  alb = mix(alb, bareC,  ss(0.46,0.63,mo1)*0.80*(1.0-0.75*ss(0.52,0.70,moist)));
  alb = mix(alb, denseC, ss(0.45,0.62,mo2)*0.70*ss(0.34,0.55,moist));
  alb *= 0.80 + 0.42*mo3;

  /* фототекстуры биомов: базовый слой по климату + накладки */
  if(uTexOn > 0.01 && land > 0.001){
    float hotW = ss(0.55,0.95,temp);
    float coldW = 1.0-ss(0.02,0.3,temp);
    float layer;
    if(hotW > 0.5){
      layer = (moist>0.62) ? 16.0 : (moist>0.38) ? 11.0 :
              ((rocky>0.62) ? ((moist<0.25)?2.0:7.0) : 10.0);
      if(h < 0.05 && moist < 0.2) layer = 8.0;               /* солончак */
    } else if(coldW > 0.5){
      layer = (moist>0.5) ? 0.0 : 17.0;                      /* тайга / тундра */
    } else {
      layer = (moist<0.28) ? 1.0 : ((moist<0.48) ? 4.0 : 14.0);
      if(rocky>0.72) layer = 15.0;
      if(moist>0.78 && h<0.06) layer = 19.0;                 /* болота */
    }
    float foot = tHit*uPixA;
    vec3 texC  = biomeTex(layer, sN, n0, foot);
    vec3 meanC = uTexMean[int(layer)];
    float wRock = ss(0.45,0.8,ridge)*(1.0-snowM);
    if(wRock>0.01){
      texC = mix(texC, biomeTex(5.0, sN, n0, foot), wRock);
      meanC = mix(meanC, uTexMean[5], wRock);
    }
    if(hotW>0.5 && ridge>0.55){
      float wv = ss(0.55,0.85,ridge)*0.8;
      texC = mix(texC, biomeTex(18.0, sN, n0, foot), wv);
      meanC = mix(meanC, uTexMean[18], wv);
    }
    if(snowM>0.01){
      int s = (ridge>0.5) ? 3 : 13;
      texC = mix(texC, biomeTex(float(s), sN, n0, foot), snowM);
      meanC = mix(meanC, uTexMean[s], snowM);
    }
    if(beach>0.01){
      int s = (rocky>0.6) ? 6 : 9;
      float wv = beach*0.8;
      texC = mix(texC, biomeTex(float(s), sN, n0, foot), wv);
      meanC = mix(meanC, uTexMean[s], wv);
    }
    /* Берём из фотографии структуру, а не цвет: на дальнем плане тайл
       замыливается до своего среднего, и абсолютный цвет выцвел бы. */
    vec3 detail = clamp(texC / max(meanC, vec3(0.05)), vec3(0.30), vec3(1.85));
    alb *= mix(vec3(1.0), detail, 0.85*uTexOn);
  }

  /* реки и озёра */
  float rv = 0.0;
  if(h > 0.0 && snowM < 0.85){
    float rn = fbm(sN*5.2 + uSeedS*1.9 + 0.5*vec3(fbm(sN*3.1+uSeedS,3), fbm(sN*3.1+uSeedS+vec3(7.7),3), 0.0), 4);
    /* ширина гуляет вдоль русла, иначе река читается как проведённая линия */
    float wVar = 0.45 + 1.15*(0.5+0.5*fbm(sN*19.0 + uSeedS + vec3(71.0), 3));
    float wReal = mix(0.013, 0.0030, ss(0.02,0.22,h)) * wVar;   /* шире у побережья */
    float wPix = tHit*uPixA*1.6;
    float w = max(wReal, wPix);
    float riv = 1.0 - ss(w*0.82, w*1.06, abs(rn) + 0.0016*fbm(sN*260.0+uSeedS,2));
    riv *= clamp(wReal/wPix*0.8, 0.0, 1.0);              /* субпиксельные реки гаснут */
    riv *= ss(0.30,0.48,moist) * (1.0-ss(0.16,0.30,h));
    float lakeN = fbm(sN*3.4 + uSeedS*3.7 + vec3(53.0), 4);
    float lth = mix(0.46, 0.20, uLake);
    float lake = ss(lth, lth+0.07, lakeN) * (1.0-ss(0.05,0.14,h)) * ss(0.22,0.38,moist);
    lake *= ss(0.02,0.10,uLake);
    rv = clamp(riv + lake, 0.0, 1.0) * (1.0 - snowM*0.9);   /* реки замерзают */
    /* тон как у прибрежной воды: раньше реки выходили светлее океана */
    alb = mix(alb, mix(vec3(0.022,0.062,0.090), vec3(0.045,0.135,0.155),
                       ss(0.30,0.85,temp)), rv*0.90);
  }

  /* океан: бровка шельфа неровная, глубина идёт тремя ступенями, а не двумя */
  /* Шельф узкий и неровный: широкая плавная бирюза читалась как свечение
     вокруг каждого острова, чего на снимках нет. */
  float dRaw = -h + 0.0045*fbm(sN*26.0 + uSeedS + vec3(63.0), 3)
                  + 0.0020*fbm(sN*90.0 + uSeedS + vec3(11.0), 2);
  float depth = clamp(dRaw*46.0, 0.0, 1.0);
  /* Бирюза бывает только на тёплом мелководье. У полярных берегов вода тёмная
     от самой кромки — иначе каждый остров окружает ореол свечения. */
  vec3 shallowC = mix(vec3(0.028,0.100,0.145), vec3(0.075,0.30,0.34), ss(0.30,0.85,temp));
  vec3 oc = mix(shallowC, vec3(0.013,0.072,0.130), ss(0.0,0.5,pow(depth,0.55)));
  oc = mix(oc, vec3(0.004,0.020,0.050), ss(0.34,1.0,pow(depth,0.45)));
  /* рябь у поверхности — вблизи вода перестаёт быть однотонной */
  float chop = 1.0-ss(1.5,3.0,uCamDist);
  if(chop > 0.02)
    oc *= 1.0 + chop*0.13*fbm(sN*420.0 + vec3(uTime*0.35, 0.0, uTime*0.2), 3);
  /* Морской лёд: кромка ещё более изломанная, чем у ледника, но такая же резкая */
  float iceN = temp + 0.05 + 0.13*fbm(sN*6.5+uSeedS+vec3(3.0),3);
  if(abs(iceN) < 0.16){
    iceN += 0.055*fbm(sN*23.0+uSeedS+vec3(51.0),3)
          + 0.022*fbm(sN*75.0+uSeedS+vec3(19.0),2);
    if(cdet > 0.02) iceN += cdet*0.010*fbm(sN*260.0+uSeedS+vec3(41.0),3);
  }
  float ice = 1.0 - ss(-climAA, climAA, iceN);
  if(ice > 0.01){
    vec3 iceCol = vec3(0.80,0.86,0.92)*(0.86+0.24*(0.5+0.5*fbm(sN*30.0+uSeedS,2)));
    if(uTexOn > 0.01){
      vec3 t12 = biomeTex(12.0, sN, n0, tHit*uPixA);
      iceCol *= mix(vec3(1.0), clamp(t12/max(uTexMean[12], vec3(0.05)), vec3(0.45), vec3(1.8)), 0.8*uTexOn);
    }
    oc = mix(oc, iceCol, ice*0.95);
  }
  vec3 albF = mix(oc, alb, land);

  /* зернистость (растительность/камень), детали появляются при зуме */
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
  float shad = ringShadow(pos);
  if(dayF > 0.01){
    /* тени от нижнего и среднего ярусов; верхний слишком тонок */
    /* Тень берёт ровно то же поле пригодности, что и видимое облако:
       иначе тень ложилась бы по резкой карте, а облако — по сглаженной
       вдоль наветренного следа, и они разошлись бы по краям материков. */
    float cs = (uLowOn > 0.5) ? lowCover(normalize(n0 + uSunDir*0.030), gClimLow) : 0.0;
    float cm = (uMidOn > 0.5) ? midCover(normalize(n0 + uSunDir*0.055)) : 0.0;
    shad *= (1.0 - 0.76*cs*dayF) * (1.0 - 0.35*cm*dayF);
  }
  /* Экспозиция подобрана так, чтобы растительность легла около 0.45 по
     яркости, а не улетала в пастель: светлыми на снимке остаются только
     облака и снег, как на настоящих кадрах. */
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
  /* блеск льда */
  col += sunC * pow(max(dot(nS, normalize(uSunDir-rd)),0.0), 200.0) * ice * (1.0-land) * 0.06 * dayF;

  /* рассеянный свет неба днём — окрашен атмосферой и звездой */
  vec3 skyScat = mix(atmC, uStarCol, 0.25);
  col += albF * dayF * 0.05 * skyScat * uAtmo;

  /* закатная полоса терминатора — тон звезды доминирует */
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
      float core = ss(th+0.22, th+0.32, pop);      /* ядра мегаполисов */
      /* где селятся люди: побережья, низины, долины рек */
      float coast = 1.0-ss(0.0,0.045,h);
      float low   = 1.0-ss(0.02,0.30,h);
      float habit = 0.35 + 1.0*max(coast, low*0.65) + 0.5*rv;

      /* паутина магистралей: гребни шума дают нити, а не пятна.
         мелкие октавы проявляются при приближении — застройка фрактальна */
      float w1 = 1.0-abs(fbm(sN*11.0 + uSeedS*1.7, 3));
      float w2 = 1.0-abs(fbm(sN*27.0 + uSeedS*2.3 + vec3(7.0), 3));
      float web = pow(clamp(w1,0.0,1.0), 4.0) + 0.8*pow(clamp(w2,0.0,1.0), 6.0);
      float fine = 1.0-ss(1.3, 2.3, uCamDist);
      if(fine > 0.02){
        float w3 = 1.0-abs(fbm(sN*74.0 + uSeedS*3.1 + vec3(17.0), 3));
        web += fine*0.8*pow(clamp(w3,0.0,1.0), 7.0);
      }
      /* густые кварталы и пустыри — иначе вблизи выходит ровная россыпь */
      float quarters = clamp(0.55 + 0.9*fbm(sN*mix(16.0, 85.0, fine) + uSeedS*4.3, 3), 0.15, 1.6);
      float urban = clamp(gate*habit*quarters*(0.30 + 1.0*web), 0.0, 1.0);
      float mask = land*(1.0-snowM);

      /* отдельные огни: решётка на каждом уровне повёрнута, ячейка зажигается
         случайно с вероятностью от плотности — это и ломает регулярность */
      vec3 pts = vec3(0.0);
      float limb = 1.0-abs(dot(n0,-rd));
      float twA = 0.04 + 0.11*limb;                /* сцинтилляция сильнее у лимба */
      /* иерархия: редкие крупные города на грубой решётке, частые посёлки —
         на мелкой; каждый уровень проявляется, когда становится различим */
      int nLvl = (uDraft > 0.5) ? 2 : 5;
      vec3 q = sN;
      for(int L=0; L<5; L++){
        if(L >= nLvl) break;
        q = M3*q;
        float sc = 45.0*pow(2.72, float(L));       /* 45 · 122 · 333 · 905 · 2460 */
        float pxc = tHit*uPixA*sc;                 /* пиксель в единицах ячейки */
        if(pxc > 2.5) continue;                    /* неразличимо — вклад ничтожен */
        vec3 p = q*sc + uSeedS*3.0;
        vec3 idc = floor(p), fc = fract(p);
        vec3 ha = hash33(idc + vec3(float(L)*31.7));
        float thr = mix(0.972, 0.20, urban);
        float lit = ss(thr, thr+0.05, ha.z);
        if(lit < 0.002) continue;
        vec3 hb = hash33(idc*1.37 + vec3(11.3 + float(L)*7.1));
        float dd = length(fc - (0.08 + 0.84*hb));  /* полный джиттер в ячейке */
        float r0  = 0.030 + 0.050*pow(ha.x, 3.0);  /* крупный город — и ярче, и больше */
        r0 = min(r0, max(pxc*4.0, 0.006));         /* вблизи город рассыпается на огни, а не в шар */
        float sg  = max(r0, pxc*0.85);
        float peak = (r0*r0)/(sg*sg);              /* субпиксельный огонь тускнеет, а не дрожит */
        float br = (0.18 + 5.5*pow(ha.x, 5.0)) * (0.30 + 1.5*urban) * pow(0.62, float(L));
        float tw = 1.0 - twA*(0.5+0.5*sin(uTime*(0.7+1.6*hb.x) + hb.y*61.0));
        /* ядра выгорают почти в белый, окраины — натриевый янтарь */
        vec3 cc = mix(vec3(1.0,0.60,0.24), vec3(1.0,0.93,0.80), clamp(br*peak*0.18,0.0,1.0));
        cc = mix(cc, vec3(0.84,0.90,1.06), ss(0.82,0.97,hb.z)*0.65);
        pts += cc * lit * br * peak * exp(-dd*dd/(sg*sg)) * tw;
      }
      /* фоновое свечение — только неразрешённая мелочь: вблизи оно уходит,
         структуру там держат сами огни */
      float unres = 1.0 - clamp(0.05/max(tHit*uPixA*60.0, 1e-5), 0.0, 1.0);
      vec3 glowC = mix(vec3(1.0,0.68,0.34), vec3(0.85,0.88,1.0), ss(0.65,0.92,pop)*0.4);
      col += nightF * uCity * mask
           * (glowC*urban*(0.20+0.7*core)*0.25*(0.35+0.65*unres) + pts*1.1);
    }
  }
  /* слабое звёздное свечение ночью */
  col += nightF * albF * 0.020 * vec3(0.4,0.55,0.9);
  return col;
}
