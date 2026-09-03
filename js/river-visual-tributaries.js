/* ============ 0.5.139: basin-constrained visual tributaries ============ */
/*
   The conservative river solver remains authoritative for runoff, discharge,
   Priority-Flood conditioning and the one-edge-per-cell drainage topology.
   That synoptic grid is intentionally too coarse to be used as visible river
   artwork, though: one Weather Core cell can cover tens of thousands of km2.

   This layer derives a DISPLAY graph from the physical graph. It may add small
   tributaries only where the resolved climate supplies water and terrain has a
   usable slope. Every visual tributary is locked to one physical basin, must
   move to a lower/equal hydro-conditioned elevation and must reduce its graph
   distance to an already diagnosed channel, lake or ocean. Thus the display
   can branch between several physically admissible downhill neighbours without
   crossing a drainage divide or inventing an uphill river.
*/

const RIVER_VISUAL_TRIBUTARY_MODEL=1;
const RIVER_VISUAL_REBUILD_TICKS=6;
const RIVER_VISUAL_MAX_BRANCH_STEPS=14;
const RIVER_VISUAL_MIN_TRUNK_DISTANCE=2;
const RIVER_VISUAL_MAX_TRUNK_DISTANCE=11;
const RIVER_VISUAL_CHANNEL_RECEIVER=0.055;
const RIVER_VISUAL_LAKE_RECEIVER=0.08;
const RIVER_VISUAL_SOURCE_MIN=0.28;
const RIVER_VISUAL_MAX_BRANCHES=420;

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
  const runoffSupport=riverSmooth(0.10*RIVER_BOOTSTRAP_RUNOFF_KG_M2_S,
                                  1.80*RIVER_BOOTSTRAP_RUNOFF_KG_M2_S,runoff);
  const T=Number(core?.surfaceTemp?.[i]);
  const liquid=Number.isFinite(T)?riverSmooth(266,278,T)*(1-riverSmooth(368,395,T)):1;
  return riverClamp((0.38*riverSmooth(0.34,0.96,rh)+0.32*soil+0.30*runoffSupport)*liquid,0,1);
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
  const slope=riverSmooth(1.5e-8,1.5e-5,core?.riverSlope?.[i]||0);
  const relief=riverSmooth(-0.01,0.20,riverTerrainAt(core,i));
  const distanceRoom=riverSmooth(RIVER_VISUAL_MIN_TRUNK_DISTANCE,RIVER_VISUAL_MAX_TRUNK_DISTANCE,d);
  return riverClamp(wet*(0.42+0.58*slope)*(0.90+0.10*relief)*(0.88+0.12*distanceRoom),0,1);
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
function riverVisualMarkSourceSpacing(core,claimed,i){
  claimed[i]=1;riverVisualNeighbourCandidates(core,i,j=>{claimed[j]=1;});
}
function riverVisualBuildBranches(core){
  riverVisualEnsureFields(core);riverVisualBuildBasins(core);
  const scores=core.riverVisualSourceScore,claimed=new Uint8Array(core.count),branches=[];
  for(let i=0;i<core.count;i++)scores[i]=riverVisualSourceStrength(core,i);
  const maxBranches=Math.min(RIVER_VISUAL_MAX_BRANCHES,Math.max(24,Math.floor(core.count*0.075)));

  /* Deterministic scan with a seed hash rather than Math.random. Source
     spacing prevents every adjacent wet synoptic cell from spawning a twig. */
  for(let pass=0;pass<2&&branches.length<maxBranches;pass++){
    for(let i=pass;i<core.count&&branches.length<maxBranches;i+=2){
      if(claimed[i])continue;const score=scores[i];if(score<RIVER_VISUAL_SOURCE_MIN)continue;
      const probability=riverClamp((score-RIVER_VISUAL_SOURCE_MIN)*0.46+0.025,0.025,0.22);
      if(riverVisualHash01(core.seed|0,i,0x713+pass)>probability)continue;
      const cells=riverVisualTraceBranch(core,i,0x2911+i*17);if(!cells)continue;
      const end=cells[cells.length-1],endQ=riverClamp(core?.riverChannelStrength?.[end]||0,0,1);
      const strength=riverClamp(0.055+0.26*score+0.08*Math.min(1,cells.length/8)+0.05*endQ,0.06,0.38);
      branches.push({source:i,cells,strength,phase:riverVisualHash01(core.seed|0,i,0x5a17)*2-1});
      riverVisualMarkSourceSpacing(core,claimed,i);
    }
  }
  core.riverVisualBranches=branches;
  core.riverVisualBuildTick=core.ticks|0;
  core.riverVisualSignature=String(core.riverTopologySignature||'')+'|seed='+(core.seed|0)+'|model='+RIVER_VISUAL_TRIBUTARY_MODEL;
  core.riverVisualBranchCount=branches.length;
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
  wetness:riverVisualWetness
};
