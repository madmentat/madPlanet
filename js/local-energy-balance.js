/* ============ 0.5.40: local radiative energy balance ============ */
/*
   Weather Core v2: each cubed-sphere cell now owns an explicit top-of-
   atmosphere/surface energy budget instead of relaxing surface temperature
   toward one latitude-shaped global target.

   This milestone deliberately uses daily-mean equinox insolation. The
   user-facing light-rotation control is a view/lighting tool and MUST NOT
   rewrite climate. Diurnal illumination and seasons are later milestones.

   Horizontal heat transport is also intentionally absent here: pressure
   gradients and wind come next. Large heat capacities keep that omission from
   producing instant polar collapse while the future circulation model is not
   yet present.
*/

const LOCAL_ENERGY_MODEL = 1;
const LOCAL_ENERGY_SOLAR_CONSTANT = 1361.0;
const LOCAL_ENERGY_SIGMA = 5.670374419e-8;
const LOCAL_ENERGY_LAND_HEAT_CAPACITY = 1.6e7;   /* J m^-2 K^-1 effective */
const LOCAL_ENERGY_OCEAN_HEAT_CAPACITY = 8.0e7;  /* shallow mixed-layer proxy */

function localEnergyClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function localEnergySmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=localEnergyClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function localEnergySeaFraction(c){
  if(Number.isFinite(c?.sea)) return localEnergyClamp(c.sea,0,1);
  if(typeof state!=='undefined' && Number.isFinite(state.sea)) return localEnergyClamp(state.sea,0,1);
  return 0.58;
}
function localEnergyHeatCapacity(c){
  const sea=localEnergySeaFraction(c);
  return LOCAL_ENERGY_LAND_HEAT_CAPACITY*(1-sea)+LOCAL_ENERGY_OCEAN_HEAT_CAPACITY*sea;
}
function localEnergyDailyMeanCosine(dx,dy,dz,axis){
  /* Equinox daily mean: cos(latitude)/pi. Area-weighted global mean is 1/4. */
  const sinLat=localEnergyClamp(dx*axis[0]+dy*axis[1]+dz*axis[2],-1,1);
  return Math.sqrt(Math.max(0,1-sinLat*sinLat))/Math.PI;
}
function localEnergyAreaWeight(dx,dy,dz){
  /* Cubed-sphere gnomonic Jacobian is proportional to the cube of the face
     normal component. This lets diagnostics use area weighting even though
     the storage grid itself is not equal-area. */
  const m=Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz));
  return Math.max(1e-9,m*m*m);
}
function localEnergyIceFraction(T,c){
  const water=localEnergyClamp(c?.waterAvail??1,0,1);
  return water*(1-localEnergySmooth(258,278,Number(T)||273.15));
}
function localEnergyIceAlbedo(c){
  if(Number.isFinite(c?.iceAlbedo)) return localEnergyClamp(c.iceAlbedo,0.2,0.9);
  if(typeof climateIceAlbedoForStar==='function'){
    const st=(typeof starPhysics==='function' && typeof state!=='undefined')
      ? starPhysics(state.star,state.luminosity) : {T:5772};
    return localEnergyClamp(climateIceAlbedoForStar(st.T),0.2,0.9);
  }
  return 0.62;
}
function localEnergyNonIceAlbedo(c){
  const A=localEnergyClamp(Number.isFinite(c?.A)?c.A:0.30,0.03,0.86);
  const ice=localEnergyClamp(c?.iceArea||0,0,0.98);
  const iceA=localEnergyIceAlbedo(c);
  return localEnergyClamp((A-ice*iceA)/Math.max(0.02,1-ice),0.04,0.72);
}
function localEnergyCellAlbedo(T,cloudWater,c){
  const ice=localEnergyIceFraction(T,c);
  const base=localEnergyNonIceAlbedo(c);
  const iceA=localEnergyIceAlbedo(c);
  /* Local cloud-water is only a modest perturbation around the global cloud
     albedo already folded into c.A; it must not double-count the whole cloud
     greenhouse/albedo effect. */
  const cloudRef=localEnergyClamp((c?.cloudCov||0)*0.55,0,1);
  const cloudDelta=0.08*(localEnergyClamp(cloudWater,0,1)-cloudRef);
  return localEnergyClamp(base*(1-ice)+iceA*ice+cloudDelta,0.03,0.90);
}
function localEnergyOlrScale(c){
  const T=localEnergyClamp(c?.T||288.15,120,1200);
  const tau=Math.max(0,Number(c?.tau)||0);
  const raw=LOCAL_ENERGY_SIGMA*Math.pow(T,4)/Math.max(1e-6,1+0.75*tau);
  const target=Number(c?.globalOLR);
  if(Number.isFinite(target)&&target>1&&raw>1) return localEnergyClamp(target/raw,0.35,2.5);
  return 1;
}
function localEnergyFluxes(T,cloudWater,dx,dy,dz,axis,c,out){
  const mu=localEnergyDailyMeanCosine(dx,dy,dz,axis);
  const incoming=LOCAL_ENERGY_SOLAR_CONSTANT*Math.max(0,Number(c?.S)||0)*mu;
  const albedo=localEnergyCellAlbedo(T,cloudWater,c);
  const absorbed=incoming*(1-albedo);
  const tau=Math.max(0,Number(c?.tau)||0);
  const rawOlr=LOCAL_ENERGY_SIGMA*Math.pow(localEnergyClamp(T,80,1600),4)
    /Math.max(1e-6,1+0.75*tau);
  const olr=rawOlr*localEnergyOlrScale(c);
  out.insolation=incoming;
  out.albedo=albedo;
  out.absorbed=absorbed;
  out.olr=olr;
  out.net=absorbed-olr;
  return out;
}

