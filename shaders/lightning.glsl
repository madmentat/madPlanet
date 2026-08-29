/* ---------- молнии 0.5.52 / 0.5.62: только из Weather Core ---------- */
/*
   Пять бывших uCycA/uCycB slots временно используются как компактный мост
   CPU Weather Core -> GLSL. uCycA.w всегда 0, поэтому старые procedural
   synoptic()/vortexWarp() полностью игнорируют эти записи. Центр грозы теперь
   приходит из реальной deep-convection ячейки; hash используется только для
   положения конкретной жилы ВНУТРИ этого физического очага.

   0.5.62 делает ручные регуляторы именно регуляторами зрелищности: обычные
   значения остаются близки к прежним, но последние 30-40% шкалы заметно
   увеличивают частоту и яркость. Ползунки всё ещё не создают физический очаг
   из ясного неба — они усиливают только уже диагностированную грозу.

   A.xyz = центр очага в body/surface coordinates, A.w = 0
   B.x   = угловой радиус очага
   B.y   = физическая частота вспышек, Hz
   B.z   = электрическая интенсивность 0..1
   B.w   = детерминированная фаза/seed
*/

float boltChannel(vec2 uv, float len, float wob, vec3 h, float w){
  float t = clamp(uv.y/len, 0.0, 1.0);
  float x = wob*(0.55*sin(uv.y*37.0  + h.x*39.0)
               + 0.30*sin(uv.y*89.0  + h.y*61.0)
               + 0.15*sin(uv.y*197.0 + h.z*97.0))*(0.25 + 0.75*t);
  float d = abs(uv.x - x);
  float live = ss(-0.006, 0.006, uv.y)*(1.0 - ss(len*0.78, len, uv.y));
  float k = d/w;
  return live*(exp(-k*k) + 0.14*exp(-k*k*0.06));
}

/* uRotS is world -> body/surface. Avoid GLSL transpose() so the full shader
   remains friendly to the existing WebGL1 source transformer. */
vec3 lightningBodyToWorld(vec3 p){
  return normalize(vec3(dot(uRotS[0],p),dot(uRotS[1],p),dot(uRotS[2],p)));
}

vec3 lightningGlow(vec3 dirW, float cloudA){
  vec3 acc = vec3(0.0);
  if(uLowOn < 0.5 || uCloudLow < 0.05) return acc;

  /* Видимое нижнее облако лишь усиливает уже физически существующий разряд.
     Нулевая alpha не запрещает ветви рядом с телом кучево-дождевого облака:
     это устраняет старое обрезание по cloud mask в main.glsl. */
  float gate = 0.55 + 0.45*ss(0.02,0.16,cloudA);
  float lt = mod(uTime, 900.0);
  float rateScale = 0.55 + 2.10*uStormRate*uStormRate;
  float activityScale = 0.75 + 0.90*uStorm*uStorm;

  float halo = 0.0;
  float bestScore = 0.0, bestWin = 0.0, bestIntensity = 0.0;
  vec3 bestF = vec3(0.0,0.0,1.0), bestH = vec3(0.0);

  for(int i=0;i<5;i++){
    vec4 A=uCycA[i];
    vec4 B=uCycB[i];
    float radius=clamp(B.x,0.02,0.22);
    float rate=max(0.0,B.y)*rateScale;
    float intensity=clamp(B.z*activityScale,0.0,1.65);
    if(rate<0.005 || intensity<0.006) continue;

    float fi=float(i);
    float ph=lt*rate + B.w*37.0 + fi*5.17;
    float cyc=floor(ph);
    float fr=fract(ph);
    /* Короткий первый удар и более слабый повторный: при высокой физической
       rate соседние очаги действительно могут дать тот самый «пулемёт». */
    float first=exp(-fr*42.0);
    float second=0.70*exp(-abs(fr-0.105)*58.0);
    float win=max(first,second);
    if(win<0.002) continue;

    vec3 hh=hash33(vec3(cyc*13.1+B.w*91.7,cyc*7.7+fi*23.3,B.w*137.0+fi*29.3)+uSeedC);
    vec3 c=normalize(A.xyz);
    vec3 upC=(abs(c.y)<0.94)?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
    vec3 txC=normalize(cross(c,upC));
    vec3 tyC=cross(c,txC);
    /* Randomness is now sub-storm jitter only, never global storm placement. */
    vec2 j=(hh.xy-0.5)*2.0;
    vec3 fpC=normalize(c + txC*j.x*radius*0.58 + tyC*j.y*radius*0.58);
    vec3 fp=lightningBodyToWorld(fpC);

    float ang=distance(dirW,fp);
    float invR2=1.0/max(1e-5,radius*radius);
    float local=exp(-ang*ang*invR2*1.7);
    halo += local*win*intensity;
    float score=local*win*intensity;
    if(score>bestScore){bestScore=score;bestWin=win;bestIntensity=intensity;bestF=fp;bestH=hh;}
  }

  vec3 tint=vec3(0.72,0.80,1.0);
  float amp=mix(2.5,18.0,uStormGlow*uStormGlow);
  acc += tint*halo*0.34*amp;

  if(bestScore>0.0004){
    vec3 up=(abs(bestF.y)<0.94)?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
    vec3 tx=normalize(cross(bestF,up));
    vec3 ty=cross(bestF,tx);
    vec3 dp=dirW-bestF*dot(dirW,bestF);
    vec2 uv=vec2(dot(dp,tx),dot(dp,ty));
    float len=0.17+0.10*bestH.x;
    uv.y+=len*0.5;
    float w=max(0.0030,uPixA*1.8);
    float g=boltChannel(uv,len,0.028,bestH,w);
    vec2 b1=uv-vec2(0.0,len*0.42);
    b1=vec2(b1.x*0.87-b1.y*0.50,b1.x*0.50+b1.y*0.87);
    g+=0.45*boltChannel(b1,len*0.42,0.022,bestH.yzx,w*0.72);
    vec2 b2=uv-vec2(0.0,len*0.66);
    b2=vec2(b2.x*0.80+b2.y*0.60,-b2.x*0.60+b2.y*0.80);
    g+=0.35*boltChannel(b2,len*0.32,0.018,bestH.zxy,w*0.66);
    acc += tint*g*bestWin*amp*(1.55+1.30*bestIntensity);
  }
  return acc*gate;
}
