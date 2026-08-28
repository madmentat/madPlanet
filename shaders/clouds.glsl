/* ---------- ОБЛАКА v4: изотропное 3D-поле вместо зональных полос ----------
   Важный принцип:
   облако НЕ растягивается вдоль экватора/меридиана. Ветровые пояса и
   циклоны влияют на перенос и количество влаги, но не диктуют форму ячейки.
   Поэтому отдельная куча может быть круглой, слитой из нескольких масс,
   рваной по краям или почти целиком закрывать планету.
*/
const float R_LOW_B  = 1.010;
const float R_MID_B  = 1.021;
const float R_HIGH_B = 1.034;
float R_LOW, R_MID, R_HIGH;

vec4 gWx;
vec4 gSyn;
/* Климат нижнего/среднего яруса считается один раз на пиксель в main():
   раньше lowCloudClimate() разворачивался в шейдер по одному разу на
   каждый ярус и на каждую карту теней, а внутри каждой копии лежал
   полный terrain(). */
float gClimLow, gClimMid;

/* ---------- циклоны: только крупный перенос поля ---------- */
vec3 vortexWarp(vec3 p){
  for(int i=0;i<5;i++){
    vec4 A = uCycA[i];
    if(A.w < 0.02) continue;
    float R = uCycB[i].x;
    float d = distance(p, A.xyz);
    if(d > R*2.0) continue;
    float a = uCycB[i].y * A.w * 1.45 * exp(-d*d/(R*R*0.7));
    vec3 ax = A.xyz;
    float cc = cos(a), sn = sin(a);
    p = p*cc + cross(ax,p)*sn + ax*dot(ax,p)*(1.0-cc);
  }
  return p;
}

vec4 synoptic(vec3 sd){
  float arms=0.0, head=0.0, front=0.0, pat=0.0, near=0.0;
  for(int i=0;i<5;i++){
    vec4 A=uCycA[i];
    if(A.w<0.02) continue;
    vec4 B=uCycB[i];
    vec3 C=normalize(A.xyz);
    float cd=dot(sd,C);
    float r=sqrt(max(2.0-2.0*cd,0.0));
    if(r>B.x*3.0) continue;
    float edge=1.0-smoothstep(B.x*1.5,B.x*3.0,r);
    vec3 v=sd-C*cd;
    float vl=length(v);
    if(vl<1e-5) continue;
    vec3 e1=normalize(cross(C,uAxis)+vec3(1e-5));
    vec3 e2=cross(C,e1);
    v/=vl;
    float th=atan(dot(v,e2),dot(v,e1));
    float rn=clamp(r/B.x,0.02,3.0);
    float arm=0.5+0.5*sin(th*1.25+B.y*B.z*log(rn+0.05)*2.3);
    float env=A.w*exp(-rn*rn*0.85);
    float eye=ss(0.03,0.16,rn);
    arms+=arm*arm*env*eye*edge;
    float prox=A.w*ss(1.6,0.45,rn)*eye*edge;
    if(prox>near){near=prox;pat=arm;}
    float dth=th-B.w;
    dth-=6.2831853*floor(dth/6.2831853+0.5);
    float crest=0.5+0.5*cos(dth-B.y*1.7);
    head+=exp(-pow((rn-0.33)*1.7,2.0))*env*eye*(0.35+0.9*crest)*edge;
    front+=exp(-dth*dth*2.6)*ss(0.18,0.62,rn)*exp(-rn*rn*0.33)*A.w*edge;
  }
  return vec4(clamp(arms,0.0,1.0),clamp(head,0.0,1.0),clamp(front,0.0,1.0),pat*clamp(near,0.0,1.0));
}

/* ---------- изотропная форма облаков ----------
   Никакого zonalStretch: именно он создавал «три спицы».  Координата
   вращается/переносится целиком, поэтому статистика формы одинаковая
   во всех направлениях.
*/
vec3 cloudCoord(vec3 dir, float scale, float speed, vec3 seed){
  vec3 p = normalize(dir) * scale + seed;
  p += vec3(uTime*speed, 0.0, -uTime*speed*0.61);
  vec3 w = vec3(
    fbm(p*0.62 + vec3(7.0), 3),
    fbm(p*0.62 + vec3(19.0), 3),
    fbm(p*0.62 + vec3(31.0), 3)
  ) - 0.08;
  return p + w*0.72;
}

/* Мягкое пятнистое поле для сросшихся облачных масс. */
float cellNoise(vec3 p){
  return 0.5 + 0.5*noise3(p);
}

