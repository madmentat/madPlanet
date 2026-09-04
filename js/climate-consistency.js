/* ============ 0.5.133: observed climate + stellar forcing / escape ============ */
/* climateModel().T remains a radiative equilibrium target.  Current UI,
   atmospheric diagnostics and H2O phase partition use the area-weighted
   persistent Weather Core instead. */
const CLIMATE_CONSISTENCY_MODEL=2;
const CLIMATE_CONSISTENCY_SETTLE_MIN_STEPS=8;
const CLIMATE_CONSISTENCY_SETTLE_MAX_STEPS=28;
const STELLAR_ESCAPE_MODEL=1;
const STELLAR_ESCAPE_EARTH_RADIUS_M=6.371e6;
const STELLAR_ESCAPE_EARTH_MASS_KG=5.9722e24;
const STELLAR_ESCAPE_EARTH_ATMOSPHERE_KG=5.1480e18;
const STELLAR_ESCAPE_EARTH_OCEAN_KG=1.386e21;
const STELLAR_ESCAPE_G=6.67430e-11;
const STELLAR_ESCAPE_SEC_GYR=365.25*86400*1e9;
const STELLAR_ESCAPE_SOLAR_XUV_W_M2=0.00464;
const STELLAR_ESCAPE_SOLAR_WIND_NPA=2.0;
const STELLAR_ESCAPE_SOLAR_WIND_KMS=450.0;
const STELLAR_ESCAPE_ACTIVITY_PIVOT=0.62;

function climateConsistencyClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function climateConsistencyWeightedFieldStats(core,field){
  if(!core?.count||!field||field.length!==core.count)return {mean:NaN,min:NaN,max:NaN,count:0};
  let sw=0,s=0,mn=Infinity,mx=-Infinity,n=0;
  for(let i=0;i<core.count;i++){
    const x=Number(field[i]);if(!Number.isFinite(x))continue;
    const w=Math.max(1e-12,Number(core.areaWeight?.[i])||1);
    sw+=w;s+=w*x;mn=Math.min(mn,x);mx=Math.max(mx,x);n++;
  }
  return {mean:sw>0?s/sw:NaN,min:Number.isFinite(mn)?mn:NaN,max:Number.isFinite(mx)?mx:NaN,count:n};
}
function climateConsistencySurfaceStats(core){
  if(!core?.count)return {meanK:NaN,minK:NaN,maxK:NaN,count:0};
  const f=(core.surfaceSkinTemp&&core.surfaceSkinTemp.length===core.count)?core.surfaceSkinTemp:core.surfaceTemp;
  const q=climateConsistencyWeightedFieldStats(core,f);
  return {meanK:q.mean,minK:q.min,maxK:q.max,count:q.count};
}
function climateConsistencyCurrentCore(){
  if(typeof weatherCore==='undefined'||!weatherCore)return null;
  if(typeof state!=='undefined'&&Number(weatherCore.seed)!==(state.seed|0))return null;
  return weatherCore;
}
function climateConsistencyCurrentSurfaceMeanK(){return climateConsistencySurfaceStats(climateConsistencyCurrentCore()).meanK;}
function climateConsistencyCurrentSurfaceC(){const K=climateConsistencyCurrentSurfaceMeanK();return Number.isFinite(K)?K-273.15:NaN;}
function climateConsistencyCurrentAirStats(){const c=climateConsistencyCurrentCore();return climateConsistencyWeightedFieldStats(c,c?.airTemp);}
function climateConsistencyCurrentAirMeanK(){return climateConsistencyCurrentAirStats().mean;}

