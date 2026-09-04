/* ============ 0.5.47: soil moisture + infiltration + runoff ============ */
/*
   Weather Core v9 turns landed precipitation into a local terrestrial water
   balance. Liquid water on land can infiltrate a finite soil reservoir,
   saturated/excess water becomes runoff, and runoff is routed conservatively
   toward the lowest resolved macro-terrain neighbour. Cells with no lower
   neighbour retain water in runoffWater until the later river/lake closure.

   No random drainage map is introduced. Soil capacity comes from the existing
   land/ocean mask plus resolved tectonic ruggedness; runoff routing uses the
   same macroTerrain and cubed-sphere neighbour stencil already owned by the
   H2O/wind layers.

   The 0.5.45 mobile H2O closure is extended to include soil moisture and
   unresolved runoff. Water explicitly reaching the macro-ocean leaves those
   local stores and returns to the bulk condensed reservoir. Bare-soil
   evaporation provides the reverse transfer back to atmospheric vapor.
*/

const SOIL_HYDROLOGY_MODEL = 2;
const SOIL_CAPACITY_FLAT_KG_M2 = 180.0;
const SOIL_CAPACITY_RUGGED_KG_M2 = 35.0;
const SOIL_FIELD_CAPACITY_FRACTION = 0.72;
const SOIL_INFILTRATION_TAU_SEC = 4.0*3600;
const SOIL_INFILTRATION_MAX_KG_M2_S = 0.0025;
const SOIL_SURFACE_RETENTION_FLAT_KG_M2 = 8.0;
const SOIL_SURFACE_RETENTION_RUGGED_KG_M2 = 2.0;
const SOIL_RUNOFF_GENERATION_TAU_SEC = 2.0*3600;
const SOIL_DRAINAGE_TAU_SEC = 3.0*86400;
const SOIL_EVAP_TAU_SEC = 4.0*86400;
const SOIL_EVAP_MAX_KG_M2_S = 1.5e-4;
const RUNOFF_ROUTE_FLAT_TAU_SEC = 18.0*3600;
const RUNOFF_ROUTE_STEEP_TAU_SEC = 1.5*3600;
const RUNOFF_ROUTE_MAX_FRACTION = 0.65;

function soilClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function soilSmooth(a,b,x){
  if(a===b) return x>=b?1:0;
  const u=soilClamp((x-a)/(b-a),0,1);
  return u*u*(3-2*u);
}
function soilMix(a,b,t){ return a+(b-a)*t; }

function soilEnsureFields(core){
  if(!core||!core.count) return core;
  const n=core.count;
  const f32=k=>{if(!core[k]||core[k].length!==n)core[k]=new Float32Array(n);};
  f32('soilMoisture');
  f32('soilCapacity');
  f32('soilBaseline');
  f32('infiltrationRate');
  f32('soilDrainageRate');
  f32('soilEvaporationRate');
  f32('runoffGenerationRate');
  f32('runoffWater');
  f32('runoffRoutedRate');
  f32('runoffOceanReturnRate');
  f32('runoffDrop');
  if(!core.runoffDownstream||core.runoffDownstream.length!==n) core.runoffDownstream=new Int32Array(n);
  if(!core.runoffMassDelta||core.runoffMassDelta.length!==n) core.runoffMassDelta=new Float64Array(n);
  core.soilHydrologyModel=SOIL_HYDROLOGY_MODEL;
  if(typeof core.soilHydrologySignature!=='string') core.soilHydrologySignature='';
  if(typeof core.runoffRoutingSignature!=='string') core.runoffRoutingSignature='';
  return core;
}

