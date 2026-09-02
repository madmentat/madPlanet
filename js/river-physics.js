/* ============ 0.5.131: runoff-driven river network physics ============ */
/*
   Close the terrestrial water cycle that already exists in Weather Core:

      precipitation -> infiltration / soil storage -> runoff -> drainage basin
      -> channel discharge -> hydraulic geometry / lake storage.

   River placement is not a latitude mask and not procedural morphology. The
   drainage graph is built from the resolved macro-terrain on the cubed sphere.
   A Priority-Flood depression fill supplies a spill path through closed pits,
   then a single downstream edge per cell provides a conservative topological
   accumulation of effective runoff. The rendering layer may add sub-grid
   meander detail, but it is only allowed where this module diagnoses a real
   channel.

   The model follows standard DEM hydrology practice (hydro-conditioned
   elevation -> flow direction -> contributing discharge). Channel size follows
   hydraulic geometry: width/depth are power functions of discharge. A compact
   stream-power diagnostic Q^m S^n is published for later geomorphic erosion;
   this module does not silently edit the visible terrain.
*/

const RIVER_PHYSICS_MODEL=1;
const RIVER_WATER_DENSITY_KG_M3=1000.0;
const RIVER_EARTH_RADIUS_M=6371000.0;
const RIVER_RUNOFF_MEMORY_SEC=24*86400;
const RIVER_DISCHARGE_RESPONSE_SEC=9*3600;
const RIVER_BOOTSTRAP_RUNOFF_KG_M2_S=1.05e-5; // ~331 mm/yr land runoff scale
const RIVER_PRIORITY_EPS=1e-7;
const RIVER_CHANNEL_Q0_M3_S=8.0;
const RIVER_CHANNEL_Q1_M3_S=220.0;
const RIVER_WIDTH_COEFF=4.4;
const RIVER_WIDTH_EXP=0.50;
const RIVER_DEPTH_COEFF=0.42;
const RIVER_DEPTH_EXP=0.36;
const RIVER_STREAM_POWER_M=0.50;
const RIVER_STREAM_POWER_N=1.00;

function riverClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function riverSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=riverClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function riverMix(a,b,t){return a+(b-a)*t;}
function riverRadiusM(climate){
  if(Number.isFinite(climate?.radiusM)&&climate.radiusM>0)return riverClamp(climate.radiusM,1e5,1e9);
  if(typeof windPlanetRadiusM==='function')return windPlanetRadiusM(climate);
  return RIVER_EARTH_RADIUS_M;
}

class RiverMinHeap{
  constructor(){this.a=[];}
  get size(){return this.a.length;}
  push(h,i){
    const a=this.a,item={h,i};let k=a.length;a.push(item);
    while(k>0){const p=(k-1)>>1,q=a[p];if(q.h<h||(q.h===h&&q.i<=i))break;a[k]=q;k=p;}a[k]=item;
  }
  pop(){
    const a=this.a;if(!a.length)return null;const root=a[0],last=a.pop();if(!a.length)return root;
    let k=0;while(true){const l=k*2+1;if(l>=a.length)break;const r=l+1;let c=l;
      if(r<a.length&&(a[r].h<a[l].h||(a[r].h===a[l].h&&a[r].i<a[l].i)))c=r;
      if(a[c].h>last.h||(a[c].h===last.h&&a[c].i>=last.i))break;a[k]=a[c];k=c;}
    a[k]=last;return root;
  }
}

function riverEnsureFields(core){
  if(!core?.count)return core;const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  const f64=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float64Array(n);};
  const i32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Int32Array(n);};
  for(const k of ['riverFilledTerrain','riverFillDepth','riverSlope','riverRunoffMean',
    'riverLocalRunoffQ','riverDischargeTarget','riverDischarge','riverChannelStrength',
    'riverWidthM','riverDepthM','riverVelocityMS','riverStreamPower','riverLakeFraction'])f32(k);
  for(const k of ['riverAccumScratch','riverAreaScratch'])f64(k);
  for(const k of ['riverDownstream','riverFloodParent','riverTopo'])i32(k);
  if(!core.riverTopoCount)core.riverTopoCount=0;
  core.riverPhysicsModel=RIVER_PHYSICS_MODEL;
  if(typeof core.riverTopologySignature!=='string')core.riverTopologySignature='';
  return core;
}
function riverTopologySignature(core){
  return String(core?.h2oSurfaceSignature||'none')+'|'+String(core?.orographySignature||'none')+
    '|N='+(core?.N||0)+'|sea='+((typeof state!=='undefined'&&Number.isFinite(state.sea))?state.sea.toFixed(5):'0.58000');
}
function riverForEachNeighbor(core,i,fn){
  if(!core?.windNeighbor)return;
  const seen0=-1,seen1=-1; // documentation marker: de-dup is done below without Set allocation
  let a=-1,b=-1,c=-1,d=-1;
  for(let k=0;k<4;k++){
    const j=core.windNeighbor[k]?.[i]|0;if(j<0||j>=core.count||j===i)continue;
    if(j===a||j===b||j===c||j===d)continue;
    if(a<0)a=j;else if(b<0)b=j;else if(c<0)c=j;else d=j;
    fn(j,k);
  }
}
function riverCellDistanceM(core,i,j,radiusM){
  const dot=riverClamp(core.dirX[i]*core.dirX[j]+core.dirY[i]*core.dirY[j]+core.dirZ[i]*core.dirZ[j],-1,1);
  return Math.max(1,radiusM*Math.acos(dot));
}
function riverTerrainAt(core,i){
  /* macroTerrain is the same large-scale continent field used by Weather Core.
     Add only resolved tectonic relief support; no random drainage terrain. */
  const base=Number(core?.macroTerrain?.[i])||0;
  const oro=riverClamp(core?.orographicRoughness?.[i]||0,0,1);
  return base+0.24*oro;
}
function riverIsOcean(core,i){return riverClamp(core?.surfaceWaterFraction?.[i]||0,0,1)>0.55;}

