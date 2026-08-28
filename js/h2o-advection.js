/* ============ 0.5.43: evaporation + H2O advection ============ */
/*
   Weather Core v5 resolves the spatial distribution of atmospheric water.
   Each cubed-sphere cell owns a physical vapor column (kg/m2). Warm liquid
   surfaces inject vapor and the 0.5.42 tangent wind field transports it with
   a conservative finite-volume edge flux.

   The global atmosphere/ocean/ice phase partition is still owned by the
   conserved 0.5.37 one-box water budget. After local evaporation/advection we
   therefore renormalize the area-weighted vapor column to the current global
   H2O reservoir. This is an explicit temporary bridge: 0.5.44 replaces that
   closure with local saturation/condensation, after which local phase changes
   can own the atmospheric reservoir directly.

   Surface-water geography uses a CPU port of the same cheap continentH()
   macro-continent field already used by the shader moisture path. It is
   computed only when seed/continent geometry changes; changing sea level only
   moves the threshold and costs one light pass over the Weather Core grid.
*/

const H2O_TRANSPORT_MODEL = 1;
const H2O_EVAP_TAU_SEC = 2.2*86400;
const H2O_EVAP_RH_TARGET = 0.78;
const H2O_EVAP_MAX_KG_M2_S = 3.5e-4;
const H2O_ADVECT_EDGE_CFL = 0.22;
const H2O_ADVECT_MAX_OUTFLOW = 0.72;
const H2O_COAST_HALF_WIDTH = 0.032;

function h2oClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function h2oSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=h2oClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function h2oFract(x){ return x-Math.floor(x); }
function h2oMix(a,b,t){ return a+(b-a)*t; }

/* Exact scalar port of shaders/noise.glsl hash33/noise3/fbm. The helper uses
   one reusable output object instead of allocating vectors in the 13k-cell
   precompute. */
