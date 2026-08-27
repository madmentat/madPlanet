/* ---------- кольца ---------- */
float ringPattern(float r){
  float t = (r-1.55)/(2.55-1.55);
  if(t<0.0 || t>1.0) return 0.0;
  float n  = 0.5+0.5*noise3(vec3(r*16.0, uSeedS.x, uSeedS.y));
  float n2 = 0.5+0.5*noise3(vec3(r*43.0, uSeedS.y, 7.7));
  float n3 = 0.5+0.5*noise3(vec3(r*110.0, uSeedS.x*1.3, 3.3));
  float a = ss(0.0,0.07,t)*(1.0-ss(0.82,1.0,t));
  a *= 0.30+0.70*pow(n,1.5);
  a *= 0.45+0.55*n2;
  a *= 0.75+0.25*n3;
  a *= ss(0.015,0.05,abs(r-2.08));            /* щель Кассини */
  a *= 0.5+0.5*ss(0.01,0.03,abs(r-1.78));     /* вторая щель */
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
  float back = pow(max(dot(rd, uSunDir), 0.0), 3.0)*0.35;
  float hueV = 0.5+0.5*noise3(vec3(r*7.0, uSeedS.y*0.7, 11.0));
  vec3 base = mix(vec3(0.58,0.52,0.44), vec3(0.66,0.62,0.58), hueV);
  vec3 c = (base*dl + uStarCol*vec3(0.82,0.74,0.62)*back)*sh*1.5*starLift;
  return vec4(c, a);
}

