/* ============ 0.5.123: publish visible/radiating surface skin temperature ============ */
/* fog-gpu.js historically packed core.surfaceTemp into cubemap A. That field is
   authoritative SST over ocean, so sea ice looked artificially close to its
   -1.8 C basal water temperature in the Thermal Imager. Keep the exact packed
   temperature format, but prefer the new surfaceSkinTemp when it is available. */
if(typeof fogGpuSurfaceTemp01==='function'){
  fogGpuSurfaceTemp01=function(core,i){
    const skin=Number(core?.surfaceSkinTemp?.[i]);
    const raw=Number.isFinite(skin)?skin:Number(core?.surfaceTemp?.[i]);
    const T=Number.isFinite(raw)?raw:273.15;
    if(T<SURFACE_TEMP_GPU_NORMAL_MIN_K){
      const q=Math.max(0,Math.min(1,(T-SURFACE_TEMP_GPU_COLD_MIN_K)/(SURFACE_TEMP_GPU_NORMAL_MIN_K-SURFACE_TEMP_GPU_COLD_MIN_K)));
      return SURFACE_TEMP_GPU_COLD_EDGE*q;
    }
    if(T<=SURFACE_TEMP_GPU_NORMAL_MAX_K){
      const q=(T-SURFACE_TEMP_GPU_NORMAL_MIN_K)/(SURFACE_TEMP_GPU_NORMAL_MAX_K-SURFACE_TEMP_GPU_NORMAL_MIN_K);
      return SURFACE_TEMP_GPU_COLD_EDGE+(SURFACE_TEMP_GPU_HOT_EDGE-SURFACE_TEMP_GPU_COLD_EDGE)*Math.max(0,Math.min(1,q));
    }
    const q=Math.max(0,Math.min(1,(T-SURFACE_TEMP_GPU_NORMAL_MAX_K)/(SURFACE_TEMP_GPU_HOT_MAX_K-SURFACE_TEMP_GPU_NORMAL_MAX_K)));
    return SURFACE_TEMP_GPU_HOT_EDGE+(1-SURFACE_TEMP_GPU_HOT_EDGE)*q;
  };
}
