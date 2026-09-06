/* ============ 0.5.54: bind double-buffered Weather Core cloud influence ============ */
let weatherCloudBoundProgram=null;
function weatherCloudBindForFrame(now){
  if(!prog||typeof weatherCloudGpuEnsureCurrent!=='function')return;
  weatherCloudGpuEnsureCurrent();
  if(!weatherCloudGpuTex||!weatherCloudGpuTexPrev)return;

  gl.activeTexture(gl.TEXTURE0+WEATHER_CLOUD_TEX_PREV_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,weatherCloudGpuTexPrev);
  gl.activeTexture(gl.TEXTURE0+WEATHER_CLOUD_TEX_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,weatherCloudGpuTex);
  gl.activeTexture(gl.TEXTURE0);

  if(weatherCloudBoundProgram!==prog){
    gl.useProgram(prog);
    if(U.uWeatherCloudTex!==null&&U.uWeatherCloudTex!==undefined)
      gl.uniform1i(U.uWeatherCloudTex,WEATHER_CLOUD_TEX_UNIT);
    if(U.uWeatherCloudTexPrev!==null&&U.uWeatherCloudTexPrev!==undefined)
      gl.uniform1i(U.uWeatherCloudTexPrev,WEATHER_CLOUD_TEX_PREV_UNIT);
    weatherCloudBoundProgram=prog;
  }
  if(U.uWeatherCloudBlend!==null&&U.uWeatherCloudBlend!==undefined){
    gl.useProgram(prog);
    gl.uniform1f(U.uWeatherCloudBlend,weatherCloudGpuBlendAt(Number(now)||weatherCloudNowMs()));
  }
}

const drawFrameBeforeWeatherCloudRender=drawFrame;
drawFrame=function(now){
  weatherCloudBindForFrame(now);
  drawFrameBeforeWeatherCloudRender(now);
};

/* 0.5.163 weather display hotfix.
   T_a is the area-weighted CURRENT Weather Core surface temperature. The
   Celsius adapter normally obtains it through climateConsistencyCurrentSurfaceC,
   but that adapter intentionally returns NaN when the core is not yet matched
   to the current seed. The first-frame/seed-change race could therefore leave
   the compact T_a readout at '—' indefinitely. Keep the public adapter's
   semantics, but give it a direct Weather Core fallback.
*/
if(typeof climateConsistencyCurrentSurfaceC==='function'){
  const weatherDisplayOriginalSurfaceC=climateConsistencyCurrentSurfaceC;
  climateConsistencyCurrentSurfaceC=function(){
    let value=NaN;
    try{value=Number(weatherDisplayOriginalSurfaceC());}catch(_e){}
    if(Number.isFinite(value))return value;
    try{
      const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
      if(core?.count){
        const field=(core.surfaceSkinTemp&&core.surfaceSkinTemp.length===core.count)?core.surfaceSkinTemp:core.surfaceTemp;
        if(field&&field.length===core.count){
          let sum=0,sw=0;
          for(let i=0;i<core.count;i++){
            const K=Number(field[i]);if(!Number.isFinite(K))continue;
            const w=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
            sum+=K*w;sw+=w;
          }
          if(sw>0)return sum/sw-273.15;
        }
      }
    }catch(_e){}
    return NaN;
  };
}

/* The Weather Core visual influence is intentionally inertial, but a strongly
   negative low-cloud influence can make the mature low deck effectively vanish
   for an entire world. Keep the physical field untouched and impose only a
   display floor on the low-layer signed influence. This preserves clear areas
   while preventing the default low layer from collapsing to zero everywhere.
*/
if(typeof weatherCloudGpuPackFace==='function'){
  const weatherCloudPackOriginal=weatherCloudGpuPackFace;
  const WEATHER_LOW_INFLUENCE_FLOOR=-0.55;
  const WEATHER_LOW_FLOOR_BYTE=Math.round((0.5+0.5*WEATHER_LOW_INFLUENCE_FLOOR)*255);
  weatherCloudGpuPackFace=function(core,face){
    const pix=weatherCloudPackOriginal(core,face);
    if(pix&&pix.length){
      for(let i=0;i<pix.length;i+=4)if(pix[i]<WEATHER_LOW_FLOOR_BYTE)pix[i]=WEATHER_LOW_FLOOR_BYTE;
    }
    return pix;
  };
  if(typeof window!=='undefined')window.__madPlanetWeatherDisplayHotfix={model:1,lowInfluenceFloor:WEATHER_LOW_INFLUENCE_FLOOR};
}
