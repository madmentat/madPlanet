/* ============ 0.5.52 / 0.5.62 / 0.5.64: lightning from physical deep convection ============ */
/*
   Lightning is no longer an independent procedural weather source. Electrical
   potential is diagnosed only inside resolved deep moist convection, using
   sub-grid updraft speed, cloud condensate, mixed-phase cloud depth and the
   existing precipitation rate. Dry/stable/shallow columns cannot create a
   lightning centre regardless of the visual storm sliders.

   0.5.62 keeps that physical requirement but removes an accidental scarcity:
   the old diagnosis multiplied four broad 0..1 gates. A perfectly ordinary
   thunderstorm could therefore be reduced to a near-zero score simply because
   each individual proxy was only moderate. Mixed-phase depth remains a hard
   physical requirement; deep state, updraft and condensate now combine as a
   softer coupled vigor term so ordinary cumulonimbus can be electrically live.

   0.5.64 keeps the same physical potential, but stops treating that potential
   as a linear flash-frequency multiplier. Weak/moderate electrically valid
   cells were still flashing absurdly rarely even when the user explicitly
   requested high storm activity. Cadence now uses a sub-linear response while
   intensity still follows the physical potential, and the render selection
   floor is lowered slightly so the five available GPU slots are populated by
   real secondary storms instead of waiting only for near-supercells.

   Until the Weather Core cloud visual bridge arrives in 0.5.53, reuse the five
   retired uCycA/uCycB uniform slots as a tiny render transport. Important:
   uCycA.w is ALWAYS zero. Legacy synoptic()/vortexWarp() therefore skip every
   slot and procedural cyclones remain dead. The payload layout is:
     A.xyz = body-fixed Weather Core direction, A.w = 0
     B.x   = angular storm radius (rad)
     B.y   = physical flash cadence (Hz)
     B.z   = electrical intensity 0..1
     B.w   = deterministic phase seed 0..1
*/

const LIGHTNING_WEATHER_MODEL = 1;
const LIGHTNING_RENDER_SLOTS = 5;
const LIGHTNING_MIXED_WARM_K = 273.15;
const LIGHTNING_MIXED_COLD_K = 238.15;
const LIGHTNING_MOIST_LAPSE_K_M = 0.0060;
const LIGHTNING_MAX_FLASH_HZ = 4.5;
const LIGHTNING_MIN_SEPARATION_RAD = 0.105;
const LIGHTNING_SELECTION_FLOOR = 0.006;

function lightningClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function lightningSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=lightningClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function lightningOverlap(a0,a1,b0,b1){ return Math.max(0,Math.min(a1,b1)-Math.max(a0,b0)); }
function lightningHash01(seed,index){
  if(typeof weatherHash01==='function') return weatherHash01((seed|0)^0x52f17a3,index|0);
  let x=Math.imul(((seed|0)^0x52f17a3),((index|0)+1));
  x^=x>>>16;x=Math.imul(x,0x21f0aaad);x^=x>>>15;return (x>>>0)/4294967296;
}
function lightningScaleHeight(core,i,climate){
  if(typeof deepScaleHeightM==='function') return deepScaleHeightM(core,i,climate);
  const h=Number(core?.scaleHeight?.[i]);
  return lightningClamp(Number.isFinite(h)&&h>0?h:8400,500,120000);
}

function lightningEnsureFields(core){
  if(!core||!core.count) return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n) core[k]=new Float32Array(n);};
  for(const k of ['lightningPotential','lightningFlashRateHz','lightningMixedPhaseDepthM','lightningElectricalIntensity']) f32(k);
  if(!core.lightningSelectedIndex||core.lightningSelectedIndex.length!==LIGHTNING_RENDER_SLOTS)
    core.lightningSelectedIndex=new Int32Array(LIGHTNING_RENDER_SLOTS);
  if(!core.lightningRenderA||core.lightningRenderA.length!==LIGHTNING_RENDER_SLOTS*4)
    core.lightningRenderA=new Float32Array(LIGHTNING_RENDER_SLOTS*4);
  if(!core.lightningRenderB||core.lightningRenderB.length!==LIGHTNING_RENDER_SLOTS*4)
    core.lightningRenderB=new Float32Array(LIGHTNING_RENDER_SLOTS*4);
  core.lightningWeatherModel=LIGHTNING_WEATHER_MODEL;
  return core;
}

