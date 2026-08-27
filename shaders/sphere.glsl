/* ---------- пересечение сферы ---------- */
float iSphere(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r*r;
  float hh = b*b - c;
  if(hh < 0.0) return -1.0;
  return -b - sqrt(hh);
}

