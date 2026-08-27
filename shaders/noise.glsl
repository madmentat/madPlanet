/* ---------- шум ---------- */
vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  float a = dot(hash33(i)                -0.5, f);
  float b = dot(hash33(i+vec3(1,0,0))    -0.5, f-vec3(1,0,0));
  float c = dot(hash33(i+vec3(0,1,0))    -0.5, f-vec3(0,1,0));
  float d = dot(hash33(i+vec3(1,1,0))    -0.5, f-vec3(1,1,0));
  float e = dot(hash33(i+vec3(0,0,1))    -0.5, f-vec3(0,0,1));
  float g = dot(hash33(i+vec3(1,0,1))    -0.5, f-vec3(1,0,1));
  float h = dot(hash33(i+vec3(0,1,1))    -0.5, f-vec3(0,1,1));
  float k = dot(hash33(i+vec3(1,1,1))    -0.5, f-vec3(1,1,1));
  return 2.0*mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),
                 mix(mix(e,g,u.x),mix(h,k,u.x),u.y),u.z);
}
const mat3 M3 = mat3( 0.00, 0.80, 0.60,
                     -0.80, 0.36,-0.48,
                     -0.60,-0.48, 0.64);
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0;
  for(int i=0;i<8;i++){
    if(i>=oct) break;
    s += a*noise3(p);
    p = M3*p*2.03 + vec3(3.1);
    a *= 0.5;
  }
  return s;
}
float ridged(vec3 p, int oct){
  float a = 0.55, s = 0.0;
  for(int i=0;i<6;i++){
    if(i>=oct) break;
    float n = 1.0 - abs(noise3(p));
    s += n*n*a;
    a *= 0.5; p = M3*p*2.15;
  }
  return s;
}
/* curl noise: искривляет координаты для завитков облаков */
vec3 curlNoise(vec3 p){
  float e = 0.1;
  float n1, n2;
  n1 = noise3(p + vec3(0,e,0)); n2 = noise3(p - vec3(0,e,0));
  float cx = (n1 - n2) / (2.0*e);
  n1 = noise3(p + vec3(0,0,e)); n2 = noise3(p - vec3(0,0,e));
  float cy = (n1 - n2) / (2.0*e);
  n1 = noise3(p + vec3(e,0,0)); n2 = noise3(p - vec3(e,0,0));
  float cz = (n1 - n2) / (2.0*e);
  return vec3(cz - cy, cx - cz, cy - cx);
}

/* плавный шаг, безопасный для перевёрнутых краёв */
float ss(float a, float b, float x){
  float t = clamp((x-a)/(b-a), 0.0, 1.0);
  return t*t*(3.0-2.0*t);
}