function riverPriorityFlood(core){
  const n=core.count,filled=core.riverFilledTerrain,parent=core.riverFloodParent;
  const seen=new Uint8Array(n),heap=new RiverMinHeap();parent.fill(-1);
  let seeds=0,best=-1,bestH=Infinity;
  for(let i=0;i<n;i++){
    const h=riverTerrainAt(core,i);filled[i]=h;
    if(riverIsOcean(core,i)){seen[i]=1;heap.push(h,i);seeds++;}
    else if(h<bestH){bestH=h;best=i;}
  }
  if(!seeds&&best>=0){seen[best]=1;heap.push(filled[best],best);}
  while(heap.size){
    const q=heap.pop(),i=q.i;
    riverForEachNeighbor(core,i,j=>{
      if(seen[j])return;seen[j]=1;parent[j]=i;
      if(!riverIsOcean(core,j)&&filled[j]<=filled[i])filled[j]=filled[i]+RIVER_PRIORITY_EPS;
      heap.push(filled[j],j);
    });
  }
  for(let i=0;i<n;i++)core.riverFillDepth[i]=riverIsOcean(core,i)?0:Math.max(0,filled[i]-riverTerrainAt(core,i));
}

function riverBuildDownstream(core,climate){
  const n=core.count,down=core.riverDownstream,filled=core.riverFilledTerrain;
  const radius=riverRadiusM(climate);down.fill(-1);core.riverSlope.fill(0);
  for(let i=0;i<n;i++){
    if(riverIsOcean(core,i))continue;
    let best=-1,bestSlope=0;
    riverForEachNeighbor(core,i,j=>{
      const drop=filled[i]-filled[j];if(!(drop>0))return;
      const s=drop/riverCellDistanceM(core,i,j,radius);
      if(s>bestSlope){bestSlope=s;best=j;}
    });
    if(best<0){const p=core.riverFloodParent[i]|0;if(p>=0&&p<n&&p!==i)best=p;}
    down[i]=best;
    if(best>=0){
      const rawDrop=Math.max(0,riverTerrainAt(core,i)-riverTerrainAt(core,best));
      core.riverSlope[i]=rawDrop/riverCellDistanceM(core,i,best,radius);
    }
  }
}

function riverBuildTopo(core){
  const n=core.count,indeg=new Int32Array(n),q=new Int32Array(n),topo=core.riverTopo;
  let land=0;
  for(let i=0;i<n;i++)if(!riverIsOcean(core,i)){
    land++;const j=core.riverDownstream[i]|0;if(j>=0&&!riverIsOcean(core,j))indeg[j]++;
  }
  let qh=0,qt=0,tc=0;for(let i=0;i<n;i++)if(!riverIsOcean(core,i)&&indeg[i]===0)q[qt++]=i;
  while(qh<qt){const i=q[qh++];topo[tc++]=i;const j=core.riverDownstream[i]|0;
    if(j>=0&&!riverIsOcean(core,j)){indeg[j]--;if(indeg[j]===0)q[qt++]=j;}}
  /* Priority-Flood is acyclic by construction. Defensive cycle cuts keep a
     malformed neighbour stencil from poisoning the whole water budget. */
  if(tc<land){
    const done=new Uint8Array(n);for(let k=0;k<tc;k++)done[topo[k]]=1;
    for(let i=0;i<n;i++)if(!riverIsOcean(core,i)&&!done[i])core.riverDownstream[i]=-1;
    return riverBuildTopo(core);
  }
  core.riverTopoCount=tc;return tc;
}
function riverRebuildTopology(core,climate){
  riverEnsureFields(core);
  if(!core.windNeighbor||!core.macroTerrain||!core.surfaceWaterFraction)return core;
  riverPriorityFlood(core);riverBuildDownstream(core,climate);riverBuildTopo(core);
  core.riverTopologySignature=riverTopologySignature(core);return core;
}

