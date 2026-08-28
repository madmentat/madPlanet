/* ============ 0.5.50: physical cyclones + anticyclones ============ */
/*
   Weather Core v12 diagnoses synoptic pressure systems from the resolved
   atmospheric state. No random centres, spiral masks or seeded storm tracks
   are created here.

   A cyclone requires a local pressure minimum, cyclonic relative vorticity
   (hemisphere-aware) and dynamical support from convergence/front activity.
   An anticyclone requires a local pressure maximum, anticyclonic vorticity
   and divergence. Near the equator the classification fades because the
   planetary Coriolis sign is too weak to define a robust synoptic rotation.

   The system layer does not edit pressure, wind, temperature or H2O. Its only
   forcing output is systemVerticalVelocity: ascent for cyclones, subsidence
   for anticyclones. The following vertical-stability module consumes that
   field together with orographic and frontal lift.
*/

const PRESSURE_SYSTEMS_MODEL = 1;
const SYSTEM_CORE_WEAK_HPA = 0.08;
const SYSTEM_CORE_STRONG_HPA = 2.8;
const SYSTEM_VORT_WEAK_1E5 = 0.04;
const SYSTEM_VORT_STRONG_1E5 = 1.8;
const SYSTEM_CONV_WEAK_1E5 = 0.025;
const SYSTEM_CONV_STRONG_1E5 = 1.2;
const SYSTEM_DIV_WEAK_1E5 = 0.020;
const SYSTEM_DIV_STRONG_1E5 = 0.9;
const SYSTEM_MIN_STRENGTH = 0.08;
const SYSTEM_MAX_CYCLONE_LIFT_MS = 1.6;
const SYSTEM_MAX_ANTICYCLONE_SINK_MS = 0.75;

function systemClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function systemSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=systemClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}

function systemEnsureFields(core){
  if(!core||!core.count) return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n) core[k]=new Float32Array(n);};
  for(const k of [
    'relativeVorticity1e5','cyclonicVorticity1e5','pressureCoreHpa',
    'cycloneStrength','anticycloneStrength','systemStrength','systemVerticalVelocity',
    'systemDivergence1e5','systemLatitudeGate'
  ]) f32(k);
  if(!core.systemType||core.systemType.length!==n) core.systemType=new Int8Array(n);
  core.pressureSystemsModel=PRESSURE_SYSTEMS_MODEL;
  return core;
}

/* Reproject neighbour velocity into cell i's tangent basis. The same seam-safe
   basis arrays are introduced by 0.5.49 fronts. */
function systemNeighbourWindInBasis(core,i,j,out){
  const u=core.windStateU||core.windU,v=core.windStateV||core.windV;
  const wx=u[j]*core.frontEastX[j]+v[j]*core.frontNorthX[j];
  const wy=u[j]*core.frontEastY[j]+v[j]*core.frontNorthY[j];
  const wz=u[j]*core.frontEastZ[j]+v[j]*core.frontNorthZ[j];
  out.u=wx*core.frontEastX[i]+wy*core.frontEastY[i]+wz*core.frontEastZ[i];
  out.v=wx*core.frontNorthX[i]+wy*core.frontNorthY[i]+wz*core.frontNorthZ[i];
  return out;
}

function systemRelativeVorticity(core,i,out){
  const u=core.windStateU||core.windU,v=core.windStateV||core.windV;
  const u0=u[i],v0=v[i];let dvdx=0,dudy=0;
  for(let k=0;k<4;k++){
    const j=core.windNeighbor[k][i];
    systemNeighbourWindInBasis(core,i,j,out);
    dvdx+=core.windGradE[k][i]*(out.v-v0);
    dudy+=core.windGradN[k][i]*(out.u-u0);
  }
  return dvdx-dudy;
}

function systemPressureCore(core,i,out){
  const p0=Math.max(0,core.pressure[i]);
  let sum=0,lower=0,higher=0,n=0;
  for(let k=0;k<4;k++){
    const j=core.windNeighbor[k][i],p=Math.max(0,core.pressure[j]);
    sum+=p;n++;if(p>p0)higher++;else if(p<p0)lower++;
  }
  const mean=sum/Math.max(1,n);
  out.signedHpa=(mean-p0)/100; /* + = low core, - = high core */
  out.lowRank=higher/Math.max(1,n);
  out.highRank=lower/Math.max(1,n);
  return out;
}

