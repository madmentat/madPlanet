/* ============ 0.5.110: wind-driven ocean heat transport and sea-ice drift ============ */
/*
   0.5.109 proved that deforming only the rendered cryosphere mask is not enough:
   a nearly zonal SST/freezing field still makes the physical polar cap want to
   become a latitude circle. This module breaks that symmetry in the physics.

   It is deliberately smaller than a full primitive-equation ocean model. The
   resolved atmosphere supplies the forcing. A shallow surface current follows
   the local wind with an Ekman deflection, is reduced near blocked/coastal
   edges, and does two conservative jobs on the existing cubed-sphere edge graph:
     - anisotropic mixed-layer heat exchange along current-bearing wet edges;
     - advection of sea-ice volume by current + a small direct wind-drift term.

   The result is not a painted polar outline. Different basins and coastlines
   exchange heat at different rates, while mobile sea ice forms tongues, bays
   and openings before it melts/freezes again in cryosphere.js. Land ice remains
   controlled by snowfall, temperature and terrain rather than this ocean path.
*/

const OCEAN_CIRCULATION_MODEL=1;
const OCEAN_CURRENT_WIND_FACTOR=0.018;
const OCEAN_CURRENT_MAX_MS=1.6;
const OCEAN_EKMAN_ANGLE_RAD=0.42;            /* ~24 degrees */
const OCEAN_HEAT_EDGE_MAX_MIX=0.030;
const OCEAN_ICE_WIND_DRIFT_FACTOR=0.012;
const OCEAN_ICE_EDGE_MAX_COURANT=0.055;

function oceanCircClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function oceanCircDot(ax,ay,az,bx,by,bz){return ax*bx+ay*by+az*bz;}
function oceanCircNorm3(x,y,z,out){
  const q=Math.hypot(x,y,z)||1;out.x=x/q;out.y=y/q;out.z=z/q;return out;
}
function oceanCircAxis(){
  if(typeof weatherCoreAxis==='function'){
    const a=weatherCoreAxis();return [Number(a[0])||0,Number(a[1])||1,Number(a[2])||0];
  }
  return [0,1,0];
}
function oceanCircWater(core,i){return oceanCircClamp(core?.surfaceWaterFraction?.[i]||0,0,1);}
function oceanCircBasis(dx,dy,dz,axis,out){
  if(typeof windTangentBasis==='function')return windTangentBasis(dx,dy,dz,axis,out);
  let ex=axis[1]*dz-axis[2]*dy,ey=axis[2]*dx-axis[0]*dz,ez=axis[0]*dy-axis[1]*dx;
  let q=Math.hypot(ex,ey,ez);
  if(q<1e-7){const rx=Math.abs(dx)<0.8?1:0,rz=Math.abs(dx)<0.8?0:1;ex=-rz*dy;ey=rz*dx-rx*dz;ez=rx*dy;q=Math.hypot(ex,ey,ez)||1;}
  ex/=q;ey/=q;ez/=q;
  let nx=dy*ez-dz*ey,ny=dz*ex-dx*ez,nz=dx*ey-dy*ex;
  q=Math.hypot(nx,ny,nz)||1;nx/=q;ny/=q;nz/=q;
  out.ex=ex;out.ey=ey;out.ez=ez;out.nx=nx;out.ny=ny;out.nz=nz;return out;
}
function oceanCircEnsure(core){
  if(!core?.count)return core;
  const n=core.count,f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['oceanCurrentE','oceanCurrentN'])f32(k);
  if(!core.oceanCircHeatDelta||core.oceanCircHeatDelta.length!==n)core.oceanCircHeatDelta=new Float64Array(n);
  if(!core.oceanCircIceVolumeDelta||core.oceanCircIceVolumeDelta.length!==n)core.oceanCircIceVolumeDelta=new Float64Array(n);
  core.oceanCirculationModel=OCEAN_CIRCULATION_MODEL;return core;
}
function oceanCircResolveCurrents(core,axis){
  const c=Math.cos(OCEAN_EKMAN_ANGLE_RAD),s=Math.sin(OCEAN_EKMAN_ANGLE_RAD);
  let mean=0,wetSum=0;
  for(let i=0;i<core.count;i++){
    const wet=oceanCircWater(core,i);if(wet<0.01){core.oceanCurrentE[i]=0;core.oceanCurrentN[i]=0;continue;}
    const lat=oceanCircClamp(oceanCircDot(core.dirX[i],core.dirY[i],core.dirZ[i],axis[0],axis[1],axis[2]),-1,1);
    const hemi=lat>=0?1:-1;
    const wu=Number((core.windStateU||core.windU)?.[i])||0;
    const wv=Number((core.windStateV||core.windV)?.[i])||0;
    /* Ekman surface transport is deflected to opposite sides in the two hemispheres. */
    let e=OCEAN_CURRENT_WIND_FACTOR*(wu*c+hemi*wv*s);
    let n=OCEAN_CURRENT_WIND_FACTOR*(wv*c-hemi*wu*s);
    const speed=Math.hypot(e,n);
    if(speed>OCEAN_CURRENT_MAX_MS){const k=OCEAN_CURRENT_MAX_MS/speed;e*=k;n*=k;}
    core.oceanCurrentE[i]=e;core.oceanCurrentN[i]=n;mean+=wet*Math.hypot(e,n);wetSum+=wet;
  }
  core.oceanCurrentMeanMS=mean/Math.max(1e-12,wetSum);return core;
}
function oceanCircGlobalVelocity(core,i,axis,windDrift,out){
  const b={};oceanCircBasis(core.dirX[i],core.dirY[i],core.dirZ[i],axis,b);
  let e=Number(core.oceanCurrentE?.[i])||0,n=Number(core.oceanCurrentN?.[i])||0;
  if(windDrift){
    e+=OCEAN_ICE_WIND_DRIFT_FACTOR*(Number((core.windStateU||core.windU)?.[i])||0);
    n+=OCEAN_ICE_WIND_DRIFT_FACTOR*(Number((core.windStateV||core.windV)?.[i])||0);
  }
  out.x=e*b.ex+n*b.nx;out.y=e*b.ey+n*b.ny;out.z=e*b.ez+n*b.nz;return out;
}
function oceanCircEdgeTangent(core,i,j,out){
  const ix=core.dirX[i],iy=core.dirY[i],iz=core.dirZ[i];
  const dot=oceanCircClamp(oceanCircDot(ix,iy,iz,core.dirX[j],core.dirY[j],core.dirZ[j]),-1,1);
  return oceanCircNorm3(core.dirX[j]-ix*dot,core.dirY[j]-iy*dot,core.dirZ[j]-iz*dot,out);
}
function oceanCircAdvectHeat(core,dtSec,axis){
  const edges=core?.h2oEdgeI?.length||0;if(!edges||!core.seaSurfaceTemp)return 0;
  const dt=oceanCircClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  const delta=core.oceanCircHeatDelta;delta.fill(0);const vi={},vj={},t={};let moved=0;
  for(let e=0;e<edges;e++){
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e],wi=oceanCircWater(core,i),wj=oceanCircWater(core,j);
    const wet=Math.min(wi,wj);if(wet<0.05)continue;
    oceanCircEdgeTangent(core,i,j,t);oceanCircGlobalVelocity(core,i,axis,false,vi);oceanCircGlobalVelocity(core,j,axis,false,vj);
    const along=0.5*(oceanCircDot(vi.x,vi.y,vi.z,t.x,t.y,t.z)+oceanCircDot(vj.x,vj.y,vj.z,t.x,t.y,t.z));
    const speed=Math.abs(along);if(speed<1e-5)continue;
    const L=Math.max(1,Number(core.h2oEdgeDistance?.[e])||1);
    const courant=Math.min(OCEAN_HEAT_EDGE_MAX_MIX,speed*dt/L)*wet;
    const ai=Math.max(1e-12,core.areaWeight?.[i]||1)*wi,aj=Math.max(1e-12,core.areaWeight?.[j]||1)*wj;
    const Ci=Math.max(1e6,Number(core.oceanHeatCapacity?.[i])||1.4e8)*ai;
    const Cj=Math.max(1e6,Number(core.oceanHeatCapacity?.[j])||1.4e8)*aj;
    const q=(Number(core.seaSurfaceTemp[i])-Number(core.seaSurfaceTemp[j]))*Math.min(Ci,Cj)*courant;
    delta[i]-=q;delta[j]+=q;moved+=Math.abs(q);
  }
  for(let i=0;i<core.count;i++){
    const w=oceanCircWater(core,i);if(w<0.001)continue;
    const C=Math.max(1e6,Number(core.oceanHeatCapacity?.[i])||1.4e8)*Math.max(1e-12,core.areaWeight?.[i]||1)*w;
    core.seaSurfaceTemp[i]=oceanCircClamp(core.seaSurfaceTemp[i]+delta[i]/Math.max(1e-12,C),80,1600);
  }
  return 0.5*moved;
}
function oceanCircAdvectSeaIce(core,dtSec,axis){
  const edges=core?.h2oEdgeI?.length||0;if(!edges||!core.seaIceThicknessM)return 0;
  const dt=oceanCircClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  const delta=core.oceanCircIceVolumeDelta;delta.fill(0);const vi={},vj={},t={};let moved=0;
  for(let e=0;e<edges;e++){
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e],wi=oceanCircWater(core,i),wj=oceanCircWater(core,j);
    if(Math.min(wi,wj)<0.05)continue;
    oceanCircEdgeTangent(core,i,j,t);oceanCircGlobalVelocity(core,i,axis,true,vi);oceanCircGlobalVelocity(core,j,axis,true,vj);
    const along=0.5*(oceanCircDot(vi.x,vi.y,vi.z,t.x,t.y,t.z)+oceanCircDot(vj.x,vj.y,vj.z,t.x,t.y,t.z));
    if(Math.abs(along)<1e-5)continue;
    const src=along>0?i:j,dst=along>0?j:i,sw=oceanCircWater(core,src),dw=oceanCircWater(core,dst);
    const h=Math.max(0,Number(core.seaIceThicknessM[src])||0);if(h<=1e-6)continue;
    const L=Math.max(1,Number(core.h2oEdgeDistance?.[e])||1);
    const courant=Math.min(OCEAN_ICE_EDGE_MAX_COURANT,Math.abs(along)*dt/L);
    const srcArea=Math.max(1e-12,core.areaWeight?.[src]||1)*sw;
    const volume=h*srcArea*courant;
    delta[src]-=volume;delta[dst]+=volume;moved+=volume;
  }
  const maxH=(typeof CRYO_SEA_ICE_MAX_M==='number'?CRYO_SEA_ICE_MAX_M:6.0);
  for(let i=0;i<core.count;i++){
    const w=oceanCircWater(core,i);if(w<0.001)continue;
    const area=Math.max(1e-12,core.areaWeight?.[i]||1)*w;
    core.seaIceThicknessM[i]=oceanCircClamp((Number(core.seaIceThicknessM[i])||0)+delta[i]/area,0,maxH);
  }
  return moved;
}
function oceanCircStep(core,dtSec){
  if(!core?.count)return core;oceanCircEnsure(core);const axis=oceanCircAxis();
  oceanCircResolveCurrents(core,axis);
  core.oceanCurrentHeatMovedJ=oceanCircAdvectHeat(core,dtSec,axis);
  core.oceanSeaIceDriftVolume=oceanCircAdvectSeaIce(core,dtSec,axis);
  if(typeof oceanPublishSurface==='function')oceanPublishSurface(core);
  if(typeof cryoRefreshCovers==='function')cryoRefreshCovers(core);
  return core;
}

const weatherCoreCreateBeforeOceanCirculation=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){const core=weatherCoreCreateBeforeOceanCirculation(seed,N,climate,axis);oceanCircEnsure(core);return oceanCircResolveCurrents(core,axis||oceanCircAxis());};
const weatherCoreStepBeforeOceanCirculation=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){weatherCoreStepBeforeOceanCirculation(core,dtSec,climate,axis);return oceanCircStep(core,dtSec);};
const weatherCoreFiniteBeforeOceanCirculation=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeOceanCirculation(core))return false;
  for(const k of ['oceanCurrentE','oceanCurrentN']){const a=core?.[k];if(!a||a.length!==core.count)return false;for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;}
  return true;
};
