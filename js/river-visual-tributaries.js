/* ============ 0.5.139 / 0.5.141: basin-constrained visual tributaries ============ */
/*
   The conservative river solver remains authoritative for runoff, discharge,
   Priority-Flood conditioning and the one-edge-per-cell drainage topology.
   That synoptic grid is intentionally too coarse to be used as visible river
   artwork, though: one Weather Core cell can cover tens of thousands of km2.

   This layer derives a DISPLAY graph from the physical graph. It may add small
   tributaries only where the resolved climate supplies water and terrain has a
   usable slope. Every visual tributary is locked to one physical basin, must
   move to a lower/equal hydro-conditioned elevation and must reduce its graph
   distance to an already diagnosed channel, lake or ocean.

   0.5.141 adds a second headwater pass. Confirmed physical channels may recruit
   short side feeders from wetter/higher neighbouring land in the same basin.
   Feeders are traced upstream first and reversed for display, so every visible
   branch still flows downhill into a diagnosed receiver. This supplies the
   dendritic fine structure that a 24..36-cell synoptic grid cannot resolve.
*/

const RIVER_VISUAL_TRIBUTARY_MODEL=2;
const RIVER_VISUAL_REBUILD_TICKS=12;
const RIVER_VISUAL_MAX_BRANCH_STEPS=16;
const RIVER_VISUAL_MIN_TRUNK_DISTANCE=1;
const RIVER_VISUAL_MAX_TRUNK_DISTANCE=15;
const RIVER_VISUAL_CHANNEL_RECEIVER=0.055;
const RIVER_VISUAL_LAKE_RECEIVER=0.08;
const RIVER_VISUAL_SOURCE_MIN=0.20;
const RIVER_VISUAL_MAX_BRANCHES=720;
const RIVER_VISUAL_FEEDER_MAX=360;
const RIVER_VISUAL_FEEDER_STEPS=5;
const RIVER_VISUAL_FEEDER_WET_MIN=0.22;

