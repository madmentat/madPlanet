/* ============ 0.5.81 / 0.5.108 / 0.5.109: hard opaque polar ice edge ============ */
/*
   Physical snow/land-ice and sea-ice remain continuous area fractions in the
   low-resolution Weather Core. Display is deliberately different: a surface
   sample is either opaque ice or exposed land/water. Fractional physics must
   never turn into a translucent white fog bank around a polar cap.

   0.5.108 removed the dense-land shortcut that exposed a latitude-like circle,
   but it only changed the threshold inside the already narrow physical edge.
   The cap therefore still looked circular from orbit. 0.5.109 changes the
   geometry at a much larger scale: the physical cryosphere field is sampled
   along a seed-dependent meridional warp of up to about ten degrees. The warp
   has zero-mean low-order sectors, so it creates continent-scale bays, lobes,
   an eccentric side and ice tongues instead of merely roughening the same
   circular isocontour. Fine 3-D noise remains only for the final shoreline.
*/

const CRYOSPHERE_EDGE_DISPLAY_MODEL=5;
const CRYO_CAP_GLOBAL_WARP_MAX_RAD=0.18;
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
function cryoDisplayNorm3(v){
  const q=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/q,v[1]/q,v[2]/q];
}
function cryoDisplayDot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cryoDisplayCross3(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function cryoDisplaySeedRotation(seed,salt){
  const a=2*cryoDisplayHash3((seed|0)^(salt|0),salt|0,(seed+17)|0,(salt^0x51f15e)|0)-1;
  const b=2*cryoDisplayHash3((seed+Math.imul(salt|0,3))|0,(salt^0x9e37)|0,(seed^0x1731)|0,(salt+29)|0)-1;
  const q=Math.hypot(a,b)||1;return [a/q,b/q];
}

/* Prepare a body-fixed polar frame once per cryosphere rebuild. Low-order
   longitude sectors are intentionally cheap: the weather tick is already the
   main-thread cadence bottleneck on tablets, so the global shape must not add
   another stack of per-texel FBM calls. */
function cryoDisplayPolarWarpFrame(seed,axis){
  const a=cryoDisplayNorm3(axis||[0,1,0]);
  const ref=Math.abs(a[1])<0.86?[0,1,0]:[1,0,0];
  const e1=cryoDisplayNorm3(cryoDisplayCross3(a,ref)),e2=cryoDisplayCross3(a,e1);
  const make=salts=>salts.map(s=>cryoDisplaySeedRotation(seed|0,s));
  return {
    axis:a,e1,e2,
    north:make([0x11a3,0x22b5,0x33c7,0x44d9]),
    south:make([0x55eb,0x66fd,0x771f,0x8831])
  };
}
function cryoDisplayRotatedX(x,y,r){return r[0]*x-r[1]*y;}
function cryoDisplayPolarOffsetRad(d,frame){
  const s=cryoDisplayDot3(d,frame.axis),as=Math.abs(s);
  if(as<0.50||as>0.99995)return 0;
  const q=[d[0]-frame.axis[0]*s,d[1]-frame.axis[1]*s,d[2]-frame.axis[2]*s];
  const qn=Math.hypot(q[0],q[1],q[2]);if(qn<1e-7)return 0;
  const x=cryoDisplayDot3(q,frame.e1)/qn,y=cryoDisplayDot3(q,frame.e2)/qn;
  const r=s>=0?frame.north:frame.south;
  const x1=cryoDisplayRotatedX(x,y,r[0]);
  const x2=cryoDisplayRotatedX(x,y,r[1]);
  const x3=cryoDisplayRotatedX(x,y,r[2]);
  const x5=cryoDisplayRotatedX(x,y,r[3]);
  const h1=x1;
  const h2=2*x2*x2-1;
  const h3=4*x3*x3*x3-3*x3;
  const x5_2=x5*x5,x5_3=x5_2*x5,x5_5=x5_3*x5_2;
  const h5=16*x5_5-20*x5_3+5*x5;
  const polarWeight=cryoDisplayFade((as-0.50)/0.24);
  const delta=(0.060*h1+0.090*h2+0.050*h3+0.025*h5)*polarWeight;
  return Math.max(-CRYO_CAP_GLOBAL_WARP_MAX_RAD,Math.min(CRYO_CAP_GLOBAL_WARP_MAX_RAD,delta));
}
function cryoDisplayWarpDirection(d,frame){
  const delta=cryoDisplayPolarOffsetRad(d,frame);if(Math.abs(delta)<1e-7)return d;
  const s=cryoDisplayDot3(d,frame.axis),sign=s>=0?1:-1,as=Math.abs(s);
  const toward=[frame.axis[0]*sign-d[0]*as,frame.axis[1]*sign-d[1]*as,frame.axis[2]*sign-d[2]*as];
  const tq=Math.hypot(toward[0],toward[1],toward[2]);if(tq<1e-7)return d;
  return cryoDisplayNorm3([d[0]+toward[0]/tq*delta,d[1]+toward[1]/tq*delta,d[2]+toward[2]/tq*delta]);
}
function cryoDisplayDirectionFaceUV(d){
  const dx=d[0],dy=d[1],dz=d[2],ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz);let face,u,v,m;
  if(ax>=ay&&ax>=az){
    if(dx>=0){face=0;m=Math.max(1e-12,dx);u=-dz/m;v=dy/m;}
    else{face=1;m=Math.max(1e-12,-dx);u=dz/m;v=dy/m;}
  }else if(ay>=az){
    if(dy>=0){face=2;m=Math.max(1e-12,dy);u=dx/m;v=-dz/m;}
    else{face=3;m=Math.max(1e-12,-dy);u=dx/m;v=dz/m;}
  }else{
    if(dz>=0){face=4;m=Math.max(1e-12,dz);u=dx/m;v=dy/m;}
    else{face=5;m=Math.max(1e-12,-dz);u=-dx/m;v=dy/m;}
  }
  return [face,u,v];
}
function cryoDisplaySampleDirection(core,d,sea){
  const m=cryoDisplayDirectionFaceUV(d),N=core.N;
  const fx=(m[1]+1)*0.5*N-0.5,fy=(m[2]+1)*0.5*N-0.5;
  return cryoGpuBilerp(core,m[0],fx,fy,sea);
}