if(typeof waterTemperatureK==='function'){
  const before=waterTemperatureK;
  waterTemperatureK=function(){const K=climateConsistencyCurrentSurfaceMeanK();return Number.isFinite(K)?climateConsistencyClamp(K,120,900):before();};
}
if(typeof settleWaterEquilibriumImmediate==='function'){
  const before=settleWaterEquilibriumImmediate;
  settleWaterEquilibriumImmediate=function(iterations=5){
    const lim=Math.max(CLIMATE_CONSISTENCY_SETTLE_MIN_STEPS,Math.min(CLIMATE_CONSISTENCY_SETTLE_MAX_STEPS,Math.max(1,Math.round(Number(iterations)||5))*4));
    let out=null,prevT=NaN,prevV=NaN;
    for(let i=0;i<lim;i++){
      out=before(1);let T=NaN;try{T=Number(climateModel()?.T);}catch(_e){}const V=Math.max(0,Number(state?.gasH2O)||0);
      if(i>=4&&Number.isFinite(T)&&Number.isFinite(prevT)&&Math.abs(T-prevT)<0.03&&Math.abs(V-prevV)/Math.max(1,Math.abs(V))<2e-6)break;
      prevT=T;prevV=V;
    }
    return out;
  };
}
if(typeof generateCityReadyRandomWorld==='function'){
  const before=generateCityReadyRandomWorld;
  generateCityReadyRandomWorld=function(randomSource=Math.random){
    const r=before(randomSource);if(typeof settleWaterEquilibriumImmediate==='function')settleWaterEquilibriumImmediate(6);
    if(typeof weatherCoreEnsure==='function')weatherCoreEnsure();if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();
    return typeof climateModel==='function'?climateModel():r;
  };
}

/* Every displayed "mean" now samples the same physical fields. */
const tempParam=(typeof PARAMS!=='undefined')?PARAMS.find(p=>p.k==='temp'):null;
if(tempParam)tempParam.label='Средняя T поверхности';
if(typeof tempLabel==='function'){
  const before=tempLabel;
  tempLabel=function(v){const C=climateConsistencyCurrentSurfaceC();if(!Number.isFinite(C))return before(v);const a=Math.abs(C);return (C>=0?'+':'−')+a.toFixed(a<100?1:0)+' °C';};
}
if(typeof weatherCoreMeans==='function'){
  weatherCoreMeans=function(core){
    if(!core?.count)return {T:NaN,RH:NaN,cloud:NaN};
    return {T:climateConsistencyWeightedFieldStats(core,core.airTemp).mean,
      RH:climateConsistencyWeightedFieldStats(core,core.humidity).mean,
      cloud:climateConsistencyWeightedFieldStats(core,core.cloudWater).mean};
  };
}
if(typeof atmosphereTemperatureK==='function'){
  const before=atmosphereTemperatureK;
  atmosphereTemperatureK=function(){const K=climateConsistencyCurrentAirMeanK();return Number.isFinite(K)?climateConsistencyClamp(K,80,3000):before();};
}
if(typeof relaxDerived==='function'){
  const before=relaxDerived;
  relaxDerived=function(dtSec){
    let moved=!!before(dtSec);const C=climateConsistencyCurrentSurfaceC();
    if(Number.isFinite(C)&&typeof tempToSlider==='function'&&typeof state!=='undefined'){
      const v=tempToSlider(C);if(Number.isFinite(v)&&Math.abs((Number(state.temp)||0)-v)>1e-7){state.temp=v;moved=true;}
    }
    return moved;
  };
}

