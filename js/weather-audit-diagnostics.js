/* ============ 0.5.60 hotfix: weather audit diagnostics ============ */
/*
   Temporary-but-useful diagnostics for the current stabilization pass.  The
   values are computed only when the Weather panel refreshes, never in the
   render hot path.  They make the suspected H2O cold-trap visible without a
   profiler: warm-band RH, vapor/saturation columns, landed cryosphere and
   resolved wind can be watched over tens/hundreds of fixed ticks.
*/

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
    atmosphericTarget:Number(core.precipAtmosphericTarget??core.h2oTargetColumn??NaN)
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
  };
}
