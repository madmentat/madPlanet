/* ============ 0.5.69: latitude-resolved surface temperature diagnostics ============ */
/*
   The headline temperature is the global climate target. During rapid climate
   transitions the persistent Weather Core can lag that target by hours of
   model time, and a single global number says nothing about a warm equator on
   an otherwise frozen world. This module exposes the actual current surface
   field in broad latitude bands without adding any render work.
*/
const PLANET_TEMPERATURE_DIAGNOSTICS_MODEL=1;

function planetTemperatureBands(core,axis){
  if(!core?.count||!core.surfaceTemp)return {equator:NaN,temperate:NaN,polar:NaN,min:NaN,max:NaN};
  const a=(typeof weatherNorm3==='function')?weatherNorm3(axis?.[0]||0,axis?.[1]??1,axis?.[2]||0):[0,1,0];
  const sin15=0.2588190451,sin30=0.5,sin60=0.8660254038,sin75=0.9659258263;
  let eq=0,eqW=0,mid=0,midW=0,pol=0,polW=0,mn=Infinity,mx=-Infinity;
  for(let i=0;i<core.count;i++){
    const T=Number(core.surfaceTemp[i]);if(!Number.isFinite(T))continue;
    const lat=Math.abs(core.dirX[i]*a[0]+core.dirY[i]*a[1]+core.dirZ[i]*a[2]);
    const w=Math.max(1e-9,Number(core.areaWeight?.[i])||1);
    if(lat<=sin15){eq+=T*w;eqW+=w;}
    if(lat>=sin30&&lat<=sin60){mid+=T*w;midW+=w;}
    if(lat>=sin75){pol+=T*w;polW+=w;}
    mn=Math.min(mn,T);mx=Math.max(mx,T);
  }
  return {
    equator:eqW?eq/eqW:NaN,
    temperate:midW?mid/midW:NaN,
    polar:polW?pol/polW:NaN,
    min:Number.isFinite(mn)?mn:NaN,
    max:Number.isFinite(mx)?mx:NaN
  };
}
function planetTempCText(K){return Number.isFinite(K)?Math.round(K-273.15)+' °C':'—';}
function appendPlanetTempRow(body,label,key){
  const row=document.createElement('div');
  row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';
  const a=document.createElement('span');a.textContent=label;a.style.opacity='.62';
  const b=document.createElement('span');b.dataset.planettemp=key;b.style.textAlign='right';
  row.append(a,b);body.appendChild(row);
}
function refreshPlanetTemperatureDiagnostics(){
  if(typeof document==='undefined')return;
  const box=document.getElementById('planetTempDiag');if(!box)return;
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;if(!core)return;
  const axis=(typeof weatherCoreAxis==='function')?weatherCoreAxis():[0,1,0];
  const b=planetTemperatureBands(core,axis);
  const set=(k,v)=>{const e=box.querySelector('[data-planettemp="'+k+'"]');if(e)e.textContent=v;};
  set('equator',planetTempCText(b.equator));
  set('temperate',planetTempCText(b.temperate));
  set('polar',planetTempCText(b.polar));
  set('range',planetTempCText(b.min)+' … '+planetTempCText(b.max));
}

/* snowAlt no longer paints snow; the physical cryosphere does. Keep the
   legacy derived control for its remaining orographic lapse role, but stop
   presenting it as a fictitious metre-valued snow line. */
const snowAltParam=(typeof PARAMS!=='undefined')?PARAMS.find(p=>p.k==='snowAlt'):null;
if(snowAltParam)snowAltParam.label='Орографическое охлаждение';
function orographicCoolingLabel(v){
  const x=Math.max(0,Math.min(1,Number(v)||0));
  return (3.6+(0.55-3.6)*x).toFixed(2)+'×';
}
if(typeof valueText==='function'){
  const valueTextBeforeTemperatureDiagnostics=valueText;
  valueText=function(p){
    if(p?.k==='snowAlt')return orographicCoolingLabel(state.snowAlt);
    return valueTextBeforeTemperatureDiagnostics(p);
  };
}

if(typeof createPanel==='function'){
  const createPanelBeforeTemperatureDiagnostics=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeTemperatureDiagnostics(group);
    if(group==='Планета'&&!el.querySelector('#planetTempDiag')){
      const body=el.querySelector('.p-body');
      const box=document.createElement('div');box.id='planetTempDiag';
      box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--txt)';
      const title=document.createElement('div');
      title.textContent='Текущая температура поверхности';
      title.style.cssText='margin-bottom:5px;font-size:9px;letter-spacing:.10em;text-transform:uppercase;color:var(--mut)';
      box.appendChild(title);
      appendPlanetTempRow(box,'Экватор ±15°','equator');
      appendPlanetTempRow(box,'Широты 30–60°','temperate');
      appendPlanetTempRow(box,'Полюса >75°','polar');
      appendPlanetTempRow(box,'Минимум … максимум','range');
      body.appendChild(box);refreshPlanetTemperatureDiagnostics();
    }
    return el;
  };
}

/* Weather Core already refreshes once per fixed physical tick. Piggyback that
   slow cadence rather than touching DOM at render FPS. */
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeTemperatureDiagnostics=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeTemperatureDiagnostics();
    refreshPlanetTemperatureDiagnostics();
  };
}
