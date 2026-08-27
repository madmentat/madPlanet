/* ---------- текстуры биомов (атлас-массив) ---------- */
/* LOD считаем сами: в рейтрейсере производные UV на силуэте мусорные */
vec3 triTex(float layer, vec3 p, vec3 nrm, float sc, float foot){
  float lod = max(0.0, log2(max(foot*sc*512.0, 1e-6)));
  vec3 an = abs(nrm); an /= (an.x+an.y+an.z);
  return textureLod(uTex, vec3(p.yz*sc, layer), lod).rgb*an.x
       + textureLod(uTex, vec3(p.xz*sc, layer), lod).rgb*an.y
       + textureLod(uTex, vec3(p.xy*sc, layer), lod).rgb*an.z;
}
/* foot — размер пикселя на поверхности в долях радиуса */
vec3 biomeTex(float layer, vec3 p, vec3 nrm, float foot){
  if(uDraft > 0.5) return triTex(layer, p, nrm, 60.0, foot)*1.06;
  vec3 c = mix(triTex(layer, p, nrm, 60.0, foot),
               triTex(layer, p + vec3(17.31), nrm, 230.0, foot), 0.5);
  float fine = 1.0-ss(1.35, 2.6, uCamDist);
  if(fine > 0.02)
    c = mix(c, triTex(layer, p + vec3(5.7), nrm, 1000.0, foot), fine*0.5);
  return c*1.06;
}