function systemRefresh(core,climate,axis){
  if(!core||!core.count||!core.windNeighbor) return core;
  systemEnsureFields(core);
  if(!core.frontEastX||core.frontEastX.length!==core.count){
    if(typeof frontBuildWindBasis==='function') frontBuildWindBasis(core,axis);
    else return core;
  }
  const ax=axis?weatherNorm3(axis[0],axis[1],axis[2]):weatherCoreAxis();
  const wind=core.windStateU||core.windU,windV=core.windStateV||core.windV;
  const wtmp={u:0,v:0},ptmp={signedHpa:0,lowRank:0,highRank:0};

  for(let i=0;i<core.count;i++){
    const zeta=systemRelativeVorticity(core,i,wtmp);
    const sinLat=systemClamp(core.dirX[i]*ax[0]+core.dirY[i]*ax[1]+core.dirZ[i]*ax[2],-1,1);
    const latGate=systemSmooth(0.08,0.30,Math.abs(sinLat));
    const cyclonic=(sinLat>=0?1:-1)*zeta;
    const div=(typeof frontWindDivergence==='function')?frontWindDivergence(core,i):0;
    const conv=Math.max(0,-div),dvg=Math.max(0,div);
    systemPressureCore(core,i,ptmp);

    const lowHpa=Math.max(0,ptmp.signedHpa),highHpa=Math.max(0,-ptmp.signedHpa);
    const lowCore=systemSmooth(SYSTEM_CORE_WEAK_HPA,SYSTEM_CORE_STRONG_HPA,lowHpa)*systemSmooth(0.45,1.0,ptmp.lowRank);
    const highCore=systemSmooth(SYSTEM_CORE_WEAK_HPA,SYSTEM_CORE_STRONG_HPA,highHpa)*systemSmooth(0.45,1.0,ptmp.highRank);
    const cycSpin=systemSmooth(SYSTEM_VORT_WEAK_1E5,SYSTEM_VORT_STRONG_1E5,Math.max(0,cyclonic)*1e5);
    const antiSpin=systemSmooth(SYSTEM_VORT_WEAK_1E5,SYSTEM_VORT_STRONG_1E5,Math.max(0,-cyclonic)*1e5);
    const convergence=systemSmooth(SYSTEM_CONV_WEAK_1E5,SYSTEM_CONV_STRONG_1E5,conv*1e5);
    const divergence=systemSmooth(SYSTEM_DIV_WEAK_1E5,SYSTEM_DIV_STRONG_1E5,dvg*1e5);
    const frontSupport=systemClamp(core.frontStrength?.[i]||0,0,1);

    const cyclone=systemClamp(latGate*lowCore*cycSpin*(0.52+0.34*convergence+0.14*frontSupport),0,1);
    const anticyclone=systemClamp(latGate*highCore*antiSpin*(0.62+0.38*divergence),0,1);
    let type=0,strength=0;
    if(cyclone>=anticyclone&&cyclone>=SYSTEM_MIN_STRENGTH){type=1;strength=cyclone;}
    else if(anticyclone>cyclone&&anticyclone>=SYSTEM_MIN_STRENGTH){type=2;strength=anticyclone;}

    const H=(typeof verticalScaleHeightM==='function')?verticalScaleHeightM(core,i,climate):8400;
    const speed=Math.hypot(wind[i],windV[i]);
    let w=0;
    if(type===1){
      const continuity=3.0*H*conv;
      w=systemClamp(strength*(0.04+continuity+0.018*speed),0,SYSTEM_MAX_CYCLONE_LIFT_MS);
    }else if(type===2){
      const continuity=1.7*H*dvg;
      w=-systemClamp(strength*(0.025+continuity+0.008*speed),0,SYSTEM_MAX_ANTICYCLONE_SINK_MS);
    }

    core.relativeVorticity1e5[i]=zeta*1e5;
    core.cyclonicVorticity1e5[i]=cyclonic*1e5;
    core.pressureCoreHpa[i]=ptmp.signedHpa;
    core.systemDivergence1e5[i]=div*1e5;
    core.systemLatitudeGate[i]=latGate;
    core.cycloneStrength[i]=cyclone;
    core.anticycloneStrength[i]=anticyclone;
    core.systemStrength[i]=strength;
    core.systemVerticalVelocity[i]=w;
    core.systemType[i]=type;
  }
  return core;
}

