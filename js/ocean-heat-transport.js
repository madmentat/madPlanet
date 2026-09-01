/* ============ 0.5.112: geographic surface heat forcing ============ */
/*
   Every Weather Core so far bootstrapped from a purely zonal temperature
   profile, and the ocean mixed layer relaxes on a ~400 simulated day scale.
   The polar cryosphere therefore stayed a latitude circle for the entire
   session no matter which continents the seed produced: sea-ice skin, snow
   line and albedo feedback all read a temperature that depended on |lat| only.

   Real ice edges are shaped by where ocean heat can go. Warm subtropical water
   reaches a polar sea only through an open meridional pathway (Norwegian Sea
   versus Hudson Bay / Okhotsk), the poleward branch of a wind-driven gyre
   warms the EASTERN side of a basin while cold polar water returns along the
   western boundary (Norway versus Labrador), maritime air spreads part of that
   heat onto nearby coasts, and high terrain sits under a thinner greenhouse
   column. This module resolves exactly those four terms from the actual
   cubed-sphere geography as a persistent surface heat flux (W m^-2).

   Rules:
     - the forcing is a REDISTRIBUTION: it has zero mean inside every
       latitude band and zero global area mean, so climateModel().T and the
       0.5.72 zonal bootstrap remain the planetary and zonal headline;
     - the same flux is applied every fixed tick, and the bootstrap anomaly is
       its steady state Q / lambda, so the geography does not drift away;
     - no allocation inside the fixed tick; the field is rebuilt only when the
       geography signature (seed, continents, sea level, axis) changes.
*/

const OHT_MODEL=1;
const OHT_POLEWARD_WM2=44.0;          /* zonal-mean ocean convergence scale at the pole */
const OHT_BASIN_SIDE_WM2=30.0;        /* warm east side / cold west side of a basin */
const OHT_ENCLOSED_FRACTION=0.28;     /* convergence surviving in a landlocked polar sea */
const OHT_MERIDIONAL_PATH_RAD=0.62;   /* ~35 degrees of equatorward pathway */
const OHT_ZONAL_PATH_RAD=0.80;        /* ~45 degrees along the parallel */
const OHT_PATH_SAMPLES=10;
const OHT_MARITIME_SHARE=0.55;        /* coastal land share of adjacent ocean anomaly per pass */
const OHT_MARITIME_PASSES=3;
const OHT_TERRAIN_KM_PER_UNIT=8.0;
const OHT_LAPSE_K_PER_KM=5.0;
const OHT_ELEVATION_MAX_KM=5.0;
const OHT_BAND_COUNT=20;              /* latitude bands in sin(lat) for zonal-mean removal */
const OHT_FORCING_MAX_WM2=110.0;
const OHT_ANOMALY_MAX_K=14.0;
const OHT_LAND_HEAT_CAPACITY=1.6e7;

function ohtClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function ohtSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=ohtClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function ohtWater(core,i){return ohtClamp(core?.surfaceWaterFraction?.[i]||0,0,1);}
function ohtDirToIndex(core,dx,dy,dz){
  const ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz);let face,u,v,m;
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
  const N=core.N,x=Math.max(0,Math.min(N-1,Math.floor((u+1)*0.5*N)));
  const y=Math.max(0,Math.min(N-1,Math.floor((v+1)*0.5*N)));
  return face*N*N+y*N+x;
}
function ohtAxis(axis){
  const a=axis||((typeof weatherCoreAxis==='function')?weatherCoreAxis():[0,1,0]);
  const q=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/q,a[1]/q,a[2]/q];
}
function ohtSeaLevelProxy(){
  if(typeof h2oSeaLevelProxy==='function')return h2oSeaLevelProxy();
  return -0.25+0.59*0.58;
}
function ohtSignature(core,axis){
  return (core.h2oSurfaceSignature||'')+'|'+ohtSeaLevelProxy().toFixed(4)+'|'+
    axis.map(x=>x.toFixed(3)).join(',')+'|'+core.N;
}
function ohtEnsure(core){
  if(!core?.count)return core;
  const n=core.count,f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['ohtSeaForcing','ohtLandForcing','ohtSeaAnomalyK','ohtLandAnomalyK','ohtScratchA','ohtScratchB'])f32(k);
  if(!Number.isFinite(core.ohtSignatureBuilds))core.ohtSignatureBuilds=0;
  core.oceanHeatTransportModel=OHT_MODEL;
  return core;
}
/* Global climate feedback lambda = dOLR/dT of the resolved field, W m^-2 K^-1.
   Converts a flux redistribution into its steady-state temperature anomaly. */
