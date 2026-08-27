/* ---------- звёзды и туманности ---------- */
vec3 stars(vec3 rd){
  vec3 col = vec3(0.0);
  vec3 q = rd*2.0 + uSeedS*0.07;
  float band = exp(-pow(dot(rd, uMilky)*2.4, 2.0));
  if(uDraft < 0.5){
    float n1 = fbm(q*1.9+vec3(3.1), 3);
    float n2 = fbm(q*3.6+vec3(11.2), 2);
    col += vec3(0.10,0.06,0.16)*ss(0.05,0.75,n1)*(0.35+0.75*band);
    col += vec3(0.04,0.07,0.13)*ss(0.02,0.8,n2)*(0.3+0.7*band);
    col += vec3(0.20,0.17,0.22)*band*ss(-0.05,0.7,n1+0.25*n2)*0.5;
  } else {
    col += vec3(0.035,0.026,0.055)*band;
  }
  for(int L=0; L<2; L++){
    float sc = (L==0) ? 34.0 : 82.0;
    vec3 p = rd*sc + uSeedS*(3.0+float(L)*1.7);
    vec3 id = floor(p), f = fract(p);
    vec3 hh = hash33(id);
    vec3 sp = 0.2 + 0.6*hh;
    float d = length(f - sp);
    float sigma = max(uPixA*sc*1.1, 0.010);
    float br = pow(hh.x, 22.0)*((L==0)?2.6:1.3) + pow(hh.x,70.0)*5.0;
    vec3 stc = mix(vec3(1.0,0.78,0.58), vec3(0.72,0.82,1.15), hh.y);
    col += stc * br * exp(-d*d/(sigma*sigma)) * (0.55+0.45*band);
  }
  /* солнце — цвет зависит от спектрального класса */
  float sd = max(dot(rd, uSunDir), 0.0);
  vec3 starDisc = mix(uStarCol, vec3(1.0), 0.35);
  /* Видимый размер звезды определяется физическим радиусом / расстоянием,
     а не одним лишь спектральным классом. Поэтому изменение расстояния и
     светимости действительно меняет сам диск звезды. */
  float apparent = max(uStarRadius / max(uStarDist, 0.03), 0.02);
  float radius = 5200.0 / apparent;
  float halo = 1.0 - smoothstep(0.0, 0.020 + 0.010*apparent, 1.0-sd);
  float disc = pow(sd, radius);
  float flare = 0.65 + 0.35*clamp(uStarFlux,0.0,3.0);
  col += starDisc * (disc*(18.0 + 14.0*uStarFlux)*flare + halo*(0.012 + 0.020*uStarFlux));
  return col;
}