function soilSignature(core){
  const surf=String(core?.h2oSurfaceSignature||'none');
  const oro=String(core?.orographySignature||'none');
  const sea=(typeof state!=='undefined'&&Number.isFinite(state.sea))?state.sea:0.58;
  return surf+'|'+oro+'|sea='+Number(sea).toFixed(5)+'|N='+(core?.N||0);
}
function soilRefreshCapacity(core){
  soilEnsureFields(core);
  if(!core?.surfaceWaterFraction||!core?.macroTerrain) return core;
  const sig=soilSignature(core);
  if(core.soilHydrologySignature===sig) return core;
  const sea=(typeof h2oSeaLevelProxy==='function')?h2oSeaLevelProxy():0;
  core.soilCapacityOceanReturnMass=0;
  for(let i=0;i<core.count;i++){
    const water=soilClamp(core.surfaceWaterFraction[i],0,1);
    const land=1-water;
    const rough=soilClamp(core.orographicRoughness?.[i]||0,0,1);
    const high=soilSmooth(0.08,0.48,Math.max(0,core.macroTerrain[i]-sea));
    const rugged=soilClamp(0.72*rough+0.28*high,0,1);
    const cap=land*soilMix(SOIL_CAPACITY_FLAT_KG_M2,SOIL_CAPACITY_RUGGED_KG_M2,rugged);
    const oldSoil=Math.max(0,core.soilMoisture[i]);
    core.soilCapacity[i]=cap;
    if(oldSoil>cap){
      const spill=oldSoil-cap;
      core.soilMoisture[i]=cap;
      if(water>0.5){
        core.soilCapacityOceanReturnMass+=spill*Math.max(1e-12,core.areaWeight?.[i]||1);
      }else{
        core.runoffWater[i]+=spill;
      }
    }
  }
  core.soilHydrologySignature=sig;
  soilRefreshBaseline(core);
  return core;
}

/* 0.5.152: climate baseline of the soil store. Earth's root-zone soil holds
   about 100 kg m^-2 of water, several times the whole atmosphere, and it is
   in balance with the local climate rather than filled from an empty start.
   Until now soilMoisture began at zero and, being part of the mobile column
   closure (~20 kg m^-2 area mean), could never exceed a tenth of its
   capacity: every continent looked like a desert to the river model.
   The baseline is treated like the ocean: exchanges below it are exchanges
   with the large condensed/groundwater reservoir; only the EXCESS above it
   counts in the weather-scale mobile closure. */
function soilBaselineFraction(core,i){
  const rh=soilClamp(core?.relativeHumidity?.[i]??core?.humidity?.[i]??0,0,1.5);
  const T=Number(core?.surfaceTemp?.[i]);
  const liquid=Number.isFinite(T)?soilSmooth(266,278,T)*(1-soilSmooth(368,395,T)):1;
  return SOIL_FIELD_CAPACITY_FRACTION*(0.06+0.94*soilSmooth(0.30,0.88,rh))*liquid;
}
function soilRefreshBaseline(core){
  if(!core?.soilBaseline||!core?.soilCapacity) return core;
  for(let i=0;i<core.count;i++){
    const cap=Math.max(0,core.soilCapacity[i]);
    const base=soilClamp(cap*soilBaselineFraction(core,i),0,cap);
    core.soilBaseline[i]=base;
    if(core.soilMoisture[i]<base) core.soilMoisture[i]=base;
  }
  return core;
}

function soilRoutingSignature(core){
  return String(core?.h2oSurfaceSignature||'none')+'|sea='+
    ((typeof state!=='undefined'&&Number.isFinite(state.sea))?Number(state.sea).toFixed(5):'0.58000')+
    '|N='+(core?.N||0);
}
function soilBuildRunoffRouting(core){
  soilEnsureFields(core);
  if(!core?.windNeighbor||!core?.macroTerrain||!core?.surfaceWaterFraction) return core;
  core.runoffDownstream.fill(-1);
  core.runoffDrop.fill(0);
  for(let i=0;i<core.count;i++){
    const water=soilClamp(core.surfaceWaterFraction[i],0,1);
    if(water>0.5) continue;
    const h0=core.macroTerrain[i];
    let best=-1,bestH=h0;
    for(let k=0;k<4;k++){
      const j=core.windNeighbor[k][i]|0;
      if(j<0||j>=core.count||j===i) continue;
      const hj=core.macroTerrain[j];
      if(hj<bestH-1e-6){bestH=hj;best=j;}
    }
    if(best>=0){
      core.runoffDownstream[i]=best;
      core.runoffDrop[i]=Math.max(0,h0-bestH);
    }
  }
  core.runoffRoutingSignature=soilRoutingSignature(core);
  return core;
}

