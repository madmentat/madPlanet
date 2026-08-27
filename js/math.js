/* ============ математика ============ */
function m3axis(ax, a){          // столбцовая mat3 поворота вокруг оси (Родригес)
  const [x,y,z] = ax, c = Math.cos(a), s = Math.sin(a), t = 1-c;
  return [ t*x*x+c,   t*x*y+s*z, t*x*z-s*y,
           t*x*y-s*z, t*y*y+c,   t*y*z+s*x,
           t*x*z+s*y, t*y*z-s*x, t*z*z+c ];
}
/* столбцовая mat3 на вектор */
function m3v(m,v){
  return [m[0]*v[0]+m[3]*v[1]+m[6]*v[2],
          m[1]*v[0]+m[4]*v[1]+m[7]*v[2],
          m[2]*v[0]+m[5]*v[1]+m[8]*v[2]];
}
function m3t(m){ return [m[0],m[3],m[6], m[1],m[4],m[7], m[2],m[5],m[8]]; }
function m3mul(a,b){
  const r = new Array(9);
  for(let c=0;c<3;c++) for(let rw=0;rw<3;rw++)
    r[c*3+rw] = a[rw]*b[c*3] + a[3+rw]*b[c*3+1] + a[6+rw]*b[c*3+2];
  return r;
}
function norm3(v){ const l = Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; }
function cross3(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