const h2oHashTmp={x:0,y:0,z:0};
function h2oHash33(x,y,z,out){
  x=h2oFract(x*0.1031); y=h2oFract(y*0.1030); z=h2oFract(z*0.0973);
  const d=x*(y+33.33)+y*(x+33.33)+z*(z+33.33);
  x+=d;y+=d;z+=d;
  out.x=h2oFract((x+y)*z);
  out.y=h2oFract((2*x)*y);
  out.z=h2oFract((x+y)*x);
  return out;
}
function h2oGradDot(ix,iy,iz,fx,fy,fz,ox,oy,oz){
  h2oHash33(ix,iy,iz,h2oHashTmp);
  return (h2oHashTmp.x-0.5)*(fx-ox)+(h2oHashTmp.y-0.5)*(fy-oy)+(h2oHashTmp.z-0.5)*(fz-oz);
}
function h2oNoise3(x,y,z){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const fx=x-ix,fy=y-iy,fz=z-iz;
  const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy),uz=fz*fz*(3-2*fz);
  const a=h2oGradDot(ix,iy,iz,fx,fy,fz,0,0,0);
  const b=h2oGradDot(ix+1,iy,iz,fx,fy,fz,1,0,0);
  const c=h2oGradDot(ix,iy+1,iz,fx,fy,fz,0,1,0);
  const d=h2oGradDot(ix+1,iy+1,iz,fx,fy,fz,1,1,0);
  const e=h2oGradDot(ix,iy,iz+1,fx,fy,fz,0,0,1);
  const g=h2oGradDot(ix+1,iy,iz+1,fx,fy,fz,1,0,1);
  const h=h2oGradDot(ix,iy+1,iz+1,fx,fy,fz,0,1,1);
  const k=h2oGradDot(ix+1,iy+1,iz+1,fx,fy,fz,1,1,1);
  return 2*h2oMix(h2oMix(h2oMix(a,b,ux),h2oMix(c,d,ux),uy),
                  h2oMix(h2oMix(e,g,ux),h2oMix(h,k,ux),uy),uz);
}
function h2oFbm(x,y,z,oct){
  let amp=0.5,sum=0;
  for(let i=0;i<oct;i++){
    sum+=amp*h2oNoise3(x,y,z);
    /* GLSL mat3 constructor is column-major: this is M3*p. */
    const nx=(-0.80*y-0.60*z)*2.03+3.1;
    const ny=( 0.80*x+0.36*y-0.48*z)*2.03+3.1;
    const nz=( 0.60*x-0.48*y+0.64*z)*2.03+3.1;
    x=nx;y=ny;z=nz;amp*=0.5;
  }
  return sum;
}
function h2oMacroTerrainHeight(dx,dy,dz){
  const cont=typeof state!=='undefined'?h2oClamp(state.cont,0,1):0.45;
  const f=0.7+(2.6-0.7)*cont;
  const seed=(typeof world!=='undefined'&&world&&world.seedS)?world.seedS:[0,0,0];
  const px=dx*f+seed[0],py=dy*f+seed[1],pz=dz*f+seed[2];
  const wx=h2oFbm(px+1.7,py+9.2,pz+3.1,2);
  const wy=h2oFbm(px+8.3,py+2.8,pz+5.9,2);
  const wz=h2oFbm(px+4.6,py+7.1,pz+0.7,2);
  return 0.95*h2oFbm(px+0.9*wx,py+0.9*wy,pz+0.9*wz,5);
}
function h2oSurfaceSignature(){
  const seed=(typeof state!=='undefined')?(state.seed|0):0;
  const cont=(typeof state!=='undefined'&&Number.isFinite(state.cont))?state.cont:0.45;
  const s=(typeof world!=='undefined'&&world&&world.seedS)?world.seedS:[0,0,0];
  return seed+'|'+cont.toFixed(5)+'|'+Number(s[0]||0).toFixed(5)+'|'+Number(s[1]||0).toFixed(5)+'|'+Number(s[2]||0).toFixed(5);
}
function h2oSeaLevelProxy(){
  const sea=(typeof state!=='undefined'&&Number.isFinite(state.sea))?h2oClamp(state.sea,0,1):0.58;
  return -0.25+(0.34+0.25)*sea;
}
function h2oRefreshSurfaceWater(core){
  if(!core||!core.count) return core;
  if(!core.macroTerrain||core.macroTerrain.length!==core.count){
    core.macroTerrain=new Float32Array(core.count);
    core.surfaceWaterFraction=new Float32Array(core.count);
    core.h2oSurfaceSignature='';
  }
  const sig=h2oSurfaceSignature();
  if(core.h2oSurfaceSignature!==sig){
    for(let i=0;i<core.count;i++)
      core.macroTerrain[i]=h2oMacroTerrainHeight(core.dirX[i],core.dirY[i],core.dirZ[i]);
    core.h2oSurfaceSignature=sig;
  }
  const sea=h2oSeaLevelProxy();
  for(let i=0;i<core.count;i++){
    const h=core.macroTerrain[i]-sea;
    core.surfaceWaterFraction[i]=1-h2oSmooth(-H2O_COAST_HALF_WIDTH,H2O_COAST_HALF_WIDTH,h);
  }
  return core;
}