function riverVisualHash01(seed,index,salt=0){
  let x=(seed|0)^Math.imul((index+1)|0,0x45d9f3b)^Math.imul((salt+17)|0,0x119de1f3);
  x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;
  return (x>>>0)/4294967296;
}
function riverVisualEnsureFields(core){
  if(!core?.count)return core;const n=core.count;
  if(!core.riverVisualBasin||core.riverVisualBasin.length!==n)core.riverVisualBasin=new Int32Array(n);
  if(!core.riverVisualDistToTrunk||core.riverVisualDistToTrunk.length!==n)core.riverVisualDistToTrunk=new Int16Array(n);
  if(!core.riverVisualSourceScore||core.riverVisualSourceScore.length!==n)core.riverVisualSourceScore=new Float32Array(n);
  if(!Array.isArray(core.riverVisualBranches))core.riverVisualBranches=[];
  core.riverVisualTributaryModel=RIVER_VISUAL_TRIBUTARY_MODEL;
  if(typeof core.riverVisualSignature!=='string')core.riverVisualSignature='';
  if(!Number.isFinite(core.riverVisualBuildTick))core.riverVisualBuildTick=-1e9;
  if(!Number.isFinite(core.riverVisualFeederCount))core.riverVisualFeederCount=0;
  return core;
}
function riverVisualIsReceiver(core,i){
  return riverClamp(core?.riverChannelStrength?.[i]||0,0,1)>=RIVER_VISUAL_CHANNEL_RECEIVER ||
         riverClamp(core?.riverLakeFraction?.[i]||0,0,1)>=RIVER_VISUAL_LAKE_RECEIVER;
}
function riverVisualWetness(core,i){
  const rh=riverClamp(core?.relativeHumidity?.[i]??core?.humidity?.[i]??0,0,1.5);
  const cap=Math.max(0,Number(core?.soilCapacity?.[i])||0);
  const soil=cap>1e-6?riverClamp((Number(core?.soilMoisture?.[i])||0)/cap,0,1):riverClamp(rh,0,1);
  const runoff=Math.max(0,Number(core?.riverRunoffMean?.[i])||0,Number(core?.runoffGenerationRate?.[i])||0);
  const runoffSupport=riverSmooth(0.08*RIVER_BOOTSTRAP_RUNOFF_KG_M2_S,
                                  1.55*RIVER_BOOTSTRAP_RUNOFF_KG_M2_S,runoff);
  const T=Number(core?.surfaceTemp?.[i]);
  const liquid=Number.isFinite(T)?riverSmooth(266,278,T)*(1-riverSmooth(368,395,T)):1;
  return riverClamp((0.36*riverSmooth(0.30,0.94,rh)+0.31*soil+0.33*runoffSupport)*liquid,0,1);
}
function riverVisualBuildBasins(core){
  riverVisualEnsureFields(core);
  const basin=core.riverVisualBasin,dist=core.riverVisualDistToTrunk;
  basin.fill(-1);dist.fill(32767);
  for(let i=0;i<core.count;i++)if(riverIsOcean(core,i)){basin[i]=i;dist[i]=0;}

  /* riverTopo is upstream -> downstream. Reverse order therefore guarantees
     that the receiver already knows its final outlet/basin and trunk distance. */
  for(let k=core.riverTopoCount-1;k>=0;k--){
    const i=core.riverTopo[k]|0;if(i<0||i>=core.count||riverIsOcean(core,i))continue;
    const j=core.riverDownstream?.[i]|0;
    if(j>=0&&j<core.count){
      basin[i]=riverIsOcean(core,j)?j:(basin[j]>=0?basin[j]:j);
    }else basin[i]=i;

    if(riverVisualIsReceiver(core,i))dist[i]=0;
    else if(j>=0&&j<core.count){
      dist[i]=riverIsOcean(core,j)?1:Math.min(32767,(dist[j]|0)+1);
    }
  }
  return core;
}
function riverVisualSourceStrength(core,i){
  if(riverIsOcean(core,i)||riverVisualIsReceiver(core,i))return 0;
  const d=core.riverVisualDistToTrunk?.[i]|0;
  if(d<RIVER_VISUAL_MIN_TRUNK_DISTANCE||d>RIVER_VISUAL_MAX_TRUNK_DISTANCE)return 0;
  const wet=riverVisualWetness(core,i);
  const slope=riverSmooth(8e-9,1.2e-5,core?.riverSlope?.[i]||0);
  const relief=riverSmooth(-0.015,0.18,riverTerrainAt(core,i));
  const distanceRoom=riverSmooth(RIVER_VISUAL_MIN_TRUNK_DISTANCE,7,d);
  return riverClamp(wet*(0.34+0.66*slope)*(0.90+0.10*relief)*(0.90+0.10*distanceRoom),0,1);
}
function riverVisualNeighbourCandidates(core,i,fn){
  const nbr=core?.riverNeighbor;
  if(nbr?.length){
    for(let k=0;k<nbr.length;k++){
      const j=nbr[k]?.[i]|0;if(j<0||j>=core.count||j===i)continue;
      let dup=false;for(let p=0;p<k;p++)if((nbr[p]?.[i]|0)===j){dup=true;break;}
      if(!dup)fn(j,k);
    }
    return;
  }
  riverForEachNeighbor(core,i,fn);
}
function riverVisualChooseNext(core,i,salt){
  const basin=core.riverVisualBasin,dist=core.riverVisualDistToTrunk;
  const d0=dist[i]|0,b0=basin[i]|0;
  const h0=Number(core?.riverFilledTerrain?.[i]);
  let best=-1,bestScore=-1e9;
  riverVisualNeighbourCandidates(core,i,j=>{
    if(riverIsOcean(core,j)){
      if(b0!==j||d0>1)return;
      const s=10+riverVisualHash01(core.seed|0,j,salt);if(s>bestScore){bestScore=s;best=j;}return;
    }
    if((basin[j]|0)!==b0)return;
    const dj=dist[j]|0;if(!(dj<d0))return;
    const hj=Number(core?.riverFilledTerrain?.[j]);
    if(Number.isFinite(h0)&&Number.isFinite(hj)&&hj>h0+RIVER_PRIORITY_EPS*6)return;
    const drop=(Number.isFinite(h0)&&Number.isFinite(hj))?Math.max(0,h0-hj):0;
    const dropSupport=riverSmooth(0,0.035,drop);
    const progress=riverClamp((d0-dj)/Math.max(1,d0),0,1);
    const wet=riverVisualWetness(core,j);
    const physical=(core.riverDownstream?.[i]|0)===j?0.08:0;
    const receiver=riverVisualIsReceiver(core,j)?0.24:0;
    const jitter=0.055*riverVisualHash01(core.seed|0,j,salt+37);
    const score=0.48*progress+0.25*dropSupport+0.14*wet+physical+receiver+jitter;
    if(score>bestScore){bestScore=score;best=j;}
  });
  if(best>=0)return best;
  const j=core.riverDownstream?.[i]|0;
  return (j>=0&&j<core.count)?j:-1;
}
function riverVisualTraceBranch(core,source,salt){
  const cells=[source];let cur=source,reached=false;
  for(let step=0;step<RIVER_VISUAL_MAX_BRANCH_STEPS;step++){
    if(step>0&&riverVisualIsReceiver(core,cur)){reached=true;break;}
    const next=riverVisualChooseNext(core,cur,salt+step*131);
    if(next<0||next>=core.count||next===cur)break;
    if(cells.includes(next))break;
    cells.push(next);
    if(riverIsOcean(core,next)){reached=true;break;}
    cur=next;
  }
  if(!reached&&riverVisualIsReceiver(core,cells[cells.length-1]))reached=true;
  return reached&&cells.length>=2?cells:null;
}