function lightningMixedPhaseDepth(core,i,climate){
  const H=lightningScaleHeight(core,i,climate);
  const base=lightningClamp(core.cloudBaseHeightM?.[i]??core.lclHeightM?.[i]??0,0,1.8*H);
  const top=lightningClamp(core.cloudTopHeightM?.[i]??base,base,1.8*H);
  const Ta=lightningClamp(core.airTemp?.[i]??climate?.T??288.15,150,1400);
  /* Approximate the vertical portion of the cloud spanning 0..-35 C, where
     collisions among supercooled droplets, ice and graupel can separate
     charge. This is a mixed-phase-depth proxy, not explicit ice microphysics. */
  const zWarm=Math.max(0,(Ta-LIGHTNING_MIXED_WARM_K)/LIGHTNING_MOIST_LAPSE_K_M);
  const zCold=Math.max(zWarm,(Ta-LIGHTNING_MIXED_COLD_K)/LIGHTNING_MOIST_LAPSE_K_M);
  return lightningOverlap(base,top,zWarm,zCold);
}

function lightningDiagnoseCell(core,i,climate){
  const deep=lightningClamp(core.deepConvectiveState?.[i]||0,0,1);
  const up=Math.max(0,Number(core.deepUpdraftMS?.[i])||0);
  const cloud=Math.max(0,Number(core.cloudWaterState?.[i])||0);
  const mixed=lightningMixedPhaseDepth(core,i,climate);
  const precipHr=Math.max(0,Number(core.precipRate?.[i])||0)*3600;

  /* 0.5.62: mixed phase is still mandatory, but the other indicators are
     correlated symptoms of the same plume and must not be multiplied as four
     independent probabilities. The old product made moderate real storms
     practically disappear: 0.4*0.3*0.25*0.5 is already only 0.015. */
  const stateGate=lightningSmooth(0.04,0.62,deep);
  const upGate=lightningSmooth(2.5,20.0,up);
  const cloudGate=lightningSmooth(0.015,0.28,cloud);
  const mixedGate=lightningSmooth(180,2400,mixed);
  const precipGate=lightningSmooth(0.5,20.0,precipHr);
  const plumeVigor=stateGate*Math.sqrt(Math.max(0,upGate*cloudGate));
  const potential=lightningClamp(mixedGate*plumeVigor*(0.78+0.22*precipGate),0,1);
  const intensity=lightningClamp(potential*(0.55+0.30*upGate+0.25*cloudGate),0,1);
  /* Electrical potential is not the same thing as the probability that the
     next second contains a flash. A sub-linear cadence response keeps weak but
     genuine thunderstorms alive without making them as bright as strong ones. */
  const cadencePotential=Math.pow(potential,0.78);
  let rate=cadencePotential*(0.18+0.090*Math.min(42,up)+0.022*Math.min(35,precipHr));
  rate=lightningClamp(rate,0,LIGHTNING_MAX_FLASH_HZ);
  return {potential,intensity,rate,mixed,deep,up,precipHr};
}

function lightningSeparated(core,index,selected,count){
  const cosMin=Math.cos(LIGHTNING_MIN_SEPARATION_RAD);
  const x=core.dirX[index],y=core.dirY[index],z=core.dirZ[index];
  for(let s=0;s<count;s++){
    const j=selected[s];
    if(j<0) continue;
    if(x*core.dirX[j]+y*core.dirY[j]+z*core.dirZ[j]>cosMin) return false;
  }
  return true;
}

function lightningPublishPayload(core){
  if(typeof world==='undefined'||!world) return false;
  if(!(world.cycA instanceof Float32Array)||world.cycA.length!==20) world.cycA=new Float32Array(20);
  if(!(world.cycB instanceof Float32Array)||world.cycB.length!==20) world.cycB=new Float32Array(20);
  let changed=false;
  for(let k=0;k<20;k++){
    const a=core.lightningRenderA[k],b=core.lightningRenderB[k];
    if(Math.abs(world.cycA[k]-a)>1e-6||Math.abs(world.cycB[k]-b)>1e-6) changed=true;
    world.cycA[k]=a;world.cycB[k]=b;
  }
  if(changed&&typeof markRenderUniformsDirty==='function') markRenderUniformsDirty();
  return changed;
}

