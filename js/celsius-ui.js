/* ============ 0.5.134: user-facing temperature units + Ta/Tf telemetry ============ */
/*
   Physics remains Kelvin internally. This late UI adapter converts every
   temperature value currently exposed by the Planet/Weather diagnostics to
   Celsius, so the program no longer mixes K and °C in user-facing readouts.

   The compact top-left thermometer deliberately exposes two different facts:
     - T_a: CURRENT area-weighted Weather Core surface temperature;
     - T_f: forecast/equilibrium temperature of climateModel().
   T_a is initialized from Weather Core on the first rendered frame and is
   coloured with the same visual scale as the thermal imager. T_f stays
   visually secondary so a radiative attractor can never masquerade as an
   observation again.
*/
(function installCelsiusUi(){
  if(typeof document==='undefined')return;

  function celsiusFromK(K){return Number(K)-273.15;}
  function celsiusTextFromK(K,digits=1,forceSign=false){
    const C=celsiusFromK(K);
    if(!Number.isFinite(C))return '—';
    const sign=forceSign&&C>=0?'+':'';
    return sign+C.toFixed(digits)+' °C';
  }
  function deltaCText(d,digits=1){
    d=Number(d);if(!Number.isFinite(d))return '—';
    return 'Δ '+(d>=0?'+':'')+d.toFixed(digits)+' °C';
  }

  /* Match the thermal-imager legend rather than inventing a second colour
     language. The label positions are intentionally nonlinear so ordinary
     climate temperatures keep useful colour resolution while lava still fits. */
  const TELEMETRY_TEMP_POS=[[-100,0],[-50,.28],[0,.53],[50,.77],[1200,1]];
  const TELEMETRY_TEMP_RGB=[[0,[20,3,38]],[.20,[20,31,158]],[.42,[0,194,230]],[.64,[250,230,31]],[.84,[245,46,8]],[1,[255,247,229]]];
  function temperatureTelemetryPosition(C){
    C=Number(C);if(!Number.isFinite(C))return NaN;
    if(C<=TELEMETRY_TEMP_POS[0][0])return 0;
    for(let i=1;i<TELEMETRY_TEMP_POS.length;i++){
      const a=TELEMETRY_TEMP_POS[i-1],b=TELEMETRY_TEMP_POS[i];
      if(C<=b[0]){const u=(C-a[0])/Math.max(1e-9,b[0]-a[0]);return a[1]+(b[1]-a[1])*u;}
    }
    return 1;
  }
  function temperatureTelemetryRgb(C){
    const p=temperatureTelemetryPosition(C);if(!Number.isFinite(p))return null;
    for(let i=1;i<TELEMETRY_TEMP_RGB.length;i++){
      const a=TELEMETRY_TEMP_RGB[i-1],b=TELEMETRY_TEMP_RGB[i];
      if(p<=b[0]){
        const u=(p-a[0])/Math.max(1e-9,b[0]-a[0]);
        return a[1].map((x,k)=>Math.round(x+(b[1][k]-x)*u));
      }
    }
    return TELEMETRY_TEMP_RGB[TELEMETRY_TEMP_RGB.length-1][1].slice();
  }
  function temperatureTelemetryColour(C){const q=temperatureTelemetryRgb(C);return q?'rgb('+q.join(',')+')':'rgba(226,235,248,.88)';}
  function temperatureTelemetryGlow(C){const q=temperatureTelemetryRgb(C);return q?'0 0 8px rgba('+q.join(',')+',.48),0 1px 8px rgba(0,0,0,.8)':'0 1px 8px rgba(0,0,0,.75)';}

  function temperatureTelemetrySubLabel(label,index){
    if(!label)return;
    label.replaceChildren(document.createTextNode('T'));
    const sub=document.createElement('sub');sub.textContent=index;sub.style.cssText='font-size:.72em;line-height:0;vertical-align:-.22em';label.appendChild(sub);
  }
  function temperatureTelemetryEnsure(){
    if(typeof smoothTelemetryEnsure!=='function'||typeof smoothTelemetryValues==='undefined')return null;
    const box=smoothTelemetryEnsure();if(!box||!smoothTelemetryValues?.temp)return null;
    const current=smoothTelemetryValues.temp,currentLabel=current.previousElementSibling;
    temperatureTelemetrySubLabel(currentLabel,'a');
    if(currentLabel){currentLabel.title='Tₐ — актуальная средняя температура поверхности';currentLabel.style.opacity='.92';}
    current.style.fontWeight='700';current.style.fontSize='9px';current.style.letterSpacing='.055em';

    let forecast=smoothTelemetryValues.forecast;
    if(!forecast||!forecast.isConnected){
      const label=document.createElement('span');temperatureTelemetrySubLabel(label,'f');label.title='T_f — ожидаемая температура установившегося климатического режима';label.style.cssText='opacity:.46;font-size:7.5px';
      forecast=document.createElement('b');forecast.dataset.live='forecastTemp';forecast.textContent='—';forecast.style.cssText='font-weight:500;color:rgba(168,180,199,.58);text-align:right;font-variant-numeric:tabular-nums;font-size:7.5px';
      const starValue=smoothTelemetryValues.star,starLabel=starValue?.previousElementSibling||null;
      box.insertBefore(label,starLabel);box.insertBefore(forecast,starLabel);
      smoothTelemetryValues.forecast=forecast;
    }
    return box;
  }
  function temperatureTelemetryFormat(C){
    C=Number(C);if(!Number.isFinite(C))return '—';
    const a=Math.abs(C),digits=a<100?1:0;return (C>=0?'+':'−')+a.toFixed(digits)+' °C';
  }
  function temperatureTelemetryRefresh(forceCore=false){
    if(!temperatureTelemetryEnsure())return;
    let actual=NaN;
    if(typeof climateConsistencyCurrentSurfaceC==='function')actual=Number(climateConsistencyCurrentSurfaceC());
    /* Weather Core is normally lazy. Force it only from the post-first-frame
       bootstrap below: normal telemetry refreshes must never turn into an
       unexpected physics allocation. */
    if(forceCore&&typeof weatherCoreEnsure==='function'){
      try{weatherCoreEnsure();}catch(_e){}
      if(typeof climateConsistencyCurrentSurfaceC==='function')actual=Number(climateConsistencyCurrentSurfaceC());
    }
    let forecast=NaN;try{forecast=Number(climateModel()?.C);}catch(_e){}
    const set=(el,text)=>{if(typeof smoothTelemetryText==='function')smoothTelemetryText(el,text);else if(el&&el.textContent!==text)el.textContent=text;};
    const current=smoothTelemetryValues?.temp,predicted=smoothTelemetryValues?.forecast;
    set(current,temperatureTelemetryFormat(actual));
    if(current){
      current.style.color=temperatureTelemetryColour(actual);
      current.style.textShadow=temperatureTelemetryGlow(actual);
      current.title='Tₐ — текущая area-weighted температура поверхности'+(Number.isFinite(forecast)?'; ожидаемая T_f '+temperatureTelemetryFormat(forecast):'');
    }
    set(predicted,temperatureTelemetryFormat(forecast));
    if(predicted)predicted.title='T_f — ожидаемая температура установившегося климатического режима; не текущая температура';
  }

  if(typeof refreshClimateDiagnostics==='function'){
    const beforeClimate=refreshClimateDiagnostics;
    refreshClimateDiagnostics=function(){
      beforeClimate();
      const e=document.querySelector('#climateRegimeDiag [data-climate="temp"]');
      if(e&&typeof climateModel==='function'){
        const c=climateModel();
        e.textContent=celsiusTextFromK(c.T,1,false);
        const label=e.parentElement?.querySelector('span');if(label)label.textContent='Ожидаемая T_f режима';
      }
      const current=document.querySelector('[data-climate-consistency="current"]');
      if(current){const label=current.parentElement?.querySelector('span');if(label)label.textContent='Текущая Tₐ поверхности';}
    };
  }

  if(typeof refreshWeatherCoreDiagnostics==='function'){
    const beforeWeather=refreshWeatherCoreDiagnostics;
    refreshWeatherCoreDiagnostics=function(){
      beforeWeather();
      const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
      if(!core)return;
      const box=document.getElementById('weatherCoreDiag');
      if(box){
        const air=box.querySelector('[data-weathercore="temp"]');
        if(air&&typeof weatherCoreMeans==='function'){
          const m=weatherCoreMeans(core);
          air.textContent=celsiusTextFromK(m.T,1,false);
        }
        const depth=box.querySelector('[data-oceanthermal="depth"]');
        if(depth&&typeof oceanDiagnostics==='function'){
          const d=oceanDiagnostics(core);
          depth.textContent=d.depth.toFixed(0)+' м · '+deltaCText(d.contrast,1);
        }
      }
      temperatureTelemetryRefresh(false);
    };
  }

  let temperatureTelemetryLastMs=-1e12;
  if(typeof smoothTelemetryUpdate==='function'){
    const beforeTelemetry=smoothTelemetryUpdate;
    smoothTelemetryUpdate=function(now){
      beforeTelemetry(now);
      const t=Number(now)||((typeof performance!=='undefined')?performance.now():Date.now());
      if(t-temperatureTelemetryLastMs<250)return;
      temperatureTelemetryLastMs=t;temperatureTelemetryRefresh(false);
    };
  }

  /* Build the labels and T_f synchronously, but do not put Weather Core work
     in front of the first renderer frame. render.js registered its RAF much
     earlier in the concatenated script, so this callback runs after that first
     draw and before the browser paints the frame in normal RAF ordering. T_a
     therefore becomes real for the first visible frame without delaying it. */
  temperatureTelemetryRefresh(false);
  const bootstrapActual=()=>temperatureTelemetryRefresh(true);
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(bootstrapActual);
  else if(typeof setTimeout==='function')setTimeout(bootstrapActual,0);
  else bootstrapActual();

  window.__madPlanetTemperatureUnits={celsiusFromK,celsiusTextFromK,deltaCText,unit:'°C',temperatureColour:temperatureTelemetryColour};
  window.__madPlanetTemperatureTelemetry={refresh:temperatureTelemetryRefresh,position:temperatureTelemetryPosition,rgb:temperatureTelemetryRgb};
})();