function ohtFeedbackWm2K(core){
  let sa=0,so=0,st=0;
  for(let i=0;i<core.count;i++){
    const a=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
    const olr=Number(core.outgoingLongwave?.[i]);
    const T=Number(core.surfaceTemp?.[i]);
    if(!Number.isFinite(olr)||!Number.isFinite(T)||T<=0)continue;
    sa+=a;so+=a*olr;st+=a*T;
  }
  if(sa<=0||so<=0||st<=0)return 3.3;
  return ohtClamp(4*(so/sa)/(st/sa),1.0,12.0);
}
/* Fraction of open water along the great-circle pathway from a cell toward
   the equator. Warm gyre water can only be delivered along such a pathway. */
function ohtMeridionalOpenness(core,dx,dy,dz,axis,s){
  const sign=s>=0?1:-1;
  let tx=-(axis[0]-dx*s)*sign,ty=-(axis[1]-dy*s)*sign,tz=-(axis[2]-dz*s)*sign;
  const q=Math.hypot(tx,ty,tz);if(q<1e-7)return 1;
  tx/=q;ty/=q;tz/=q;
  let open=0;
  for(let k=0;k<OHT_PATH_SAMPLES;k++){
    const th=(k+0.5)/OHT_PATH_SAMPLES*OHT_MERIDIONAL_PATH_RAD,c=Math.cos(th),sn=Math.sin(th);
    const px=dx*c+tx*sn,py=dy*c+ty*sn,pz=dz*c+tz*sn;
    open+=ohtWater(core,ohtDirToIndex(core,px,py,pz));
  }
  return open/OHT_PATH_SAMPLES;
}
/* Arc (rad) to the first land sample along the parallel, east (+1) or west (-1).
   Rotation about the spin axis keeps the sample exactly on the parallel. */
function ohtArcToLand(core,dx,dy,dz,axis,s,dir){
  const ex=axis[1]*dz-axis[2]*dy,ey=axis[2]*dx-axis[0]*dz,ez=axis[0]*dy-axis[1]*dx;
  for(let k=1;k<=OHT_PATH_SAMPLES;k++){
    const th=dir*k/OHT_PATH_SAMPLES*OHT_ZONAL_PATH_RAD,c=Math.cos(th),sn=Math.sin(th),m=s*(1-c);
    const px=dx*c+ex*sn+axis[0]*m,py=dy*c+ey*sn+axis[1]*m,pz=dz*c+ez*sn+axis[2]*m;
    if(ohtWater(core,ohtDirToIndex(core,px,py,pz))<0.5)return {arc:Math.abs(th),land:true};
  }
  return {arc:OHT_ZONAL_PATH_RAD,land:false};
}
function ohtBandIndex(s){
  return Math.max(0,Math.min(OHT_BAND_COUNT-1,Math.floor((s+1)*0.5*OHT_BAND_COUNT)));
}
/* Remove the area-weighted mean of `field` inside every latitude band using
   `weight` (0..1) as the fraction of the cell that the field applies to. */