function lightningRefresh(core,climate){
  if(!core||!core.count) return core;
  lightningEnsureFields(core);
  let mean=0,maxPotential=0,maxRate=0,weight=0;
  for(let i=0;i<core.count;i++){
    const d=lightningDiagnoseCell(core,i,climate);
    core.lightningPotential[i]=d.potential;
    core.lightningElectricalIntensity[i]=d.intensity;
    core.lightningFlashRateHz[i]=d.rate;
    core.lightningMixedPhaseDepthM[i]=d.mixed;
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);weight+=w;mean+=w*d.potential;
    if(d.potential>maxPotential)maxPotential=d.potential;if(d.rate>maxRate)maxRate=d.rate;
  }

  const selected=core.lightningSelectedIndex;selected.fill(-1);
  core.lightningRenderA.fill(0);core.lightningRenderB.fill(0);
  let active=0;
  for(let slot=0;slot<LIGHTNING_RENDER_SLOTS;slot++){
    let best=-1,bestScore=0;
    for(let i=0;i<core.count;i++){
      const score=core.lightningPotential[i];
      if(score<=bestScore||score<LIGHTNING_SELECTION_FLOOR) continue;
      if(!lightningSeparated(core,i,selected,active)) continue;
      best=i;bestScore=score;
    }
    if(best<0) break;
    selected[active++]=best;
    const o=slot*4;
    const deep=lightningClamp(core.deepConvectiveState[best],0,1);
    const front=lightningClamp(core.frontStrength?.[best]||0,0,1);
    const cyc=lightningClamp(core.cycloneStrength?.[best]||0,0,1);
    const radius=lightningClamp(0.050+0.095*Math.sqrt(deep)+0.024*Math.max(front,cyc),0.050,0.18);
    core.lightningRenderA[o]=core.dirX[best];core.lightningRenderA[o+1]=core.dirY[best];core.lightningRenderA[o+2]=core.dirZ[best];
    core.lightningRenderA[o+3]=0; /* CRITICAL: never wake legacy procedural synoptic weather. */
    core.lightningRenderB[o]=radius;
    core.lightningRenderB[o+1]=core.lightningFlashRateHz[best];
    core.lightningRenderB[o+2]=core.lightningElectricalIntensity[best];
    core.lightningRenderB[o+3]=lightningHash01(core.seed,best);
  }
  core.lightningActiveCount=active;
  core.lightningMeanPotential=mean/Math.max(1e-12,weight);
  core.lightningMaxPotential=maxPotential;
  core.lightningMaxFlashRateHz=maxRate;
  lightningPublishPayload(core);
  return core;
}

const weatherCoreCreateBeforeLightningWeather=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeLightningWeather(seed,N,climate,axis);
  lightningEnsureFields(core);lightningRefresh(core,climate);return core;
};
const weatherCoreStepBeforeLightningWeather=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeLightningWeather(core,dtSec,climate,axis);
  lightningRefresh(core,climate);return core;
};

const weatherCoreFiniteBeforeLightningWeather=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeLightningWeather(core)) return false;
  for(const k of ['lightningPotential','lightningFlashRateHz','lightningMixedPhaseDepthM','lightningElectricalIntensity']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])||a[i]<0)return false;
  }
  for(let i=0;i<core.count;i++){
    if(core.lightningPotential[i]>1.000001||core.lightningElectricalIntensity[i]>1.000001)return false;
    if(core.lightningFlashRateHz[i]>LIGHTNING_MAX_FLASH_HZ+1e-6)return false;
  }
  if(!core.lightningRenderA||!core.lightningRenderB)return false;
  for(let s=0;s<LIGHTNING_RENDER_SLOTS;s++) if(core.lightningRenderA[s*4+3]!==0)return false;
  return true;
};

function lightningDiagnostics(core){
  if(!core?.lightningPotential)return {active:0,mean:NaN,max:NaN,rate:NaN};
  return {active:core.lightningActiveCount||0,mean:core.lightningMeanPotential||0,max:core.lightningMaxPotential||0,rate:core.lightningMaxFlashRateHz||0};
}
if(typeof createPanel==='function'){
  const createPanelBeforeLightningWeather=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeLightningWeather(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-lightning="activity"]')){
        appendWeatherCoreRow(box,'Электрические грозы','lightning-activity');
        const a=box.lastElementChild?.querySelector('[data-weathercore="lightning-activity"]');if(a){delete a.dataset.weathercore;a.dataset.lightning='activity';}
        appendWeatherCoreRow(box,'Lightning potential','lightning-potential');
        const b=box.lastElementChild?.querySelector('[data-weathercore="lightning-potential"]');if(b){delete b.dataset.weathercore;b.dataset.lightning='potential';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeLightningWeather=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeLightningWeather();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.lightningPotential)return;
    const d=lightningDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-lightning="'+k+'"]');if(e)e.textContent=v;};
    set('activity',d.active+' очагов · max '+d.rate.toFixed(2)+' всп/с');
    set('potential',d.mean.toFixed(3)+' / '+d.max.toFixed(3));
  };
}
