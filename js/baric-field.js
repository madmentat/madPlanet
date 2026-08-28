/* ============ 0.5.41: local baric anomalies ============ */
/*
   Surface pressure is column mass * gravity; temperature alone must not
   magically create or destroy pressure. A warm column first becomes less
   dense and thicker. Large-scale mass redistribution then produces thermal
   lows/highs. Until the explicit momentum/transport equation arrives in
   0.5.42, this module diagnoses that redistribution tendency while enforcing
   exact area-weighted conservation of the global atmospheric column.

   Warm regions therefore relax toward relative lows, cold regions toward
   highs, but the planet-wide mean pressure always remains the pressure set by
   the real gas inventories and gravity.
*/

const BARIC_FIELD_MODEL = 1;
const BARIC_GAS_R = 8.314462618;
const BARIC_THERMAL_COUPLING = 0.42;
const BARIC_MAX_FRACTIONAL_ANOMALY = 0.16;
const BARIC_RELAX_TAU_SEC = 2.5*3600;

function baricClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function baricAreaMean(core,field){
  if(!core||!field||!core.count) return NaN;
  let sw=0,s=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    sw+=w; s+=w*field[i];
  }
  return s/Math.max(1e-12,sw);
}
function baricMeanMolarMassKg(climate){
  if(Number.isFinite(climate?.meanMolarMassKg))
    return baricClamp(climate.meanMolarMassKg,0.001,0.200);
  if(typeof meanMolecularWeight==='function'){
    const g=meanMolecularWeight();
    if(Number.isFinite(g)&&g>0) return baricClamp(g/1000,0.001,0.200);
  }
  return 0.02897;
}
function baricGravityMS2(climate){
  if(Number.isFinite(climate?.gravityMS2)&&climate.gravityMS2>0)
    return baricClamp(climate.gravityMS2,0.05,200);
  if(typeof planetPhysics==='function'){
    const p=planetPhysics();
    if(Number.isFinite(p?.gravityMS2)&&p.gravityMS2>0) return baricClamp(p.gravityMS2,0.05,200);
  }
  return 9.80665;
}
function baricGlobalPressurePa(climate){
  return Math.max(0,Number(climate?.pressureBar)||0)*1e5;
}
function baricDensityKgM3(pPa,T,molarMassKg){
  T=baricClamp(T,40,3000);
  return Math.max(0,pPa)*baricClamp(molarMassKg,0.001,0.200)/(BARIC_GAS_R*T);
}
function baricScaleHeightM(T,molarMassKg,g){
  T=baricClamp(T,40,3000);
  return BARIC_GAS_R*T/(baricClamp(molarMassKg,0.001,0.200)*baricClamp(g,0.05,200));
}

/* Add composition/gravity to the Weather Core snapshot so the same gas column
   that defines global pressure also defines local density and scale height. */
const weatherCoreClimateSnapshotBeforeBaric=weatherCoreClimateSnapshot;
weatherCoreClimateSnapshot=function(){
  const s=weatherCoreClimateSnapshotBeforeBaric();
  s.meanMolarMassKg=baricMeanMolarMassKg(s);
  s.gravityMS2=baricGravityMS2(s);
  return s;
};

function baricComputeTargets(core,climate){
  if(!core||!core.count) return core;
  const meanP=baricGlobalPressurePa(climate);
  const meanT=baricAreaMean(core,core.airTemp);
  let sw=0,meanRaw=0;

  /* First pass: thermal redistribution tendency. The cap is deliberately
     modest; 0.5.42 momentum/transport, not this diagnostic closure, should
     create intense compact cyclones. */
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    const thermal=(core.airTemp[i]-meanT)/Math.max(80,meanT);
    const raw=baricClamp(-BARIC_THERMAL_COUPLING*thermal,
      -BARIC_MAX_FRACTIONAL_ANOMALY,BARIC_MAX_FRACTIONAL_ANOMALY);
    core.pressureTarget[i]=raw;
    sw+=w; meanRaw+=w*raw;
  }
  meanRaw/=Math.max(1e-12,sw);

  /* Re-center after the cap. This is the mass-conservation step: the weighted
     target anomaly is exactly zero, so the mean column remains meanP. */
  let targetMean=0;
  for(let i=0;i<core.count;i++){
    const frac=core.pressureTarget[i]-meanRaw;
    const p=Math.max(0,meanP*(1+frac));
    core.pressureTarget[i]=p;
    targetMean+=Math.max(1e-12,core.areaWeight?.[i]||1)*p;
  }
  targetMean/=Math.max(1e-12,sw);
  const correction=meanP-targetMean;
  for(let i=0;i<core.count;i++) core.pressureTarget[i]=Math.max(0,core.pressureTarget[i]+correction);
  return core;
}

function baricRefreshDerived(core,climate){
  const meanP=baricGlobalPressurePa(climate);
  const M=baricMeanMolarMassKg(climate);
  const g=baricGravityMS2(climate);
  for(let i=0;i<core.count;i++){
    const T=baricClamp(core.airTemp[i],40,3000);
    const p=Math.max(0,core.pressure[i]);
    core.pressureAnomaly[i]=p-meanP;
    core.airDensity[i]=baricDensityKgM3(p,T,M);
    core.scaleHeight[i]=baricScaleHeightM(T,M,g);
  }
  return core;
}

