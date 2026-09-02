/* ============ 0.5.120: user-facing temperature units ============ */
/*
   Physics remains Kelvin internally. This late UI adapter converts every
   temperature value currently exposed by the Planet/Weather diagnostics to
   Celsius, so the program no longer mixes K and °C in user-facing readouts.
   Temperature differences keep the same numeric magnitude and only change the
   unit label, as Δ1 K == Δ1 °C.
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

  if(typeof refreshClimateDiagnostics==='function'){
    const beforeClimate=refreshClimateDiagnostics;
    refreshClimateDiagnostics=function(){
      beforeClimate();
      const e=document.querySelector('#climateRegimeDiag [data-climate="temp"]');
      if(e&&typeof climateModel==='function'){
        const c=climateModel();
        e.textContent=celsiusTextFromK(c.T,1,false);
      }
    };
  }

  if(typeof refreshWeatherCoreDiagnostics==='function'){
    const beforeWeather=refreshWeatherCoreDiagnostics;
    refreshWeatherCoreDiagnostics=function(){
      beforeWeather();
      const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
      if(!core)return;
      const box=document.getElementById('weatherCoreDiag');if(!box)return;
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
    };
  }

  window.__madPlanetTemperatureUnits={celsiusFromK,celsiusTextFromK,deltaCText,unit:'°C'};
})();
