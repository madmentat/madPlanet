/* ============ 0.5.60 hotfix: spatially coherent physical fog ============ */
/*
   A single Weather Core fog cell magnified through a 32/48 cubemap becomes a
   very visible bilinear tent.  The old 0.002 shader cutoff then exposes the
   finite texel support as a rectangle/cross.  Fog is already an optical
   diagnostic state rather than a conserved H2O reservoir, so it may be
   spatially mixed after physical formation/advection without moving water.

   Two light neighbour passes turn isolated cells into coherent banks before
   GPU publication.  This is deliberately not a permission mask and not an
   FPS process; it runs once on the fixed Weather Core tick.
*/

const FOG_SPATIAL_FIX_MODEL=1;
const FOG_SPATIAL_BLEND=0.24;
const FOG_SPATIAL_PASSES=2;

function fogSpatialEnsure(core){
  if(!core?.count)return core;
  if(!core.fogSpatialScratch||core.fogSpatialScratch.length!==core.count)core.fogSpatialScratch=new Float32Array(core.count);
  core.fogSpatialFixModel=FOG_SPATIAL_FIX_MODEL;
  return core;
}
function fogSpatialDiffusePass(core){
  if(!core?.fogState||!core?.windNeighbor)return core;
  fogSpatialEnsure(core);
  const src=core.fogState,tmp=core.fogSpatialScratch,b=FOG_SPATIAL_BLEND,n=core.count;
  for(let i=0;i<n;i++){
    let sum=0,w=0;
    for(let k=0;k<4;k++){
      const j=core.windNeighbor[k]?.[i];
      if(Number.isInteger(j)&&j>=0&&j<n){sum+=src[j];w++;}
    }
    const avg=w?sum/w:src[i];
    tmp[i]=fogClamp(src[i]*(1-b)+avg*b,0,1);
  }
  src.set(tmp);return core;
}
function fogSpatialDiffuse(core){
  for(let p=0;p<FOG_SPATIAL_PASSES;p++)fogSpatialDiffusePass(core);
  if(typeof fogRefreshDerived==='function')fogRefreshDerived(core);
  return core;
}

const fogStepBeforeSpatialFix=fogStep;
fogStep=function(core,dtSec){
  const out=fogStepBeforeSpatialFix(core,dtSec);
  return fogSpatialDiffuse(out);
};

const weatherCoreCreateBeforeFogSpatialFix=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeFogSpatialFix(seed,N,climate,axis);fogSpatialEnsure(core);return core;
};