function soilAreaMeanStores(core){
  if(!core?.soilMoisture) return 0;
  let sw=0,sum=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    sw+=w;
    sum+=w*(Math.max(0,core.surfaceLiquidWater?.[i]||0)+
            Math.max(0,core.surfaceSnowWater?.[i]||0)+
            Math.max(0,core.soilMoisture[i]-(core.soilBaseline?.[i]||0))+
            Math.max(0,core.runoffWater[i]));
  }
  return sum/Math.max(1e-12,sw);
}
function soilScaleStores(core,scale){
  scale=Math.max(0,Number(scale)||0);
  if(!core?.soilMoisture) return;
  for(let i=0;i<core.count;i++){
    if(core.surfaceLiquidWater) core.surfaceLiquidWater[i]=Math.max(0,core.surfaceLiquidWater[i]*scale);
    if(core.surfaceSnowWater) core.surfaceSnowWater[i]=Math.max(0,core.surfaceSnowWater[i]*scale);
    const base=core.soilBaseline?.[i]||0;
    core.soilMoisture[i]=Math.max(0,base+Math.max(0,core.soilMoisture[i]-base)*scale);
    core.runoffWater[i]=Math.max(0,core.runoffWater[i]*scale);
  }
}

/* Extend the weather-scale H2O closure: atmosphere + landed liquid/snow +
   soil moisture + unresolved runoff share the same mobile column target.
   Explicit ocean returns are exchanges with the large condensed reservoir. */
const h2oNormalizeGlobalVaporBeforeSoil=h2oNormalizeGlobalVapor;
h2oNormalizeGlobalVapor=function(core,climate){
  if(!core?.soilMoisture||!core?.cloudWaterState)
    return h2oNormalizeGlobalVaporBeforeSoil(core,climate);
  const totalTarget=Math.max(0,h2oGlobalTargetColumnKgM2(climate));
  let stored=soilAreaMeanStores(core);
  if(stored>totalTarget&&stored>1e-12){
    soilScaleStores(core,totalTarget/stored);
    stored=totalTarget;
  }
  const atmosphericTarget=Math.max(0,totalTarget-stored);
  const mean=condAreaMeanTotal(core);
  if(!(atmosphericTarget>1e-12)){
    core.vaporColumn.fill(0);core.cloudWaterState.fill(0);
    core.h2oTargetColumn=totalTarget;core.soilAtmosphericTarget=0;
    condMirrorCloudWater(core);return 0;
  }
  if(!(mean>1e-12)){
    core.vaporColumn.fill(atmosphericTarget);core.cloudWaterState.fill(0);
    core.h2oTargetColumn=totalTarget;core.soilAtmosphericTarget=atmosphericTarget;
    condMirrorCloudWater(core);return 1;
  }
  const scale=atmosphericTarget/mean;
  for(let i=0;i<core.count;i++){
    core.vaporColumn[i]=Math.max(0,core.vaporColumn[i]*scale);
    core.cloudWaterState[i]=Math.max(0,core.cloudWaterState[i]*scale);
  }
  core.h2oTargetColumn=totalTarget;core.soilAtmosphericTarget=atmosphericTarget;
  condMirrorCloudWater(core);
  return scale;
};