/* Source spacing now uses local prominence rather than deleting the entire
   one-cell neighbourhood. On a synoptic grid one neighbour can be hundreds of
   kilometres away; blanket claiming was the main reason islands got one river. */
function riverVisualSourceProminent(core,i,score){
  const b=core.riverVisualBasin?.[i]|0,d=core.riverVisualDistToTrunk?.[i]|0;
  let dominated=false;
  riverVisualNeighbourCandidates(core,i,j=>{
    if(dominated||riverIsOcean(core,j)||(core.riverVisualBasin?.[j]|0)!==b)return;
    const dj=core.riverVisualDistToTrunk?.[j]|0;
    if(dj+1<d)return;
    const sj=Number(core.riverVisualSourceScore?.[j])||0;
    if(sj>score+0.055)dominated=true;
  });
  return !dominated;
}
function riverVisualMarkSourceSpacing(core,claimed,scores,i){
  claimed[i]=1;
  const si=Number(scores[i])||0,b=core.riverVisualBasin?.[i]|0;
  riverVisualNeighbourCandidates(core,i,j=>{
    if((core.riverVisualBasin?.[j]|0)!==b)return;
    if((Number(scores[j])||0)<si*0.56)claimed[j]=1;
  });
}

/* Reverse (upstream) routing for short side feeders. Every accepted step must
   remain inside the same physical outlet basin, get farther from the diagnosed
   channel, and be no lower than the cell it drains into. Reversing the result
   therefore gives a guaranteed downhill display polyline into the trunk. */
function riverVisualChooseUpstream(core,i,salt,visited){
  const basin=core.riverVisualBasin,dist=core.riverVisualDistToTrunk;
  const b0=basin[i]|0,d0=dist[i]|0,h0=Number(core?.riverFilledTerrain?.[i]);
  let best=-1,bestScore=-1e9;
  riverVisualNeighbourCandidates(core,i,j=>{
    if(riverIsOcean(core,j)||riverVisualIsReceiver(core,j)||visited.has(j))return;
    if((basin[j]|0)!==b0)return;
    const dj=dist[j]|0;if(!(dj>d0)||dj>RIVER_VISUAL_MAX_TRUNK_DISTANCE)return;
    const hj=Number(core?.riverFilledTerrain?.[j]);
    if(Number.isFinite(h0)&&Number.isFinite(hj)&&hj+RIVER_PRIORITY_EPS*6<h0)return;
    const wet=riverVisualWetness(core,j);if(wet<RIVER_VISUAL_FEEDER_WET_MIN)return;
    const source=Number(core.riverVisualSourceScore?.[j])||0;
    const rise=(Number.isFinite(h0)&&Number.isFinite(hj))?Math.max(0,hj-h0):0;
    const riseSupport=riverSmooth(0,0.035,rise);
    const distGain=riverClamp((dj-d0)/Math.max(1,dj),0,1);
    const jitter=0.08*riverVisualHash01(core.seed|0,j,salt+71);
    const score=0.39*wet+0.25*source+0.18*riseSupport+0.10*distGain+jitter;
    if(score>bestScore){bestScore=score;best=j;}
  });
  return best;
}
function riverVisualTraceFeeder(core,receiver,salt){
  const reverse=[receiver],visited=new Set([receiver]);let cur=receiver;
  for(let step=0;step<RIVER_VISUAL_FEEDER_STEPS;step++){
    const next=riverVisualChooseUpstream(core,cur,salt+step*193,visited);
    if(next<0)break;
    reverse.push(next);visited.add(next);cur=next;
    if((core.riverVisualDistToTrunk?.[cur]|0)>=RIVER_VISUAL_MAX_TRUNK_DISTANCE)break;
  }
  if(reverse.length<2)return null;
  reverse.reverse();
  return reverse;
}