/* ---------- нижний кучевой слой v7 ----------
   Форма больше не строится ни из Worley-ячеек, ни из порога на billow,
   который в 0.5.6 давал химическую "каракуль". Сначала создаётся одна
   связная крупномасштабная облачная масса, затем только её край получает
   неровности масштаба отдельных кучевых башенок. Это ближе к спутниковой
   картинке: облачный банк читается целиком, но его граница состоит из
   пышных выступов, а не из одинаковых пузырей. */
vec3 cumulusCoord(vec3 dir,float scale,vec3 seed){
  vec3 p=normalize(dir)*scale+seed;
  p+=vec3(uTime*0.0044,-uTime*0.0016,uTime*0.0029);
  /* Очень слабый изотропный domain warp. Он ломает идеальные изолинии, но
     слишком мал, чтобы вытянуть облако в спицу или длинную колбасу. */
  vec3 w=vec3(noise3(p*0.31+vec3(7.0)),
              noise3(p*0.31+vec3(19.0)),
              noise3(p*0.31+vec3(31.0)));
  return p+w*0.055;
}

float cumulusShape(vec3 p){
  float broad=0.5+0.5*fbm(p*0.66+vec3(13.0,3.0,29.0),4);
  float bank =0.5+0.5*fbm(p*1.42+vec3(37.0,11.0,5.0),3);
  float lobe =0.5+0.5*fbm(p*3.15+vec3(71.0,17.0,43.0),2);
  /* Макроформа доминирует. Более мелкие масштабы только мнут границу. */
  float body=broad*0.72+bank*0.22+lobe*0.06;
  float scallop=0.5+0.5*fbm(p*5.8+vec3(101.0,7.0,53.0),2);
  body+=(scallop-0.5)*0.085;
  return clamp(body,0.0,1.0);
}

/* Та же температурно-влажностная карта, что визуально формирует биомы на
   поверхности. Нижние облака любят океан и влажную сушу и постепенно редеют
   над горячими сухими континентальными областями — но не исчезают там
   полностью и не обрываются по контуру зоны. */
float lowCloudSuitability(float h,float temp,float moist,float lat){
  /* Береговая линия больше не работает как нож, но и шельф не должен
     считаться сушей: пространственное размытие даёт выборка вдоль
     наветренного следа, здесь достаточно перехода шириной с шельф.
     Самая сухая суша при этом сохраняет заметный остаток облачности. */
  float ocean=1.0-ss(-0.030,0.016,h);
  float land=1.0-ocean;
  float hot=ss(0.60,1.02,temp);
  float dry=1.0-ss(0.24,0.56,moist);
  float desert=land*hot*dry;
  float humidLand=ss(0.20,0.72,moist);
  float polar=ss(0.90,0.985,lat);
  /* Разрыв между морем и сушей нарочно небольшой. Когда над океаном было
     0.98, а над сушей могло быть втрое меньше, при высоком ползунке море
     затягивало сплошняком, суша — нет, и граница облачности повторяла
     береговую линию. Теперь потолок над морем ниже, пол над сушей выше, и
     кромка покрова перестаёт совпадать с берегом. */
  float suit=mix(0.44+0.50*humidLand,0.90,ocean);
  suit*=1.0-0.62*desert;
  suit*=1.0-0.26*polar*(1.0-ocean*0.55);
  return clamp(suit,0.14,1.0);
}

/* ---------- влага вдоль наветренного следа ----------
   Нижний ярус обгоняет поверхность, то есть воздух приходит с наветренной
   стороны. Пригодность берётся не в точке под облаком, а как взвешенное
   среднее по следу длиной ~1000 км против сноса: масса теряет влагу
   постепенно, пока идёт над сушей и пустыней, и так же постепенно
   насыщается снова над океаном.

   Именно поэтому облако больше не срезается по береговой линии, как по
   линейке, и не возникает мгновенно в прежней конфигурации сразу за
   дальним краем засушливой зоны: за ней тянется подветренный сухой шлейф.

   Берётся не среднее по следу, а ХУДШЕЕ из встреченного, с поправкой на
   пройденное расстояние. Испарение необратимо: облако, пересёкшее жаркую
   зону, теряет массу насовсем, и за зоной тянется настоящий след
   разрежения. Прежнее усреднение возвращало прежнюю картину, стоило
   облаку выйти за край, — будто ничего и не было. Поправка на расстояние
   задаёт, как быстро воздух насыщается снова: далёкая пустыня давит
   слабее близкой, поэтому через тысячу-другую километров облачность
   восстанавливается — но уже другой формы, потому что само поле ушло
   вперёд относительно поверхности.

   Цена держится в пределах прежней: температура и влажность меняются на
   масштабе радиана и вдоль короткого следа почти постоянны, поэтому они
   считаются один раз, а по следу берётся только макроконтур суши. Граница
   цикла из uDraft, поэтому тело отсчёта попадает в шейдер один раз. */