function h2oGravityMS2(climate){
  if(Number.isFinite(climate?.gravityMS2)&&climate.gravityMS2>0) return h2oClamp(climate.gravityMS2,0.05,200);
  if(typeof baricGravityMS2==='function') return baricGravityMS2(climate);
  return 9.80665;
}
function h2oSaturationBar(T){
  if(typeof waterSaturationPressureBar==='function') return Math.max(0,waterSaturationPressureBar(T));
  T=h2oClamp(T,150,647);
  const ex=h2oClamp(5420*(1/273.15-1/T),-40,20);
  return 0.00611*Math.exp(ex);
}
function h2oSaturationColumnKgM2(T,climate){
  return h2oSaturationBar(T)*1e5/h2oGravityMS2(climate);
}
function h2oGlobalTargetColumnKgM2(climate){
  return Math.max(0,Number(climate?.h2oBar)||0)*1e5/h2oGravityMS2(climate);
}
function h2oAreaMean(core,field){
  let sw=0,s=0;
  if(!core||!field) return NaN;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    sw+=w;s+=w*field[i];
  }
  return s/Math.max(1e-12,sw);
}
function h2oNormalizeGlobalVapor(core,climate){
  const target=h2oGlobalTargetColumnKgM2(climate);
  const mean=h2oAreaMean(core,core.vaporColumn);
  if(!(target>1e-12)){
    core.vaporColumn.fill(0);core.h2oTargetColumn=0;return 0;
  }
  if(!(mean>1e-12)){
    core.vaporColumn.fill(target);core.h2oTargetColumn=target;return 1;
  }
  const scale=target/mean;
  for(let i=0;i<core.count;i++) core.vaporColumn[i]=Math.max(0,core.vaporColumn[i]*scale);
  core.h2oTargetColumn=target;
  return scale;
}
function h2oRefreshRelativeHumidity(core,climate){
  for(let i=0;i<core.count;i++){
    const sat=Math.max(1e-8,h2oSaturationColumnKgM2(core.airTemp[i],climate));
    const rh=h2oClamp(core.vaporColumn[i]/sat,0,4);
    core.relativeHumidity[i]=rh;
    /* Keep the legacy 0..1 humidity channel useful for diagnostics until the
       condensation milestone consumes relativeHumidity directly. */
    core.humidity[i]=h2oClamp(rh,0,1);
  }
}
function h2oInitializeVapor(core,climate){
  const target=h2oGlobalTargetColumnKgM2(climate);
  for(let i=0;i<core.count;i++){
    const oldRH=h2oClamp(core.humidity?.[i]??0.5,0,1);
    const wet=core.surfaceWaterFraction?.[i]||0;
    /* Preserve deterministic large-scale humidity structure from the Weather
       Core bootstrap, then let real evaporation/wind replace it. */
    const shape=0.42+0.70*oldRH+0.38*wet;
    core.vaporColumn[i]=Math.max(0,target*shape);
  }
  h2oNormalizeGlobalVapor(core,climate);
  h2oRefreshRelativeHumidity(core,climate);
}

/* Build unique finite-volume edges from the 0.5.42 pressure/wind neighbour
   stencil. Direction components are stored in each endpoint's own tangent
   basis; transport then needs no trigonometry or neighbour search per tick. */
