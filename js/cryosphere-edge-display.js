/* ============ 0.5.79: crisp irregular continental ice margins ============ */
/*
   Physics keeps continuous snow/land-ice coverage. Display should not render
   that continuous fraction as a translucent white fog bank, especially in a
   close mobile view. cryosphere-gpu already reconstructs a seamless 5x field;
   replace only the LAND display transfer with a narrow, seed-stable sub-cell
   threshold. Sea pack ice keeps its gradual concentration behaviour.

   The threshold itself wanders with cryoGpuEdgeNoise, so the cap grows bays,
   tongues and embayments instead of a ruler-smooth contour. Dense ice remains
   exactly opaque and zero physical cover remains exactly zero visible ice.
*/

const CRYOSPHERE_EDGE_DISPLAY_MODEL=1;
const cryoGpuVisualCoverageBeforeCrispLand=cryoGpuVisualCoverage;
cryoGpuVisualCoverage=function(raw,edgeNoise,sea){
  if(sea)return cryoGpuVisualCoverageBeforeCrispLand(raw,edgeNoise,true);
  raw=Math.max(0,Math.min(1,Number(raw)||0));
  edgeNoise=Math.max(0,Math.min(1,Number(edgeNoise)||0.5));
  if(raw<=0.015)return 0;
  if(raw>=0.62)return 1;
  /* Wide geographic displacement, narrow optical transition. This moves the
     edge rather than blurring it: neighbouring sub-cells become ice OR land
     over a small coverage interval instead of all becoming semi-transparent. */
  const threshold=0.33+(edgeNoise-0.5)*0.46;
  return cryoGpuSmooth(threshold-0.024,threshold+0.024,raw);
};