const weatherCoreCreateBeforePressureSystems=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforePressureSystems(seed,N,climate,axis);
  systemEnsureFields(core);
  systemRefresh(core,climate,axis);
  return core;
};

const weatherCoreStepBeforePressureSystems=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforePressureSystems(core,dtSec,climate,axis);
  systemRefresh(core,climate,axis);
  return core;
};

const weatherCoreFiniteBeforePressureSystems=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforePressureSystems(core)) return false;
  const fields=['relativeVorticity1e5','cyclonicVorticity1e5','pressureCoreHpa','cycloneStrength',
    'anticycloneStrength','systemStrength','systemVerticalVelocity','systemDivergence1e5','systemLatitudeGate'];
  for(const k of fields){
    const a=core?.[k];if(!a||a.length!==core.count) return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])) return false;
  }
  if(!core.systemType||core.systemType.length!==core.count) return false;
  for(let i=0;i<core.count;i++){
    if(core.cycloneStrength[i]<0||core.cycloneStrength[i]>1.000001) return false;
    if(core.anticycloneStrength[i]<0||core.anticycloneStrength[i]>1.000001) return false;
    if(core.systemStrength[i]<0||core.systemStrength[i]>1.000001) return false;
    if(core.systemVerticalVelocity[i]>SYSTEM_MAX_CYCLONE_LIFT_MS+1e-6||core.systemVerticalVelocity[i]<-SYSTEM_MAX_ANTICYCLONE_SINK_MS-1e-6) return false;
    if(core.systemType[i]<0||core.systemType[i]>2) return false;
  }
  return true;
};

function pressureSystemsDiagnostics(core){
  if(!core?.systemStrength) return {cyclone:NaN,anti:NaN,cycMax:NaN,antiMax:NaN,lift:NaN,sink:NaN,vort:NaN};
  let sw=0,cyclone=0,anti=0,cycMax=0,antiMax=0,lift=0,sink=0,vort=0;
  for(let i=0;i<core.count;i++){
    const aw=Math.max(1e-12,core.areaWeight?.[i]||1);sw+=aw;
    if(core.systemType[i]===1) cyclone+=aw;else if(core.systemType[i]===2) anti+=aw;
    cycMax=Math.max(cycMax,core.cycloneStrength[i]);antiMax=Math.max(antiMax,core.anticycloneStrength[i]);
    lift=Math.max(lift,core.systemVerticalVelocity[i]);sink=Math.min(sink,core.systemVerticalVelocity[i]);
    vort+=aw*Math.abs(core.relativeVorticity1e5[i]);
  }
  const d=Math.max(1e-12,sw);
  return {cyclone:cyclone/d,anti:anti/d,cycMax,antiMax,lift,sink,vort:vort/d};
}

if(typeof createPanel==='function'){
  const createPanelBeforePressureSystems=createPanel;
  createPanel=function(group){
    const el=createPanelBeforePressureSystems(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-system="coverage"]')){
        appendWeatherCoreRow(box,'Циклоны / антициклоны','system-coverage');
        const a=box.lastElementChild?.querySelector('[data-weathercore="system-coverage"]');if(a){delete a.dataset.weathercore;a.dataset.system='coverage';}
        appendWeatherCoreRow(box,'System strength max','system-strength');
        const b=box.lastElementChild?.querySelector('[data-weathercore="system-strength"]');if(b){delete b.dataset.weathercore;b.dataset.system='strength';}
        appendWeatherCoreRow(box,'System w up / down','system-w');
        const c=box.lastElementChild?.querySelector('[data-weathercore="system-w"]');if(c){delete c.dataset.weathercore;c.dataset.system='w';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforePressureSystems=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforePressureSystems();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag');if(!box) return;
    const core=weatherCoreEnsure();if(!core?.systemStrength) return;
    const d=pressureSystemsDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-system="'+k+'"]');if(e)e.textContent=v;};
    set('coverage',(100*d.cyclone).toFixed(1)+' / '+(100*d.anti).toFixed(1)+'%');
    set('strength',d.cycMax.toFixed(3)+' / '+d.antiMax.toFixed(3));
    set('w',d.lift.toFixed(2)+' / '+d.sink.toFixed(2)+' м/с');
  };
}
