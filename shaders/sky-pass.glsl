/* ---------- небо ----------
   Отдельная маленькая программа, как и аврора. Небо рисуется только там, где
   нет планеты, и тащить его в основной шейдер незачем: за ту программу мы
   платим минутами линковки, а здесь можно позволить себе и туманности, и
   пылевые прожилки, и разброс цвета звёзд.

   Проход идёт первым и непрозрачно заливает кадр, а планета поверх
   накладывается с предумноженной альфой. */
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform mat3  uCamMat;
uniform float uFocal;
uniform float uPixA;
uniform vec3  uMilky;
uniform vec3  uSeedS;
uniform vec3  uSunDir;
uniform vec3  uStarCol;
uniform float uStarRadius, uStarDist, uStarFlux;
uniform float uVoid;
uniform float uSkyStars;   /* плотность звёздного поля */
uniform float uSkyMilky;   /* яркость галактической полосы */
uniform float uSkyNebula;  /* обилие туманностей */
uniform float uSkyHue;     /* холодный - тёплый оттенок поля */

vec3 h33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float n3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  float a = dot(h33(i)             -0.5, f);
  float b = dot(h33(i+vec3(1,0,0)) -0.5, f-vec3(1,0,0));
  float c = dot(h33(i+vec3(0,1,0)) -0.5, f-vec3(0,1,0));
  float d = dot(h33(i+vec3(1,1,0)) -0.5, f-vec3(1,1,0));
  float e = dot(h33(i+vec3(0,0,1)) -0.5, f-vec3(0,0,1));
  float g = dot(h33(i+vec3(1,0,1)) -0.5, f-vec3(1,0,1));
  float h = dot(h33(i+vec3(0,1,1)) -0.5, f-vec3(0,1,1));
  float k = dot(h33(i+vec3(1,1,1)) -0.5, f-vec3(1,1,1));
  return 2.0*mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),
                 mix(mix(e,g,u.x),mix(h,k,u.x),u.y),u.z);
}
const mat3 M3 = mat3(0.00,0.80,0.60, -0.80,0.36,-0.48, -0.60,-0.48,0.64);
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0;
  for(int i=0;i<7;i++){
    if(i>=oct) break;
    s += a*n3(p); p = M3*p*2.03 + vec3(3.1); a *= 0.5;
  }
  return s;
}
float ss(float a, float b, float x){
  float t = clamp((x-a)/(b-a), 0.0, 1.0);
  return t*t*(3.0-2.0*t);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/uRes.y;
  vec3 rd = normalize(uCamMat * normalize(vec3(uv, uFocal)));
  vec3 col = vec3(0.0);

  if(uVoid < 0.5){
    /* Галактическая полоса. Она не ровная лента: её рвут пылевые прожилки,
       из-за которых у настоящего Млечного Пути посередине идёт тёмная щель. */
    float lat  = dot(rd, uMilky);
    float band = exp(-pow(lat*2.4, 2.0));
    vec3  q    = rd*2.0 + uSeedS*0.07;
    float warp = fbm(q*1.1 + vec3(17.0), 3);
    float bandW = exp(-pow((lat + 0.12*warp)*2.4, 2.0));
    float dust = ss(0.10, 0.75, fbm(q*2.6 + vec3(41.0), 4));
    float rift = 1.0 - 0.85*ss(0.35, 0.95, fbm(q*1.7 + vec3(7.0), 3) + 0.6*exp(-pow(lat*7.0,2.0)));

    /* Оттенок поля: холодный синий - нейтральный - тёплый янтарный. */
    vec3 coolC = vec3(0.36,0.52,1.00);
    vec3 warmC = vec3(1.00,0.66,0.38);
    vec3 hueC  = mix(coolC, warmC, uSkyHue);

    vec3 milkyC = mix(vec3(0.62,0.66,0.82), hueC, 0.35);
    col += milkyC * bandW * rift * (0.070 + 0.20*dust) * uSkyMilky * 3.2;

    /* Туманности: широкое свечение, поверх него волокна, и тёмная пыль,
       которая их подрезает. Волокна берут оттенок поля, ядра светлее. */
    if(uSkyNebula > 0.01){
      float nb  = fbm(q*0.85 + vec3(83.0), 4);
      float neb = ss(0.06, 0.62, nb + 0.35*bandW);
      float fil = ss(0.20, 0.78, fbm(q*2.3 + vec3(151.0), 4));
      float core= ss(0.45, 0.85, nb);
      vec3  nc   = mix(hueC, vec3(1.0,0.86,0.92), core*0.55);
      float shade= 1.0 - 0.7*ss(0.30, 0.85, fbm(q*3.9 + vec3(211.0), 3));
      col += nc * neb * (0.35 + 0.85*fil) * shade * uSkyNebula * 0.62;
    }

    /* Звёзды в три яруса: редкие яркие, обычные и мелкая россыпь. Цвет
       разбросан по спектру от красных карликов до голубых гигантов, а размер
       пятна не даёт им мерцать при субпиксельном размере. */
    for(int L=0; L<3; L++){
      float sc = (L==0) ? 26.0 : ((L==1) ? 62.0 : 140.0);
      vec3 p = rd*sc + uSeedS*(3.0 + float(L)*1.7);
      vec3 id = floor(p), f = fract(p);
      vec3 hh = h33(id);
      vec3 sp = 0.2 + 0.6*hh;
      float d = length(f - sp);
      float sigma = max(uPixA*sc*1.1, 0.010);
      float thr = mix(30.0, 12.0, uSkyStars);
      float br = pow(hh.x, thr)*((L==0) ? 2.8 : ((L==1) ? 1.5 : 0.7))
               + pow(hh.x, thr*3.0)*5.0;
      vec3 stc = mix(vec3(1.00,0.72,0.50), vec3(0.68,0.80,1.20), hh.y);
      stc = mix(stc, mix(stc, hueC, 0.5), 0.25);
      col += stc * br * exp(-d*d/(sigma*sigma)) * (0.55 + 0.45*band);
    }
  }

  /* Звезда системы. Видимый размер идёт от физического радиуса и расстояния,
     поэтому оба ползунка действительно меняют диск. */
  float sd = max(dot(rd, uSunDir), 0.0);
  vec3 starDisc = mix(uStarCol, vec3(1.0), 0.35);
  float apparent = max(uStarRadius / max(uStarDist, 0.03), 0.02);
  float radius = 5200.0 / apparent;
  float halo = 1.0 - smoothstep(0.0, 0.020 + 0.010*apparent, 1.0-sd);
  float disc = pow(sd, radius);
  float flare = 0.65 + 0.35*clamp(uStarFlux, 0.0, 3.0);
  col += starDisc * (disc*(18.0 + 14.0*uStarFlux)*flare + halo*(0.012 + 0.020*uStarFlux));

  /* Тонмап и виньетка те же, что у планеты: иначе шов между проходами виден. */
  col = clamp((col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14), 0.0, 1.0);
  col = pow(col, vec3(1.0/2.2));
  col *= 1.0 - 0.16*pow(length(uv)*1.15, 2.4);
  fragColor = vec4(col, 1.0);
}
