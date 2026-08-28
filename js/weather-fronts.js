/* ============ 0.5.49: physically diagnosed weather fronts ============ */
/*
   Weather Core v11 diagnoses fronts from resolved air-mass contrasts rather
   than drawing procedural bands. Temperature, humidity and pressure gradients
   use the existing cross-face tangent stencil from wind dynamics. Resolved
   wind supplies convergence and thermal advection.

   A front requires both a meaningful horizontal temperature contrast and a
   dynamical reason for the air masses to meet (convergence and/or cross-front
   advection). Type is diagnosed from -V dot grad(T): warm advection -> warm
   front, cold advection -> cold front, near-zero advection -> stationary.

   This module never edits airTemp, vaporColumn, cloudWaterState or pressure.
   Its only physical forcing output is a bounded frontVerticalVelocity used by
   the following vertical-stability layer. Condensation, precipitation and
   latent heat remain owned by their existing modules.
*/

const WEATHER_FRONTS_MODEL = 1;
const FRONT_TEMP_WEAK_K_100KM = 0.15;
const FRONT_TEMP_STRONG_K_100KM = 1.80;
const FRONT_RH_WEAK_100KM = 0.005;
const FRONT_RH_STRONG_100KM = 0.080;
const FRONT_PRESSURE_WEAK_HPA_100KM = 0.05;
const FRONT_PRESSURE_STRONG_HPA_100KM = 0.80;
const FRONT_CONVERGENCE_WEAK_1E5 = 0.05;
const FRONT_CONVERGENCE_STRONG_1E5 = 1.50;
const FRONT_ADVECTION_WEAK_K_H = 0.025;
const FRONT_ADVECTION_STRONG_K_H = 0.40;
const FRONT_TYPE_ADVECTION_K_H = 0.035;
const FRONT_MIN_STRENGTH = 0.08;
const FRONT_MAX_LIFT_MS = 2.0;

function frontClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function frontSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=frontClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}

function frontEnsureFields(core){
  if(!core||!core.count) return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n) core[k]=new Float32Array(n);};
  for(const k of [
    'frontTempGradientK100km','frontHumidityGradient100km','frontPressureGradientHpa100km',
    'frontConvergence1e5','frontThermalAdvectionKHour','frontStrength',
    'frontNormalE','frontNormalN','frontTangentE','frontTangentN','frontVerticalVelocity'
  ]) f32(k);
  if(!core.frontType||core.frontType.length!==n) core.frontType=new Int8Array(n);
  core.frontsModel=WEATHER_FRONTS_MODEL;
  return core;
}

/* Wind components are stored in each cell's own east/north tangent basis.
   Across cubed-sphere seams those bases rotate, so neighbour U/V values may
   not be subtracted directly. Store six world-space basis components once;
   convergence then projects neighbour velocity into the current cell basis. */
function frontBuildWindBasis(core,axis){
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n) core[k]=new Float32Array(n);};
  for(const k of ['frontEastX','frontEastY','frontEastZ','frontNorthX','frontNorthY','frontNorthZ']) f32(k);
  const ax=axis?weatherNorm3(axis[0],axis[1],axis[2]):weatherCoreAxis();
  const b={};
  for(let i=0;i<n;i++){
    windTangentBasis(core.dirX[i],core.dirY[i],core.dirZ[i],ax,b);
    core.frontEastX[i]=b.ex;core.frontEastY[i]=b.ey;core.frontEastZ[i]=b.ez;
    core.frontNorthX[i]=b.nx;core.frontNorthY[i]=b.ny;core.frontNorthZ[i]=b.nz;
  }
  return core;
}

function frontScalarGradient(core,field,i,out){
  const a=field[i];let ge=0,gn=0;
  for(let k=0;k<4;k++){
    const j=core.windNeighbor[k][i],d=field[j]-a;
    ge+=core.windGradE[k][i]*d;
    gn+=core.windGradN[k][i]*d;
  }
  out.e=ge;out.n=gn;return out;
}

/* Local horizontal divergence. Neighbour wind is first reconstructed in world
   coordinates and then projected into the basis of cell i; this prevents cube
   face seams from masquerading as convergent frontal boundaries. */
