/* ---------- кольца ---------- */
/* Границы и плотность системы управляются ползунками. Щели заданы долями
   ширины, а не абсолютным радиусом: иначе при узком кольце они уезжали бы
   за его край, а при широком сбивались в кучу у внутренней кромки. */
float ringR0(){ return mix(1.22, 2.05, uRingInner); }
float ringR1(){ return ringR0() + mix(0.22, 1.55, uRingWidth); }
float ringPattern(float r){
  float r0 = ringR0(), r1 = ringR1();
  float t = (r-r0)/max(r1-r0, 1e-4);
  if(t<0.0 || t>1.0) return 0.0;
  float n  = 0.5+0.5*noise3(vec3(r*16.0, uSeedS.x, uSeedS.y));
  float n2 = 0.5+0.5*noise3(vec3(r*43.0, uSeedS.y, 7.7));
  float n3 = 0.5+0.5*noise3(vec3(r*110.0, uSeedS.x*1.3, 3.3));
  float a = ss(0.0,0.07,t)*(1.0-ss(0.82,1.0,t));
  a *= 0.30+0.70*pow(n,1.5);
  a *= 0.45+0.55*n2;
  a *= 0.75+0.25*n3;
  float span = max(r1-r0, 1e-4);
  a *= ss(0.015,0.05,abs(t-0.53)*span);       /* щель Кассини */
  a *= 0.5+0.5*ss(0.01,0.03,abs(t-0.23)*span);/* вторая щель */
  /* Дробность: система расслаивается на отдельные кольца с промежутками.
     Резонансы разносят вещество по узким полосам, и чем их больше, тем
     тоньше каждая. При нуле остаётся сплошной диск. */
  float bands = mix(1.0, 26.0, uRingCount);
  float bandPhase = fract(t*bands + 0.35*n);
  float gaps = mix(1.0, ss(0.10,0.30,bandPhase)*(1.0-ss(0.70,0.92,bandPhase)),
                   ss(0.04,0.35,uRingCount));
  a *= 0.25 + 0.75*gaps;
  a *= mix(0.22, 1.25, uRingDens);
  return clamp(a,0.0,1.0);
}
float ringShadow(vec3 pos){
  if(uRingsOn < 0.5) return 1.0;
  vec3 rn = uRingMat[1];
  float dn = dot(uSunDir, rn);
  if(abs(dn) < 1e-3) return 1.0;
  float t = -dot(pos, rn)/dn;
  if(t <= 0.0) return 1.0;
  float r = length(pos + uSunDir*t);
  return 1.0 - ringPattern(r)*0.7;
}
vec4 ringColor(vec3 ro, vec3 rd, float tMax, out float tR){
  tR = -1.0;
  if(uRingsOn < 0.5) return vec4(0.0);
  vec3 rn = uRingMat[1];
  float dn = dot(rd, rn);
  if(abs(dn) < 1e-4) return vec4(0.0);
  float t = -dot(ro, rn)/dn;
  if(t < 0.0 || t > tMax) return vec4(0.0);
  vec3 p = ro + rd*t;
  float r = length(p);
  float a = ringPattern(r)*0.88;
  if(a < 0.003) return vec4(0.0);
  tR = t;
  float alongSun = dot(p, uSunDir);
  float distAx = length(p - uSunDir*alongSun);
  float sh = (alongSun < 0.0) ? mix(0.10, 1.0, ss(0.97, 1.06, distAx)) : 1.0;
  float dl = clamp(abs(dot(rn, uSunDir)), 0.0, 1.0)*0.75 + 0.25;
  float starLift = clamp(0.68 + 0.34*log(1.0 + uStarFlux), 0.55, 1.60);
  /* Мелкая пыль сильнее светится на просвет — как земное сумеречное гало. */
  float back = pow(max(dot(rd, uSunDir), 0.0), 3.0)*mix(0.80, 0.18, uRingGrain);
  float hueV = 0.5+0.5*noise3(vec3(r*7.0, uSeedS.y*0.7, 11.0));

  /* ---------- цвет кольца ----------
     Кольцо ничего не излучает: мы видим отражённый свет звезды. Поэтому цвет
     складывается из трёх вещей — спектрального отклика вещества, спектра
     осветителя и размера частиц.

     Вещество (ползунок «Состав»): водяной лёд — силикаты — органика (толины)
     — метановые и аммиачные льды. Лёд яркий и чуть голубоватый, силикаты
     серо-красные, толины тёмно-бурые и очень тёмные, метановые льды синеватые.

     Размер (ползунок «Частицы»): мелкая пыль масштаба микрона рассеивает по
     Рэлею и уводит цвет в синеву, крупные глыбы отражают почти нейтрально.

     Тепловой режим: вблизи горячей звезды лёд сублимирует, и от состава
     остаются одни силикаты — сколько ползунок ни двигай. */
  vec3 refl;
  vec3 ICE   = vec3(0.90,0.93,0.98);   /* водяной лёд */
  vec3 SIL   = vec3(0.40,0.32,0.26);   /* силикаты */
  vec3 THOLIN= vec3(0.27,0.12,0.07);   /* органика */
  vec3 CH4   = vec3(0.72,0.83,1.00);   /* метан/аммиак */
  float m = uRingMaterial*3.0;
  if(m < 1.0)      refl = mix(ICE, SIL, m);
  else if(m < 2.0) refl = mix(SIL, THOLIN, m-1.0);
  else             refl = mix(THOLIN, CH4, m-2.0);
  refl *= 0.86 + 0.28*hueV;

  /* Лёд не переживает близкой горячей звезды. */
  float iceSafe = 1.0 - ss(1.8, 5.0, uStarFlux);
  float icy = max(1.0-ss(0.0,0.33,uRingMaterial), ss(0.66,1.0,uRingMaterial));
  refl = mix(refl, SIL*(0.9+0.3*hueV), icy*(1.0-iceSafe));

  /* Рэлеевское рассеяние на мелкой пыли: короткие волны уходят в сторону
     наблюдателя охотнее. Крупные частицы, наоборот, обесцвечивают отклик. */
  float fine = 1.0 - uRingGrain;
  refl *= mix(vec3(1.0), vec3(0.62,0.86,1.35), fine*0.75);
  float grey = dot(refl, vec3(0.299,0.587,0.114));
  refl = mix(refl, vec3(grey), uRingGrain*0.55);

  /* Осветитель. Спектр звезды множится на отклик: у красного карлика ледяное
     кольцо желтеет, у горячей голубой — синеет, а органика уходит почти в
     чёрное, потому что отражать ей в синей части нечем. */
  vec3 base = refl * mix(vec3(1.0), uStarCol, 0.85);
  vec3 c = (base*dl + uStarCol*vec3(0.82,0.74,0.62)*back)*sh*1.5*starLift;
  return vec4(c, a);
}

