/* ---------- туман / stratus ---------- */
vec3 fogLayer(vec3 dir, float foot){
  if(uLowOn < 0.5 || uCloudLow < 0.15) return vec3(0.0);
  float lat = abs(dot(dir, uAxis));
  /* Субтропический пояс инверсий: ширина 20-35° */
  float inversionBelt = smoothstep(0.3, 0.5, lat) * smoothstep(0.65, 0.5, lat);
  /* Прибрежные зоны: туман над водой у берега */
  float coastal = smoothstep(0.2, 0.6, uSea) * smoothstep(0.2, 0.6, uCont);
  /* Терминатор: диффузное свечение на границе день/ночь */
  float sunDot = dot(dir, uSunDir);
  float terminator = exp(-sunDot * sunDot * 8.0);
  float fogMask = max(max(inversionBelt * 0.4, coastal * 0.3), terminator * 0.25);
  fogMask *= uCloudLow;
  if(fogMask < 0.01) return vec3(0.0);
  /* Гладкий, низкочастотный шум — туман без текстуры */
  vec3 fp = uRotC * dir * 3.0 + uSeedC * 0.5;
  float fog = 0.5 + 0.5 * fbm(fp, 2);
  fog = smoothstep(0.35, 0.65, fog) * fogMask;
  float fade = detailFade(40.0, foot);
  return vec3(fog * fade * 0.5, 0.0, 0.0);
}

