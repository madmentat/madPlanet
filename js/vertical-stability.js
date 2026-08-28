/* ============ 0.5.48: vertical stability + physical cloud layers ============ */
/*
   Weather Core v10 derives a compact vertical-column diagnosis from the
   resolved near-surface state. This is intentionally not a full 3-D model.
   Surface/air temperature, humidity, pressure, scale height and resolved
   orographic/frontal ascent are used to estimate bulk stability,
   lifting-condensation level (LCL), and a plausible cloud-column top.

   The authoritative condensate remains cloudWaterState (kg/m2). This module
   only partitions that existing mass into low/mid/high layers by geometric
   overlap with pressure-scale-height bands. Therefore:

       cloudLowMass + cloudMidMass + cloudHighMass == cloudWaterState

   per cell. No condensate is created, destroyed, advected or precipitated
   here. GLSL cloud rendering is deliberately untouched until 0.5.53.
*/

const VERTICAL_STABILITY_MODEL = 1;
const VERTICAL_DRY_LAPSE_K_M = 0.0098;
const VERTICAL_MOIST_LAPSE_K_M = 0.0060;
const VERTICAL_LCL_M_PER_K = 125.0;
const VERTICAL_REF_HEIGHT_SCALE = 0.12;
const VERTICAL_LOW_TOP_SCALE = 0.25;
const VERTICAL_MID_TOP_SCALE = 0.75;
const VERTICAL_MAX_TOP_SCALE = 1.80;
const VERTICAL_MIN_SCALE_HEIGHT_M = 500.0;
const VERTICAL_MAX_SCALE_HEIGHT_M = 120000.0;

function verticalClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function verticalSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=verticalClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function verticalOverlap(a0,a1,b0,b1){ return Math.max(0,Math.min(a1,b1)-Math.max(a0,b0)); }
function verticalGravityMS2(climate){
  if(Number.isFinite(climate?.gravityMS2)&&climate.gravityMS2>0) return verticalClamp(climate.gravityMS2,0.05,80);
  if(typeof h2oGravityMS2==='function') return verticalClamp(h2oGravityMS2(climate),0.05,80);
  return 9.80665;
}
function verticalScaleHeightM(core,i,climate){
  const direct=Number(core?.scaleHeight?.[i]);
  if(Number.isFinite(direct)&&direct>0) return verticalClamp(direct,VERTICAL_MIN_SCALE_HEIGHT_M,VERTICAL_MAX_SCALE_HEIGHT_M);
  const T=verticalClamp(core?.airTemp?.[i]??climate?.T??288.15,80,1400);
  const g=verticalGravityMS2(climate);
  let M=Number(climate?.meanMolarMassKg);
  if(!(M>0)&&typeof windMeanMolarMassKg==='function') M=windMeanMolarMassKg(climate);
  M=verticalClamp(M||0.02897,0.001,0.2);
  return verticalClamp(8.314462618*T/(M*g),VERTICAL_MIN_SCALE_HEIGHT_M,VERTICAL_MAX_SCALE_HEIGHT_M);
}
function verticalRelativeHumidity(core,i){
  const rh=Number(core?.relativeHumidity?.[i]);
  if(Number.isFinite(rh)) return verticalClamp(rh,0,2);
  return verticalClamp(core?.humidity?.[i]??0,0,2);
}

/* Magnus dew point is only used to estimate cloud-base height. Keep the
   empirical formula inside its well-behaved meteorological temperature range;
   exotic hot worlds simply approach a zero LCL if nearly saturated. */
function verticalDewPointK(T,rh){
  T=verticalClamp(T,173.15,373.15);
  rh=verticalClamp(rh,1e-6,1);
  const tc=verticalClamp(T-273.15,-80,60);
  const a=17.625,b=243.04;
  const gamma=Math.log(rh)+a*tc/(b+tc);
  const td=b*gamma/(a-gamma);
  return verticalClamp(td+273.15,173.15,T);
}
function verticalLclHeightM(T,rh,H){
  const td=verticalDewPointK(T,rh);
  return verticalClamp(VERTICAL_LCL_M_PER_K*Math.max(0,T-td),0,VERTICAL_MAX_TOP_SCALE*H*0.98);
}

function verticalEnsureFields(core){
  if(!core||!core.count) return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n) core[k]=new Float32Array(n);};
  for(const k of [
    'environmentLapseKPerKm','parcelLapseKPerKm','bulkStabilityIndex','convectiveIndex',
    'lclHeightM','cloudBaseHeightM','cloudTopHeightM','cloudBasePressurePa','cloudTopPressurePa',
    'cloudLowMass','cloudMidMass','cloudHighMass','cloudLowFraction','cloudMidFraction','cloudHighFraction'
  ]) f32(k);
  core.verticalStabilityModel=VERTICAL_STABILITY_MODEL;
  return core;
}