float lowCloudClimate(vec3 dir){
  vec3 drift=cross(uAxis,dir);
  float dl=length(drift);
  drift=(dl>1e-4)?drift/dl:vec3(0.0);
  vec3 sN=uRotS*dir;
  float lat=abs(dot(dir,uAxis));
  float tempBase=mix(-0.55,1.55,uTemp)-pow(lat,3.0)*1.55
                +0.22*fbm(sN*1.3+uSeedS*1.1+vec3(61.0),3)
                +0.16*fbm(sN*3.2+uSeedS+vec3(5.5),3);
  float moist=0.5+0.5*fbm(sN*2.4+uSeedS*1.3+vec3(17.0),4);
  int taps=(uDraft>0.5)?1:3;
  /* Отсчётов мало, и при равном шаге они дают несколько смещённых копий
     береговой линии: на косой границе это читается как правильная
     «гребёнка». Поэтому шаг растёт от отсчёта к отсчёту, а фаза всего следа
     сдвигается низкочастотным шумом в системе облаков — ступеньки виляют
     вместе с облачным полем и превращаются в рваный край. */
  float ph=0.5+0.5*noise3(uRotC*dir*22.0+uSeedC);
  float suit=1.0;
  for(int i=0;i<taps;i++){
    float fi=float(i);
    float back=(fi+ph)*0.050*(1.0+0.32*fi);      /* как далеко назад по следу */
    float h=continentH(normalize(dir-drift*back));
    float si=lowCloudSuitability(h,tempBase-max(h,0.0)*0.95,moist,lat);
    suit=min(suit, si + back*1.55);              /* восстановление с расстоянием */
  }
  return clamp(suit,0.0,1.0);
}

float cumulusRegion(vec3 p,float climate){
  float broad=0.5+0.5*fbm(p*0.30+uSeedC*0.37+vec3(67.0),3);
  /* Граница засушливой зоны — не геометрический контур: её размывает
     отдельное облачное поле, поэтому край рваный и дрейфует вместе с
     облаками, а не стоит неподвижно по берегу.
     Поле именно отдельное, не broad: с broad дрожание совпало бы с тем,
     что и так задаёт порог области, и вместо размытия границы просто
     подняло бы контраст, выбив всю полуоформленную облачность.
     Вес гасит дрожание у краёв диапазона, чтобы над открытым океаном и в
     сердцевине пустыни количество облаков осталось прежним. */
  float jit=fbm(p*1.35+uSeedC*0.83+vec3(149.0,37.0,211.0),2);
  float cl0=clamp(climate,0.0,1.0);
  float clim=clamp(cl0+jit*0.30*(4.0*cl0*(1.0-cl0)),0.0,1.0);
  float amount=clamp(uCloudLow*clim,0.0,1.0);
  float a=amount*amount*(3.0-2.0*amount);
  float threshold=mix(0.76,0.45,a);
  float region=ss(threshold,threshold+0.105,broad);
  /* Пустыня разрежает облачность плавно и с остатком: даже при максимальном
     ползунке она не превращается в сплошное покрывало, но и не выстригается
     по линейке. */
  return region*mix(0.24,1.0,ss(0.05,0.62,clim));
}

float cumulusDensityFromShape(vec3 p,float shape,float foot,float climate){
  float amount=clamp(uCloudLow*climate,0.0,1.0);
  float a=amount*amount*(3.0-2.0*amount);
  float edge=mix(0.675,0.445,a);
  float aa=clamp(foot*3.6,0.0055,0.027);
  float puff=ss(edge-aa,edge+aa,shape);
  return clamp(puff*cumulusRegion(p,climate),0.0,1.0);
}
float cumulusDensity(vec3 p,float foot,float climate){
  return cumulusDensityFromShape(p,cumulusShape(p),foot,climate);
}

