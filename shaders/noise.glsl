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

/* 0.5.102: 3D simplex (Ashima/McEwan). Cubic lattice Perlin produces
   preferred 45°/axis facets on iso-surfaces — the triangular coast cuts.
   Simplex tiles tetrahedra, so zero-contours have no cubic bias. */
vec4 _perm(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 _tisqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }
float simplex3(vec3 v){
  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = _perm(_perm(_perm(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0*floor(p*ns.z*ns.z);
  vec4 x_ = floor(j*ns.z);
  vec4 y_ = floor(j - 7.0*x_);
  vec4 x = x_*ns.x + ns.yyyy;
  vec4 y = y_*ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = _tisqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
  m = m*m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbmSimplex(vec3 p, int oct){
  float a = 0.5, s = 0.0;
  for(int i=0;i<8;i++){
    if(i>=oct) break;
    s += a*simplex3(p);
    p = M3*p*2.03 + vec3(3.1);
    a *= 0.5;
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