function verticalCellState(core,i,climate,out){
  const Ts=verticalClamp(core.surfaceTemp[i],80,1400);
  const Ta=verticalClamp(core.airTemp[i],80,1400);
  const H=verticalScaleHeightM(core,i,climate);
  const zRef=verticalClamp(VERTICAL_REF_HEIGHT_SCALE*H,350,1800);
  const rh=verticalRelativeHumidity(core,i);
  const moist=verticalSmooth(0.55,0.98,verticalClamp(rh,0,1));
  const parcelGamma=VERTICAL_DRY_LAPSE_K_M+(VERTICAL_MOIST_LAPSE_K_M-VERTICAL_DRY_LAPSE_K_M)*moist;
  const envGamma=verticalClamp((Ts-Ta)/Math.max(100,zRef),-0.025,0.030);
  const excess=envGamma-parcelGamma; /* >0: environment cools faster than parcel => unstable */
  const stability=verticalClamp(0.5-excess/0.012,0,1); /* 1 stable, 0 unstable */
  const oroW=Math.max(0,Number(core.orographicVerticalVelocity?.[i])||0);
  const frontW=Math.max(0,Number(core.frontVerticalVelocity?.[i])||0);
  const resolvedW=oroW+frontW;
  const buoyant=verticalSmooth(-0.0015,0.0060,excess);
  const lift=verticalSmooth(0.05,1.5,resolvedW);
  const convective=verticalClamp(buoyant*(0.45+0.55*verticalClamp(rh,0,1))+0.22*lift,0,1);
  const lcl=verticalLclHeightM(Ta,rh,H);
  const maxTop=VERTICAL_MAX_TOP_SCALE*H;
  const base=verticalClamp(lcl,0,maxTop*0.96);
  const cloud=Math.max(0,Number(core.cloudWaterState?.[i])||0);
  const cloudBoost=verticalSmooth(0.01,0.60,cloud);
  let depth=H*(0.07+0.18*(1-stability)+0.92*convective+0.10*cloudBoost);
  depth+=Math.min(0.35*H,oroW*420+frontW*650);
  depth=verticalClamp(depth,0.04*H,1.55*H);
  const top=verticalClamp(base+depth,base,maxTop);
  const p0=Math.max(1,Number(core.pressure?.[i])||Math.max(1,Number(climate?.pressureBar)||0)*1e5);

  out.H=H;out.zRef=zRef;out.rh=rh;
  out.envGamma=envGamma;out.parcelGamma=parcelGamma;out.stability=stability;out.convective=convective;
  out.lcl=lcl;out.base=base;out.top=top;out.pBase=p0*Math.exp(-base/H);out.pTop=p0*Math.exp(-top/H);
  return out;
}

function verticalPartitionCloud(core,i,s){
  const total=Math.max(0,Number(core.cloudWaterState?.[i])||0);
  const H=s.H,lowTop=VERTICAL_LOW_TOP_SCALE*H,midTop=VERTICAL_MID_TOP_SCALE*H,maxTop=VERTICAL_MAX_TOP_SCALE*H;
  let wl=verticalOverlap(s.base,s.top,0,lowTop);
  let wm=verticalOverlap(s.base,s.top,lowTop,midTop);
  let wh=verticalOverlap(s.base,s.top,midTop,maxTop);
  let w=wl+wm+wh;
  if(!(w>1e-9)){
    if(s.base<lowTop) wl=1;
    else if(s.base<midTop) wm=1;
    else wh=1;
    w=wl+wm+wh;
  }
  const fl=wl/w,fm=wm/w,fh=wh/w;
  core.cloudLowFraction[i]=fl;core.cloudMidFraction[i]=fm;core.cloudHighFraction[i]=fh;
  core.cloudLowMass[i]=total*fl;core.cloudMidMass[i]=total*fm;core.cloudHighMass[i]=total*fh;
}

function verticalRefresh(core,climate){
  if(!core||!core.count) return core;
  verticalEnsureFields(core);
  const s={};
  for(let i=0;i<core.count;i++){
    verticalCellState(core,i,climate,s);
    core.environmentLapseKPerKm[i]=s.envGamma*1000;
    core.parcelLapseKPerKm[i]=s.parcelGamma*1000;
    core.bulkStabilityIndex[i]=s.stability;
    core.convectiveIndex[i]=s.convective;
    core.lclHeightM[i]=s.lcl;
    core.cloudBaseHeightM[i]=s.base;
    core.cloudTopHeightM[i]=s.top;
    core.cloudBasePressurePa[i]=s.pBase;
    core.cloudTopPressurePa[i]=s.pTop;
    verticalPartitionCloud(core,i,s);
  }
  return core;
}