function frontWindDivergence(core,i){
  const u=core.windStateU||core.windU,v=core.windStateV||core.windV;
  const u0=u[i],v0=v[i];let div=0;
  const eix=core.frontEastX[i],eiy=core.frontEastY[i],eiz=core.frontEastZ[i];
  const nix=core.frontNorthX[i],niy=core.frontNorthY[i],niz=core.frontNorthZ[i];
  for(let k=0;k<4;k++){
    const j=core.windNeighbor[k][i];
    const wx=u[j]*core.frontEastX[j]+v[j]*core.frontNorthX[j];
    const wy=u[j]*core.frontEastY[j]+v[j]*core.frontNorthY[j];
    const wz=u[j]*core.frontEastZ[j]+v[j]*core.frontNorthZ[j];
    const uj=wx*eix+wy*eiy+wz*eiz;
    const vj=wx*nix+wy*niy+wz*niz;
    div+=core.windGradE[k][i]*(uj-u0)+core.windGradN[k][i]*(vj-v0);
  }
  return div;
}

function frontScaleHeightM(core,i,climate){
  const h=Number(core.scaleHeight?.[i]);
  if(Number.isFinite(h)&&h>0) return frontClamp(h,500,120000);
  if(typeof verticalScaleHeightM==='function') return verticalScaleHeightM(core,i,climate);
  return 8400;
}

function frontRefresh(core,climate,axis){
  if(!core||!core.count||!core.windNeighbor) return core;
  frontEnsureFields(core);
  if(!core.frontEastX||core.frontEastX.length!==core.count) frontBuildWindBasis(core,axis);
  const gT={e:0,n:0},gRH={e:0,n:0},gP={e:0,n:0};
  const u=core.windStateU||core.windU,v=core.windStateV||core.windV;
  const rhField=core.relativeHumidity||core.humidity;

  for(let i=0;i<core.count;i++){
    frontScalarGradient(core,core.airTemp,i,gT);
    frontScalarGradient(core,rhField,i,gRH);
    frontScalarGradient(core,core.pressure,i,gP);

    const magT=Math.hypot(gT.e,gT.n);
    const magRH=Math.hypot(gRH.e,gRH.n);
    const magP=Math.hypot(gP.e,gP.n);
    const temp100=magT*1e5;
    const rh100=magRH*1e5;
    const p100=magP*1000; /* Pa/m -> hPa / 100 km */
    const div=frontWindDivergence(core,i);
    const conv=Math.max(0,-div),conv1e5=conv*1e5;

    let ne=0,nn=0;
    if(magT>1e-12){ne=gT.e/magT;nn=gT.n/magT;}
    const te=-nn,tn=ne;
    const adv=-(u[i]*gT.e+v[i]*gT.n)*3600; /* K/hour Eulerian thermal advection */
    const normalWind=u[i]*ne+v[i]*nn;

    const thermal=frontSmooth(FRONT_TEMP_WEAK_K_100KM,FRONT_TEMP_STRONG_K_100KM,temp100);
    const moisture=frontSmooth(FRONT_RH_WEAK_100KM,FRONT_RH_STRONG_100KM,rh100);
    const pressure=frontSmooth(FRONT_PRESSURE_WEAK_HPA_100KM,FRONT_PRESSURE_STRONG_HPA_100KM,p100);
    const convergence=frontSmooth(FRONT_CONVERGENCE_WEAK_1E5,FRONT_CONVERGENCE_STRONG_1E5,conv1e5);
    const advection=frontSmooth(FRONT_ADVECTION_WEAK_K_H,FRONT_ADVECTION_STRONG_K_H,Math.abs(adv));
    const dynamics=Math.max(convergence,0.72*advection);
    const strength=frontClamp(thermal*dynamics*(0.55+0.25*moisture+0.20*pressure),0,1);

    let type=0;
    if(strength>=FRONT_MIN_STRENGTH){
      if(adv>FRONT_TYPE_ADVECTION_K_H) type=2;       /* warm front */
      else if(adv<-FRONT_TYPE_ADVECTION_K_H) type=1; /* cold front */
      else type=3;                                   /* stationary */
    }

    const H=frontScaleHeightM(core,i,climate);
    /* Continuity gives w ~ H * convergence. Cross-front collision supplies a
       second bounded contribution. Strength gates both so the broad planetary
       temperature gradient alone cannot generate a fake continuous updraft. */
    const continuityLift=4.0*H*conv;
    const collisionLift=0.020*Math.abs(normalWind);
    const lift=frontClamp(strength*(0.03+continuityLift+collisionLift),0,FRONT_MAX_LIFT_MS);

    core.frontTempGradientK100km[i]=temp100;
    core.frontHumidityGradient100km[i]=rh100;
    core.frontPressureGradientHpa100km[i]=p100;
    core.frontConvergence1e5[i]=conv1e5;
    core.frontThermalAdvectionKHour[i]=adv;
    core.frontStrength[i]=strength;
    core.frontNormalE[i]=ne;core.frontNormalN[i]=nn;
    core.frontTangentE[i]=te;core.frontTangentN[i]=tn;
    core.frontVerticalVelocity[i]=lift;
    core.frontType[i]=type;
  }
  return core;
}