function soilInfiltrateAndGenerateRunoff(core,dtSec){
  soilRefreshCapacity(core);
  const dt=Math.max(0,Number(dtSec)||0);
  if(!(dt>0)||!core?.surfaceLiquidWater) return {infil:0,runoff:0,drain:0};
  let infilMass=0,runoffMass=0,drainMass=0;
  for(let i=0;i<core.count;i++){
    core.infiltrationRate[i]=0;
    core.runoffGenerationRate[i]=0;
    core.soilDrainageRate[i]=0;
    const land=1-soilClamp(core.surfaceWaterFraction?.[i]||0,0,1);
    if(!(land>1e-5)) continue;
    const cap=Math.max(0,core.soilCapacity[i]);
    let soil=Math.min(Math.max(0,core.soilMoisture[i]),cap);
    let surface=Math.max(0,core.surfaceLiquidWater[i]);
    const rough=soilClamp(core.orographicRoughness?.[i]||0,0,1);
    const thaw=soilSmooth(268,278,core.surfaceTemp[i]);
    const permeability=(0.25+0.75*(1-rough))*thaw;
    const deficit=Math.max(0,cap-soil);
    const frac=1-Math.exp(-dt/Math.max(1,SOIL_INFILTRATION_TAU_SEC));
    const infil=Math.min(surface,SOIL_INFILTRATION_MAX_KG_M2_S*dt,deficit*frac*permeability);
    if(infil>0){
      surface-=infil;soil+=infil;
      core.infiltrationRate[i]=infil/dt;
      infilMass+=infil*Math.max(1e-12,core.areaWeight?.[i]||1);
    }

    const field=cap*SOIL_FIELD_CAPACITY_FRACTION;
    const drainExcess=Math.max(0,soil-field);
    const drain= Math.min(soil,drainExcess*(1-Math.exp(-dt/Math.max(1,SOIL_DRAINAGE_TAU_SEC))));
    if(drain>0){
      soil-=drain;core.runoffWater[i]+=drain;
      core.soilDrainageRate[i]=drain/dt;
      drainMass+=drain*Math.max(1e-12,core.areaWeight?.[i]||1);
    }

    const retention=land*soilMix(SOIL_SURFACE_RETENTION_FLAT_KG_M2,SOIL_SURFACE_RETENTION_RUGGED_KG_M2,rough);
    const excess=Math.max(0,surface-retention);
    const speed=0.45+1.55*rough;
    const runoff= Math.min(surface,excess*(1-Math.exp(-dt*speed/Math.max(1,SOIL_RUNOFF_GENERATION_TAU_SEC))));
    if(runoff>0){
      surface-=runoff;core.runoffWater[i]+=runoff;
      runoffMass+=runoff*Math.max(1e-12,core.areaWeight?.[i]||1);
    }
    core.runoffGenerationRate[i]=(runoff+drain)/dt;
    core.soilMoisture[i]=Math.max(0,Math.min(cap,soil));
    core.surfaceLiquidWater[i]=Math.max(0,surface);
  }
  return {infil:infilMass,runoff:runoffMass,drain:drainMass};
}

function soilRouteRunoff(core,dtSec){
  soilEnsureFields(core);
  if(core.runoffRoutingSignature!==soilRoutingSignature(core)) soilBuildRunoffRouting(core);
  const dt=Math.max(0,Number(dtSec)||0),delta=core.runoffMassDelta;
  delta.fill(0);
  core.runoffRoutedRate.fill(0);core.runoffOceanReturnRate.fill(0);
  let moved=0,ocean=0;
  for(let i=0;i<core.count;i++){
    const store=Math.max(0,core.runoffWater[i]);
    const j=core.runoffDownstream[i]|0;
    if(!(store>0)||j<0||j>=core.count) continue;
    const steep=soilSmooth(0.002,0.10,core.runoffDrop[i]);
    const tau=soilMix(RUNOFF_ROUTE_FLAT_TAU_SEC,RUNOFF_ROUTE_STEEP_TAU_SEC,steep);
    const frac=Math.min(RUNOFF_ROUTE_MAX_FRACTION,1-Math.exp(-dt/Math.max(1,tau)));
    if(!(frac>0)) continue;
    const wi=Math.max(1e-12,core.areaWeight?.[i]||1);
    const mass=store*wi*frac;
    if(!(mass>0)) continue;
    delta[i]-=mass;
    core.runoffRoutedRate[i]=mass/wi/Math.max(1,dt);
    if(soilClamp(core.surfaceWaterFraction?.[j]||0,0,1)>0.5){
      core.runoffOceanReturnRate[i]=mass/wi/Math.max(1,dt);
      ocean+=mass;
    }else{
      delta[j]+=mass;
      moved+=mass;
    }
  }
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);
    core.runoffWater[i]=Math.max(0,(core.runoffWater[i]*w+delta[i])/w);
  }
  return {moved,ocean};
}