const weatherCoreCreateBeforeBaric=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeBaric(seed,N,climate,axis);
  core.baricModel=BARIC_FIELD_MODEL;
  core.pressureTarget=new Float32Array(core.count);
  core.pressureAnomaly=new Float32Array(core.count);
  core.airDensity=new Float32Array(core.count);
  core.scaleHeight=new Float32Array(core.count);
  baricComputeTargets(core,climate);
  for(let i=0;i<core.count;i++) core.pressure[i]=core.pressureTarget[i];
  baricRefreshDerived(core,climate);
  return core;
};

const weatherCoreStepBeforeBaric=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeBaric(core,dtSec,climate,axis);
  const dt=weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC);
  baricComputeTargets(core,climate);
  const a=1-Math.exp(-dt/BARIC_RELAX_TAU_SEC);
  for(let i=0;i<core.count;i++)
    core.pressure[i]+=(core.pressureTarget[i]-core.pressure[i])*a;

  /* Global inventory/pressure changes apply to the whole column immediately;
     only spatial anomalies have the multi-hour relaxation. Correcting the
     weighted mean here also prevents numerical pressure drift over long runs. */
  const meanP=baricGlobalPressurePa(climate);
  const currentMean=baricAreaMean(core,core.pressure);
  const shift=meanP-currentMean;
  for(let i=0;i<core.count;i++) core.pressure[i]=Math.max(0,core.pressure[i]+shift);
  baricRefreshDerived(core,climate);
  return core;
};

const weatherCoreFiniteBeforeBaric=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeBaric(core)) return false;
  for(const k of ['pressureTarget','pressureAnomaly','airDensity','scaleHeight']){
    const a=core?.[k]; if(!a||a.length!==core.count) return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])) return false;
  }
  return true;
};

function baricDiagnostics(core){
  if(!core||!core.count) return {mean:NaN,min:NaN,max:NaN,minAnom:NaN,maxAnom:NaN,density:NaN,scale:NaN};
  let min=Infinity,max=-Infinity,minA=Infinity,maxA=-Infinity,sw=0,rho=0,H=0;
  for(let i=0;i<core.count;i++){
    const p=core.pressure[i],a=core.pressureAnomaly[i];
    if(p<min)min=p;if(p>max)max=p;if(a<minA)minA=a;if(a>maxA)maxA=a;
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    sw+=w;rho+=w*core.airDensity[i];H+=w*core.scaleHeight[i];
  }
  return {mean:baricAreaMean(core,core.pressure),min,max,minAnom:minA,maxAnom:maxA,
    density:rho/Math.max(1e-12,sw),scale:H/Math.max(1e-12,sw)};
}
function baricPressureText(pa){
  const hpa=pa/100;
  if(Math.abs(hpa)>=100) return hpa.toFixed(0)+' hPa';
  if(Math.abs(hpa)>=10) return hpa.toFixed(1)+' hPa';
  return hpa.toFixed(2)+' hPa';
}

if(typeof createPanel==='function'){
  const createPanelBeforeBaric=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeBaric(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-baric="pressure"]')){
        appendWeatherCoreRow(box,'Давление min / max','baric-pressure');
        const r1=box.lastElementChild?.querySelector('[data-weathercore="baric-pressure"]');
        if(r1){delete r1.dataset.weathercore;r1.dataset.baric='pressure';}
        appendWeatherCoreRow(box,'Барическая аномалия','baric-anomaly');
        const r2=box.lastElementChild?.querySelector('[data-weathercore="baric-anomaly"]');
        if(r2){delete r2.dataset.weathercore;r2.dataset.baric='anomaly';}
        appendWeatherCoreRow(box,'Средняя плотность воздуха','baric-density');
        const r3=box.lastElementChild?.querySelector('[data-weathercore="baric-density"]');
        if(r3){delete r3.dataset.weathercore;r3.dataset.baric='density';}
        appendWeatherCoreRow(box,'Scale height','baric-scale');
        const r4=box.lastElementChild?.querySelector('[data-weathercore="baric-scale"]');
        if(r4){delete r4.dataset.weathercore;r4.dataset.baric='scale';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeBaric=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeBaric();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag'); if(!box) return;
    const core=weatherCoreEnsure(); if(!core||!core.pressureAnomaly) return;
    const d=baricDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-baric="'+k+'"]');if(e)e.textContent=v;};
    set('pressure',baricPressureText(d.min)+' / '+baricPressureText(d.max));
    set('anomaly',(d.minAnom<=0?'':' +')+baricPressureText(d.minAnom)+' / '+(d.maxAnom>=0?'+':'')+baricPressureText(d.maxAnom));
    set('density',d.density.toFixed(3)+' кг/м³');
    set('scale',(d.scale/1000).toFixed(1)+' км');
  };
}
