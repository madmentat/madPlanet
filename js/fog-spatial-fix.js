/* ============ 0.5.60 / 0.5.65: spatially coherent physical fog ============ */
/*
   A single Weather Core fog cell magnified through a cubemap can expose the
   grid. A very small neighbour blend smooths that sampling footprint before
   GPU publication, but it must not become a second fog-formation mechanism.

   0.5.65 reduces the old two-pass 24% diffusion substantially. That setting
   could repeatedly spread an already too-permissive fog field into a broad
   blanket. One 12% pass is enough to hide isolated-cell geometry while
   preserving physically clear gaps between fog banks.
*/

const FOG_SPATIAL_FIX_MODEL=1;
const FOG_SPATIAL_BLEND=0.12;
const FOG_SPATIAL_PASSES=1;

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
