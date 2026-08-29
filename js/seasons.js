/* ============ 0.5.58: physical seasons / axial tilt ============ */
/*
   Seasonal forcing extends the 0.5.57 physical sun with orbital declination.
   The orbit is circular for now because eccentricity is not yet a BASE input.
   Orbital period follows Kepler's third law from the resolved stellar mass and
   orbital distance. Axial tilt comes from planetPhysics().axialTiltDeg.

   No seasonal temperature multiplier exists here: tilt changes only the real
   solar direction, so day length and solar elevation alter local insolation;
   all thermal/weather consequences then flow through the existing fixed-step
   energy, pressure, H2O, cloud and fog modules.
*/

const SEASONS_MODEL=1;
const SEASONS_EARTH_YEAR_SEC=365.2568983*86400;
const SEASONS_YEAR_MIN_SEC=6*3600;
const SEASONS_YEAR_MAX_SEC=1.0e12;

function seasonClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function seasonAxialTiltDeg(climate){
  if(Number.isFinite(climate?.axialTiltDeg))return seasonClamp(climate.axialTiltDeg,0,90);
  if(typeof planetPhysics==='function'){
    const p=planetPhysics();
    if(Number.isFinite(p?.axialTiltDeg))return seasonClamp(p.axialTiltDeg,0,90);
  }
  return 0;
}
function seasonOrbitalPeriodSec(climate){
  if(Number.isFinite(climate?.orbitalPeriodSec)&&climate.orbitalPeriodSec>0)
    return seasonClamp(climate.orbitalPeriodSec,SEASONS_YEAR_MIN_SEC,SEASONS_YEAR_MAX_SEC);
  let a=1,M=1;
  if(typeof state!=='undefined'){
    if(typeof orbitDistanceAU==='function'&&Number.isFinite(state.distance))a=Math.max(1e-4,orbitDistanceAU(state.distance));
    if(typeof starPhysics==='function'){
      const st=starPhysics(state.star,state.luminosity);
      if(Number.isFinite(st?.M)&&st.M>0)M=st.M;
    }
  }
  return seasonClamp(SEASONS_EARTH_YEAR_SEC*Math.sqrt(Math.pow(a,3)/Math.max(1e-6,M)),SEASONS_YEAR_MIN_SEC,SEASONS_YEAR_MAX_SEC);
}
function seasonSeedPhase(seed){
  if(typeof weatherHash01==='function')return 2*Math.PI*weatherHash01((seed|0)^0x31c6d1f,29);
  let x=((seed|0)^0x31c6d1f)>>>0;x=(Math.imul(x^x>>>16,0x7feb352d))>>>0;x=(Math.imul(x^x>>>15,0x846ca68b))>>>0;x=(x^x>>>16)>>>0;
  return 2*Math.PI*(x/4294967296);
}
function seasonOrbitPhaseRad(seed,simSeconds,climate){
  const P=seasonOrbitalPeriodSec(climate);
  let q=seasonSeedPhase(seed)+2*Math.PI*(Number(simSeconds)||0)/P;
  q%=2*Math.PI;if(q<0)q+=2*Math.PI;return q;
}
function seasonDeclinationRadForPhase(phaseRad,tiltDeg){
  const eps=seasonClamp(tiltDeg,0,90)*Math.PI/180;
  return Math.asin(seasonClamp(Math.sin(eps)*Math.sin(Number(phaseRad)||0),-1,1));
}
function seasonSolarDeclinationRad(seed,simSeconds,climate){
  return seasonDeclinationRadForPhase(seasonOrbitPhaseRad(seed,simSeconds,climate),seasonAxialTiltDeg(climate));
}
function seasonDayLengthHours(latitudeRad,declinationRad){
  const lat=seasonClamp(latitudeRad,-Math.PI/2,Math.PI/2);
  const dec=seasonClamp(declinationRad,-Math.PI/2,Math.PI/2);
  const x=-Math.tan(lat)*Math.tan(dec);
  if(x<=-1)return 24;
  if(x>=1)return 0;
  return 24*Math.acos(x)/Math.PI;
}

/* Replace only the solar-direction geometry from 0.5.57. Spin phase still
   supplies local time, while orbital phase supplies declination. Thus the
   user's rotationPeriod remains the physical solar-day control and year
   length independently follows the orbit. */
const diurnalSunDirectionBeforeSeasons=diurnalSunDirection;
diurnalSunDirection=function(axis,seed,simSeconds,climate,out){
  const b={};diurnalBasis(axis,b);
  const day=diurnalRotationPeriodSec(climate);
  const hourPhase=diurnalSeedPhase(seed)-2*Math.PI*(Number(simSeconds)||0)/day;
  const dec=seasonSolarDeclinationRad(seed,simSeconds,climate);
  const cd=Math.cos(dec),sd=Math.sin(dec),c=Math.cos(hourPhase),s=Math.sin(hourPhase);
  out=out||[0,0,0];
  out[0]=cd*(b.e1[0]*c+b.e2[0]*s)+sd*b.axis[0];
  out[1]=cd*(b.e1[1]*c+b.e2[1]*s)+sd*b.axis[1];
  out[2]=cd*(b.e1[2]*c+b.e2[2]*s)+sd*b.axis[2];
  return out;
};