/* Extend the 0.5.39 climate snapshot with the radiative quantities needed by
   the per-cell budget. Global climate remains the slow attractor; local cells
   resolve its spatial energy distribution. */
const weatherCoreClimateSnapshotBeforeLocalEnergy=weatherCoreClimateSnapshot;
weatherCoreClimateSnapshot=function(){
  const s=weatherCoreClimateSnapshotBeforeLocalEnergy();
  const c=climateModel();
  s.A=localEnergyClamp(c.A,0.03,0.86);
  s.tau=Math.max(0,c.tau||0);
  s.globalASR=Math.max(0,c.ASR||0);
  s.globalOLR=Math.max(0,c.OLR||0);
  s.sea=(typeof state!=='undefined')?localEnergyClamp(state.sea,0,1):0.58;
  s.iceAlbedo=(typeof climateIceAlbedoForStar==='function' && typeof starPhysics==='function' && typeof state!=='undefined')
    ? climateIceAlbedoForStar(starPhysics(state.star,state.luminosity).T) : 0.62;
  return s;
};

const weatherCoreCreateBeforeLocalEnergy=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeLocalEnergy(seed,N,climate,axis);
  core.energyModel=LOCAL_ENERGY_MODEL;
  core.areaWeight=new Float32Array(core.count);
  core.insolation=new Float32Array(core.count);
  core.localAlbedo=new Float32Array(core.count);
  core.absorbedSolar=new Float32Array(core.count);
  core.outgoingLongwave=new Float32Array(core.count);
  core.netRadiation=new Float32Array(core.count);
  const ax=weatherNorm3(axis[0],axis[1],axis[2]);
  const f={insolation:0,albedo:0,absorbed:0,olr:0,net:0};
  for(let i=0;i<core.count;i++){
    const dx=core.dirX[i],dy=core.dirY[i],dz=core.dirZ[i];
    core.areaWeight[i]=localEnergyAreaWeight(dx,dy,dz);
    localEnergyFluxes(core.surfaceTemp[i],core.cloudWater[i],dx,dy,dz,ax,climate,f);
    core.insolation[i]=f.insolation;
    core.localAlbedo[i]=f.albedo;
    core.absorbedSolar[i]=f.absorbed;
    core.outgoingLongwave[i]=f.olr;
    core.netRadiation[i]=f.net;
  }
  return core;
};

