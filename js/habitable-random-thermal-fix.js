/* ============ 0.5.168: temperate Random finalizer ============ */
/*
   Random worlds are NEW worlds, not continuations of an old climate history.
   The previous 0.5.164..0.5.167 adapters tried to move the orbit until CURRENT
   Weather Core T_a entered the target band. That is the wrong control loop:
   Weather Core has thermal reservoirs, ice/albedo hysteresis and finite-time
   transport, so an instantaneous T_a is not a monotonic function of AU.
   The loop could therefore drive the orbit far inward while T_a stayed on a
   cold branch, yielding exactly the observed T_a ~ -84 C with T_f +300 C.

   0.5.168 returns orbit selection to the equilibrium climateModel() quantity,
   then INITIALIZES the brand-new Weather Core from that accepted temperate
   climate. This is not a clamp on ordinary simulation: it only chooses the
   initial condition of the Random button.
*/

const CITY_FINAL_MODEL=5;
const CITY_FINAL_TARGET_MIN_C=14;
const CITY_FINAL_TARGET_MAX_C=24;
const CITY_FINAL_ACCEPT_MIN_C=10;
const CITY_FINAL_ACCEPT_MAX_C=27;
const CITY_FINAL_SOLVE_STEPS=18;

function cityFinalClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function cityFinalTargetFromSeed(){
  const h=(typeof weatherHash01==='function')?weatherHash01(state.seed|0,0x168):0.5;
  return CITY_FINAL_TARGET_MIN_C+(CITY_FINAL_TARGET_MAX_C-CITY_FINAL_TARGET_MIN_C)*h;
}
function cityFinalInvalidateCore(){
  try{if(typeof weatherCore!=='undefined')weatherCore=null;}catch(_e){}
}
function cityFinalFormalProbe(au,targetC){
  if(typeof stellarDistanceSliderFromAU==='function')state.distance=stellarDistanceSliderFromAU(au);
  cityFinalInvalidateCore();
  if(Number.isFinite(targetC)&&typeof tempToSlider==='function'){
    const v=tempToSlider(targetC);if(Number.isFinite(v))state.temp=v;
  }
  if(typeof settleWaterEquilibriumImmediate==='function')settleWaterEquilibriumImmediate(4);
  if(typeof updateLegacyAtmoProxy==='function')updateLegacyAtmoProxy();
  try{return (typeof climateModel==='function')?climateModel():null;}catch(_e){return null;}
}
function cityFinalSolveTemperateOrbit(targetC){
  if(typeof state==='undefined'||typeof starPhysics!=='function')return null;
  const st=starPhysics(state.star,state.luminosity);
  const hz=(typeof habitableZoneForStar==='function')
    ?habitableZoneForStar(st.T,st.L)
    :{conservativeInner:Math.sqrt(Math.max(1e-9,st.L))*0.90,
      conservativeOuter:Math.sqrt(Math.max(1e-9,st.L))*1.55};
  let near=Math.max(0.01,(Number(hz.conservativeInner)||0.7)*0.90);
  let far=Math.max(near*1.08,(Number(hz.conservativeOuter)||1.5)*1.08);
  let bestAu=Math.sqrt(near*far),best=null,bestErr=Infinity;

  const remember=(au,c)=>{
    const C=Number(c?.C);if(!Number.isFinite(C))return C;
    const err=Math.abs(C-targetC);
    if(err<bestErr){bestErr=err;bestAu=au;best=c;}
    return C;
  };
  let cNear=remember(near,cityFinalFormalProbe(near,targetC));
  for(let i=0;i<6&&Number.isFinite(cNear)&&cNear<targetC&&near>0.011;i++){
    near=Math.max(0.01,near*0.78);
    cNear=remember(near,cityFinalFormalProbe(near,targetC));
  }
  let cFar=remember(far,cityFinalFormalProbe(far,targetC));
  for(let i=0;i<6&&Number.isFinite(cFar)&&cFar>targetC&&far<999;i++){
    far=Math.min(1000,far*1.25);
    cFar=remember(far,cityFinalFormalProbe(far,targetC));
  }

  for(let i=0;i<CITY_FINAL_SOLVE_STEPS;i++){
    const au=Math.sqrt(near*far);
    const c=cityFinalFormalProbe(au,targetC);
    const C=remember(au,c);
    if(!Number.isFinite(C))break;
    /* Formal equilibrium temperature is monotonic enough for this bracket:
       hot -> farther out; cold -> farther in. */
    if(C>targetC)near=au;else far=au;
  }
  const final=cityFinalFormalProbe(bestAu,targetC);
  return final||best;
}
function cityFinalAreaMeanC(core,field){
  if(!core?.count||!field||field.length!==core.count)return NaN;
  let s=0,w=0;
  for(let i=0;i<core.count;i++){
    const K=Number(field[i]);if(!Number.isFinite(K))continue;
    const a=Math.max(1e-12,Number(core.areaWeight?.[i])||1);s+=a*K;w+=a;
  }
  return w>0?s/w-273.15:NaN;
}
function cityFinalInitializeTemperateCore(){
  cityFinalInvalidateCore();
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
  if(!core?.count)return NaN;
  const climate=(typeof weatherCoreClimateSnapshot==='function')?weatherCoreClimateSnapshot():null;
  const axis=(typeof weatherCoreAxis==='function')?weatherCoreAxis():[0,1,0];

  /* Re-seed only thermal/phase state. Geography, terrain, atmosphere, soil,
     rivers and all Random parameters stay intact. */
  if(climate&&typeof weatherCoreTargetsForCell==='function'){
    const q={surfaceTemp:0,airTemp:0,pressurePa:0,humidity:0,cloudWater:0};
    for(let i=0;i<core.count;i++){
      weatherCoreTargetsForCell(climate,core.dirX[i],core.dirY[i],core.dirZ[i],axis,core.seed,i,q);
      core.surfaceTemp[i]=q.surfaceTemp;
      if(core.airTemp)core.airTemp[i]=q.airTemp;
      if(core.landSurfaceTemp)core.landSurfaceTemp[i]=q.surfaceTemp;
      if(core.seaSurfaceTemp)core.seaSurfaceTemp[i]=q.surfaceTemp;
    }
  }
  /* A newly generated temperate planet has no inherited ice history. Leaving
     stale phase reservoirs here recreates a snowball skin on top of a warm
     climate forecast. */
  if(core.surfaceSnowWater)core.surfaceSnowWater.fill(0);
  if(core.landIceWater)core.landIceWater.fill(0);
  if(core.seaIceThicknessM)core.seaIceThicknessM.fill(0);
  if(core.snowCoverFraction)core.snowCoverFraction.fill(0);
  if(core.landIceCoverFraction)core.landIceCoverFraction.fill(0);
  if(core.seaIceConcentration)core.seaIceConcentration.fill(0);
  if(core.surfaceCryoFraction)core.surfaceCryoFraction.fill(0);

  if(typeof oceanPublishSurface==='function')oceanPublishSurface(core);
  if(typeof cryoRefreshCovers==='function')cryoRefreshCovers(core);
  if(typeof pstRefreshPolarBudget==='function')pstRefreshPolarBudget(core,climate,axis,true);
  if(typeof pstRefreshSkin==='function')pstRefreshSkin(core,axis);
  /* dt=0 refreshes derived radiation/season/phase diagnostics without advancing
     physical time. */
  try{if(typeof weatherCoreStep==='function')weatherCoreStep(core,0,climate,axis);}catch(_e){}
  if(typeof pstRefreshSkin==='function')pstRefreshSkin(core,axis);

  const field=(core.surfaceSkinTemp&&core.surfaceSkinTemp.length===core.count)
    ?core.surfaceSkinTemp:core.surfaceTemp;
  return cityFinalAreaMeanC(core,field);
}

