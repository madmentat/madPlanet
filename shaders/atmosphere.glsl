/* ---------- атмосфера ---------- */
/* Состав атмосферы (uAtmoComp):
   0.0 — N2/O2 (Земля): синее Рэлеевское рассеяние
   0.25 — CO2 тонкий (Марс): пыльный оранжевый
   0.5 — CO2 плотный (Венера): жёлтая дымка
   0.75 — N2+CH4 (Титан): оранжево-зелёный
   1.0 — H2/He+CH4 (газовый гигант): глубокий сине-зелёный */
vec3 atmoColor(){
  vec3 earthBlue   = vec3(0.22, 0.48, 0.95);
  vec3 marsDust    = vec3(0.88, 0.55, 0.28);
  vec3 venusHaze   = vec3(0.95, 0.88, 0.55);
  vec3 titanOrange = vec3(0.45, 0.55, 0.30);
  vec3 giantBlue   = vec3(0.25, 0.50, 0.65);

  float c = uAtmoComp;
  vec3 base;
  if(c < 0.25){
    base = mix(earthBlue, marsDust, c*4.0);
  } else if(c < 0.5){
    base = mix(marsDust, venusHaze, (c-0.25)*4.0);
  } else if(c < 0.75){
    base = mix(venusHaze, titanOrange, (c-0.5)*4.0);
  } else {
    base = mix(titanOrange, giantBlue, (c-0.75)*4.0);
  }
  vec3 starWash = mix(vec3(1.0), uStarCol, 0.55);
  return base * starWash;
}