const weatherCoreCreateBeforeVerticalStability=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeVerticalStability(seed,N,climate,axis);
  verticalEnsureFields(core);
  verticalRefresh(core,climate);
  return core;
};

const weatherCoreStepBeforeVerticalStability=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeVerticalStability(core,dtSec,climate,axis);
  /* Diagnostic/partition-only pass after condensation, precipitation, soil
     hydrology and (when loaded) frontal diagnosis. It never changes
     temperature, vapor or bulk condensate. */
  verticalRefresh(core,climate);
  return core;
};

const weatherCoreFiniteBeforeVerticalStability=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeVerticalStability(core)) return false;
  const fields=['environmentLapseKPerKm','parcelLapseKPerKm','bulkStabilityIndex','convectiveIndex',
    'lclHeightM','cloudBaseHeightM','cloudTopHeightM','cloudBasePressurePa','cloudTopPressurePa',
    'cloudLowMass','cloudMidMass','cloudHighMass','cloudLowFraction','cloudMidFraction','cloudHighFraction'];
  for(const k of fields){
    const a=core?.[k];if(!a||a.length!==core.count) return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])||a[i]<0) return false;
  }
  for(let i=0;i<core.count;i++){
    if(core.bulkStabilityIndex[i]>1.000001||core.convectiveIndex[i]>1.000001) return false;
    const frac=core.cloudLowFraction[i]+core.cloudMidFraction[i]+core.cloudHighFraction[i];
    if(Math.abs(frac-1)>2e-5) return false;
    const layers=core.cloudLowMass[i]+core.cloudMidMass[i]+core.cloudHighMass[i];
    if(Math.abs(layers-Math.max(0,core.cloudWaterState?.[i]||0))>2e-4) return false;
  }
  return true;
};

function verticalDiagnostics(core){
  if(!core?.bulkStabilityIndex) return {stable:NaN,neutral:NaN,unstable:NaN,deep:NaN,lcl:NaN,top:NaN,low:NaN,mid:NaN,high:NaN};
  let sw=0,stable=0,neutral=0,unstable=0,deep=0,lcl=0,top=0,low=0,mid=0,high=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1),s=core.bulkStabilityIndex[i],c=core.convectiveIndex[i];
    sw+=w;
    if(c>0.68) deep+=w;
    else if(s>0.67) stable+=w;
    else if(s<0.33) unstable+=w;
    else neutral+=w;
    lcl+=w*core.lclHeightM[i];top+=w*core.cloudTopHeightM[i];
    low+=w*core.cloudLowMass[i];mid+=w*core.cloudMidMass[i];high+=w*core.cloudHighMass[i];
  }
  const d=Math.max(1e-12,sw);
  return {stable:stable/d,neutral:neutral/d,unstable:unstable/d,deep:deep/d,
    lcl:lcl/d,top:top/d,low:low/d,mid:mid/d,high:high/d};
}

if(typeof createPanel==='function'){
  const createPanelBeforeVerticalStability=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeVerticalStability(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-vertical="stability"]')){
        appendWeatherCoreRow(box,'Устойчивость столба','vertical-stability');
        const a=box.lastElementChild?.querySelector('[data-weathercore="vertical-stability"]');if(a){delete a.dataset.weathercore;a.dataset.vertical='stability';}
        appendWeatherCoreRow(box,'LCL / cloud top','vertical-height');
        const b=box.lastElementChild?.querySelector('[data-weathercore="vertical-height"]');if(b){delete b.dataset.weathercore;b.dataset.vertical='height';}
        appendWeatherCoreRow(box,'Cloud low / mid / high','vertical-layers');
        const c=box.lastElementChild?.querySelector('[data-weathercore="vertical-layers"]');if(c){delete c.dataset.weathercore;c.dataset.vertical='layers';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeVerticalStability=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeVerticalStability();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag');if(!box) return;
    const core=weatherCoreEnsure();if(!core?.bulkStabilityIndex) return;
    const d=verticalDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-vertical="'+k+'"]');if(e)e.textContent=v;};
    set('stability',(100*d.stable).toFixed(0)+'% stable · '+(100*d.unstable).toFixed(0)+'% unstable · '+(100*d.deep).toFixed(0)+'% deep');
    set('height',(d.lcl/1000).toFixed(2)+' / '+(d.top/1000).toFixed(2)+' км');
    set('layers',d.low.toFixed(3)+' / '+d.mid.toFixed(3)+' / '+d.high.toFixed(3)+' кг/м²');
  };
}