/* Replace the v1 thermal relaxation. Non-thermal fields still relax toward
   their current scaffold targets until their own physical equations arrive. */
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  const dt=weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC);
  const ax=weatherNorm3(axis[0],axis[1],axis[2]);
  const heatCap=localEnergyHeatCapacity(climate);
  const aAir=1-Math.exp(-dt/(5*3600));
  const aPressure=1-Math.exp(-dt/(4*3600));
  const aHumidity=1-Math.exp(-dt/(1.5*3600));
  const aCloud=1-Math.exp(-dt/(45*60));
  const aWind=1-Math.exp(-dt/(2*3600));
  const q={surfaceTemp:0,airTemp:0,pressurePa:0,humidity:0,cloudWater:0};
  const f={insolation:0,albedo:0,absorbed:0,olr:0,net:0};

  for(let i=0;i<core.count;i++){
    const dx=core.dirX[i],dy=core.dirY[i],dz=core.dirZ[i];
    weatherCoreTargetsForCell(climate,dx,dy,dz,ax,core.seed,i,q);

    localEnergyFluxes(core.surfaceTemp[i],core.cloudWater[i],dx,dy,dz,ax,climate,f);
    core.surfaceTemp[i]=weatherClamp(core.surfaceTemp[i]+f.net*dt/heatCap,80,1600);
    /* Air follows the locally heated surface with a finite coupling time. The
       detailed vertical lapse/stability model comes later. */
    const airTarget=weatherClamp(core.surfaceTemp[i]-6.0,75,1600);
    core.airTemp[i]+= (airTarget-core.airTemp[i])*aAir;

    core.pressure[i]+=(q.pressurePa-core.pressure[i])*aPressure;
    core.humidity[i]+=(q.humidity-core.humidity[i])*aHumidity;
    core.cloudWater[i]+=(q.cloudWater-core.cloudWater[i])*aCloud;
    core.windU[i]+=(0-core.windU[i])*aWind;
    core.windV[i]+=(0-core.windV[i])*aWind;
    core.precipRate[i]=0;

    /* Store fluxes after the thermal update so diagnostics describe the new
       state rather than the previous tick. */
    localEnergyFluxes(core.surfaceTemp[i],core.cloudWater[i],dx,dy,dz,ax,climate,f);
    core.insolation[i]=f.insolation;
    core.localAlbedo[i]=f.albedo;
    core.absorbedSolar[i]=f.absorbed;
    core.outgoingLongwave[i]=f.olr;
    core.netRadiation[i]=f.net;
  }
  core.simSeconds+=dt;
  core.ticks++;
  return core;
};

const weatherCoreFiniteBeforeLocalEnergy=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeLocalEnergy(core)) return false;
  const fields=['areaWeight','insolation','localAlbedo','absorbedSolar','outgoingLongwave','netRadiation'];
  for(const k of fields){
    const a=core?.[k]; if(!a||a.length!==core.count) return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])) return false;
  }
  return true;
};

function localEnergyDiagnostics(core){
  if(!core||!core.count) return {minT:NaN,maxT:NaN,asr:NaN,olr:NaN,net:NaN};
  let wsum=0,asr=0,olr=0,net=0,minT=Infinity,maxT=-Infinity;
  for(let i=0;i<core.count;i++){
    const w=Math.max(0,core.areaWeight[i]||0);
    wsum+=w; asr+=w*core.absorbedSolar[i]; olr+=w*core.outgoingLongwave[i]; net+=w*core.netRadiation[i];
    const T=core.surfaceTemp[i]; if(T<minT)minT=T; if(T>maxT)maxT=T;
  }
  const d=Math.max(1e-12,wsum);
  return {minT,maxT,asr:asr/d,olr:olr/d,net:net/d};
}

if(typeof createPanel==='function'){
  const createPanelBeforeLocalEnergy=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeLocalEnergy(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-localenergy="range"]')){
        appendWeatherCoreRow(box,'T поверхности min / max','local-range');
        const r1=box.lastElementChild?.querySelector('[data-weathercore="local-range"]');
        if(r1){delete r1.dataset.weathercore;r1.dataset.localenergy='range';}
        appendWeatherCoreRow(box,'ASR / OLR локально','local-flux');
        const r2=box.lastElementChild?.querySelector('[data-weathercore="local-flux"]');
        if(r2){delete r2.dataset.weathercore;r2.dataset.localenergy='flux';}
        appendWeatherCoreRow(box,'Локальный энергобаланс','local-net');
        const r3=box.lastElementChild?.querySelector('[data-weathercore="local-net"]');
        if(r3){delete r3.dataset.weathercore;r3.dataset.localenergy='net';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeLocalEnergy=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeLocalEnergy();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag'); if(!box) return;
    const core=weatherCoreEnsure(); if(!core||!core.netRadiation) return;
    const d=localEnergyDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-localenergy="'+k+'"]');if(e)e.textContent=v;};
    set('range',(d.minT-273.15).toFixed(1)+' / '+(d.maxT-273.15).toFixed(1)+' °C');
    set('flux',d.asr.toFixed(0)+' / '+d.olr.toFixed(0)+' Вт/м²');
    set('net',(d.net>=0?'+':'')+d.net.toFixed(1)+' Вт/м²');
  };
}
