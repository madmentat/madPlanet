const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const h2o=read('js/h2o-column-thermodynamics.js');
const targets=read('js/weather-target-smoothing.js');
const fogFix=read('js/fog-spatial-fix.js');
const fogShader=read('shaders/fog.glsl');
const sub=read('js/cryosphere-sublimation.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');
const version=read('VERSION.txt');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'stabilization test must see semantic version');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/weather-core.js','js/weather-target-smoothing.js','js/h2o-advection.js','js/h2o-column-thermodynamics.js','js/condensation.js','js/cryosphere.js','js/cryosphere-sublimation.js','js/physical-fog.js','js/fog-spatial-fix.js'];
ordered(buildSh,order,'shell stabilization order');
ordered(buildPs,order,'PowerShell stabilization order');

/* Vertically integrated saturation must be much smaller than the obsolete
   isothermal p_sat/g slab, while remaining monotonic with temperature. */
{
  const ctx={console,Math,Number,
    h2oGravityMS2:()=>9.80665,
    h2oSaturationColumnKgM2:(T)=>{const ex=Math.max(-40,Math.min(20,5420*(1/273.15-1/T)));return 0.00611*Math.exp(ex)*1e5/9.80665;},
    waterSaturationPressureBar:(T)=>{const ex=Math.max(-40,Math.min(20,5420*(1/273.15-1/T)));return 0.00611*Math.exp(ex);},
    atmosphereGravityEarth:()=>1,EARTH_ATM_BAR:1.01325,WATER_EOW_TO_ATM_INV:261.3,
    waterEquilibriumVaporInventory:()=>0,settleWaterEquilibriumImmediate:()=>{}
  };
  vm.createContext(ctx);vm.runInContext(h2o,ctx,{filename:'h2o-column-thermodynamics.js'});
  const slab=0.00611*Math.exp(5420*(1/273.15-1/290))*1e5/9.80665;
  const sat290=ctx.h2oSaturationColumnKgM2(290,{gravityMS2:9.80665});
  assert.ok(sat290>25&&sat290<45,'290 K integrated saturation should be tens, not hundreds, of kg/m2');
  assert.ok(sat290<0.24*slab,'vertical profile must substantially reduce the isothermal saturation slab');
  assert.ok(ctx.h2oSaturationColumnKgM2(300,{gravityMS2:9.80665})>sat290,'saturation column must increase with T');
  const inv=ctx.waterEquilibriumVaporInventory(1,290);
  const vaporColumn=inv*ctx.EARTH_ATM_BAR*1e5/9.80665;
  const rh=vaporColumn/sat290;
  assert.ok(rh>0.62&&rh<0.76,'temperate one-box equilibrium must map to ordinary meteorological RH');
}

/* Equilibrium targets must no longer depend on per-cell index hashes. */
{
  const ctx={console,Math,Number,
    weatherClamp:(x,a,b)=>Math.max(a,Math.min(b,Number(x)||0)),
    weatherCoreTargetsForCell:()=>{}
  };
  vm.createContext(ctx);vm.runInContext(targets,ctx,{filename:'weather-target-smoothing.js'});
  const c={T:290,pressureBar:1,h2oBar:0.002,cloudCov:0.45,waterAvail:1};
  const a={},b={};
  ctx.weatherCoreTargetsForCell(c,1,0,0,[0,1,0],7,1,a);
  ctx.weatherCoreTargetsForCell(c,1,0,0,[0,1,0],999,9876,b);
  assert.deepEqual(a,b,'same physical location must have the same relaxation target regardless of cell hash/index');
}

/* Fog spatial pass must spread an isolated texel before GPU magnification. */
{
  const ctx={console,Math,Number,Float32Array,
    fogClamp:(x,a,b)=>Math.max(a,Math.min(b,Number(x)||0)),
    fogRefreshDerived:()=>{},fogStep:(core)=>core,
    weatherCoreCreate:(seed,N)=>({seed,N,count:5}),
  };
  vm.createContext(ctx);vm.runInContext(fogFix,ctx,{filename:'fog-spatial-fix.js'});
  const core={count:5,fogState:new Float32Array([1,0,0,0,0]),
    windNeighbor:[new Int32Array([1,0,0,0,0]),new Int32Array([2,2,1,1,1]),new Int32Array([3,3,3,2,2]),new Int32Array([4,4,4,4,3])]};
  ctx.fogSpatialDiffuse(core);
  assert.ok(core.fogState[0]<1,'isolated fog cell should lose its grid-point spike');
  assert.ok(core.fogState.slice(1).some(v=>v>0),'fog influence should spread into neighbours');
}
assert.ok(!/optical\s*<\s*0\.002/.test(fogShader),'hard 0.002 fog contour must not return');
assert.match(fogShader,/softVisibility=smoothstep/,'weak physical fog must fade continuously');
assert.match(fogShader,/max\(0\.0,optical-erosion\)/,'edge noise must be subtractive and unable to create fog');

/* Snow sublimation must be a locally mass-conservative return path. */
{
  let rhRefresh=0;
  const ctx={console,Math,Number,Float32Array,
    WEATHER_CORE_FIXED_DT_SEC:300,
    h2oSaturationColumnKgM2:()=>10,
    h2oRefreshRelativeHumidity:()=>{rhRefresh++;},
    weatherCoreCreate:(seed,N)=>({seed,N,count:1}),weatherCoreStep:(core)=>core
  };
  vm.createContext(ctx);vm.runInContext(sub,ctx,{filename:'cryosphere-sublimation.js'});
  const core={count:1,vaporColumn:new Float32Array([1]),surfaceSnowWater:new Float32Array([20]),landIceWater:new Float32Array([0]),
    surfaceWaterFraction:new Float32Array([0]),landSurfaceTemp:new Float32Array([260]),surfaceTemp:new Float32Array([260]),
    windStateU:new Float32Array([8]),windStateV:new Float32Array([0]),areaWeight:new Float32Array([1])};
  const total0=core.vaporColumn[0]+core.surfaceSnowWater[0]+core.landIceWater[0];
  ctx.cryoSublimationStep(core,300,{});
  const total1=core.vaporColumn[0]+core.surfaceSnowWater[0]+core.landIceWater[0];
  assert.ok(core.vaporColumn[0]>1&&core.surfaceSnowWater[0]<20,'dry cold air must sublimate some snow');
  assert.ok(Math.abs(total1-total0)<2e-5,'snow -> vapor sublimation must conserve local H2O mass');
  assert.ok(core.landSurfaceTemp[0]<260,'sublimation must consume latent heat');
  assert.ok(rhRefresh>0,'relative humidity must refresh after sublimation');
}

for(const src of [h2o,targets,fogFix,sub]){
  assert.ok(!/Math\.random/.test(src),'stabilization physics must be deterministic');
  assert.ok(!/requestAnimationFrame/.test(src),'stabilization physics must stay off render FPS');
}
console.log('weather-stabilization.test.js: OK');