/* Облака с «барашками»: curl noise + ridge noise для резких завитков */
float cloudBody(vec3 p){
  /* Искривляем координаты — даёт закручивающиеся структуры */
  vec3 w1 = p + curlNoise(p * 0.7) * 1.2;
  vec3 w2 = p + curlNoise(p*1.3 + vec3(20.0)) * 0.8;

  float broad = 0.5 + 0.5*fbm(w1*0.95, 4);
  float ridge = ridged(w1*1.8 + vec3(7.0), 4);
  float mid = 0.5 + 0.5*fbm(w2*2.35 + vec3(43.0), 3);
  float fine = 0.5 + 0.5*fbm(w1*4.8 + vec3(71.0), 2);

  float body = broad*0.38 + ridge*0.30 + mid*0.22 + fine*0.10;
  return clamp(body,0.0,1.0);
}

/* Пышность с барашками: мелкие закрученные структуры */
float puffDetail(vec3 p){
  vec3 wp = p + curlNoise(p*0.9) * 0.6;
  float a = 0.5 + 0.5*fbm(wp*3.2 + vec3(5.0), 3);
  float b = 0.5 + 0.5*fbm(wp*6.7 + vec3(17.0), 2);
  float c = 0.5 + 0.5*fbm(wp*10.5 + vec3(29.0), 2);
  float r = ridged(wp*5.0 + vec3(13.0), 3);
  return clamp(0.40*a + 0.25*b + 0.12*c + 0.23*r,0.0,1.0);
}

float coverageMask(float coverage,float amount){
  float ca=amount*amount*(3.0-2.0*amount);
  float blanket=smoothstep(0.90,0.995,amount);
  float thr=mix(0.82,0.27,ca);
  float m=ss(thr,thr+0.12,coverage);
  return mix(m,1.0,blanket);
}

float detailFade(float freq,float foot){
  float lam=6.2831853/freq;
  return 1.0-ss(lam*0.30,lam*0.95,foot);
}

/* ---------- климат: только широкие вероятности типов облака ---------- */
vec4 weather(vec3 dir, vec3 sd){
  float lat=abs(dot(dir,uAxis));
  float solar=clamp(uStarFlux,0.25,1.8);
  float itcz=exp(-pow(lat*6.0,2.0))*(0.65+0.35*solar);
  float subtr=exp(-pow((lat-0.58)*5.0,2.0));
  float midl=exp(-pow((lat-0.78)*4.5,2.0));
  float polar=exp(-pow((lat-0.93)*4.0,2.0));
  float conv= mix(0.18,0.95,uConvection) * (0.45+0.55*(0.5+0.5*fbm(sd*2.1+uSeedC*1.7+vec3(51.0),3)));
  float inst=0.5+0.5*fbm(sd*4.2+uSeedC*3.1+vec3(19.0),2);
  float fr=0.5+0.5*fbm(sd*1.55+uSeedC*2.3+vec3(7.0),3);
  float fz=clamp(fr*(midl*1.8+subtr*0.35+0.08),0.0,1.0);
  float cu=clamp(itcz*1.8*ss(0.34,0.70,conv)+midl*0.7*ss(0.40,0.72,conv),0.0,1.0);
  float sc=clamp(subtr*1.45*ss(0.26,0.64,1.0-conv)+polar*0.85*ss(0.18,0.52,conv),0.0,1.0);
  /* inst — это 0.5+0.5*fbm(...,2), он не выходит за ~0.35..0.65, так что
     пороги 0.58..0.84 и 0.50..0.80 почти всегда давали ноль и гроз не было.
     Плотная атмосфера и густая облачность усиливают неустойчивость. */
  float stormy=mix(0.55,1.45,uAtmo)*mix(0.65,1.30,uCloudLow);
  float iw=clamp((itcz*2.4*uConvection*ss(0.44,0.58,inst)+midl*1.1*ss(0.40,0.55,inst))*stormy,0.0,1.0);
  return vec4(cu,sc,fz,iw);
}

/* ---------- тонкие карты для теней ---------- */
float lowCover(vec3 dir,float climate){
  if(uCloudLow<0.015) return 0.0;
  vec3 p=cumulusCoord(uRotC*dir,2.58,uSeedC+vec3(3.0,9.0,15.0));
  float mask=cumulusDensity(p,0.0055,climate);
  return pow(mask,1.10);
}
float midCover(vec3 dir){
  if(uCloudMid<0.025) return 0.0;
  vec3 p=cloudCoord(uRotC2*dir,3.1,-0.0062,uSeedC*1.7+vec3(23.0,5.0,37.0));
  float body=cloudBody(p);
  return coverageMask(body,uCloudMid*gClimMid)*0.88;
}