function stellarEscapeSmooth(a,b,x){const u=climateConsistencyClamp((Number(x)-a)/(b-a),0,1);return u*u*(3-2*u);}
function stellarEscapeLogLerp(a,b,u){return Math.exp(Math.log(Math.max(1e-12,a))*(1-u)+Math.log(Math.max(1e-12,b))*u);}
const STELLAR_ESCAPE_ANCHORS=Object.freeze([
  {x:0.00,wind:1.2,speed:350,xuv:0.08},{x:0.17,wind:0.8,speed:400,xuv:0.30},
  {x:0.43,wind:1.0,speed:450,xuv:1.00},{x:0.57,wind:2.0,speed:600,xuv:3.00},
  {x:0.71,wind:5.0,speed:750,xuv:8.00},{x:0.86,wind:5e4,speed:1200,xuv:5e3},
  {x:1.00,wind:5e7,speed:2200,xuv:5e5}
]);
function stellarEscapeAnchor(x){
  x=climateConsistencyClamp(x,0,1);
  for(let i=0;i<STELLAR_ESCAPE_ANCHORS.length-1;i++){
    const a=STELLAR_ESCAPE_ANCHORS[i],b=STELLAR_ESCAPE_ANCHORS[i+1];if(x>b.x)continue;
    const u=(x-a.x)/Math.max(1e-9,b.x-a.x);return {wind:stellarEscapeLogLerp(a.wind,b.wind,u),speed:a.speed+(b.speed-a.speed)*u,xuv:stellarEscapeLogLerp(a.xuv,b.xuv,u)};
  }
  return {...STELLAR_ESCAPE_ANCHORS[STELLAR_ESCAPE_ANCHORS.length-1]};
}
function stellarEscapeEventMultiplier(v){
  const x=climateConsistencyClamp(v,0,1),p=STELLAR_ESCAPE_ACTIVITY_PIVOT;
  if(x<=p)return Math.exp(Math.log(0.35)*(1-x/Math.max(1e-9,p)));
  return Math.exp(Math.log(8)*(x-p)/Math.max(1e-9,1-p));
}
function stellarEscapeAgeActivity(st){
  const age=(typeof planetAgeGyr==='function'&&typeof state!=='undefined')?Math.max(0.03,planetAgeGyr(state.planetAge)):4.57;
  if((Number(st?.T)||5772)>=8000)return 1;
  const M=Math.max(0.08,Number(st?.M)||1),sat=climateConsistencyClamp(0.08/(M*M),0.08,2.5),boost=Math.pow(Math.max(0.2,1/M),0.28);
  return age<=sat?climateConsistencyClamp(60*boost,1,100):climateConsistencyClamp(Math.pow(4.57/age,1.25)*boost,0.08,100);
}
function stellarEscapeOrbitalState(){
  const st=(typeof starPhysics==='function'&&typeof state!=='undefined')?starPhysics(state.star,state.luminosity):{T:5772,L:1,M:1,lumMult:1};
  const a=(typeof orbitDistanceAU==='function'&&typeof state!=='undefined')?Math.max(1e-5,orbitDistanceAU(state.distance)):1;
  const core=climateConsistencyCurrentCore(),r=Number.isFinite(Number(core?.orbitalDistanceAU))?Math.max(1e-5,Number(core.orbitalDistanceAU)):a;
  const flux=(L,d)=>(typeof orbitalFluxEarth==='function')?orbitalFluxEarth(L,d):L/(d*d);
  const S=flux(st.L,r),SMean=flux(st.L,a);return {st,a,r,S,SMean,fluxFactor:S/Math.max(1e-12,SMean)};
}
function stellarEscapeWeatherForcingCheck(){
  const o=stellarEscapeOrbitalState(),core=climateConsistencyCurrentCore();let meanIncoming=NaN,inferredS=NaN,error=NaN;
  if(core?.insolation?.length===core?.count){meanIncoming=climateConsistencyWeightedFieldStats(core,core.insolation).mean;if(Number.isFinite(meanIncoming)){inferredS=4*meanIncoming/1361;error=100*(inferredS-o.S)/Math.max(1e-9,o.S);}}
  return {...o,meanIncoming,inferredS,error};
}
function stellarEscapeMagneticMomentRel(){if(typeof state==='undefined')return 1;const x=climateConsistencyClamp(state.magnet,0,1);return x<0.005?0:climateConsistencyClamp(Math.pow(x/0.52,2),0.005,12);}
function stellarEscapeModel(){
  const o=stellarEscapeOrbitalState(),st=o.st,p=(typeof planetPhysics==='function')?planetPhysics():{radiusEarth:1,massEarth:1,surfaceAreaEarth:1,ageGyr:4.57};
  const a=stellarEscapeAnchor(typeof state!=='undefined'?state.star:0.43),ageActivity=stellarEscapeAgeActivity(st),event=stellarEscapeEventMultiplier(typeof state!=='undefined'?state.aurora:STELLAR_ESCAPE_ACTIVITY_PIVOT);
  const lumMult=Math.max(0.02,Number(st?.lumMult)||1),hot=(Number(st?.T)||5772)>=8000;
  const massLossRel=hot?a.wind*Math.pow(lumMult,1.5)*Math.pow(event,0.35):a.wind*Math.pow(ageActivity,0.65)*Math.pow(lumMult,0.55)*event;
  const windSpeedKms=a.speed*(0.92+0.08*Math.sqrt(event));
  const windPressureRel=massLossRel*(windSpeedKms/STELLAR_ESCAPE_SOLAR_WIND_KMS)/(o.r*o.r),windPressureNPa=STELLAR_ESCAPE_SOLAR_WIND_NPA*windPressureRel;
  const xuvLumRel=hot?a.xuv*Math.pow(lumMult,1.2):a.xuv*ageActivity*Math.pow(lumMult,0.9),xuvFluxRel=xuvLumRel/(o.r*o.r),xuvFluxWm2=STELLAR_ESCAPE_SOLAR_XUV_W_M2*xuvFluxRel;
  const momentRel=stellarEscapeMagneticMomentRel(),magnetopauseRp=momentRel<=0?1.05:climateConsistencyClamp(10*Math.pow((momentRel*momentRel)/Math.max(1e-12,windPressureRel),1/6),1.05,80);
  const windTransmission=momentRel<=0?1:climateConsistencyClamp(1/(1+0.70*(magnetopauseRp-1)),0.015,1);
  const Rp=STELLAR_ESCAPE_EARTH_RADIUS_M*Math.max(0.05,Number(p.radiusEarth)||1),Mp=STELLAR_ESCAPE_EARTH_MASS_KG*Math.max(1e-5,Number(p.massEarth)||1);
  const energyLimitedKgS=0.10*Math.PI*xuvFluxWm2*Math.pow(Rp,3)/(STELLAR_ESCAPE_G*Mp);
  const totalInv=(typeof gasInventoryTotal==='function')?Math.max(1e-15,gasInventoryTotal()):1;
  const hhe=Math.max(0,Number(typeof state!=='undefined'?state.gasHHe:0)||0)/totalInv,h2o=Math.max(0,Number(typeof state!=='undefined'?state.gasH2O:0)||0)/totalInv;
  let surfaceK=climateConsistencyCurrentSurfaceMeanK();if(!Number.isFinite(surfaceK)){try{surfaceK=Number(climateModel()?.T);}catch(_e){surfaceK=288;}}
  const hheSupply=climateConsistencyClamp(12*hhe,0,1),waterSupply=climateConsistencyClamp(5*h2o*stellarEscapeSmooth(320,380,surfaceK),0,1),supply=climateConsistencyClamp(hheSupply+waterSupply,0,1);
  const hydrodynamicKgS=energyLimitedKgS*supply,waterShare=(hheSupply+waterSupply)>1e-12?waterSupply/(hheSupply+waterSupply):0,waterEquivalentKgS=hydrodynamicKgS*waterShare;
  const pressureBar=(typeof atmosphereSurfacePressureBar==='function')?Math.max(0,atmosphereSurfacePressureBar()):1,columnSupply=climateConsistencyClamp(Math.pow(Math.max(1e-8,pressureBar),0.25),0.05,2);
  const ionPickupKgS=5*Math.max(1e-6,p.surfaceAreaEarth||1)*Math.pow(Math.max(1e-12,windPressureRel),0.65)*windTransmission*columnSupply,totalEscapeKgS=hydrodynamicKgS+ionPickupKgS;
  const atmMass=STELLAR_ESCAPE_EARTH_ATMOSPHERE_KG*totalInv*Math.max(1e-6,p.surfaceAreaEarth||1);
  const wb=(typeof waterBudget==='function')?waterBudget():null;
  const waterMass=(wb&&Number.isFinite(wb.totalEow))?STELLAR_ESCAPE_EARTH_OCEAN_KG*Math.max(0,wb.totalEow)*Math.max(1e-6,p.surfaceAreaEarth||1):0;
  const atmosphereLifetimeGyr=totalEscapeKgS>0?atmMass/(totalEscapeKgS*STELLAR_ESCAPE_SEC_GYR):Infinity,waterLifetimeGyr=waterEquivalentKgS>0?waterMass/(waterEquivalentKgS*STELLAR_ESCAPE_SEC_GYR):Infinity;
  const ageGyr=Number.isFinite(Number(p.ageGyr))?Number(p.ageGyr):4.57,ageLossFraction=Number.isFinite(atmosphereLifetimeGyr)&&atmosphereLifetimeGyr>0?climateConsistencyClamp(1-Math.exp(-ageGyr/atmosphereLifetimeGyr),0,1):0;
  let regime='устойчиво';if(atmosphereLifetimeGyr<0.1)regime='катастрофическая эрозия';else if(atmosphereLifetimeGyr<1)regime='сильная эрозия';else if(atmosphereLifetimeGyr<10)regime='заметная эрозия';else if(atmosphereLifetimeGyr<100)regime='медленная эрозия';
  return {model:STELLAR_ESCAPE_MODEL,starT:st.T,starM:st.M,starL:st.L,orbitalAU:o.r,semiMajorAU:o.a,bolometricFluxS:o.S,ageActivity,event,massLossRel,windSpeedKms,windPressureRel,windPressureNPa,xuvLumRel,xuvFluxRel,xuvFluxWm2,momentRel,magnetopauseRp,windTransmission,energyLimitedKgS,hydrodynamicKgS,ionPickupKgS,totalEscapeKgS,waterEquivalentKgS,waterShare,atmosphereLifetimeGyr,waterLifetimeGyr,ageLossFraction,regime};
}
function stellarEscapeApplyPhysicalStep(dtSec){
  if(typeof state==='undefined')return false;const maxDt=(typeof WEATHER_CORE_FIXED_DT_SEC!=='undefined')?Math.max(1,Number(WEATHER_CORE_FIXED_DT_SEC)||300):3600,dt=climateConsistencyClamp(dtSec,0,maxDt);if(!(dt>0))return false;
  const m=stellarEscapeModel(),p=(typeof planetPhysics==='function')?planetPhysics():{surfaceAreaEarth:1},area=Math.max(1e-6,Number(p.surfaceAreaEarth)||1),kgPerInv=STELLAR_ESCAPE_EARTH_ATMOSPHERE_KG*area;let changed=false;
  const hheKg=Math.max(0,m.hydrodynamicKgS*(1-m.waterShare))*dt;if(hheKg>0&&Number(state.gasHHe)>0){const old=Math.max(0,Number(state.gasHHe)||0),v=Math.max(0,old-hheKg/kgPerInv);if(v!==old){state.gasHHe=v;changed=true;}}
  const totalInv=(typeof gasInventoryTotal==='function')?Math.max(0,gasInventoryTotal()):0,vaporInv=Math.max(0,Number(state.gasH2O)||0),vaporFrac=totalInv>1e-15?climateConsistencyClamp(vaporInv/totalInv,0,1):0;
  const ionKg=Math.max(0,m.ionPickupKgS)*dt,ionWaterKg=ionKg*vaporFrac,ionDryKg=ionKg-ionWaterKg;
  if(ionDryKg>0&&typeof GAS_KEYS!=='undefined'){const keys=GAS_KEYS.filter(k=>k!=='gasH2O');let dry=0;for(const k of keys)dry+=Math.max(0,Number(state[k])||0);if(dry>1e-15){const loss=Math.min(dry,ionDryKg/kgPerInv);for(const k of keys){const old=Math.max(0,Number(state[k])||0),v=Math.max(0,old-loss*old/dry);if(v!==old){state[k]=v;changed=true;}}}}
  const waterKg=Math.max(0,m.waterEquivalentKgS)*dt+ionWaterKg;
  if(waterKg>0&&typeof waterTotalEowFromSlider==='function'&&typeof waterTotalSliderFromEow==='function'&&Number.isFinite(Number(state.waterTotal))){const old=waterTotalEowFromSlider(state.waterTotal),floor=(typeof WATER_TOTAL_MIN_EOW!=='undefined')?Math.max(0,WATER_TOTAL_MIN_EOW):0,v=Math.max(floor,old-waterKg/(STELLAR_ESCAPE_EARTH_OCEAN_KG*area));if(v<old){state.waterTotal=waterTotalSliderFromEow(v);changed=true;}}
  if(changed){if(typeof sanitizeGasInventories==='function')sanitizeGasInventories();if(typeof updateWaterDerivedState==='function')updateWaterDerivedState();if(typeof updateLegacyAtmoProxy==='function')updateLegacyAtmoProxy();if(typeof atmoCompFromGases==='function')state.atmoComp=atmoCompFromGases();if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();}
  return changed;
}
if(typeof weatherCoreStep==='function'){const before=weatherCoreStep;weatherCoreStep=function(core,dtSec,climate,axis){const out=before(core,dtSec,climate,axis);stellarEscapeApplyPhysicalStep(dtSec);return out;};}