/* Bare-soil evaporation is a strict local transfer from soilMoisture to
   vaporColumn. Free ocean and puddle evaporation remain owned by older layers. */
const h2oApplyEvaporationBeforeSoil=h2oApplyEvaporation;
h2oApplyEvaporation=function(core,dtSec,climate){
  let source=h2oApplyEvaporationBeforeSoil(core,dtSec,climate);
  if(!core?.soilMoisture) return source;
  soilRefreshCapacity(core);
  const dt=Math.max(0,Number(dtSec)||0);
  if(!(dt>0)) return source;
  for(let i=0;i<core.count;i++){
    core.soilEvaporationRate[i]=0;
    const soil=Math.max(0,core.soilMoisture[i]),cap=Math.max(1e-9,core.soilCapacity[i]);
    if(!(soil>0&&cap>0)) continue;
    const land=1-soilClamp(core.surfaceWaterFraction?.[i]||0,0,1);
    const T=core.surfaceTemp[i];
    const liquid=soilSmooth(258,278,T)*(1-soilSmooth(635,650,T));
    const available=soilSmooth(0.05,0.65,soil/cap);
    if(!(land*liquid*available>0)) continue;
    const sat=h2oSaturationColumnKgM2(T,climate);
    const deficit=Math.max(0,0.72*sat-core.vaporColumn[i]);
    if(!(deficit>0)) continue;
    const speed=Math.hypot(core.windStateU?.[i]??core.windU[i],core.windStateV?.[i]??core.windV[i]);
    const windBoost=0.45+0.55*soilClamp(speed/10,0,1.5);
    const rate=Math.min(SOIL_EVAP_MAX_KG_M2_S,soil/dt,
      land*liquid*available*deficit/Math.max(1,SOIL_EVAP_TAU_SEC)*windBoost);
    if(rate>0){
      const dm=rate*dt;
      core.soilMoisture[i]=Math.max(0,soil-dm);
      core.vaporColumn[i]+=dm;
      core.evaporationRate[i]+=rate;
      core.soilEvaporationRate[i]=rate;
      source+=rate*Math.max(1e-12,core.areaWeight?.[i]||1);
    }
  }
  return source;
};

const weatherCoreCreateBeforeSoil=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeSoil(seed,N,climate,axis);
  soilEnsureFields(core);
  soilRefreshCapacity(core);
  soilBuildRunoffRouting(core);
  core.soilAtmosphericTarget=h2oGlobalTargetColumnKgM2(climate);
  core.soilInfiltratedMass=0;core.soilRunoffGeneratedMass=0;
  core.soilRunoffRoutedMass=0;core.soilOceanReturnMass=0;
  h2oNormalizeGlobalVapor(core,climate);
  return core;
};

const weatherCoreStepBeforeSoil=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeSoil(core,dtSec,climate,axis);
  const dt=weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC);
  soilRefreshCapacity(core);
  if(core.runoffRoutingSignature!==soilRoutingSignature(core)) soilBuildRunoffRouting(core);
  const g=soilInfiltrateAndGenerateRunoff(core,dt);
  const r=soilRouteRunoff(core,dt);
  core.soilInfiltratedMass=g.infil;
  core.soilRunoffGeneratedMass=g.runoff+g.drain;
  core.soilRunoffRoutedMass=r.moved;
  core.soilOceanReturnMass=r.ocean;
  h2oNormalizeGlobalVapor(core,climate);
  h2oRefreshRelativeHumidity(core,climate);
  condMirrorCloudWater(core);
  return core;
};

