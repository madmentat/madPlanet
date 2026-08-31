/* ============ 0.5.81: hard opaque polar ice edge ============ */
/*
   Physical snow/land-ice and sea-ice remain continuous area fractions in the
   low-resolution Weather Core. Display is deliberately different: a surface
   sample is either opaque ice or exposed land/water. Fractional physics must
   never turn into a translucent white fog bank around a polar cap.

   The geographic decision is made with seamless 3-D value noise evaluated
   from sphere direction, so it rotates with the planet and has no cube-face,
   latitude or screen axes. Dense continental ice remains solid. Partial sea
   ice becomes opaque floes/open leads. Very sparse sea ice below 15% is not
   displayed as part of the coherent ice edge.
*/

const CRYOSPHERE_EDGE_DISPLAY_MODEL=3;
let cryoDisplayMeanK=288.15;

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

/* User calibration: around a +15 C mean climate, trim only the transitional
   outer coverage by about ten percent. Dense core ice is deliberately exempt,
   and the correction fades away for substantially colder/hotter climates. */
function cryoDisplayTemperateTrimWeight(T){
  T=Number(T);if(!Number.isFinite(T))T=288.15;
  const d=Math.abs(T-288.15);
  return 1-cryoDisplayFade(d/18.0);
}

/* Fraction -> BINARY spatial coverage. No feather. A physical 35% cell becomes
   an arrangement of opaque ice and exposed surface, never 35%-white pixels. */
cryoGpuVisualCoverage=function(raw,edgeNoise,sea){
  raw=Math.max(0,Math.min(1,Number(raw)||0));
  edgeNoise=Math.max(0,Math.min(1,Number(edgeNoise)||0.5));
  if(raw<=0.008)return 0;
  if(!sea && raw>=0.70)return 1;
  if(sea && raw>=0.985)return 1;
  const temperate=cryoDisplayTemperateTrimWeight(cryoDisplayMeanK);
  raw*=1-0.10*temperate;
  if(sea && raw<0.15)return 0;
  return raw>=edgeNoise?1:0;
};

/* Sample the climate once per cryosphere rebuild, never once per texel. */
if(typeof cryoGpuReadCurrent==='function'){
  const cryoGpuReadCurrentBeforeHardEdge=cryoGpuReadCurrent;
  cryoGpuReadCurrent=function(core){
    if(typeof climateModel==='function'){
      const c=climateModel();
      if(c&&Number.isFinite(Number(c.T)))cryoDisplayMeanK=Number(c.T);
    }
    return cryoGpuReadCurrentBeforeHardEdge(core);
  };
}

/* Even a binary CPU mask becomes grey if the GPU linearly filters neighbouring
   texels. The render map is already 5x the Weather Core resolution, so nearest
   sampling gives a much better solid ice edge without increasing physics cost. */
if(typeof cryoGpuEnsure==='function'){
  const cryoGpuEnsureBeforeHardEdge=cryoGpuEnsure;
  cryoGpuEnsure=function(N){
    const out=cryoGpuEnsureBeforeHardEdge(N);
    if(typeof gl!=='undefined'&&gl&&cryoGpuTex){
      gl.activeTexture(gl.TEXTURE0+CRYO_TEX_UNIT);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP,cryoGpuTex);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);
      gl.activeTexture(gl.TEXTURE0);
    }
    return out;
  };
}

/* Cross-fading two different hard coastlines is another source of white mist.
   Weather physics still evolves continuously; only the optical mask switches
   to the newest resolved geography at the weather update. */
if(typeof cryoGpuBlendAt==='function')cryoGpuBlendAt=function(){return 1;};
