/* ============ 0.5.81 / 0.5.108 / 0.5.109 / 0.5.112: hard opaque polar ice edge ============ */
/*
   Physical snow/land-ice and sea-ice remain continuous area fractions in the
   low-resolution Weather Core. Display is deliberately different: a surface
   sample is either opaque ice or exposed land/water. Fractional physics must
   never turn into a translucent white fog bank around a polar cap.

   0.5.109 tried to hide a circular cap by sampling the physical field through
   a seed-dependent meridional warp of up to ten degrees. That detached ice
   from its own coastlines (an ice sheet displaced 1000 km off its continent)
   and every seed still produced the same kind of smooth lobed circle, because
   the physical field underneath was zonal. 0.5.112 removes the warp: the
   Weather Core temperature is now geographic (ocean-heat-transport.js), so the
   displayed edge follows real basins, coasts and plateaus. Only shoreline-
   scale 3-D noise remains here, to break the cube grid at the final edge.
*/

const CRYOSPHERE_EDGE_DISPLAY_MODEL=6;
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

/* Shoreline-scale breakup of the final edge. These frequencies roughen the
   coast of an ice sheet; the continental-scale outline comes from physics. */
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

/* Dense display reconstruction of the authoritative physical field. The
   sampling direction is the true surface direction: geography lives in the
   physics, not in a display-side displacement.

   0.5.114: the geometry of this reconstruction never changes between ticks,
   only the field values do. Earlier versions re-projected every display texel
   through weatherFaceDir/normalize/dirToIndex eight times per tick (about
   600 ms of the once-per-second hitch on desktop). The four source cell
   indices and bilinear weights are now tabulated once per (core.N, display N),
   and the seed-dependent edge noise is cached lazily per texel, so a tick
   costs one fused multiply-add pass. */
let cryoDisplayTable=null,cryoDisplayNoiseCache=null,cryoDisplayLandField=null,cryoDisplaySeaField=null;
function cryoDisplayBuildTable(core,N){
  const coreN=core.N,T=6*N*N,wide=core.count>65535;
  const idx=wide?new Uint32Array(4*T):new Uint16Array(4*T),wt=new Float32Array(2*T);
  let t=0;
  for(let face=0;face<6;face++)for(let y=0;y<N;y++)for(let x=0;x<N;x++,t++){
    const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=weatherFaceDir(face,u,v);
    const m=cryoDisplayDirectionFaceUV(d);
    const fx=(m[1]+1)*0.5*coreN-0.5,fy=(m[2]+1)*0.5*coreN-0.5;
    const x0=Math.floor(fx),y0=Math.floor(fy);
    wt[2*t]=Math.max(0,Math.min(1,fx-x0));wt[2*t+1]=Math.max(0,Math.min(1,fy-y0));
    const corners=[[x0,y0],[x0+1,y0],[x0,y0+1],[x0+1,y0+1]];
    for(let k=0;k<4;k++){
      const uu=2*(corners[k][0]+0.5)/coreN-1,vv=2*(corners[k][1]+0.5)/coreN-1,dd=weatherFaceDir(m[0],uu,vv);
      idx[4*t+k]=cryoGpuDirToIndex(core,dd[0],dd[1],dd[2]);
    }
  }
  return {coreN,N,count:core.count,idx,wt};
}
function cryoDisplayEnsureTable(core,N){
  if(!cryoDisplayTable||cryoDisplayTable.coreN!==core.N||cryoDisplayTable.N!==N||cryoDisplayTable.count!==core.count)
    cryoDisplayTable=cryoDisplayBuildTable(core,N);
  const seed=core.seed|0;
  if(!cryoDisplayNoiseCache||cryoDisplayNoiseCache.seed!==seed||cryoDisplayNoiseCache.N!==N){
    const noise=new Float32Array(6*N*N);noise.fill(-1);
    cryoDisplayNoiseCache={seed,N,noise};
  }
  if(!cryoDisplayLandField||cryoDisplayLandField.length!==core.count){
    cryoDisplayLandField=new Float32Array(core.count);cryoDisplaySeaField=new Float32Array(core.count);
  }
  return cryoDisplayTable;
}
if(typeof cryoGpuReadCurrent==='function'){
  cryoGpuReadCurrent=function(core){
    if(typeof climateModel==='function'){
      const c=climateModel();
      if(c&&Number.isFinite(Number(c.T)))cryoDisplayMeanK=Number(c.T);
    }
    const N=cryoGpuN,seed=core.seed|0,tab=cryoDisplayEnsureTable(core,N);
    const idx=tab.idx,wt=tab.wt,noise=cryoDisplayNoiseCache.noise;
    const landF=cryoDisplayLandField,seaF=cryoDisplaySeaField;
    for(let i=0;i<core.count;i++){landF[i]=cryoGpuSourceLandIndex(core,i);seaF[i]=cryoGpuSourceSeaIndex(core,i);}
    let t=0;
    for(let face=0;face<6;face++){
      const land=cryoGpuCurrLand[face],sea=cryoGpuCurrSea[face];
      for(let y=0;y<N;y++){
        const rowDst=(N-1-y)*N;
        for(let x=0;x<N;x++,t++){
          const i0=idx[4*t],i1=idx[4*t+1],i2=idx[4*t+2],i3=idx[4*t+3],tx=wt[2*t],ty=wt[2*t+1];
          const lab=landF[i0]+(landF[i1]-landF[i0])*tx,lcd=landF[i2]+(landF[i3]-landF[i2])*tx;
          const rawLand=lab+(lcd-lab)*ty;
          const sab=seaF[i0]+(seaF[i1]-seaF[i0])*tx,scd=seaF[i2]+(seaF[i3]-seaF[i2])*tx;
          const rawSea=sab+(scd-sab)*ty;
          const needsNoise=(rawLand>0.008&&rawLand<0.995)||(rawSea>0.02&&rawSea<0.995);
          let edge=0.5;
          if(needsNoise){
            edge=noise[t];
            if(edge<0){edge=cryoGpuEdgeNoise(seed,face,x,y,N);noise[t]=edge;}
          }
          const dst=rowDst+x;
          land[dst]=cryoGpuVisualCoverage(rawLand,edge,false);
          sea[dst]=cryoGpuVisualCoverage(rawSea,edge,true);
        }
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
