/* ============ 0.5.80: patch-resolved ice display without grid/stripe artefacts ============ */
/*
   Physical snow/land-ice and sea-ice remain continuous area fractions in the
   low-resolution Weather Core. 0.5.79 converted the land fraction to a very
   narrow threshold using cryoGpuEdgeNoise(), whose old sine-plane field was
   excellent at exposing the cubemap interpolation lattice: close views showed
   square/polygonal cap outlines, orthogonal bands and a translucent white
   fringe. Sea ice still mixed concentration straight into colour and could
   look like milky fog around a continent.

   Display now interprets a physical fraction as sub-cell spatial coverage.
   A seamless 3-D value-noise field decides which high-resolution sub-cells are
   ice and which are exposed surface/water. The noise is evaluated from sphere
   direction, not face x/y, so it rotates with the planet and has no preferred
   cube-face axes. Dense continental ice is solid; partial sea concentration
   becomes coherent floes/leads rather than a semi-transparent white wash.
*/

const CRYOSPHERE_EDGE_DISPLAY_MODEL=2;

function cryoDisplayHash3(ix,iy,iz,seed){
  let h=(seed|0)^0x68bc21eb;
  h=Math.imul(h^Math.imul(ix|0,0x1b873593),0x85ebca6b);
  h=Math.imul(h^Math.imul(iy|0,0x27d4eb2d),0xc2b2ae35);
  h=Math.imul(h^Math.imul(iz|0,0x165667b1),0x85ebca6b);
  h^=h>>>15;h=Math.imul(h,0x2c1b3c6d);h^=h>>>12;h=Math.imul(h,0x297a2d39);h^=h>>>15;
  return (h>>>0)/4294967295;
}
function cryoDisplayFade(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
function cryoDisplayNoise3(x,y,z,seed){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const fx=x-ix,fy=y-iy,fz=z-iz;
  const u=cryoDisplayFade(fx),v=cryoDisplayFade(fy),w=cryoDisplayFade(fz);
  const h=(dx,dy,dz)=>cryoDisplayHash3(ix+dx,iy+dy,iz+dz,seed);
  const x00=h(0,0,0)+(h(1,0,0)-h(0,0,0))*u;
  const x10=h(0,1,0)+(h(1,1,0)-h(0,1,0))*u;
  const x01=h(0,0,1)+(h(1,0,1)-h(0,0,1))*u;
  const x11=h(0,1,1)+(h(1,1,1)-h(0,1,1))*u;
  const y0=x00+(x10-x00)*v,y1=x01+(x11-x01)*v;
  return y0+(y1-y0)*w;
}
function cryoDisplayRotate(x,y,z){
  return [0.36*x+0.48*y+0.80*z,-0.80*x+0.60*y,-0.48*x-0.64*y+0.60*z];
}

/* Replace the old sum of sine planes. Three differently oriented 3-D value
   noise scales give coherent bays/floes without longitude/latitude, cube-face
   or screen-aligned stripes. */
cryoGpuEdgeNoise=function(seed,face,x,y,N){
  if(typeof weatherFaceDir!=='function')return 0.5;
  const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=weatherFaceDir(face,u,v);
  const p=(seed|0)*0.000173;
  const r=cryoDisplayRotate(d[0],d[1],d[2]);
  const s=cryoDisplayRotate(r[0],r[1],r[2]);
  const a=cryoDisplayNoise3(d[0]*6.7+p,d[1]*6.7-p*0.7,d[2]*6.7+p*1.3,seed^0x1731);
  const b=cryoDisplayNoise3(r[0]*15.1-p*1.1,r[1]*15.1+p*0.5,r[2]*15.1-p*1.7,seed^0x51f1);
  const c=cryoDisplayNoise3(s[0]*33.7+p*1.9,s[1]*33.7-p*1.4,s[2]*33.7+p*0.3,seed^0x9e37);
  return Math.max(0,Math.min(1,0.56*a+0.30*b+0.14*c));
};

/* Fraction -> spatial coverage. Only the narrow edge of an individual floe is
   fractional; a 35% physical concentration means roughly 35% opaque ice and
   65% exposed surface/water, not every pixel painted 35% white. */
cryoGpuVisualCoverage=function(raw,edgeNoise,sea){
  raw=Math.max(0,Math.min(1,Number(raw)||0));
  edgeNoise=Math.max(0,Math.min(1,Number(edgeNoise)||0.5));
  if(raw<=0.008)return 0;
  if(!sea && raw>=0.70)return 1;
  if(sea && raw>=0.985)return 1;
  const feather=sea?0.050:0.036;
  return cryoGpuSmooth(edgeNoise-feather,edgeNoise+feather,raw);
};