function climateConsistencyFmtC(C){return Number.isFinite(C)?(C>=0?'+':'−')+Math.abs(C).toFixed(1)+' °C':'—';}
function stellarEscapeRateText(x){x=Math.max(0,Number(x)||0);if(x<1)return x.toFixed(3)+' кг/с';if(x<1e3)return x.toFixed(x<10?1:0)+' кг/с';if(x<1e6)return (x/1e3).toFixed(1)+' т/с';return (x/1e6).toFixed(1)+'·10⁶ кг/с';}
function stellarEscapeLifetimeText(x){if(!Number.isFinite(x))return '∞';if(x>=1000)return (x/1000).toFixed(1)+' трлн лет';if(x>=1)return x.toFixed(x<10?1:0)+' млрд лет';if(x>=0.001)return (x*1000).toFixed(x<0.01?1:0)+' млн лет';return (x*1e6).toFixed(0)+' тыс. лет';}
function climateConsistencyAppendRow(box,label,dataset,key){const row=document.createElement('div');row.style.cssText='display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:10px';const a=document.createElement('span');a.textContent=label;a.style.opacity='.62';const b=document.createElement('span');b.dataset[dataset]=key;b.style.textAlign='right';row.append(a,b);box.appendChild(row);}
function climateConsistencyDecoratePanel(el,group){
  if(!el||typeof document==='undefined')return el;const body=el.querySelector('.p-body');if(!body)return el;
  if(group==='Планета'){
    const box=el.querySelector('#climateRegimeDiag');if(box){const predicted=box.querySelector('[data-climate="temp"]');if(predicted?.parentElement){const label=predicted.parentElement.querySelector('span');if(label)label.textContent='Расчётная T* режима';}if(!box.querySelector('[data-climate-consistency="current"]')){climateConsistencyAppendRow(box,'Текущая T̄ поверхности','climateConsistency','current');climateConsistencyAppendRow(box,'Текущая → расчётная','climateConsistency','delta');}}
  }
  if(group==='Звезда'&&!el.querySelector('#stellarForcingDiag')){const box=document.createElement('div');box.id='stellarForcingDiag';box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line)';for(const [l,k] of [['Текущая орбита / поток','forcing'],['Weather Core / орбита','forcingCheck'],['Звёздный ветер','wind'],['XUV у планеты','xuv']])climateConsistencyAppendRow(box,l,'stellarEscape',k);body.appendChild(box);}
  if(group==='Атмосфера'&&!el.querySelector('#stellarEscapeDiag')){const box=document.createElement('div');box.id='stellarEscapeDiag';box.style.cssText='margin-top:10px;padding-top:9px;border-top:1px solid var(--line)';const t=document.createElement('div');t.textContent='Эрозия атмосферы звездой';t.style.cssText='margin-bottom:5px;font-size:9px;letter-spacing:.10em;text-transform:uppercase;color:var(--mut)';box.appendChild(t);for(const [l,k] of [['Магнитопауза','magnetopause'],['Потеря атмосферы','escape'],['Экв. потеря H₂O','waterEscape'],['Срок атмосферы','lifetime'],['Оценка за возраст','ageLoss']])climateConsistencyAppendRow(box,l,'stellarEscape',k);body.appendChild(box);}
  return el;
}
function refreshClimateConsistencyDiagnostics(){
  if(typeof document==='undefined')return;const current=climateConsistencyCurrentSurfaceC();let target=NaN;try{target=Number(climateModel()?.C);}catch(_e){}
  document.querySelectorAll('[data-climate-consistency="current"]').forEach(e=>e.textContent=climateConsistencyFmtC(current));
  document.querySelectorAll('[data-climate-consistency="delta"]').forEach(e=>e.textContent=Number.isFinite(current)&&Number.isFinite(target)?climateConsistencyFmtC(current)+' → '+climateConsistencyFmtC(target):'—');
}
function refreshStellarEscapeDiagnostics(){
  if(typeof document==='undefined')return;const m=stellarEscapeModel(),f=stellarEscapeWeatherForcingCheck(),set=(k,v)=>document.querySelectorAll('[data-stellar-escape="'+k+'"]').forEach(e=>e.textContent=v),d=Number.isFinite(f.error)?' · Δ '+(f.error>=0?'+':'')+f.error.toFixed(1)+'%':'';
  set('forcing',f.r.toFixed(f.r<0.1?3:2)+' AU · '+f.S.toPrecision(f.S<0.1?2:3)+' S⊕');set('forcingCheck',Number.isFinite(f.inferredS)?f.inferredS.toPrecision(f.inferredS<0.1?2:3)+' S⊕'+d:'ожидание поля');
  set('wind',m.massLossRel.toPrecision(m.massLossRel<10?2:3)+'× Ṁ☉ · '+m.windPressureNPa.toPrecision(3)+' nPa');set('xuv',m.xuvFluxRel.toPrecision(m.xuvFluxRel<10?2:3)+'× ⊕ · '+m.xuvFluxWm2.toPrecision(3)+' W/m²');
  set('magnetopause',m.magnetopauseRp.toFixed(m.magnetopauseRp<10?1:0)+' Rₚ · пропуск '+Math.round(100*m.windTransmission)+'%');set('escape',stellarEscapeRateText(m.totalEscapeKgS)+' · '+m.regime);set('waterEscape',stellarEscapeRateText(m.waterEquivalentKgS));set('lifetime',stellarEscapeLifetimeText(m.atmosphereLifetimeGyr));set('ageLoss',(100*m.ageLossFraction).toFixed(m.ageLossFraction<0.01?2:0)+'% при нынешнем режиме');
}
const activityParam=(typeof PARAMS!=='undefined')?PARAMS.find(p=>p.k==='aurora'):null;if(activityParam)activityParam.label='Космическая погода / вспышки';
if(typeof createPanel==='function'){const before=createPanel;createPanel=function(group){const el=before(group);climateConsistencyDecoratePanel(el,group);refreshClimateConsistencyDiagnostics();refreshStellarEscapeDiagnostics();return el;};}
if(typeof refreshClimateDiagnostics==='function'){const before=refreshClimateDiagnostics;refreshClimateDiagnostics=function(){before();const el=(typeof document!=='undefined')?document.querySelector('.param-panel'):null;if(el)climateConsistencyDecoratePanel(el,'Планета');refreshClimateConsistencyDiagnostics();};}
if(typeof syncDynamicLabels==='function'){const before=syncDynamicLabels;syncDynamicLabels=function(){before();refreshStellarEscapeDiagnostics();};}
if(typeof refreshWeatherCoreDiagnostics==='function'){const before=refreshWeatherCoreDiagnostics;refreshWeatherCoreDiagnostics=function(){before();refreshStellarEscapeDiagnostics();};}
let climateConsistencyTelemetryLastMs=-1e12;
if(typeof smoothTelemetryUpdate==='function'){const before=smoothTelemetryUpdate;smoothTelemetryUpdate=function(now){before(now);const t=Number(now)||((typeof performance!=='undefined')?performance.now():Date.now());if(t-climateConsistencyTelemetryLastMs<350)return;climateConsistencyTelemetryLastMs=t;const C=climateConsistencyCurrentSurfaceC();if(Number.isFinite(C)&&typeof smoothTelemetryText==='function'&&smoothTelemetryValues?.temp){smoothTelemetryText(smoothTelemetryValues.temp,climateConsistencyFmtC(C));let target=NaN;try{target=Number(climateModel()?.C);}catch(_e){}smoothTelemetryValues.temp.title='Текущая area-weighted температура поверхности'+(Number.isFinite(target)?'; расчётный режим '+climateConsistencyFmtC(target):'');}};}

try{if(typeof settleWaterEquilibriumImmediate==='function')settleWaterEquilibriumImmediate(5);if(typeof updateLegacyAtmoProxy==='function')updateLegacyAtmoProxy();if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();}catch(_e){}
window.__madPlanetClimateConsistency={model:CLIMATE_CONSISTENCY_MODEL,surfaceStats:climateConsistencySurfaceStats,currentMeanK:climateConsistencyCurrentSurfaceMeanK,currentC:climateConsistencyCurrentSurfaceC,airStats:climateConsistencyCurrentAirStats};
window.__madPlanetStellarEscape={model:STELLAR_ESCAPE_MODEL,anchor:stellarEscapeAnchor,orbitalState:stellarEscapeOrbitalState,forcingCheck:stellarEscapeWeatherForcingCheck,calculate:stellarEscapeModel,applyStep:stellarEscapeApplyPhysicalStep};