/* ---------- нижний ярус: связные поля настоящих кучевых облаков ---------- */
vec3 lowDeck(vec3 dir,float foot,float climate){
  if(uCloudLow<0.015) return vec3(0.0);
  vec3 p=cumulusCoord(uRotC*dir,2.58,uSeedC+vec3(3.0,9.0,15.0));
  float shape=cumulusShape(p);
  float density=cumulusDensityFromShape(p,shape,foot,climate);

  /* Синоптика может усилить уже разрешённое климатом облако, но не способна
     вернуть плотную кучевую шапку в центр горячей пустыни. */
  float weatherBoost=clamp(0.88+0.15*gWx.x+0.08*gWx.z+0.06*gSyn.y,0.82,1.12);
  density*=weatherBoost;

  /* Мелкая неоднородность работает только внутри белого тела. Она не режет
     силуэт на отдельные кружки. */
  float fd=detailFade(82.0,foot);
  if(fd>0.02){
    float micro=0.5+0.5*fbm(p*8.2+vec3(83.0),2);
    density*=mix(0.94,1.055,micro*fd);
  }

  float cauliflower=0.5+0.5*fbm(p*4.6+vec3(131.0,17.0,29.0),2);
  float typ=clamp(0.76+0.18*uConvection+0.08*gWx.w,0.70,1.0);
  return vec3(clamp(density,0.0,1.0),cauliflower,typ);
}

/* ---------- средний ярус: существующая удачная землеподобная морфология ---------- */
vec3 midDeck(vec3 dir,float foot){
  if(uCloudMid<0.025) return vec3(0.0);
  vec3 p=cloudCoord(uRotC2*dir,3.35,-0.0075,uSeedC*1.55+vec3(23.0,5.0,37.0));
  float body=cloudBody(p*0.95+vec3(4.0));
  float detail=puffDetail(p*1.1+vec3(9.0));
  float cover=coverageMask(body,uCloudMid*gClimMid)*0.88;
  float scMask=clamp(0.55*gWx.y+0.55*gWx.z+0.25*gWx.w,0.0,1.0);
  float density=cover*(0.72+0.34*detail)*mix(0.72,1.08,scMask);
  float cells=cellNoise(p*2.7+vec3(47.0));
  density*=mix(0.62,1.18,cells);
  float fd=detailFade(70.0,foot);
  if(fd>0.02) density*=mix(0.94,1.08,fbm(p*9.0+vec3(101.0),2)*0.5+0.25);
  return vec3(clamp(density,0.0,0.92),body,clamp(0.35*gWx.z+0.65*gWx.w,0.0,1.0));
}

/* ---------- верхний ярус: независимая редкая перистая облачность ---------- */
vec3 highDeck(vec3 dir,float foot){
  if(uCloudHigh<0.02 || uDraft>0.5) return vec3(0.0);
  vec3 p=cloudCoord(uRotC3*dir,4.0,-0.011,uSeedC*1.3+vec3(31.0,11.0,53.0));
  float ca=uCloudHigh*uCloudHigh*(3.0-2.0*uCloudHigh);
  float cloudPatch=0.5+0.5*fbm(p*0.75+vec3(127.0),3);
  float pth=mix(0.72,0.50,ca);
  cloudPatch=ss(pth,pth+0.12,cloudPatch);
  float body=0.5+0.5*fbm(p*1.45,3);
  float wispBase=0.5+0.5*fbm(p*4.1+vec3(71.0),3);
  float wispFine=0.5+0.5*fbm(p*8.2+vec3(13.0),2);
  float local=clamp(wispBase*0.72+wispFine*0.28,0.0,1.0);
  float density=cloudPatch*(0.22+0.48*body)*local*mix(0.28,0.62,ca);
  density*=smoothstep(0.18,0.55,uWind+0.15);
  return vec3(clamp(density,0.0,0.55),body,0.85);
}