function riverCellAreas(core,climate){
  const n=core.count,a=core.riverAreaScratch;let sw=0;
  for(let i=0;i<n;i++)sw+=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
  const total=4*Math.PI*Math.pow(riverRadiusM(climate),2);
  const unit=total/Math.max(1e-12,sw);
  for(let i=0;i<n;i++)a[i]=unit*Math.max(1e-12,Number(core.areaWeight?.[i])||1);
  return a;
}
function riverBootstrapRunoffRate(core,i){
  if(riverIsOcean(core,i))return 0;
  const rh=riverClamp(core?.relativeHumidity?.[i]??core?.humidity?.[i]??0,0,1.5);
  const cap=Math.max(0,Number(core?.soilCapacity?.[i])||0);
  const soil=cap>1e-6?riverClamp((Number(core?.soilMoisture?.[i])||0)/cap,0,1):riverClamp(rh,0,1);
  const wet=riverClamp(0.55*riverSmooth(0.42,0.92,rh)+0.45*soil,0,1);
  const T=Number(core?.surfaceTemp?.[i])||288;
  const liquid=riverSmooth(266,278,T)*(1-riverSmooth(368,395,T));
  return RIVER_BOOTSTRAP_RUNOFF_KG_M2_S*wet*liquid;
}
function riverUpdateRunoffMemory(core,dtSec){
  const dt=Math.max(0,Number(dtSec)||0),a=1-Math.exp(-dt/RIVER_RUNOFF_MEMORY_SEC);
  for(let i=0;i<core.count;i++){
    if(riverIsOcean(core,i)){core.riverRunoffMean[i]=0;continue;}
    const actual=Math.max(0,Number(core?.runoffGenerationRate?.[i])||0);
    /* unresolved groundwater/baseflow: a small climate/soil-supported floor,
       not a random source. It prevents a perennial river from vanishing in the
       five-minute tick between rain events. */
    const base=0.28*riverBootstrapRunoffRate(core,i);
    const target=Math.max(actual,base);
    if(!(core.riverRunoffMean[i]>0))core.riverRunoffMean[i]=riverBootstrapRunoffRate(core,i);
    else core.riverRunoffMean[i]+= (target-core.riverRunoffMean[i])*a;
  }
}
function riverHydraulicGeometry(Q,slope,out){
  Q=Math.max(0,Number(Q)||0);slope=Math.max(1e-8,Number(slope)||0);
  const width=Q>0?riverClamp(RIVER_WIDTH_COEFF*Math.pow(Q,RIVER_WIDTH_EXP),0.8,12000):0;
  const depth=Q>0?riverClamp(RIVER_DEPTH_COEFF*Math.pow(Q,RIVER_DEPTH_EXP),0.08,80):0;
  const velocity=(width>0&&depth>0)?riverClamp(Q/(width*depth),0.04,8.0):0;
  const power=Q>0?Math.pow(Q,RIVER_STREAM_POWER_M)*Math.pow(slope,RIVER_STREAM_POWER_N):0;
  out.width=width;out.depth=depth;out.velocity=velocity;out.power=power;return out;
}
function riverAccumulateDischarge(core,dtSec,climate){
  const n=core.count,acc=core.riverAccumScratch,areas=riverCellAreas(core,climate);acc.fill(0);
  for(let i=0;i<n;i++){
    const q=Math.max(0,core.riverRunoffMean[i])*areas[i]/RIVER_WATER_DENSITY_KG_M3;
    core.riverLocalRunoffQ[i]=q;acc[i]=q;
  }
  for(let k=0;k<core.riverTopoCount;k++){
    const i=core.riverTopo[k],j=core.riverDownstream[i]|0;
    if(j>=0&&!riverIsOcean(core,j))acc[j]+=acc[i];
  }
  const response=1-Math.exp(-Math.max(0,dtSec)/RIVER_DISCHARGE_RESPONSE_SEC),g={};
  for(let i=0;i<n;i++){
    if(riverIsOcean(core,i)){
      core.riverDischargeTarget[i]=core.riverDischarge[i]=core.riverChannelStrength[i]=0;
      core.riverWidthM[i]=core.riverDepthM[i]=core.riverVelocityMS[i]=core.riverStreamPower[i]=core.riverLakeFraction[i]=0;continue;
    }
    const target=Math.max(0,acc[i]);core.riverDischargeTarget[i]=target;
    if(!(core.riverDischarge[i]>0))core.riverDischarge[i]=target;
    else core.riverDischarge[i]+= (target-core.riverDischarge[i])*response;
    const Q=Math.max(0,core.riverDischarge[i]);riverHydraulicGeometry(Q,core.riverSlope[i],g);
    core.riverWidthM[i]=g.width;core.riverDepthM[i]=g.depth;core.riverVelocityMS[i]=g.velocity;core.riverStreamPower[i]=g.power;
    const qStrength=riverSmooth(RIVER_CHANNEL_Q0_M3_S,RIVER_CHANNEL_Q1_M3_S,Q);
    const slopeSupport=0.58+0.42*riverSmooth(1e-7,2.0e-5,core.riverSlope[i]);
    core.riverChannelStrength[i]=riverClamp(qStrength*slopeSupport,0,1);
    const depression=riverSmooth(0.0015,0.055,core.riverFillDepth[i]);
    const waterSupport=riverSmooth(0.3*RIVER_CHANNEL_Q0_M3_S,2.0*RIVER_CHANNEL_Q0_M3_S,Q);
    core.riverLakeFraction[i]=riverClamp(depression*waterSupport,0,1);
  }
}
function riverPhysicsStep(core,dtSec,climate){
  if(!core?.count)return core;riverEnsureFields(core);
  if(core.riverTopologySignature!==riverTopologySignature(core))riverRebuildTopology(core,climate);
  riverUpdateRunoffMemory(core,dtSec);riverAccumulateDischarge(core,dtSec,climate);return core;
}

