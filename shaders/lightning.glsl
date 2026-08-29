/* ---------- молнии 0.5.52 / 0.5.65: только из Weather Core ---------- */
/*
   Пять бывших uCycA/uCycB slots временно используются как компактный мост
   CPU Weather Core -> GLSL. uCycA.w всегда 0, поэтому старые procedural
   synoptic()/vortexWarp() полностью игнорируют эти записи. Центр грозы теперь
   приходит из реальной deep-convection ячейки; hash используется только для
   положения и формы конкретной жилы ВНУТРИ этого физического очага.

   0.5.65 отделяет сам разряд от визуальной alpha нижнего облака. Detail/Draft
   меняет число выборок облачного объёма и поэтому больше не имеет права
   приглушать или отключать молнию. Cloud alpha используется только для
   рассеянной подсветки окружающей облачной массы. Подсветка намеренно
   неоднородная и эллиптическая, а не ровный круг.

   Разряды получают детерминированный случайный поворот вокруг локальной
   вертикали, широкий диапазон длины/толщины и разное количество ветвей. Это
   сохраняет стабильность одного кадра/скриншота, но убирает строй одинаковых
   вертикальных молний.

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

  float lt = mod(uTime, 900.0);
  /* Keep these three spectacle controls in lock-step with screenshot-trigger. */
  float rateScale = 0.65 + 4.15*uStormRate*uStormRate;
  float activityScale = 0.85 + 1.45*uStorm*uStorm;

  float halo = 0.0;
  float bestScore = 0.0, bestWin = 0.0, bestIntensity = 0.0;
  vec3 bestF = vec3(0.0,0.0,1.0), bestH = vec3(0.0);

  for(int i=0;i<5;i++){
    vec4 A=uCycA[i];
    vec4 B=uCycB[i];
    float radius=clamp(B.x,0.02,0.22);
    float rate=max(0.0,B.y)*rateScale;
    float intensity=clamp(B.z*activityScale,0.0,2.30);
    if(rate<0.005 || intensity<0.006) continue;

    float fi=float(i);
    float ph=lt*rate + B.w*37.0 + fi*5.17;
    float cyc=floor(ph);
    float fr=fract(ph);
    float first=exp(-fr*42.0);
    float second=0.70*exp(-abs(fr-0.105)*58.0);
    float win=max(first,second);
    if(win<0.002) continue;

    vec3 hh=hash33(vec3(cyc*13.1+B.w*91.7,cyc*7.7+fi*23.3,B.w*137.0+fi*29.3)+uSeedC);
    vec3 c=normalize(A.xyz);
    vec3 upC=(abs(c.y)<0.94)?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
    vec3 txC=normalize(cross(c,upC));
    vec3 tyC=cross(c,txC);
    vec2 j=(hh.xy-0.5)*2.0;
    vec3 fpC=normalize(c + txC*j.x*radius*0.58 + tyC*j.y*radius*0.58);
    vec3 fp=lightningBodyToWorld(fpC);

    /* Irregular cloud illumination. An ellipse with a strike-specific angle is
       broken by low-frequency 3-D noise. No circular flashlight disk. */
    vec3 hup=(abs(fp.y)<0.94)?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
    vec3 htx=normalize(cross(fp,hup));
    vec3 hty=cross(fp,htx);
    vec3 hdp=dirW-fp*dot(dirW,fp);
    vec2 huv=vec2(dot(hdp,htx),dot(hdp,hty))/max(radius,0.02);
    float ha=6.2831853*fract(hh.z+fi*0.173);
    float hc=cos(ha),hs=sin(ha);
    huv=vec2(huv.x*hc-huv.y*hs,huv.x*hs+huv.y*hc);
    float aspect=mix(0.58,1.65,hh.x);
    float q=huv.x*huv.x/max(0.22,aspect)+huv.y*huv.y*max(0.55,aspect);
    float rag=0.5+0.5*noise3(dirW*(18.0+11.0*hh.y)+hh*37.0+vec3(cyc*0.071));
    float local=exp(-q*1.55)*mix(0.52,1.18,rag);
    float cloudLight=0.20+1.35*ss(0.012,0.34,cloudA);
    halo += local*win*intensity*cloudLight;

    /* Direct bolt selection deliberately ignores cloud alpha. */
    float ang=distance(dirW,fp);
    float direct=exp(-ang*ang/max(1e-5,radius*radius)*1.7)*win*intensity;
    if(direct>bestScore){bestScore=direct;bestWin=win;bestIntensity=intensity;bestF=fp;bestH=hh;}
  }

  vec3 tint=vec3(0.72,0.82,1.0);
  float amp=mix(2.8,24.0,uStormGlow*uStormGlow);
  acc += tint*halo*0.52*amp;

  if(bestScore>0.00035){
    vec3 up=(abs(bestF.y)<0.94)?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
    vec3 tx0=normalize(cross(bestF,up));
    vec3 ty0=cross(bestF,tx0);
    /* Each strike gets its own orientation around the local radial axis. */
    float a=6.2831853*fract(bestH.z+bestH.x*0.37);
    float ca=cos(a),sa=sin(a);
    vec3 tx=tx0*ca+ty0*sa;
    vec3 ty=ty0*ca-tx0*sa;
    vec3 dp=dirW-bestF*dot(dirW,bestF);
    vec2 uv=vec2(dot(dp,tx),dot(dp,ty));

    float size=mix(0.62,1.42,bestH.y);
    float len=(0.105+0.155*bestH.x)*size;
    uv.y+=len*0.5;
    float w=max(0.0024*(0.75+0.90*bestH.z),uPixA*mix(1.35,2.45,bestH.y));
    float wob=mix(0.014,0.043,bestH.z);
    float g=boltChannel(uv,len,wob,bestH,w);

    /* Branch presence and size vary continuously with the strike hash. */
    float ba1=ss(0.14,0.42,bestH.x)*mix(0.24,0.62,bestH.y);
    float ba2=ss(0.34,0.70,bestH.y)*mix(0.18,0.50,bestH.z);
    float ba3=ss(0.62,0.88,bestH.z)*0.30;
    vec2 b1=uv-vec2(0.0,len*mix(0.30,0.50,bestH.z));
    b1=vec2(b1.x*0.86-b1.y*0.52,b1.x*0.52+b1.y*0.86);
    g+=ba1*boltChannel(b1,len*mix(0.28,0.52,bestH.x),wob*0.78,bestH.yzx,w*0.72);
    vec2 b2=uv-vec2(0.0,len*mix(0.50,0.72,bestH.x));
    b2=vec2(b2.x*0.78+b2.y*0.63,-b2.x*0.63+b2.y*0.78);
    g+=ba2*boltChannel(b2,len*mix(0.22,0.40,bestH.y),wob*0.64,bestH.zxy,w*0.64);
    vec2 b3=uv-vec2(0.0,len*0.58);
    b3=vec2(b3.x*0.94-b3.y*0.34,b3.x*0.34+b3.y*0.94);
    g+=ba3*boltChannel(b3,len*0.26,wob*0.52,bestH.xzy,w*0.58);

    acc += tint*g*bestWin*amp*(1.85+1.65*bestIntensity);
  }
  return acc;
}
