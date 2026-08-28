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
  float back = pow(max(dot(rd, uSunDir), 0.0), 3.0)*mix(0.62, 0.20, ss(0.0,1.0,uRingMaterial));
  float hueV = 0.5+0.5*noise3(vec3(r*7.0, uSeedS.y*0.7, 11.0));
  /* Материал: лёд - камень - пыль. Лёд яркий и голубоватый, камень серо-бурый,
     пыль тёплая и тусклая. Заодно меняется, насколько сильно кольцо светится
     на просвет: ледяные частицы рассеивают вперёд заметно охотнее. */
  vec3 ICE  = mix(vec3(0.74,0.80,0.88), vec3(0.86,0.91,0.97), hueV);
  vec3 ROCKY= mix(vec3(0.42,0.38,0.33), vec3(0.52,0.47,0.42), hueV);
  vec3 DUST = mix(vec3(0.55,0.44,0.31), vec3(0.64,0.54,0.42), hueV);
  vec3 base = (uRingMaterial < 0.5)
            ? mix(ICE, ROCKY, ss(0.0,0.5,uRingMaterial))
            : mix(ROCKY, DUST, ss(0.5,1.0,uRingMaterial));
  vec3 c = (base*dl + uStarCol*vec3(0.82,0.74,0.62)*back)*sh*1.5*starLift;
  return vec4(c, a);
}