function ohtRemoveBandMeans(core,field,weightOf,axis,bandSum,bandArea){
  bandSum.fill(0);bandArea.fill(0);
  for(let i=0;i<core.count;i++){
    const wgt=weightOf(i);if(wgt<0.001)continue;
    const s=ohtClamp(core.dirX[i]*axis[0]+core.dirY[i]*axis[1]+core.dirZ[i]*axis[2],-1,1);
    const b=ohtBandIndex(s),a=Math.max(1e-12,Number(core.areaWeight?.[i])||1)*wgt;
    bandSum[b]+=a*field[i];bandArea[b]+=a;
  }
  for(let i=0;i<core.count;i++){
    const wgt=weightOf(i);if(wgt<0.001){field[i]=0;continue;}
    const s=ohtClamp(core.dirX[i]*axis[0]+core.dirY[i]*axis[1]+core.dirZ[i]*axis[2],-1,1);
    const b=ohtBandIndex(s);
    if(bandArea[b]>0)field[i]-=bandSum[b]/bandArea[b];
  }
}
function ohtBuildForcing(core,axis){
  const n=core.count,sea=core.ohtSeaForcing,land=core.ohtLandForcing;
  const spill=core.ohtScratchA,spillNext=core.ohtScratchB;
  const seaLevel=ohtSeaLevelProxy(),lambda=ohtFeedbackWm2K(core);
  const bandSum=new Float64Array(OHT_BAND_COUNT),bandArea=new Float64Array(OHT_BAND_COUNT);
  for(let i=0;i<n;i++){
    const dx=core.dirX[i],dy=core.dirY[i],dz=core.dirZ[i];
    const s=ohtClamp(dx*axis[0]+dy*axis[1]+dz*axis[2],-1,1),as=Math.abs(s);
    const w=ohtWater(core,i);
    let q=0;
    if(w>0.01){
      /* Zonal-mean poleward convergence, Legendre P2 shape. Only the
         geographic deviation from its band mean survives below. */
      const P=OHT_POLEWARD_WM2*0.5*(3*s*s-1);
      if(P>0){
        /* Warm inflow follows an open pathway up to the subpolar seas; the
           central polar basin itself is fed only by what sinks there, so the
           openness contrast fades out above ~78 degrees. */
        const reach=1-ohtSmooth(0.94,0.99,as);
        const open=reach>0.001?ohtMeridionalOpenness(core,dx,dy,dz,axis,s):0;
        q=P*(OHT_ENCLOSED_FRACTION+(1-OHT_ENCLOSED_FRACTION)*(open*reach+0.5*(1-reach)));
      }else q=P;
      const band=ohtSmooth(0.42,0.70,as)*(1-ohtSmooth(0.93,0.995,as));
      if(band>0.001){
        const east=ohtArcToLand(core,dx,dy,dz,axis,s,1),west=ohtArcToLand(core,dx,dy,dz,axis,s,-1);
        if(east.land||west.land){
          const A=(west.arc-east.arc)/Math.max(1e-6,west.arc+east.arc);
          q+=OHT_BASIN_SIDE_WM2*A*band;
        }
      }
    }
    sea[i]=q;
    const h=Number(core.macroTerrain?.[i]);
    const zKm=Number.isFinite(h)?ohtClamp((h-seaLevel)*OHT_TERRAIN_KM_PER_UNIT,0,OHT_ELEVATION_MAX_KM):0;
    land[i]=-lambda*OHT_LAPSE_K_PER_KM*zKm;
  }
  ohtRemoveBandMeans(core,sea,i=>ohtWater(core,i),axis,bandSum,bandArea);
  /* Maritime spill-over: the atmosphere carries part of an ocean anomaly onto
     neighbouring land, decaying inland with each pass. */
  spill.fill(0);spillNext.fill(0);
  const nb=core.windNeighbor;
  if(nb&&nb.length>=4){
    for(let pass=0;pass<OHT_MARITIME_PASSES;pass++){
      for(let i=0;i<n;i++){
        const wl=1-ohtWater(core,i);if(wl<0.01){spillNext[i]=0;continue;}
        let sum=0,cnt=0;
        for(let k=0;k<4;k++){
          const j=nb[k][i]|0;if(j<0||j>=n||j===i)continue;
          const wj=ohtWater(core,j);sum+=wj*sea[j]+(1-wj)*spill[j];cnt++;
        }
        spillNext[i]=cnt?OHT_MARITIME_SHARE*sum/cnt:0;
      }
      spill.set(spillNext);
    }
  }
  for(let i=0;i<n;i++)land[i]+=spill[i];
  ohtRemoveBandMeans(core,land,i=>1-ohtWater(core,i),axis,bandSum,bandArea);
  /* Exact global closure and safety clamp. */
  let sa=0,sq=0;
  for(let i=0;i<n;i++){
    const a=Math.max(1e-12,Number(core.areaWeight?.[i])||1),w=ohtWater(core,i);
    sa+=a;sq+=a*(w*sea[i]+(1-w)*land[i]);
  }
  const mean=sa>0?sq/sa:0;
  let maxAbs=0;
  for(let i=0;i<n;i++){
    sea[i]=ohtClamp(sea[i]-mean,-OHT_FORCING_MAX_WM2,OHT_FORCING_MAX_WM2);
    land[i]=ohtClamp(land[i]-mean,-OHT_FORCING_MAX_WM2,OHT_FORCING_MAX_WM2);
    const w=ohtWater(core,i);
    maxAbs=Math.max(maxAbs,Math.abs(w*sea[i]+(1-w)*land[i]));
  }
  core.ohtFeedbackWm2K=lambda;core.ohtMaxAbsWm2=maxAbs;
  return core;
}
/* The anomaly is the steady state of the persistent flux. Applying only the
   CHANGE keeps a running world continuous when continents or sea level move,
   and equals a full bootstrap on a freshly created core. */
