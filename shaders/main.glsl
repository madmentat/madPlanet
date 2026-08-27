void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/uRes.y;
  vec3 rd = normalize(uCamMat * normalize(vec3(uv, uFocal)));
  vec3 ro = uCamPos;
  float R_ATM = 1.035 + 0.085*uAtmo;
  /* Высоты облаков: чем толще атмосфера, тем выше и разбросаннее слои */
  float atmoScale = 0.6 + 0.8 * uAtmo;   /* 0.6 (тонкая) → 1.4 (толстая) */
  R_LOW  = R_LOW_B  + (R_LOW_B  - 1.0) * (atmoScale - 1.0);
  R_MID  = R_MID_B  + (R_MID_B  - 1.0) * (atmoScale - 1.0);
  R_HIGH = R_HIGH_B + (R_HIGH_B - 1.0) * (atmoScale - 1.0);
  vec3 atmC = atmoColor();

  float tP = iSphere(ro, rd, 1.0);
  float tLo = iSphere(ro, rd, R_LOW);
  /* Синоптическая обстановка считается один раз на пиксель: все три яруса
     и тени на поверхности берут её готовой, иначе шум гонялся бы четырежды. */
  {
    float tw = (tLo > 0.0) ? tLo : iSphere(ro, rd, R_HIGH);
    vec3 wd = (tw > 0.0) ? normalize(ro + rd*tw) : rd;
    vec3 wc = uRotC*wd;
    gSyn = synoptic(wc);
    gWx = weather(wd, vortexWarp(wc));
    /* Климат облачных ярусов — тоже один раз на пиксель. Раньше его
       пересчитывали нижний ярус, средний ярус и обе карты теней, и в
       каждой копии сидел полный terrain(). */
    bool needClim = (uLowOn > 0.5 && uCloudLow > 0.015)
                 || (uMidOn > 0.5 && uCloudMid > 0.025);
    gClimLow = needClim ? lowCloudClimate(wd) : 1.0;
    /* Средняя облачность меньше привязана к поверхности, но пустынный
       провал всё равно заметен. */
    gClimMid = clamp(0.48 + 0.52*gClimLow, 0.48, 1.0);
  }

  /* Три яруса считаются здесь, один раз на пиксель. Раньше композитинг был
     продублирован в ветках поверхности и лимба, cloudLayer инлайнился шесть
     раз вместе с телами всех ярусов, и компилятор шейдеров не справлялся
     с размером кода. */
  float boost = (tP > 0.0) ? 1.0 : 1.12;
  vec4 cl0 = vec4(0.0), cl1 = vec4(0.0), cl2 = vec4(0.0);
  if(uLowOn > 0.5 && uCloudLow > 0.015 && tLo > 0.0){
    float span = max(0.010, R_MID-R_LOW + 0.006 + 0.006*uConvection);
    cl0 = volumeLow(ro,rd,tLo,span,boost,gClimLow);
  }
  float tMd = iSphere(ro, rd, R_MID);
  if(uMidOn > 0.5 && uCloudMid > 0.025 && tMd > 0.0){
    vec3 nc = normalize(ro + rd*tMd);
    float ft = tMd*uPixA;
    /* Собственная тень среднего яруса раньше требовала ещё одного полного
       midCover() со своим cloudBody() — вторая по стоимости ветка облаков
       при линковке ради 16 % затемнения. Объёмное затемнение по плотности
       в shadeDeck() даёт тот же эффект даром. */
    cl1 = shadeDeck(1, nc, rd, midDeck(nc, ft), 1.0, boost, ft);
  }
  float tHi = iSphere(ro, rd, R_HIGH);
  if(uHighOn > 0.5 && uCloudHigh > 0.02 && tHi > 0.0){
    vec3 nc = normalize(ro + rd*tHi);
    float ft = tHi*uPixA;
    cl2 = shadeDeck(2, nc, rd, highDeck(nc, ft), 1.0, boost, ft);
  }

  /* Свечение молний одинаково для обеих веток композитинга: раньше вызов
     стоял и в ветке поверхности, и в ветке лимба, то есть весь грозовой
     блок попадал в шейдер дважды. */
  vec3 bolt = vec3(0.0);
  if(uLowOn > 0.5 && cl0.a > 0.08 && tLo > 0.0)
    bolt = lightningGlow(normalize(ro + rd*tLo), cl0.a) * (0.25 + cl0.a*1.7);

  vec3 col;

  if(tP > 0.0){
    vec3 pos = ro + rd*tP;
    vec3 n0 = normalize(pos);
    float dayF;
    col = shadeSurface(pos, rd, tP, dayF);

    /* туман: низкий, полупрозрачный слой над поверхностью */
    vec3 fogC = fogLayer(n0, tP*uPixA);
    if(fogC.r > 0.002){
      float fogAlbedo = 0.5 + 0.5*dot(n0, uSunDir);
      col = mix(col, vec3(fogAlbedo), fogC.r * 0.35);
    }

    /* композитинг от дальнего к ближнему: нижний, средний, верхний */
    col = mix(col, cl0.rgb, cl0.a);
    col += bolt;
    col = mix(col, cl1.rgb, cl1.a);
    col = mix(col, cl2.rgb, cl2.a);
    /* Воздушная перспектива по длине пути луча внутри оболочки, а не по углу
       к нормали: иначе с низкой орбиты весь кадр затягивает молочной пеленой,
       хотя смотреть сквозь атмосферу приходится всего десяток километров. */
    float alit = ss(-0.3, 0.4, dot(n0, uSunDir));
    float tIn = iSphere(ro, rd, R_ATM);
    float pathA = max(tP - max(tIn, 0.0), 0.0) / max(R_ATM-1.0, 1e-4);
    /* Пропускание и рассеяние по отдельности. Раньше дымка подмешивалась
       как готовый яркий синий цвет и почти вдвое поднимала синий канал даже
       при взгляде в надир — зелень уходила в шалфейный. Степень 1.6 держит
       рассеяние малым вблизи надира и полным на лимбе. */
    float trans = exp(-pathA * 0.30 * uAtmo);
    float scat  = pow(1.0 - trans, 1.6);
    col = col*trans + atmC * scat * 0.80 * alit;
    /* свечение атмосферы на ночном лимбе — окрашено составом и звездой */
    vec3 nightGlow = mix(atmC*0.5, uStarCol*0.3, 0.4);
    col += nightGlow * pow(scat, 3.0) * (1.0-alit) * 0.35 * uAtmo;

    /* кольца перед планетой */
    float tR;
    vec4 rg = ringColor(ro, rd, tP, tR);
    col = mix(col, rg.rgb, rg.a);
  } else {
    col = (uVoid > 0.5) ? vec3(0.0) : stars(rd);
    /* ореол атмосферы */
    float tca = -dot(ro, rd);
    if(tca > 0.0){
      float b2 = dot(ro,ro) - tca*tca;
      float bb = sqrt(max(b2, 0.0));
      if(bb < R_ATM){
        float x = clamp((bb-1.0)/(R_ATM-1.0), 0.0, 1.0);
        float g = exp(-x*3.4)*(1.0-x*0.4);
        vec3 cp = normalize(ro + rd*tca);
        float litp = dot(cp, uSunDir);
        float lit = ss(-0.35, 0.45, litp);
        float sunset = exp(-pow(litp*3.2, 2.0));
        vec3 sunsetWash = mix(vec3(1.0,0.42,0.16), uStarCol*1.1, 0.35);
        vec3 ac = mix(atmC, sunsetWash, sunset*0.7);
        col += ac * g * (lit*2.0 + 0.015) * uAtmo * 1.25;
        vec3 limbNight = mix(atmC*0.5, uStarCol*0.3, 0.3);
        col += limbNight * exp(-pow((x-0.10)*7.0,2.0)) * (1.0-lit) * 0.30 * uAtmo;
      }
    }
    /* облака на лимбе + кольца, в порядке глубины */
    float tR;
    vec4 rg = ringColor(ro, rd, 1e9, tR);
    col += bolt;
    if(rg.a > 0.0 && (tLo < 0.0 || tR > tLo)){
      col = mix(col, rg.rgb, rg.a);      /* кольцо за облачным лимбом */
      col = mix(col, cl0.rgb, cl0.a);
    } else {
      col = mix(col, cl0.rgb, cl0.a);
      col = mix(col, rg.rgb, rg.a);
    }
    col = mix(col, cl1.rgb, cl1.a);
    col = mix(col, cl2.rgb, cl2.a);
  }

  /* тонмап + виньетка + дизеринг */
  col = clamp((col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14), 0.0, 1.0);
  col = pow(col, vec3(1.0/2.2));
  col *= 1.0 - 0.16*pow(length(uv)*1.15, 2.4);
  col += (hash33(vec3(gl_FragCoord.xy, uTime)).x - 0.5)/255.0;
  fragColor = vec4(col, 1.0);
}