if(typeof generateCityReadyRandomWorld==='function'){
  const cityRandomBeforeFinal=generateCityReadyRandomWorld;
  generateCityReadyRandomWorld=function(randomSource=Math.random){
    const result=cityRandomBeforeFinal(randomSource);
    const target=cityFinalTargetFromSeed();
    const formal=cityFinalSolveTemperateOrbit(target);
    if(typeof deriveWorld==='function')deriveWorld();
    const actual=cityFinalInitializeTemperateCore();
    if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();
    if(typeof syncUI==='function')syncUI();
    if(typeof saveHash==='function')saveHash();
    try{
      if(typeof window!=='undefined')window.__madPlanetHabitableRandomThermalFix.last={
        targetC:target,formalC:Number(formal?.C),actualC:actual,
        au:(typeof orbitDistanceAU==='function')?orbitDistanceAU(state.distance):NaN
      };
    }catch(_e){}
    return (typeof climateModel==='function')?climateModel():result;
  };
}

if(typeof window!=='undefined')window.__madPlanetHabitableRandomThermalFix={
  model:CITY_FINAL_MODEL,target:[CITY_FINAL_TARGET_MIN_C,CITY_FINAL_TARGET_MAX_C],
  acceptance:[CITY_FINAL_ACCEPT_MIN_C,CITY_FINAL_ACCEPT_MAX_C],last:null
};