const weatherCoreCreateBeforeFronts=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeFronts(seed,N,climate,axis);
  frontEnsureFields(core);frontBuildWindBasis(core,axis);
  frontRefresh(core,climate,axis);
  return core;
};

const weatherCoreStepBeforeFronts=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeFronts(core,dtSec,climate,axis);
  frontRefresh(core,climate,axis);
  return core;
};

const weatherCoreFiniteBeforeFronts=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeFronts(core)) return false;
  const fields=['frontTempGradientK100km','frontHumidityGradient100km','frontPressureGradientHpa100km',
    'frontConvergence1e5','frontThermalAdvectionKHour','frontStrength','frontNormalE','frontNormalN',
    'frontTangentE','frontTangentN','frontVerticalVelocity'];
  for(const k of fields){
    const a=core?.[k];if(!a||a.length!==core.count) return false;
    for(let i=0;i<a.length;i++){
      if(!Number.isFinite(a[i])) return false;
      if((k==='frontStrength'||k==='frontConvergence1e5'||k==='frontVerticalVelocity'||k.includes('Gradient'))&&a[i]<0) return false;
    }
  }
  if(!core.frontType||core.frontType.length!==core.count) return false;
  for(let i=0;i<core.count;i++){
    if(core.frontStrength[i]>1.000001||core.frontVerticalVelocity[i]>FRONT_MAX_LIFT_MS+1e-6) return false;
    if(core.frontType[i]<0||core.frontType[i]>3) return false;
  }
  return true;
};

function frontDiagnostics(core){
  if(!core?.frontStrength) return {coverage:NaN,cold:NaN,warm:NaN,stationary:NaN,mean:NaN,max:NaN,lift:NaN,tempGrad:NaN};
  let sw=0,cov=0,cold=0,warm=0,stationary=0,sum=0,max=0,lift=0,tempGrad=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1),s=core.frontStrength[i];sw+=w;sum+=w*s;tempGrad+=w*core.frontTempGradientK100km[i];
    if(s>max)max=s;if(core.frontVerticalVelocity[i]>lift)lift=core.frontVerticalVelocity[i];
    if(core.frontType[i]!==0){cov+=w;if(core.frontType[i]===1)cold+=w;else if(core.frontType[i]===2)warm+=w;else stationary+=w;}
  }
  const d=Math.max(1e-12,sw);
  return {coverage:cov/d,cold:cold/d,warm:warm/d,stationary:stationary/d,mean:sum/d,max,lift,tempGrad:tempGrad/d};
}

if(typeof createPanel==='function'){
  const createPanelBeforeFronts=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeFronts(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-front="coverage"]')){
        appendWeatherCoreRow(box,'Фронты cold / warm / stat','front-coverage');
        const a=box.lastElementChild?.querySelector('[data-weathercore="front-coverage"]');if(a){delete a.dataset.weathercore;a.dataset.front='coverage';}
        appendWeatherCoreRow(box,'Front strength mean / max','front-strength');
        const b=box.lastElementChild?.querySelector('[data-weathercore="front-strength"]');if(b){delete b.dataset.weathercore;b.dataset.front='strength';}
        appendWeatherCoreRow(box,'Front lift max','front-lift');
        const c=box.lastElementChild?.querySelector('[data-weathercore="front-lift"]');if(c){delete c.dataset.weathercore;c.dataset.front='lift';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeFronts=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeFronts();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag');if(!box) return;
    const core=weatherCoreEnsure();if(!core?.frontStrength) return;
    const d=frontDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-front="'+k+'"]');if(e)e.textContent=v;};
    set('coverage',(100*d.cold).toFixed(1)+' / '+(100*d.warm).toFixed(1)+' / '+(100*d.stationary).toFixed(1)+'%');
    set('strength',d.mean.toFixed(3)+' / '+d.max.toFixed(3));
    set('lift',d.lift.toFixed(2)+' м/с');
  };
}