/* ============ 0.5.138: river routing refinement ============ */
/*
   The runoff-driven river pass owns the water budget, Priority-Flood drainage
   and hydraulic geometry. This layer deals with numerical resolution: Weather
   Core cells are large synoptic catchment elements, while the visible river
   network must still preserve headwaters, tributaries and an unbroken trunk.

   0.5.132 introduced an eight-neighbour cubed-sphere stencil and prevented
   every wet Weather Core cell from automatically becoming a river.

   0.5.138 keeps that protection but fixes the opposite failure: with a 24..36
   cell face a single catchment element can represent tens of thousands of
   square kilometres, so requiring several complete cells before any visible
   channel made ordinary island and coastal rivers disappear. Channel
   initiation now needs both a climate-supported discharge and a fractional
   resolved catchment. Once a supported channel exists, a conservative visual
   continuity pass carries part of its strength downstream. The pass cannot
   create water, change Q, or jump drainage divides; it only prevents a real
   graph edge from becoming visually discontinuous because the next coarse
   cell falls just below a display threshold.
*/

const RIVER_ROUTING_REFINEMENT_MODEL=2;
const RIVER_AREA_START_CELLS=0.72;
const RIVER_AREA_FULL_CELLS=4.80;
const RIVER_Q_START_LOCAL_MULT=1.05;
const RIVER_Q_FULL_LOCAL_MULT=6.00;
const RIVER_CONTINUITY_START=0.025;
const RIVER_CONTINUITY_DECAY=0.90;
const RIVER_CONTINUITY_Q_FLOOR=0.58;

function riverRoutingEnsureFields(core){
  if(!core?.count)return core;
  if(!core.riverContributingArea||core.riverContributingArea.length!==core.count)
    core.riverContributingArea=new Float64Array(core.count);
  if(!core.riverRawChannelStrength||core.riverRawChannelStrength.length!==core.count)
    core.riverRawChannelStrength=new Float32Array(core.count);
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

function riverRoutingReferenceQ(cellArea){
  return Math.max(0.02,RIVER_BOOTSTRAP_RUNOFF_KG_M2_S*Math.max(1,cellArea)/RIVER_WATER_DENSITY_KG_M3);
}

/* A display-only continuity constraint. It never alters discharge, runoff,
   contributing area or downstream routing. A channel can be inherited only by
   its own diagnosed downstream receiver, and only while that receiver still
   carries physically supported discharge. */
function riverRoutingCarryChannelsDownstream(core,area){
  const strength=core.riverChannelStrength,raw=core.riverRawChannelStrength;
  raw.set(strength);
  for(let k=0;k<core.riverTopoCount;k++){
    const i=core.riverTopo[k]|0,j=core.riverDownstream[i]|0;
    if(j<0||j>=core.count||riverIsOcean(core,j))continue;
    const upstream=riverClamp(strength[i],0,1);
    if(upstream<=RIVER_CONTINUITY_START)continue;
    const qj=Math.max(0,Number(core.riverDischarge[j])||0);
    const ref=riverRoutingReferenceQ(area[j]);
    const qSupport=riverSmooth(0.72*ref,2.50*ref,qj);
    if(qSupport<=0)continue;
    const inherited=upstream*RIVER_CONTINUITY_DECAY*(RIVER_CONTINUITY_Q_FLOOR+(1-RIVER_CONTINUITY_Q_FLOOR)*qSupport);
    if(inherited>strength[j])strength[j]=riverClamp(inherited,0,1);
  }
}

/* The old discharge calculation is still the conservative owner of Q and the
   hydraulic geometry. Afterwards we add contributing area, resolve headwater
   support and enforce graph continuity only in the visual channel field. */
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
    if(riverIsOcean(core,i)){
      core.riverChannelStrength[i]=0;
      core.riverRawChannelStrength[i]=0;
      continue;
    }
    const cellArea=Math.max(1,area[i]);
    const Q=Math.max(0,Number(core.riverDischarge[i])||0);
    const localReferenceQ=riverRoutingReferenceQ(cellArea);
    const areaStrength=riverSmooth(RIVER_AREA_START_CELLS*cellArea,
                                   RIVER_AREA_FULL_CELLS*cellArea,accA[i]);
    const qStrength=riverSmooth(RIVER_Q_START_LOCAL_MULT*localReferenceQ,
                                RIVER_Q_FULL_LOCAL_MULT*localReferenceQ,Q);
    const slopeSupport=0.66+0.34*riverSmooth(6e-8,1.6e-5,core.riverSlope[i]);
    core.riverChannelStrength[i]=riverClamp(areaStrength*qStrength*slopeSupport,0,1);

    /* A lake may occupy one resolved depression, but it still needs enough
       water to support standing surface water. Do not require a multi-cell
       channel-area gate for the lake itself. */
    const depression=riverSmooth(0.0015,0.055,core.riverFillDepth[i]);
    const waterSupport=riverSmooth(0.45*localReferenceQ,2.8*localReferenceQ,Q);
    core.riverLakeFraction[i]=riverClamp(depression*waterSupport,0,1);
  }
  riverRoutingCarryChannelsDownstream(core,area);
  return core;
};

const weatherCoreFiniteBeforeRiverRoutingRefinement=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeRiverRoutingRefinement(core))return false;
  for(const key of ['riverContributingArea','riverRawChannelStrength']){
    const a=core?.[key];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i])||a[i]<0)return false;
  }
  return true;
};

if(typeof window!=='undefined')window.__madPlanetRiverRoutingRefinement={
  model:RIVER_ROUTING_REFINEMENT_MODEL,
  rebuildNeighbors:riverRoutingBuildNeighbor8,
  carryDownstream:riverRoutingCarryChannelsDownstream
};