/* ---------- освещение ---------- */
vec4 shadeDeck(int deck,vec3 nc,vec3 rd,vec3 m,float self,float boost,float foot){
  float d=m.x;
  if(d<0.004) return vec4(0.0);
  float ndl=dot(nc,uSunDir);
  float lit=ss(-0.25,0.10,ndl);
  float nightFloor=0.035;
  float effLit=max(lit,nightFloor);

  /* Более явный объём: сердцевина темнее, край светлее. */
  float fakeH=1.0-clamp(d*1.35,0.0,1.0);
  float volumeShade=mix(0.40,1.0,fakeH);
  effLit*=volumeShade;

  float tex=0.92+0.10*(0.5+0.5*fbm(nc*((deck==0)?38.0:24.0)+uSeedC*2.2,2));
  if(deck==0) tex*=mix(0.90,1.10,m.y);
  float term=exp(-pow((ndl-0.02)*6.0,2.0));
  vec3 sunTint=mix(vec3(1.0),vec3(1.25,0.60,0.33),term*0.8);
  float lgt=max(ndl,0.0)*self*(0.42+0.58*tex)*mix(0.62,1.0,fakeH);
  lgt*=1.0+(1.0-abs(dot(rd,nc)))*0.25;

  vec3 darkS=vec3(0.16,0.18,0.24),darkC=vec3(0.10,0.12,0.18);
  vec3 brtS=vec3(1.20,1.18,1.15),brtC=vec3(1.36,1.33,1.28);
  vec3 dark,brt;
  float typ=m.z;
  if(deck==0){dark=mix(darkS,darkC,typ);brt=mix(brtS,brtC,typ);}
  else if(deck==1){dark=mix(vec3(0.22,0.24,0.30),vec3(0.17,0.19,0.25),typ);brt=mix(vec3(1.10,1.10,1.12),vec3(1.22,1.22,1.24),typ);}
  else {dark=vec3(0.28,0.32,0.40);brt=vec3(1.02,1.06,1.16);}
  vec3 ccol=mix(dark,brt*boost,ss(0.0,0.70,lgt))*sunTint*effLit;
  ccol+=vec3(0.02,0.03,0.05)*effLit;
  /* Просвет на просвет: свет, прошедший облако насквозь. Он возможен
     только там, где солнце вообще освещает этот кусок облака, то есть у
     терминатора и на лимбе. Раньше множитель зависел лишь от угла между
     лучом и направлением на звезду — а он максимален как раз тогда, когда
     смотришь на ночную сторону, и вся ночная облачность вспыхивала
     «подсветкой». Теперь вклад гасится освещённостью lit. */
  float fwd=pow(max(dot(rd,uSunDir),0.0),(deck==2)?14.0:6.0);
  ccol+=vec3(1.0,0.94,0.86)*fwd*lit*(1.0-d)*d*((deck==2)?1.2:0.6);

  float k=(deck==0)?mix(4.6,7.0,typ):((deck==1)?4.7:1.45);
  float a=1.0-exp(-d*k);
  if(deck==2)a=min(a,0.45);
  return vec4(ccol,clamp(a,0.0,1.0));
}

/* ---------- настоящий многослойный объём низкого яруса ---------- */
vec4 volumeLow(vec3 ro,vec3 rd,float t0,float span,float boost,float climate){
  vec4 acc=vec4(0.0);
  /* Черновик — это ровно один слой вместо трёх, а не отдельная ветка со
     своим вызовом lowDeck(). Граница цикла берётся из uDraft, поэтому
     компилятор не разворачивает его и тело слоя попадает в шейдер один
     раз, а не четырьмя копиями: именно на этом разворачивании линковка
     программы в ANGLE/D3D раздувалась до минут. */
  int N=(uDraft>0.5)?1:3;
  for(int i=0;i<N;i++){
    float f=(float(i)+0.5)/float(N);
    float t=t0+span*f;
    vec3 nc=normalize(ro+rd*t);
    vec3 m=lowDeck(nc,t*uPixA,climate);
    /* Облако имеет тяжёлое основание, максимум плотности в середине,
       затем постепенно рассыпается к верхушке. Это даёт выпуклый объём,
       а не одинаковую полоску через всю толщину. */
    float bottom=ss(0.03,0.20,f);
    float top=1.0-ss(0.70,0.98,f);
    float mid=ss(0.18,0.42,f)*(1.0-ss(0.68,0.90,f));
    float vert=0.48*bottom+0.92*mid+0.56*top;
    float tower=pow(ss(0.30,0.88,f),1.35)*m.z*0.35;
    float d=m.x*((N>1)?clamp(vert+tower,0.18,1.25):1.0);
    if(d<0.003)continue;
    vec4 c=shadeDeck(0,nc,rd,vec3(d,m.y,m.z),1.0,boost,t*uPixA);
    if(N>1) c.a=1.0-pow(max(1.0-c.a,0.0),0.68);
    acc.rgb+=(1.0-acc.a)*c.rgb*c.a;
    acc.a+=(1.0-acc.a)*c.a;
    if(acc.a>0.985)break;
  }
  return acc;
}