function riverVisualBuildBranches(core){
  riverVisualEnsureFields(core);riverVisualBuildBasins(core);
  const scores=core.riverVisualSourceScore,claimed=new Uint8Array(core.count),branches=[];
  for(let i=0;i<core.count;i++)scores[i]=riverVisualSourceStrength(core,i);
  const maxBranches=Math.min(RIVER_VISUAL_MAX_BRANCHES,Math.max(48,Math.floor(core.count*0.13)));

  /* Deterministic selection: wet local maxima are preferred, while the hash
     only decides which equally plausible headwaters survive at display scale. */
  for(let pass=0;pass<3&&branches.length<maxBranches;pass++){
    for(let i=pass;i<core.count&&branches.length<maxBranches;i+=3){
      if(claimed[i])continue;const score=scores[i];if(score<RIVER_VISUAL_SOURCE_MIN)continue;
      if(!riverVisualSourceProminent(core,i,score))continue;
      const probability=riverClamp((score-RIVER_VISUAL_SOURCE_MIN)*0.72+0.055,0.055,0.38);
      if(riverVisualHash01(core.seed|0,i,0x713+pass)>probability)continue;
      const cells=riverVisualTraceBranch(core,i,0x2911+i*17);if(!cells)continue;
      const end=cells[cells.length-1],endQ=riverClamp(core?.riverChannelStrength?.[end]||0,0,1);
      const strength=riverClamp(0.14+0.30*score+0.08*Math.min(1,cells.length/8)+0.06*endQ,0.16,0.46);
      branches.push({kind:'tributary',source:i,cells,strength,phase:(riverVisualHash01(core.seed|0,i,0x5a17)*2-1)*1.35});
      riverVisualMarkSourceSpacing(core,claimed,scores,i);
    }
  }

  /* Side feeders add the missing dendritic texture around real trunks. They
     are not invented across the planet: a feeder can exist only if a confirmed
     channel/lake is its receiver and the reverse trace finds wet uphill land in
     the same physical basin. */
  const feederKeys=new Set();let feeders=0;
  for(let i=0;i<core.count&&feeders<RIVER_VISUAL_FEEDER_MAX&&branches.length<maxBranches;i++){
    if(!riverVisualIsReceiver(core,i)||riverIsOcean(core,i))continue;
    const channel=riverClamp(core?.riverChannelStrength?.[i]||0,0,1);
    const wet=riverVisualWetness(core,i);
    const chance=riverClamp(0.045+0.28*wet+0.13*Math.sqrt(channel),0.045,0.42);
    if(riverVisualHash01(core.seed|0,i,0x9d31)>chance)continue;
    const cells=riverVisualTraceFeeder(core,i,0x4319+i*29);if(!cells)continue;
    const key=cells.slice(0,Math.min(3,cells.length)).join('>')+'>'+i;
    if(feederKeys.has(key))continue;feederKeys.add(key);
    const source=cells[0],sourceWet=riverVisualWetness(core,source);
    const strength=riverClamp(0.12+0.18*sourceWet+0.07*Math.sqrt(channel)+0.035*Math.min(1,cells.length/4),0.15,0.34);
    const phase=(riverVisualHash01(core.seed|0,source,0x663b+i)*2-1)*2.55;
    branches.push({kind:'feeder',source,cells,strength,phase});feeders++;
  }

  core.riverVisualBranches=branches;
  core.riverVisualBuildTick=core.ticks|0;
  core.riverVisualSignature=String(core.riverTopologySignature||'')+'|seed='+(core.seed|0)+'|model='+RIVER_VISUAL_TRIBUTARY_MODEL;
  core.riverVisualBranchCount=branches.length;
  core.riverVisualFeederCount=feeders;
  return core;
}
function riverVisualMaybeRebuild(core,force=false){
  if(!core?.count||!core.riverDownstream||!core.riverTopo)return core;
  riverVisualEnsureFields(core);
  const sig=String(core.riverTopologySignature||'')+'|seed='+(core.seed|0)+'|model='+RIVER_VISUAL_TRIBUTARY_MODEL;
  const age=(core.ticks|0)-(core.riverVisualBuildTick|0);
  if(force||core.riverVisualSignature!==sig||age>=RIVER_VISUAL_REBUILD_TICKS)riverVisualBuildBranches(core);
  return core;
}

const weatherCoreCreateBeforeRiverVisualTributaries=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeRiverVisualTributaries(seed,N,climate,axis);
  riverVisualMaybeRebuild(core,true);return core;
};
const weatherCoreStepBeforeRiverVisualTributaries=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  weatherCoreStepBeforeRiverVisualTributaries(core,dtSec,climate,axis);
  riverVisualMaybeRebuild(core,false);return core;
};
const weatherCoreFiniteBeforeRiverVisualTributaries=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeRiverVisualTributaries(core))return false;
  for(const key of ['riverVisualBasin','riverVisualDistToTrunk','riverVisualSourceScore']){
    const a=core?.[key];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  return Array.isArray(core.riverVisualBranches);
};

if(typeof window!=='undefined')window.__madPlanetRiverVisualTributaries={
  model:RIVER_VISUAL_TRIBUTARY_MODEL,
  rebuild:riverVisualBuildBranches,
  trace:riverVisualTraceBranch,
  traceFeeder:riverVisualTraceFeeder,
  wetness:riverVisualWetness,
  get branchCount(){return Number(weatherCore?.riverVisualBranchCount)||0;},
  get feederCount(){return Number(weatherCore?.riverVisualFeederCount)||0;}
};