function h2oBuildTransportEdges(core,axis,radiusM){
  if(!core?.windNeighbor) return core;
  const ii=[],jj=[],dd=[],ie=[],inn=[],je=[],jnn=[];
  const seen=new Set(),bi={},bj={};
  for(let i=0;i<core.count;i++) for(let k=0;k<4;k++){
    const j=core.windNeighbor[k][i]|0;
    if(j<0||j>=core.count||j===i) continue;
    const a=i<j?i:j,b=i<j?j:i,key=a*core.count+b;
    if(seen.has(key)) continue;seen.add(key);
    const ax=core.dirX[a],ay=core.dirY[a],az=core.dirZ[a];
    const bx=core.dirX[b],by=core.dirY[b],bz=core.dirZ[b];
    const dot=h2oClamp(ax*bx+ay*by+az*bz,-1,1);
    let tx=bx-ax*dot,ty=by-ay*dot,tz=bz-az*dot;
    let q=Math.hypot(tx,ty,tz)||1;tx/=q;ty/=q;tz/=q;
    windTangentBasis(ax,ay,az,axis,bi);
    const aE=tx*bi.ex+ty*bi.ey+tz*bi.ez,aN=tx*bi.nx+ty*bi.ny+tz*bi.nz;
    let ux=ax-bx*dot,uy=ay-by*dot,uz=az-bz*dot;
    q=Math.hypot(ux,uy,uz)||1;ux/=q;uy/=q;uz/=q;
    windTangentBasis(bx,by,bz,axis,bj);
    const bE=ux*bj.ex+uy*bj.ey+uz*bj.ez,bN=ux*bj.nx+uy*bj.ny+uz*bj.nz;
    ii.push(a);jj.push(b);dd.push(Math.max(1,radiusM*Math.acos(dot)));
    ie.push(aE);inn.push(aN);je.push(bE);jnn.push(bN);
  }
  core.h2oEdgeI=Int32Array.from(ii);core.h2oEdgeJ=Int32Array.from(jj);
  core.h2oEdgeDistance=Float32Array.from(dd);
  core.h2oEdgeIE=Float32Array.from(ie);core.h2oEdgeIN=Float32Array.from(inn);
  core.h2oEdgeJE=Float32Array.from(je);core.h2oEdgeJN=Float32Array.from(jnn);
  core.h2oEdgeFlux=new Float64Array(ii.length);
  core.h2oMassDelta=new Float64Array(core.count);
  core.h2oOutMass=new Float64Array(core.count);
  core.h2oTransportRadiusM=radiusM;
  return core;
}
function h2oAdvectConservative(core,dtSec){
  if(!core?.h2oEdgeI?.length) return 0;
  const dt=Math.max(0,Number(dtSec)||0),delta=core.h2oMassDelta,out=core.h2oOutMass,flux=core.h2oEdgeFlux;
  delta.fill(0);out.fill(0);flux.fill(0);
  const wu=core.windStateU||core.windU,wv=core.windStateV||core.windV;
  for(let e=0;e<core.h2oEdgeI.length;e++){
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e];
    const vi=wu[i]*core.h2oEdgeIE[e]+wv[i]*core.h2oEdgeIN[e];
    const vj=wu[j]*core.h2oEdgeJE[e]+wv[j]*core.h2oEdgeJN[e];
    /* vj is positive j->i, hence the minus sign for the i->j edge frame. */
    const edgeV=0.5*(vi-vj);
    const frac=Math.min(H2O_ADVECT_EDGE_CFL,Math.abs(edgeV)*dt/Math.max(1,core.h2oEdgeDistance[e]));
    if(!(frac>0)) continue;
    const donor=edgeV>=0?i:j;
    const mass=Math.max(0,core.vaporColumn[donor])*Math.max(1e-12,core.areaWeight?.[donor]||1);
    const signed=(edgeV>=0?1:-1)*mass*frac;
    flux[e]=signed;out[donor]+=Math.abs(signed);
  }
  for(let e=0;e<core.h2oEdgeI.length;e++){
    let dm=flux[e];if(dm===0)continue;
    const i=core.h2oEdgeI[e],j=core.h2oEdgeJ[e],donor=dm>0?i:j;
    const mass=Math.max(0,core.vaporColumn[donor])*Math.max(1e-12,core.areaWeight?.[donor]||1);
    const scale=out[donor]>H2O_ADVECT_MAX_OUTFLOW*mass
      ? H2O_ADVECT_MAX_OUTFLOW*mass/Math.max(1e-30,out[donor]) : 1;
    dm*=scale;delta[i]-=dm;delta[j]+=dm;
  }
  let moved=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    moved+=Math.abs(delta[i]);
    core.vaporColumn[i]=Math.max(0,(core.vaporColumn[i]*w+delta[i])/w);
  }
  return moved*0.5;
}

function h2oApplyEvaporation(core,dtSec,climate){
  const dt=Math.max(0,Number(dtSec)||0);
  let source=0;
  for(let i=0;i<core.count;i++){
    const water=h2oClamp(core.surfaceWaterFraction[i],0,1),T=core.surfaceTemp[i];
    const liquid=h2oSmooth(258,278,T)*(1-h2oSmooth(635,650,T));
    const sat=h2oSaturationColumnKgM2(T,climate);
    const target=H2O_EVAP_RH_TARGET*sat;
    const deficit=Math.max(0,target-core.vaporColumn[i]);
    const speed=Math.hypot(core.windStateU?.[i]??core.windU[i],core.windStateV?.[i]??core.windV[i]);
    const windBoost=0.55+0.75*h2oClamp(speed/12,0,1.5);
    const rate=Math.min(H2O_EVAP_MAX_KG_M2_S,
      water*liquid*deficit/Math.max(1,H2O_EVAP_TAU_SEC)*windBoost);
    core.evaporationRate[i]=rate;
    if(rate>0){core.vaporColumn[i]+=rate*dt;source+=rate*Math.max(1e-12,core.areaWeight?.[i]||1);}
  }
  return source;
}

const weatherCoreCreateBeforeH2O=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeH2O(seed,N,climate,axis);
  core.h2oModel=H2O_TRANSPORT_MODEL;
  core.vaporColumn=new Float32Array(core.count);
  core.relativeHumidity=new Float32Array(core.count);
  core.evaporationRate=new Float32Array(core.count);
  h2oRefreshSurfaceWater(core);
  const ax=weatherNorm3(axis[0],axis[1],axis[2]);
  h2oBuildTransportEdges(core,ax,windPlanetRadiusM(climate));
  h2oInitializeVapor(core,climate);
  core.h2oAdvectedMass=0;core.h2oEvapSource=0;
  return core;
};