const weatherCoreClimateSnapshotBeforeSeasons=weatherCoreClimateSnapshot;
weatherCoreClimateSnapshot=function(){
  const s=weatherCoreClimateSnapshotBeforeSeasons();
  s.axialTiltDeg=seasonAxialTiltDeg(s);
  s.orbitalPeriodSec=seasonOrbitalPeriodSec(s);
  s.seasonsModel=SEASONS_MODEL;
  return s;
};

function seasonEnsureFields(core){
  if(!core?.count)return core;
  if(!core.dayLengthHours||core.dayLengthHours.length!==core.count)core.dayLengthHours=new Float32Array(core.count);
  core.seasonsModel=SEASONS_MODEL;
  return core;
}
function seasonRefreshFields(core,climate,axis){
  if(!core?.count)return core;
  seasonEnsureFields(core);
  const ax=[0,0,0];diurnalNorm3(axis[0],axis[1],axis[2],ax);
  const phase=seasonOrbitPhaseRad(core.seed|0,core.simSeconds,climate);
  const dec=seasonDeclinationRadForPhase(phase,seasonAxialTiltDeg(climate));
  core.orbitalPeriodSec=seasonOrbitalPeriodSec(climate);
  core.seasonOrbitPhase=phase/(2*Math.PI);
  core.solarDeclinationDeg=dec*180/Math.PI;
  core.axialTiltDeg=seasonAxialTiltDeg(climate);
  for(let i=0;i<core.count;i++){
    const sinLat=seasonClamp(core.dirX[i]*ax[0]+core.dirY[i]*ax[1]+core.dirZ[i]*ax[2],-1,1);
    const lat=Math.asin(sinLat);
    core.dayLengthHours[i]=seasonDayLengthHours(lat,dec);
  }
  return core;
}

const weatherCoreCreateBeforeSeasons=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeSeasons(seed,N,climate,axis);
  seasonEnsureFields(core);seasonRefreshFields(core,climate,axis);return core;
};
const weatherCoreStepBeforeSeasons=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeSeasons(core,dtSec,climate,axis);
  seasonRefreshFields(core,climate,axis);return core;
};
const weatherCoreFiniteBeforeSeasons=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeSeasons(core))return false;
  if(!core?.dayLengthHours||core.dayLengthHours.length!==core.count)return false;
  for(let i=0;i<core.dayLengthHours.length;i++)if(!Number.isFinite(core.dayLengthHours[i]))return false;
  return Number.isFinite(core.seasonOrbitPhase)&&Number.isFinite(core.solarDeclinationDeg)&&
    Number.isFinite(core.axialTiltDeg)&&Number.isFinite(core.orbitalPeriodSec);
};
function seasonLabel(phase){
  phase=((Number(phase)||0)%1+1)%1;
  if(phase<0.125||phase>=0.875)return 'равноденствие → северная весна';
  if(phase<0.375)return 'северное лето';
  if(phase<0.625)return 'равноденствие → северная осень';
  return 'северная зима';
}
function seasonDiagnostics(core){
  if(!core)return {yearDays:NaN,declination:NaN,tilt:NaN,phase:NaN};
  return {yearDays:(core.orbitalPeriodSec||SEASONS_EARTH_YEAR_SEC)/86400,
    declination:core.solarDeclinationDeg,tilt:core.axialTiltDeg,phase:core.seasonOrbitPhase};
}
if(typeof createPanel==='function'){
  const createPanelBeforeSeasons=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeSeasons(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-seasons="orbit"]')){
        appendWeatherCoreRow(box,'Год / наклон оси','seasons-orbit');
        const a=box.lastElementChild?.querySelector('[data-weathercore="seasons-orbit"]');if(a){delete a.dataset.weathercore;a.dataset.seasons='orbit';}
        appendWeatherCoreRow(box,'Склонение / сезон','seasons-state');
        const b=box.lastElementChild?.querySelector('[data-weathercore="seasons-state"]');if(b){delete b.dataset.weathercore;b.dataset.seasons='state';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeSeasons=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeSeasons();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.seasonsModel)return;
    const d=seasonDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-seasons="'+k+'"]');if(e)e.textContent=v;};
    set('orbit',d.yearDays.toFixed(d.yearDays<100?1:0)+' сут · '+d.tilt.toFixed(1)+'°');
    set('state',(d.declination>=0?'+':'')+d.declination.toFixed(1)+'° · '+seasonLabel(d.phase));
  };
}