function ohtApplyAnomalyShift(core){
  const n=core.count,lambda=Math.max(0.5,Number(core.ohtFeedbackWm2K)||3.3);
  let maxShift=0;
  for(let i=0;i<n;i++){
    const w=ohtWater(core,i);
    const seaK=ohtClamp(core.ohtSeaForcing[i]/lambda,-OHT_ANOMALY_MAX_K,OHT_ANOMALY_MAX_K);
    const landK=ohtClamp(core.ohtLandForcing[i]/lambda,-OHT_ANOMALY_MAX_K,OHT_ANOMALY_MAX_K);
    const dSea=seaK-core.ohtSeaAnomalyK[i],dLand=landK-core.ohtLandAnomalyK[i];
    core.ohtSeaAnomalyK[i]=seaK;core.ohtLandAnomalyK[i]=landK;
    if(core.seaSurfaceTemp&&w>0.001)core.seaSurfaceTemp[i]=ohtClamp(core.seaSurfaceTemp[i]+dSea,80,1600);
    if(core.landSurfaceTemp&&w<0.999)core.landSurfaceTemp[i]=ohtClamp(core.landSurfaceTemp[i]+dLand,80,1600);
    const mixed=w*dSea+(1-w)*dLand;
    if(core.airTemp)core.airTemp[i]=ohtClamp(core.airTemp[i]+mixed,75,1600);
    maxShift=Math.max(maxShift,Math.abs(mixed));
  }
  core.ohtLastShiftK=maxShift;
  return core;
}
function ohtPublish(core){
  if(typeof oceanPublishSurface==='function')oceanPublishSurface(core);
  if(typeof cryoRefreshCovers==='function')cryoRefreshCovers(core);
  return core;
}
function ohtRefreshForcing(core,axis){
  if(!core?.count)return false;
  ohtEnsure(core);
  const ax=ohtAxis(axis),sig=ohtSignature(core,ax);
  if(core.ohtSignature===sig)return false;
  ohtBuildForcing(core,ax);
  ohtApplyAnomalyShift(core);
  core.ohtSignature=sig;core.ohtSignatureBuilds++;
  return true;
}
function ohtStep(core,dtSec){
  if(!core?.ohtSeaForcing)return core;
  const dt=ohtClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  if(!(dt>0))return core;
  for(let i=0;i<core.count;i++){
    const w=ohtWater(core,i);
    if(core.seaSurfaceTemp&&w>0.001){
      const cap=Math.max(1e6,Number(core.oceanHeatCapacity?.[i])||1.4e8);
      core.seaSurfaceTemp[i]=ohtClamp(core.seaSurfaceTemp[i]+core.ohtSeaForcing[i]*dt/cap,80,1600);
    }
    if(core.landSurfaceTemp&&w<0.999)
      core.landSurfaceTemp[i]=ohtClamp(core.landSurfaceTemp[i]+core.ohtLandForcing[i]*dt/OHT_LAND_HEAT_CAPACITY,80,1600);
  }
  return core;
}

const weatherCoreCreateBeforeOceanHeatTransport=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeOceanHeatTransport(seed,N,climate,axis);
  if(core?.count){ohtRefreshForcing(core,axis);ohtPublish(core);}
  return core;
};
const weatherCoreStepBeforeOceanHeatTransport=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeOceanHeatTransport(core,dtSec,climate,axis);
  if(!core?.count)return core;
  const rebuilt=ohtRefreshForcing(core,axis);
  ohtStep(core,dtSec);
  if(rebuilt)ohtPublish(core);
  else{
    if(typeof oceanPublishSurface==='function')oceanPublishSurface(core);
    if(typeof cryoRefreshCovers==='function')cryoRefreshCovers(core);
  }
  return core;
};
const weatherCoreFiniteBeforeOceanHeatTransport=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeOceanHeatTransport(core))return false;
  for(const k of ['ohtSeaForcing','ohtLandForcing','ohtSeaAnomalyK','ohtLandAnomalyK']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  return true;
};
function ohtDiagnostics(core){
  if(!core?.ohtSeaForcing)return {maxAbs:NaN,maxK:NaN};
  let maxK=0;
  for(let i=0;i<core.count;i++){
    const w=ohtWater(core,i);
    maxK=Math.max(maxK,Math.abs(w*core.ohtSeaAnomalyK[i]+(1-w)*core.ohtLandAnomalyK[i]));
  }
  return {maxAbs:Number(core.ohtMaxAbsWm2)||0,maxK};
}
if(typeof createPanel==='function'){
  const createPanelBeforeOceanHeatTransport=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeOceanHeatTransport(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-oht="forcing"]')){
        appendWeatherCoreRow(box,'Перенос тепла океаном','oht-forcing');
        const a=box.lastElementChild?.querySelector('[data-weathercore="oht-forcing"]');
        if(a){delete a.dataset.weathercore;a.dataset.oht='forcing';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeOceanHeatTransport=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeOceanHeatTransport();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.ohtSeaForcing)return;
    const d=ohtDiagnostics(core),e=box.querySelector('[data-oht="forcing"]');
    if(e)e.textContent='±'+d.maxAbs.toFixed(0)+' Вт/м² · ±'+d.maxK.toFixed(1)+' K';
  };
}