function riverDiagnostics(core){
  if(!core?.riverDischarge)return {channels:NaN,Qmax:NaN,widthMax:NaN,lakes:NaN,powerMax:NaN};
  let land=0,channels=0,lakes=0,Qmax=0,widthMax=0,powerMax=0;
  for(let i=0;i<core.count;i++)if(!riverIsOcean(core,i)){
    land++;if(core.riverChannelStrength[i]>0.08)channels++;if(core.riverLakeFraction[i]>0.15)lakes++;
    Qmax=Math.max(Qmax,core.riverDischarge[i]);widthMax=Math.max(widthMax,core.riverWidthM[i]);powerMax=Math.max(powerMax,core.riverStreamPower[i]);
  }
  return {channels:channels/Math.max(1,land),Qmax,widthMax,lakes:lakes/Math.max(1,land),powerMax};
}

const weatherCoreCreateBeforeRiverPhysics=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeRiverPhysics(seed,N,climate,axis);riverEnsureFields(core);riverPhysicsStep(core,WEATHER_CORE_FIXED_DT_SEC,climate);return core;
};
const weatherCoreStepBeforeRiverPhysics=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeRiverPhysics(core,dtSec,climate,axis);riverPhysicsStep(core,dtSec,climate);return core;
};
const weatherCoreFiniteBeforeRiverPhysics=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeRiverPhysics(core))return false;
  const fields=['riverFilledTerrain','riverFillDepth','riverSlope','riverRunoffMean','riverLocalRunoffQ','riverDischargeTarget','riverDischarge','riverChannelStrength','riverWidthM','riverDepthM','riverVelocityMS','riverStreamPower','riverLakeFraction'];
  for(const k of fields){const a=core?.[k];if(!a||a.length!==core.count)return false;for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i])||a[i]<0)return false;}
  return true;
};

if(typeof createPanel==='function'){
  const createPanelBeforeRiverPhysics=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeRiverPhysics(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-river="network"]')){
        appendWeatherCoreRow(box,'Речная сеть','river-network');
        const a=box.lastElementChild?.querySelector('[data-weathercore="river-network"]');if(a){delete a.dataset.weathercore;a.dataset.river='network';}
        appendWeatherCoreRow(box,'Макс. расход / ширина','river-q');
        const b=box.lastElementChild?.querySelector('[data-weathercore="river-q"]');if(b){delete b.dataset.weathercore;b.dataset.river='q';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeRiverPhysics=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeRiverPhysics();if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;const core=weatherCoreEnsure();if(!core?.riverDischarge)return;
    const d=riverDiagnostics(core),set=(k,v)=>{const e=box.querySelector('[data-river="'+k+'"]');if(e)e.textContent=v;};
    set('network',(100*d.channels).toFixed(1)+'% channel · '+(100*d.lakes).toFixed(1)+'% lake');
    set('q',d.Qmax.toFixed(0)+' м³/с · '+d.widthMax.toFixed(0)+' м');
  };
}

if(typeof window!=='undefined')window.__madPlanetRiverPhysics={
  model:RIVER_PHYSICS_MODEL,rebuild:riverRebuildTopology,step:riverPhysicsStep,diagnostics:riverDiagnostics,hydraulicGeometry:riverHydraulicGeometry
};