/* Shoreline-scale breakup after the global cap has already been displaced.
   These frequencies may roughen the edge, but they no longer carry the burden
   of making a circular cap look continental from orbit. */
cryoGpuEdgeNoise=function(seed,face,x,y,N){
  if(typeof weatherFaceDir!=='function')return 0.5;
  const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=weatherFaceDir(face,u,v);
  const p=(seed|0)*0.000173;
  const r=cryoDisplayRotate(d[0],d[1],d[2]);
  const s=cryoDisplayRotate(r[0],r[1],r[2]);
  const broad=cryoDisplayNoise3(d[0]*2.35+p,d[1]*2.35-p*0.7,d[2]*2.35+p*1.3,seed^0x1731);
  const regional=cryoDisplayNoise3(r[0]*5.40-p*1.1,r[1]*5.40+p*0.5,r[2]*5.40-p*1.7,seed^0x51f1);
  const local=cryoDisplayNoise3(s[0]*13.7+p*1.9,s[1]*13.7-p*1.4,s[2]*13.7+p*0.3,seed^0x9e37);
  const fine=cryoDisplayNoise3(d[0]*31.1-p*2.3,d[1]*31.1+p*1.6,d[2]*31.1-p*0.9,seed^0x6d2b);
  const n=0.48*broad+0.29*regional+0.16*local+0.07*fine;
  return Math.max(0.08,Math.min(0.92,0.10+0.82*n));
};

/* User calibration: around a +15 C mean climate, trim the transitional outer
   cap by about ten percent. The correction fades away in markedly colder or
   hotter climates and never removes a truly saturated physical ice core. */
function cryoDisplayTemperateTrimWeight(T){
  T=Number(T);if(!Number.isFinite(T))T=288.15;
  const d=Math.abs(T-288.15);
  return 1-cryoDisplayFade(d/18.0);
}

/* Fraction -> BINARY spatial coverage. No feather and no opacity interpolation. */
cryoGpuVisualCoverage=function(raw,edgeNoise,sea){
  raw=Math.max(0,Math.min(1,Number(raw)||0));
  edgeNoise=Math.max(0,Math.min(1,Number(edgeNoise)||0.5));
  if(raw<=0.008)return 0;
  if(raw>=0.995)return 1;
  const temperate=cryoDisplayTemperateTrimWeight(cryoDisplayMeanK);
  raw*=1-0.10*temperate;
  if(sea && raw<0.15)return 0;
  return raw>=edgeNoise?1:0;
};

/* 0.5.109: unlike 0.5.108, do not only change the threshold at the same
   latitude. Sample the authoritative physical field at a nearby latitude whose
   offset varies by broad body-fixed sectors. A sharp physical 0/1 snow line is
   therefore visibly displaced by many degrees instead of remaining a circle. */
if(typeof cryoGpuReadCurrent==='function'){
  cryoGpuReadCurrent=function(core){
    if(typeof climateModel==='function'){
      const c=climateModel();
      if(c&&Number.isFinite(Number(c.T)))cryoDisplayMeanK=Number(c.T);
    }
    const N=cryoGpuN,seed=core.seed|0;
    const axis=(typeof weatherCoreAxis==='function')?weatherCoreAxis():[0,1,0];
    const warpFrame=cryoDisplayPolarWarpFrame(seed,axis);
    for(let face=0;face<6;face++){
      const land=cryoGpuCurrLand[face],sea=cryoGpuCurrSea[face];
      for(let y=0;y<N;y++)for(let x=0;x<N;x++){
        const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=weatherFaceDir(face,u,v);
        const sampleDir=cryoDisplayWarpDirection(d,warpFrame);
        const rawLand=cryoDisplaySampleDirection(core,sampleDir,false);
        const rawSea=cryoDisplaySampleDirection(core,sampleDir,true);
        const needsNoise=(rawLand>0.008&&rawLand<0.995)||(rawSea>0.02&&rawSea<0.995);
        const edge=needsNoise?cryoGpuEdgeNoise(seed,face,x,y,N):0.5;
        const dst=(N-1-y)*N+x;
        land[dst]=cryoGpuVisualCoverage(rawLand,edge,false);
        sea[dst]=cryoGpuVisualCoverage(rawSea,edge,true);
      }
    }
  };
}

/* Even a binary CPU mask becomes grey if the GPU linearly filters neighbouring
   texels. Keep nearest sampling: geometric irregularity comes from the dense
   spherical display mask, not from translucent interpolation. */
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