const weatherCoreStepBeforeH2O=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeH2O(core,dtSec,climate,axis);
  const dt=weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC),ax=weatherNorm3(axis[0],axis[1],axis[2]);
  h2oRefreshSurfaceWater(core);
  const radius=windPlanetRadiusM(climate);
  if(!core.h2oEdgeI||Math.abs((core.h2oTransportRadiusM||0)-radius)>Math.max(1,radius*1e-5))
    h2oBuildTransportEdges(core,ax,radius);
  core.h2oAdvectedMass=h2oAdvectConservative(core,dt);
  core.h2oEvapSource=h2oApplyEvaporation(core,dt,climate);
  /* Global phase partition remains the one-box water budget in 0.5.43. This
     normalization conserves that exact atmospheric H2O reservoir while the
     new local equations decide where the vapor lives. */
  h2oNormalizeGlobalVapor(core,climate);
  h2oRefreshRelativeHumidity(core,climate);
  return core;
};

const weatherCoreFiniteBeforeH2O=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeH2O(core)) return false;
  for(const k of ['vaporColumn','relativeHumidity','evaporationRate','macroTerrain','surfaceWaterFraction']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  if(!core.h2oEdgeI||core.h2oEdgeI.length!==core.h2oEdgeJ.length||!core.h2oMassDelta)return false;
  return true;
};

function h2oDiagnostics(core,climate){
  if(!core||!core.count)return {vapor:NaN,rh:NaN,rhMax:NaN,evap:NaN,water:NaN,target:NaN};
  let sw=0,v=0,rh=0,rhMax=0,ev=0,water=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);sw+=w;
    v+=w*core.vaporColumn[i];rh+=w*core.relativeHumidity[i];ev+=w*core.evaporationRate[i];water+=w*core.surfaceWaterFraction[i];
    if(core.relativeHumidity[i]>rhMax)rhMax=core.relativeHumidity[i];
  }
  const d=Math.max(1e-12,sw);
  return {vapor:v/d,rh:rh/d,rhMax,evap:ev/d*86400,water:water/d,target:h2oGlobalTargetColumnKgM2(climate)};
}

if(typeof createPanel==='function'){
  const createPanelBeforeH2O=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeH2O(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-h2oadv="vapor"]')){
        appendWeatherCoreRow(box,'H₂O column mean','h2o-vapor');
        const a=box.lastElementChild?.querySelector('[data-weathercore="h2o-vapor"]');if(a){delete a.dataset.weathercore;a.dataset.h2oadv='vapor';}
        appendWeatherCoreRow(box,'Отн. влажность mean / max','h2o-rh');
        const b=box.lastElementChild?.querySelector('[data-weathercore="h2o-rh"]');if(b){delete b.dataset.weathercore;b.dataset.h2oadv='rh';}
        appendWeatherCoreRow(box,'Испарение source','h2o-evap');
        const c=box.lastElementChild?.querySelector('[data-weathercore="h2o-evap"]');if(c){delete c.dataset.weathercore;c.dataset.h2oadv='evap';}
        appendWeatherCoreRow(box,'Водная поверхность (macro)','h2o-water');
        const d=box.lastElementChild?.querySelector('[data-weathercore="h2o-water"]');if(d){delete d.dataset.weathercore;d.dataset.h2oadv='water';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeH2O=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeH2O();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core||!core.vaporColumn)return;
    const c=weatherCoreClimateSnapshot(),d=h2oDiagnostics(core,c);
    const set=(k,v)=>{const e=box.querySelector('[data-h2oadv="'+k+'"]');if(e)e.textContent=v;};
    set('vapor',d.vapor.toFixed(1)+' кг/м² · цель '+d.target.toFixed(1));
    set('rh',(100*d.rh).toFixed(0)+'% / '+(100*d.rhMax).toFixed(0)+'%');
    set('evap',d.evap.toFixed(2)+' мм/сут');
    set('water',(100*d.water).toFixed(1)+'%');
  };
}
