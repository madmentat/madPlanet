/* ============ 0.5.60/0.5.61 hotfix: weather audit diagnostics ============ */
/*
   Temporary-but-useful diagnostics for the current stabilization pass.  The
   panel values are computed only when the Weather panel refreshes, never in
   the render hot path.  They make the suspected H2O cold-trap visible without
   a profiler: warm-band RH, vapor/saturation columns, landed cryosphere and
   resolved wind can be watched over tens/hundreds of fixed ticks.

   0.5.61 also instruments the legacy global H2O normalizer without changing
   its result.  Per-call atmospheric correction (delta), signed cumulative
   correction and absolute cumulative correction tell us whether the exact
   closure step is persistently injecting/removing atmospheric water or merely
   cleaning up small symmetric numerical errors.
*/

/* Observe the existing normalizer from the outside.  The wrapper deliberately
   does not inspect its target formula and does not alter its return value: the
   measured correction is simply the atmosphere+cloud column after minus before
   the call.  This keeps the diagnostic valid if the normalizer is replaced. */
if(typeof h2oNormalizeGlobalVapor==='function'){
  const h2oNormalizeGlobalVaporBeforeWeatherAudit=h2oNormalizeGlobalVapor;
  h2oNormalizeGlobalVapor=function(core,climate){
    const canMeasure=core&&typeof condAreaMeanTotal==='function';
    const before=canMeasure?Number(condAreaMeanTotal(core)):NaN;
    const scale=h2oNormalizeGlobalVaporBeforeWeatherAudit(core,climate);
    const after=canMeasure?Number(condAreaMeanTotal(core)):NaN;
    if(core&&Number.isFinite(before)&&Number.isFinite(after)){
      const correction=after-before;
      core.h2oNormalizationScale=Number.isFinite(Number(scale))?Number(scale):NaN;
      core.h2oNormalizationCorrectionKgM2=correction;
      core.h2oNormalizationCumulativeKgM2=(Number(core.h2oNormalizationCumulativeKgM2)||0)+correction;
      core.h2oNormalizationAbsCumulativeKgM2=(Number(core.h2oNormalizationAbsCumulativeKgM2)||0)+Math.abs(correction);
      core.h2oNormalizationSamples=(Number(core.h2oNormalizationSamples)||0)+1;
    }
    return scale;
  };
}

function weatherAuditStats(core,climate){
  if(!core?.count)return null;
  const axis=(typeof weatherCoreAxis==='function')?weatherCoreAxis():[0,1,0];
  let sw=0,vap=0,sat=0,rh=0,cloud=0,fog=0,wind=0,windMax=0;
  let warmW=0,warmRH=0,polarW=0,polarStore=0,landStore=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);sw+=w;
    const v=Math.max(0,Number(core.vaporColumn?.[i])||0);
    const s=(typeof h2oSaturationColumnKgM2==='function')?Math.max(1e-9,h2oSaturationColumnKgM2(core.airTemp?.[i]||273.15,climate)):1;
    const r=Math.max(0,Number(core.relativeHumidity?.[i])||v/s);
    const c=Math.max(0,Number(core.cloudWaterState?.[i]??core.cloudWater?.[i])||0);
    const f=Math.max(0,Number(core.fogState?.[i])||0);
    const u=Number((core.windStateU||core.windU)?.[i])||0;
    const vv=Number((core.windStateV||core.windV)?.[i])||0;
    const sp=Math.hypot(u,vv);
    const snow=Math.max(0,Number(core.surfaceSnowWater?.[i])||0);
    const ice=Math.max(0,Number(core.landIceWater?.[i])||0);
    const store=snow+ice;
    vap+=w*v;sat+=w*s;rh+=w*r;cloud+=w*c;fog+=w*f;wind+=w*sp;landStore+=w*store;
    if(sp>windMax)windMax=sp;
    const sinLat=Math.abs(core.dirX[i]*axis[0]+core.dirY[i]*axis[1]+core.dirZ[i]*axis[2]);
    if(sinLat<0.72){warmW+=w;warmRH+=w*r;}
    if(sinLat>0.82){polarW+=w;polarStore+=w*store;}
  }
  const q=Math.max(1e-12,sw);
  return {
    vapor:vap/q,saturation:sat/q,rh:rh/q,cloud:cloud/q,fog:fog/q,
    warmRH:warmRH/Math.max(1e-12,warmW),wind:wind/q,windMax,
    landStore:landStore/q,polarStore:polarStore/Math.max(1e-12,polarW),
    atmosphericTarget:Number(core.precipAtmosphericTarget??core.h2oTargetColumn??NaN),
    normDelta:Number(core.h2oNormalizationCorrectionKgM2??NaN),
    normSum:Number(core.h2oNormalizationCumulativeKgM2??NaN),
    normAbs:Number(core.h2oNormalizationAbsCumulativeKgM2??NaN),
    normScale:Number(core.h2oNormalizationScale??NaN),
    normSamples:Number(core.h2oNormalizationSamples||0)
  };
}

if(typeof createPanel==='function'){
  const createPanelBeforeWeatherAudit=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeWeatherAudit(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-audit="rh"]')){
        const add=(label,key)=>{
          appendWeatherCoreRow(box,label,'audit-'+key);
          const e=box.lastElementChild?.querySelector('[data-weathercore="audit-'+key+'"]');
          if(e){delete e.dataset.weathercore;e.dataset.audit=key;}
        };
        add('RH mean / умеренные широты','rh');
        add('H₂O vapor / sat column','h2o');
        add('Cloud / fog state','cloudfog');
        add('Snow+land ice mean / poles','cryo');
        add('Wind mean / max','wind');
        add('H₂O norm Δ / Σ','norm');
      }
    }
    return el;
  };
}

if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeAudit=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeAudit();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core)return;
    const climate=(typeof weatherCoreClimateSnapshot==='function')?weatherCoreClimateSnapshot():null;
    const d=weatherAuditStats(core,climate);if(!d)return;
    const set=(k,v)=>{const e=box.querySelector('[data-audit="'+k+'"]');if(e)e.textContent=v;};
    set('rh',(100*d.rh).toFixed(0)+'% / '+(100*d.warmRH).toFixed(0)+'%');
    set('h2o',d.vapor.toFixed(1)+' / '+d.saturation.toFixed(1)+' кг/м²');
    set('cloudfog',d.cloud.toFixed(3)+' / '+d.fog.toFixed(2));
    set('cryo',d.landStore.toFixed(1)+' / '+d.polarStore.toFixed(1)+' кг/м²');
    set('wind',d.wind.toFixed(1)+' / '+d.windMax.toFixed(1)+' м/с');
    if(Number.isFinite(d.normDelta)&&Number.isFinite(d.normSum)){
      const signed=x=>(x>=0?'+':'')+x.toFixed(3);
      set('norm',signed(d.normDelta)+' / '+signed(d.normSum)+' кг/м² · |Σ| '+d.normAbs.toFixed(2));
    }else set('norm','—');
  };
}
