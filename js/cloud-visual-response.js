/* ============ 0.5.54 / 0.5.61 hotfix: inertial cloud visual response ============ */
/*
   This layer deliberately does NOT decide whether a rendered cloud pixel is
   allowed or forbidden.  Weather Core supplies only a slowly varying signed
   influence for the mature 0.5.53 procedural cloud morphology:
      +1  strongly favours cloud growth ("magnet")
       0  neutral
      -1  strongly favours dissipation ("disperser")

   The response is persistent, spatially diffused across the cubed-sphere and
   asymmetric in time.  A dry/subsident cell therefore erodes a cloud over a
   finite time instead of clipping it at a grid boundary, while a humid/lifting
   cell must accumulate enough favourable forcing before the morphology grows.
   No H2O, condensate or thermodynamic state is modified here.

   0.5.61 reduces the per-tick spatial blend. At 22% every five model minutes,
   a single physically favourable cell surrounded by dry cells was driven back
   through zero faster than its deliberately slow local growth could respond.
   Spatial smoothing remains, but it can no longer reverse sustained local
   forcing merely because neighbouring cells are dry.
*/

const CLOUD_VISUAL_RESPONSE_MODEL=2;
const CLOUD_VISUAL_GROW_TAU_SEC=95*60;
const CLOUD_VISUAL_DISSIPATE_TAU_SEC=70*60;
const CLOUD_VISUAL_SPATIAL_BLEND=0.10;

function cloudVisualClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function cloudVisualSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=cloudVisualClamp((x-a)/(b-a),0,1);
  return t*t*(3-2*t);
}
function cloudVisualOptical(mass,scale){
  mass=Math.max(0,Number(mass)||0);scale=Math.max(1e-6,Number(scale)||1);
  return cloudVisualClamp(1-Math.exp(-mass/scale),0,1);
}
function cloudVisualEnsureFields(core){
  if(!core?.count)return core;
  const n=core.count;
  const ensure=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  for(const k of ['cloudVisualLow','cloudVisualMid','cloudVisualHigh',
    'cloudGrowthWeight','cloudDissipationWeight','cloudVisualScratch'])ensure(k);
  core.cloudVisualResponseModel=CLOUD_VISUAL_RESPONSE_MODEL;
  return core;
}
function cloudVisualWeights(core,i){
  const rh=cloudVisualClamp(core.relativeHumidity?.[i] ?? core.humidity?.[i] ?? 0,0,2.5);
  const moist=cloudVisualSmooth(0.62,0.98,rh);
  const saturated=cloudVisualSmooth(0.92,1.10,rh);
  const dry=1-cloudVisualSmooth(0.42,0.78,rh);
  const cond=cloudVisualSmooth(1e-7,5e-5,Math.max(0,Number(core.condensationRate?.[i])||0));
  const evap=cloudVisualSmooth(1e-7,5e-5,Math.max(0,Number(core.cloudEvaporationRate?.[i])||0));
  const oro=Number(core.orographicVerticalVelocity?.[i])||0;
  const front=Number(core.frontVerticalVelocity?.[i])||0;
  const sys=Number(core.systemVerticalVelocity?.[i])||0;
  const lift=cloudVisualSmooth(0.02,0.85,Math.max(0,oro)+Math.max(0,front)+Math.max(0,sys));
  const sink=cloudVisualSmooth(0.02,0.55,Math.max(0,-oro)+Math.max(0,-front)+Math.max(0,-sys));
  const deep=cloudVisualClamp(core.deepConvectiveState?.[i],0,1);
  const growth=cloudVisualClamp(0.42*moist+0.16*saturated+0.18*cond+0.14*lift+0.10*deep,0,1);
  const diss=cloudVisualClamp(0.58*dry+0.24*evap+0.18*sink,0,1);
  return {growth,diss,moist,deep};
}
function cloudVisualLayerTarget(core,i,w,layer){
  const low=cloudVisualOptical(core.cloudLowMass?.[i],0.16);
  const mid=cloudVisualOptical(core.cloudMidMass?.[i],0.11);
  const high=cloudVisualOptical(core.cloudHighMass?.[i],0.055);
  let physical=low;
  if(layer===1)physical=mid;
  else if(layer===2)physical=high;

  /* Existing condensate strengthens a growth region, but it is never a mask.
     A dry/subsident environment can still become a disperser even while a
     large cloud is present.  Deep convection preferentially favours upper
     layers/anvils. */
  let source=w.growth*(0.38+0.62*physical);
  if(layer===1)source=cloudVisualClamp(source+0.10*w.deep,0,1);
  if(layer===2)source=cloudVisualClamp(source+0.28*w.deep,0,1);
  const sink=w.diss*(1-0.18*physical); // large existing clouds resist erosion
  return cloudVisualClamp(source-sink,-1,1);
}
function cloudVisualAdvanceValue(current,target,dtSec,moist,physical){
  current=cloudVisualClamp(current,-1,1);target=cloudVisualClamp(target,-1,1);
  /* Formation is slower when moisture support is marginal.  Dissipation of a
     massive cloud is slower because the disperser has finite capacity. */
  let tau;
  if(target>current){
    tau=CLOUD_VISUAL_GROW_TAU_SEC*(1.55-0.75*cloudVisualClamp(moist,0,1));
  }else{
    tau=CLOUD_VISUAL_DISSIPATE_TAU_SEC*(1+1.45*cloudVisualClamp(physical,0,1));
  }
  const a=1-Math.exp(-Math.max(0,dtSec)/Math.max(30,tau));
  return cloudVisualClamp(current+(target-current)*a,-1,1);
}
function cloudVisualDiffuse(core,field){
  if(!core.windNeighbor||!core.cloudVisualScratch)return;
  const tmp=core.cloudVisualScratch,n=core.count,b=CLOUD_VISUAL_SPATIAL_BLEND;
  for(let i=0;i<n;i++){
    let sum=0,c=0;
    for(let k=0;k<4;k++){
      const j=core.windNeighbor[k]?.[i];
      if(Number.isInteger(j)&&j>=0&&j<n){sum+=field[j];c++;}
    }
    const avg=c?sum/c:field[i];
    tmp[i]=field[i]*(1-b)+avg*b;
  }
  field.set(tmp);
}
function cloudVisualResponseStep(core,dtSec){
  if(!core?.count)return core;
  cloudVisualEnsureFields(core);
  const dt=cloudVisualClamp(dtSec,0,(typeof WEATHER_CORE_FIXED_DT_SEC==='number'?WEATHER_CORE_FIXED_DT_SEC:300));
  for(let i=0;i<core.count;i++){
    const w=cloudVisualWeights(core,i);
    core.cloudGrowthWeight[i]=w.growth;
    core.cloudDissipationWeight[i]=w.diss;
    const low=cloudVisualOptical(core.cloudLowMass?.[i],0.16);
    const mid=cloudVisualOptical(core.cloudMidMass?.[i],0.11);
    const high=cloudVisualOptical(core.cloudHighMass?.[i],0.055);
    core.cloudVisualLow[i]=cloudVisualAdvanceValue(core.cloudVisualLow[i],cloudVisualLayerTarget(core,i,w,0),dt,w.moist,low);
    core.cloudVisualMid[i]=cloudVisualAdvanceValue(core.cloudVisualMid[i],cloudVisualLayerTarget(core,i,w,1),dt,w.moist,mid);
    core.cloudVisualHigh[i]=cloudVisualAdvanceValue(core.cloudVisualHigh[i],cloudVisualLayerTarget(core,i,w,2),dt,w.moist,high);
  }
  /* One cheap neighbour diffusion pass makes the influence field larger and
     softer than a raw 48x48 cell.  It is not diffusion of water/cloud mass. */
  cloudVisualDiffuse(core,core.cloudVisualLow);
  cloudVisualDiffuse(core,core.cloudVisualMid);
  cloudVisualDiffuse(core,core.cloudVisualHigh);
  return core;
}

const weatherCoreCreateBeforeCloudVisualResponse=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeCloudVisualResponse(seed,N,climate,axis);
  cloudVisualEnsureFields(core); // neutral zero = exact morphology baseline
  return core;
};
const weatherCoreStepBeforeCloudVisualResponse=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeCloudVisualResponse(core,dtSec,climate,axis);
  cloudVisualResponseStep(core,dtSec);
  return core;
};

const weatherCoreFiniteBeforeCloudVisualResponse=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeCloudVisualResponse(core))return false;
  for(const k of ['cloudVisualLow','cloudVisualMid','cloudVisualHigh','cloudGrowthWeight','cloudDissipationWeight']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  return true;
};