const weatherCoreFiniteBeforeSoil=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeSoil(core)) return false;
  for(const k of ['soilMoisture','soilCapacity','infiltrationRate','soilDrainageRate',
    'soilEvaporationRate','runoffGenerationRate','runoffWater','runoffRoutedRate',
    'runoffOceanReturnRate','runoffDrop']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])||a[i]<0)return false;
  }
  if(!core.runoffDownstream||core.runoffDownstream.length!==core.count||!core.runoffMassDelta)return false;
  for(let i=0;i<core.count;i++) if(core.soilMoisture[i]>core.soilCapacity[i]+1e-4)return false;
  return true;
};

function soilDiagnostics(core,climate){
  if(!core?.soilMoisture) return {soil:NaN,cap:NaN,sat:NaN,infil:NaN,runoff:NaN,route:NaN,ocean:NaN,store:NaN,closure:NaN,target:NaN};
  let sw=0,soil=0,cap=0,infil=0,runoff=0,route=0,ocean=0,store=0,atm=0,surface=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1);sw+=w;
    soil+=w*core.soilMoisture[i];cap+=w*core.soilCapacity[i];
    infil+=w*core.infiltrationRate[i];runoff+=w*core.runoffGenerationRate[i];
    route+=w*core.runoffRoutedRate[i];ocean+=w*core.runoffOceanReturnRate[i];
    store+=w*core.runoffWater[i];
    surface+=w*(Math.max(0,core.surfaceLiquidWater?.[i]||0)+Math.max(0,core.surfaceSnowWater?.[i]||0));
    atm+=w*(Math.max(0,core.vaporColumn?.[i]||0)+Math.max(0,core.cloudWaterState?.[i]||0));
  }
  const d=Math.max(1e-12,sw),s=soil/d,c=cap/d,target=h2oGlobalTargetColumnKgM2(climate);
  return {soil:s,cap:c,sat:c>1e-9?s/c:0,infil:infil/d,runoff:runoff/d,route:route/d,ocean:ocean/d,
    store:store/d,closure:(atm+surface+soil+store)/d,target};
}

if(typeof createPanel==='function'){
  const createPanelBeforeSoil=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeSoil(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-soil="moisture"]')){
        appendWeatherCoreRow(box,'Почвенная влага','soil-moisture');
        const a=box.lastElementChild?.querySelector('[data-weathercore="soil-moisture"]');if(a){delete a.dataset.weathercore;a.dataset.soil='moisture';}
        appendWeatherCoreRow(box,'Инфильтрация / runoff','soil-flux');
        const b=box.lastElementChild?.querySelector('[data-weathercore="soil-flux"]');if(b){delete b.dataset.weathercore;b.dataset.soil='flux';}
        appendWeatherCoreRow(box,'Runoff store / в океан','soil-runoff');
        const c=box.lastElementChild?.querySelector('[data-weathercore="soil-runoff"]');if(c){delete c.dataset.weathercore;c.dataset.soil='runoff';}
        appendWeatherCoreRow(box,'H₂O closure + soil','soil-closure');
        const d=box.lastElementChild?.querySelector('[data-weathercore="soil-closure"]');if(d){delete d.dataset.weathercore;d.dataset.soil='closure';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeSoil=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeSoil();
    if(typeof document==='undefined') return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core?.soilMoisture)return;
    const d=soilDiagnostics(core,weatherCoreClimateSnapshot());
    const set=(k,v)=>{const e=box.querySelector('[data-soil="'+k+'"]');if(e)e.textContent=v;};
    set('moisture',d.soil.toFixed(1)+' / '+d.cap.toFixed(1)+' кг/м² · '+(100*d.sat).toFixed(0)+'%');
    set('flux',(d.infil*86400).toFixed(2)+' / '+(d.runoff*86400).toFixed(2)+' мм/сут');
    set('runoff',d.store.toFixed(2)+' кг/м² · '+(d.ocean*86400).toFixed(2)+' мм/сут');
    set('closure',d.closure.toFixed(2)+' / '+d.target.toFixed(2)+' кг/м²');
  };
}
