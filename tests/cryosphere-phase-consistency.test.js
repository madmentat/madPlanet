const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const cryo=fs.readFileSync(path.join(root,'js','cryosphere.js'),'utf8');
const sub=fs.readFileSync(path.join(root,'js','cryosphere-sublimation.js'),'utf8');
const thermal=fs.readFileSync(path.join(root,'shaders','thermal.glsl'),'utf8');

assert.match(sub,/CRYO_PHASE_CONSISTENCY_MODEL=1/,'late cryosphere phase closure missing');
assert.match(sub,/CRYO_SEA_ICE_AREA_SCALE_M=0\.35/,'thin sea ice must not imply a solid pack');
assert.match(sub,/pstRefreshSkin\(core,axis\)/,'radiating skin must be republished after late melting');
assert.match(thermal,/visibleCryo>0\.5\)baseK=min\(baseK,273\.15\)/,
  'thermal image must not show above-freezing temperature on the same visible ice pixel');
assert.match(thermal,/cryoSurfaceSample\(uCryosphereTex,normalize\(sN\)\)/,
  'thermal phase clamp must use the exact displayed cryosphere geography');

const makeCore=()=>({
  count:3,N:4,seed:9,ticks:0,
  surfaceTemp:new Float32Array([276,276,276]),
  landSurfaceTemp:new Float32Array([276,276,276]),
  seaSurfaceTemp:new Float32Array([276,276,276]),
  surfaceWaterFraction:new Float32Array([0,1,1]),
  surfaceSnowWater:new Float32Array([100,0,0]),
  surfaceLiquidWater:new Float32Array([0,0,0]),
  surfaceMeltRate:new Float32Array(3),
  oceanHeatCapacity:new Float32Array([1.4e8,1.4e8,1.4e8]),
  areaWeight:new Float32Array([1,1,1]),
  vaporColumn:new Float32Array([20,20,20]),
  cloudWaterState:new Float32Array([0.1,0.1,0.1]),
  pressure:new Float32Array([101325,101325,101325]),
  dirX:new Float32Array([1,0,0]),dirY:new Float32Array([0,0,0]),dirZ:new Float32Array([0,1,-1]),
});

const windowObj={};
const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,window:windowObj,
  WEATHER_CORE_FIXED_DT_SEC:300,
  weatherCoreCreate:()=>makeCore(),weatherCoreStep:(core)=>{core.ticks++;return core;},weatherCoreFinite:()=>true,
  oceanPublishSurface:(core)=>{for(let i=0;i<core.count;i++){const w=core.surfaceWaterFraction[i];core.surfaceTemp[i]=core.landSurfaceTemp[i]*(1-w)+core.seaSurfaceTemp[i]*w;}return core;},
  precipMeltSurfaceSnow:()=>0,precipAreaMeanStore:()=>0,precipScaleSurfaceStore:()=>{},h2oApplyEvaporation:()=>0,
  localEnergyCellAlbedo:()=>0.2,localEnergyFluxes:(T,cw,dx,dy,dz,axis,c,out)=>out,
  localEnergyIceAlbedo:()=>0.65,localEnergyNonIceAlbedo:()=>0.18,cloudRadClearGlobalAlbedo:()=>0.30,
  pstRefreshSkin:(core)=>{
    if(!core.surfaceSkinTemp||core.surfaceSkinTemp.length!==core.count)core.surfaceSkinTemp=new Float32Array(core.count);
    for(let i=0;i<core.count;i++){
      const w=core.surfaceWaterFraction[i];
      const land=core.landSurfaceTemp[i],sea=core.seaSurfaceTemp[i];
      const ice=core.seaIceConcentration?.[i]||0;
      const seaSkin=ice>0.5?Math.min(sea,273.15):sea;
      core.surfaceSkinTemp[i]=land*(1-w)+seaSkin*w;
    }
    return core;
  },
};
vm.createContext(ctx);
vm.runInContext(cryo,ctx,{filename:'cryosphere.js'});
vm.runInContext(sub,ctx,{filename:'cryosphere-sublimation.js'});

assert.ok(ctx.cryoSeaIceCover(0.10)<0.35,'10 cm of new sea ice must leave substantial open water');
assert.ok(ctx.cryoSeaIceCover(1.00)>0.90,'one metre of sea ice should still represent a compact pack');

const core=makeCore();
ctx.cryoEnsureFields(core);
core.landIceWater[0]=500;
core.seaIceThicknessM[1]=3.0;
core.seaIceThicknessM[2]=0.10;
ctx.cryoRefreshCovers(core);

ctx.cryoPhaseConsistencyClose(core,300,{},[0,1,0]);

assert.ok(core.surfaceSnowWater[0]<100,'late warm land must spend sensible heat melting snow');
assert.ok(core.landIceWater[0]>0,'the test must retain persistent land ice after partial melt');
assert.ok(core.landSurfaceTemp[0]<=273.1501,
  'land with remaining snow/glacier ice cannot finish the tick above the melting point');

assert.ok(core.seaIceThicknessM[1]>0,'thick pack ice must survive one warm closure in the test');
assert.ok(core.seaSurfaceTemp[1]<=271.3501,
  'SST under surviving sea ice cannot finish the tick above seawater freezing');
assert.ok(core.surfaceSkinTemp[1]<=273.1501,
  'radiating skin over surviving sea ice cannot be warmer than melting ice');

assert.equal(core.seaIceThicknessM[2],0,'thin sea ice should disappear when enough sensible heat exists to melt it');
assert.ok(core.seaSurfaceTemp[2]>271.35,'after all thin ice melts, leftover heat may warm open water');
assert.ok(core.seaIceConcentration[2]<0.01,'melted thin ice must not leave a white visual cap behind');
assert.equal(core.cryoWarmLandIceCells,0,'phase closure must leave no warm dense land-ice cells');
assert.equal(core.cryoWarmSeaIceCells,0,'phase closure must leave no warm dense sea-ice cells');

console.log('cryosphere-phase-consistency.test.js: OK');
