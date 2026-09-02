/* ============ 0.5.132: river routing refinement ============ */
/*
   The first runoff-driven river pass exposed the coarse four-neighbour
   Weather Core lattice: almost every wet cell qualified as a channel and the
   only available receivers were E/W/N/S. Rasterizing those links faithfully
   produced a tilted chessboard rather than a drainage network.

   This refinement keeps the water budget and Priority-Flood physics, but makes
   two numerical-resolution corrections before the graph is shown:
     1. hydrology gets its own eight-neighbour cubed-sphere stencil (D8-like),
        so flow can follow diagonal steepest descent instead of Manhattan paths;
     2. a cell becomes a visible channel only after several resolved hillslope
        cells have contributed area and discharge. A single Weather Core cell
        is a catchment element, not automatically a river.

   The thresholds are expressed relative to the current cell area and its
   climate-supported reference runoff, so changing Weather Core resolution or
   planet radius does not resurrect a dense grid of one-cell channels.
*/

const RIVER_ROUTING_REFINEMENT_MODEL=1;
const RIVER_AREA_START_CELLS=1.35;
const RIVER_AREA_FULL_CELLS=6.50;
const RIVER_Q_START_LOCAL_MULT=1.25;
const RIVER_Q_FULL_LOCAL_MULT=8.00;

function riverRoutingEnsureFields(core){
  if(!core?.count)return core;
  if(!core.riverContributingArea||core.riverContributingArea.length!==core.count)
    core.riverContributingArea=new Float64Array(core.count);
  core.riverRoutingRefinementModel=RIVER_ROUTING_REFINEMENT_MODEL;
  return core;
}

function riverRoutingBuildNeighbor8(core){
  if(!core?.count)return core;
  const N=core.N|0;
  /* Synthetic/unit-test cores and legacy environments can keep the already
     valid four-neighbour stencil. The production cubed sphere has both helper
     transforms and receives the full D8-like topology. */
  if(!(N>1)||typeof weatherFaceDir!=='function'||typeof windDirToIndex!=='function'){
    core.riverNeighbor=core.windNeighbor||null;
    return core;
  }
  const n=core.count;
  if(!core.riverNeighbor||core.riverNeighbor.length!==8||core.riverNeighbor[0]?.length!==n)
    core.riverNeighbor=Array.from({length:8},()=>new Int32Array(n));
  const step=2/N;
  const du=[ 1,-1, 0, 0, 1, 1,-1,-1];
  const dv=[ 0, 0, 1,-1, 1,-1, 1,-1];
  let i=0;
  for(let face=0;face<6;face++)for(let y=0;y<N;y++)for(let x=0;x<N;x++,i++){
    const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1;
    for(let k=0;k<8;k++){
      const d=weatherFaceDir(face,u+du[k]*step,v+dv[k]*step);
      core.riverNeighbor[k][i]=windDirToIndex(core,d[0],d[1],d[2]);
    }
  }
  return core;
}

/* Priority-Flood and steepest-descent functions in river-physics.js resolve
   riverForEachNeighbor dynamically, so upgrading this one iterator upgrades
   both conditioning and downstream selection without duplicating either. */
const riverForEachNeighborBeforeRefinement=riverForEachNeighbor;
riverForEachNeighbor=function(core,i,fn){
  const nbr=core?.riverNeighbor;
  if(!nbr||!nbr.length)return riverForEachNeighborBeforeRefinement(core,i,fn);
  for(let k=0;k<nbr.length;k++){
    const j=nbr[k]?.[i]|0;
    if(j<0||j>=core.count||j===i)continue;
    let duplicate=false;
    for(let p=0;p<k;p++)if((nbr[p]?.[i]|0)===j){duplicate=true;break;}
    if(!duplicate)fn(j,k);
  }
};

const riverTopologySignatureBeforeRefinement=riverTopologySignature;
riverTopologySignature=function(core){
  return riverTopologySignatureBeforeRefinement(core)+'|routing8='+RIVER_ROUTING_REFINEMENT_MODEL;
};

const riverRebuildTopologyBeforeRefinement=riverRebuildTopology;
riverRebuildTopology=function(core,climate){
  riverRoutingEnsureFields(core);
  riverRoutingBuildNeighbor8(core);
  return riverRebuildTopologyBeforeRefinement(core,climate);
};

/* The old discharge calculation is still the conservative owner of Q and the
   hydraulic geometry. Afterwards we add a contributing-area pass and replace
   only the visible channel/lake support. This is a resolution criterion, not a
   new water source or sink. */
const riverAccumulateDischargeBeforeRefinement=riverAccumulateDischarge;
riverAccumulateDischarge=function(core,dtSec,climate){
  riverAccumulateDischargeBeforeRefinement(core,dtSec,climate);
  riverRoutingEnsureFields(core);
  const area=riverCellAreas(core,climate),accA=core.riverContributingArea;
  for(let i=0;i<core.count;i++)accA[i]=riverIsOcean(core,i)?0:Math.max(0,area[i]);
  for(let k=0;k<core.riverTopoCount;k++){
    const i=core.riverTopo[k]|0,j=core.riverDownstream[i]|0;
    if(j>=0&&!riverIsOcean(core,j))accA[j]+=accA[i];
  }
  for(let i=0;i<core.count;i++){
    if(riverIsOcean(core,i))continue;
    const cellArea=Math.max(1,area[i]);
    const Q=Math.max(0,Number(core.riverDischarge[i])||0);
    const localReferenceQ=Math.max(0.02,
      RIVER_BOOTSTRAP_RUNOFF_KG_M2_S*cellArea/RIVER_WATER_DENSITY_KG_M3);
    const areaStrength=riverSmooth(RIVER_AREA_START_CELLS*cellArea,
                                   RIVER_AREA_FULL_CELLS*cellArea,accA[i]);
    const qStrength=riverSmooth(RIVER_Q_START_LOCAL_MULT*localReferenceQ,
                                RIVER_Q_FULL_LOCAL_MULT*localReferenceQ,Q);
    const slopeSupport=0.58+0.42*riverSmooth(1e-7,2.0e-5,core.riverSlope[i]);
    core.riverChannelStrength[i]=riverClamp(areaStrength*qStrength*slopeSupport,0,1);

    /* A lake may occupy one resolved depression, but it still needs enough
       water to support standing surface water. Do not require a multi-cell
       channel-area gate for the lake itself. */
    const depression=riverSmooth(0.0015,0.055,core.riverFillDepth[i]);
    const waterSupport=riverSmooth(0.45*localReferenceQ,2.8*localReferenceQ,Q);
    core.riverLakeFraction[i]=riverClamp(depression*waterSupport,0,1);
  }
  return core;
};

const weatherCoreFiniteBeforeRiverRoutingRefinement=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeRiverRoutingRefinement(core))return false;
  if(!core?.riverContributingArea||core.riverContributingArea.length!==core.count)return false;
  for(let i=0;i<core.count;i++)if(!Number.isFinite(core.riverContributingArea[i])||core.riverContributingArea[i]<0)return false;
  return true;
};

if(typeof window!=='undefined')window.__madPlanetRiverRoutingRefinement={
  model:RIVER_ROUTING_REFINEMENT_MODEL,
  rebuildNeighbors:riverRoutingBuildNeighbor8
};
