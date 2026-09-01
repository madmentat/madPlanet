const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/atmospheric-heat-transport.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=113),'atmospheric heat transport requires 0.5.113+');
for(const [name,text] of [['shell',buildSh],['PowerShell',buildPs]]){
  const a=text.indexOf('js/ocean-heat-transport.js'),b=text.indexOf('js/atmospheric-heat-transport.js'),c=text.indexOf('js/cryosphere-sublimation.js');
  assert.ok(a>0&&b>a&&c>b,name+' build must load atmospheric transport after ocean forcing and before sublimation');
}
assert.ok(!/requestAnimationFrame|Math\.random/.test(src),'transport must stay deterministic and off render FPS');
assert.match(src,/AHT_DIFFUSIVITY_M2_S=2\.2e6/,'diffusivity must stay at the Earth-calibrated EBM value');
assert.match(src,/ahtColumnHeatCapacity/,'transport strength must scale with the atmospheric column cp p / g');
assert.match(src,/AHT_MAX_EDGE_MIX/,'explicit diffusion needs a per-edge stability cap');
assert.match(src,/ahtMoistFactor\(climate\)\*cAtm/,'latent-heat transport must scale the diffusivity with water vapour');
assert.match(src,/function ahtDailyMeanInsolation\(/,'seasonal bootstrap needs the daily-mean insolation integral');
assert.match(src,/seasonDeclinationRadForPhase\(2\*Math\.PI\*\(k\+0\.5\)\/AHT_SEASON_PHASES,tilt\)/,'seasonal anomaly must be relative to the annual mean of the same orbit');

/* Synthetic two-cell and ring geometries on the real cubed-sphere layout. */
function faceDir(face,u,v){
  const p=face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1];
  const q=Math.hypot(...p)||1;return p.map(x=>x/q);
}
function dirToIndex(N,d){
  const [dx,dy,dz]=d,ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz);let face,u,v,q;
  if(ax>=ay&&ax>=az){if(dx>=0){face=0;q=dx;u=-dz/q;v=dy/q;}else{face=1;q=-dx;u=dz/q;v=dy/q;}}
  else if(ay>=az){if(dy>=0){face=2;q=dy;u=dx/q;v=-dz/q;}else{face=3;q=-dy;u=dx/q;v=dz/q;}}
  else{if(dz>=0){face=4;q=dz;u=dx/q;v=dy/q;}else{face=5;q=-dz;u=-dx/q;v=dy/q;}}
  const x=Math.max(0,Math.min(N-1,Math.floor((u+1)*0.5*N))),y=Math.max(0,Math.min(N-1,Math.floor((v+1)*0.5*N)));
  return face*N*N+y*N+x;
}
function makeCore(N,water){
  const count=6*N*N,core={count,N,seed:5,simSeconds:0,
    dirX:new Float32Array(count),dirY:new Float32Array(count),dirZ:new Float32Array(count),areaWeight:new Float32Array(count),
    surfaceWaterFraction:new Float32Array(count),surfaceTemp:new Float32Array(count),landSurfaceTemp:new Float32Array(count),
    seaSurfaceTemp:new Float32Array(count),airTemp:new Float32Array(count),outgoingLongwave:new Float32Array(count),
    localAlbedo:new Float32Array(count),oceanHeatCapacity:new Float32Array(count)};
  const ii=[],jj=[],dd=[],seen=new Set();let i=0;
  for(let face=0;face<6;face++)for(let y=0;y<N;y++)for(let x=0;x<N;x++,i++){
    const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=faceDir(face,u,v);
    core.dirX[i]=d[0];core.dirY[i]=d[1];core.dirZ[i]=d[2];
    const mm=Math.max(Math.abs(d[0]),Math.abs(d[1]),Math.abs(d[2]));core.areaWeight[i]=mm*mm*mm;
    const lat=Math.asin(Math.max(-1,Math.min(1,d[1])));
    const T=288-38*(Math.pow(Math.abs(d[1]),2.4)-0.294);
    core.surfaceWaterFraction[i]=water(lat);core.surfaceTemp[i]=T;core.landSurfaceTemp[i]=T;core.seaSurfaceTemp[i]=T;core.airTemp[i]=T-6;
    core.outgoingLongwave[i]=5.67e-8*Math.pow(T,4)/1.75;core.localAlbedo[i]=0.3;core.oceanHeatCapacity[i]=1.4e8;
    const h=2/N;
    for(const nb of [faceDir(face,u+h,v),faceDir(face,u-h,v),faceDir(face,u,v+h),faceDir(face,u,v-h)]){
      const j=dirToIndex(N,nb);if(j===i)continue;const a=Math.min(i,j),b=Math.max(i,j),key=a*count+b;
      if(seen.has(key))continue;seen.add(key);ii.push(a);jj.push(b);dd.push(6371000*Math.acos(Math.max(-1,Math.min(1,d[0]*nb[0]+d[1]*nb[1]+d[2]*nb[2]))));
    }
  }
  core.h2oEdgeI=Int32Array.from(ii);core.h2oEdgeJ=Int32Array.from(jj);core.h2oEdgeDistance=Float32Array.from(dd);
  return core;
}
let publishes=0,covers=0;
const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,
  WEATHER_CORE_FIXED_DT_SEC:300,
  baricGravityMS2:()=>9.80665,windPlanetRadiusM:()=>6371000,
  seasonAxialTiltDeg:c=>Number.isFinite(c?.axialTiltDeg)?c.axialTiltDeg:23.4,
  seasonOrbitPhaseRad:()=>Math.PI*1.5,   /* declination = -tilt: southern summer */
  seasonDeclinationRadForPhase:(p,t)=>Math.asin(Math.sin(t*Math.PI/180)*Math.sin(p)),
  weatherCoreCreate:()=>null,weatherCoreStep:core=>core,weatherCoreFinite:()=>true,
  oceanPublishSurface:core=>{publishes++;for(let i=0;i<core.count;i++){const w=core.surfaceWaterFraction[i];core.surfaceTemp[i]=core.landSurfaceTemp[i]*(1-w)+core.seaSurfaceTemp[i]*w;}return core;},
  cryoRefreshCovers:core=>{covers++;return core;},
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'atmospheric-heat-transport.js'});

const N=12,climate={pressureBar:1,S:1,axialTiltDeg:23.4};
const core=makeCore(N,lat=>Math.abs(lat)<Math.PI/3?1:0);
function energy(c){let e=0;for(let i=0;i<c.count;i++){const a=c.areaWeight[i],w=c.surfaceWaterFraction[i];e+=a*(w*c.oceanHeatCapacity[i]*c.seaSurfaceTemp[i]+(1-w)*1.6e7*c.landSurfaceTemp[i]);}return e;}
function polar(c,sign){let s=0,n=0;for(let i=0;i<c.count;i++)if(sign*c.dirY[i]>0.9){s+=c.surfaceTemp[i];n++;}return s/n;}
function equator(c){let s=0,n=0;for(let i=0;i<c.count;i++)if(Math.abs(c.dirY[i])<0.15){s+=c.surfaceTemp[i];n++;}return s/n;}

/* Diffusion: conservative, flattens the equator-pole contrast, finite. */
const e0=energy(core),contrast0=equator(core)-polar(core,1),pole0=polar(core,1);
let movedJ=0;
for(let k=0;k<400;k++){movedJ+=ctx.ahtDiffuse(core,300,climate);ctx.oceanPublishSurface(core);}
assert.ok(Math.abs(energy(core)-e0)/e0<2e-5,'diffusive transport must conserve surface heat (float32 reservoirs)');
const contrast1=equator(core)-polar(core,1);
assert.ok(movedJ>0,'diffusion must move heat down the gradient');
assert.ok(polar(core,1)>pole0+0.1&&contrast1<contrast0,'transport must warm the pole at the expense of the equator; contrast '+contrast0.toFixed(2)+' -> '+contrast1.toFixed(2));
assert.ok(ctx.weatherCoreFinite(core));

/* No atmosphere, no transport. */
const airless=makeCore(N,()=>0);const ea=Float32Array.from(airless.surfaceTemp);
ctx.ahtDiffuse(airless,300,{pressureBar:0,S:1});
for(let i=0;i<airless.count;i++)assert.equal(airless.landSurfaceTemp[i],ea[i],'an airless world must not transport heat through an atmosphere');

/* Thick atmosphere stays stable thanks to the per-edge cap. */
const thick=makeCore(N,()=>0);
for(let k=0;k<50;k++)ctx.ahtDiffuse(thick,300,{pressureBar:90,S:1});
for(let i=0;i<thick.count;i++)assert.ok(thick.landSurfaceTemp[i]>200&&thick.landSurfaceTemp[i]<330,'90 bar diffusion must remain bounded');

/* Seasonal bootstrap: at southern summer the south pole is milder than the
   north pole, land responds more than the ocean, and the anomaly is bounded. */
const season=makeCore(N,lat=>Math.abs(lat)<Math.PI/3?1:0);
ctx.ahtSeasonBootstrap(season,climate,[0,1,0]);ctx.oceanPublishSurface(season);
assert.ok(Math.abs(season.ahtSeasonDeclinationDeg+23.4)<1e-6,'bootstrap must use the current declination');
const north=polar(season,1),south=polar(season,-1);
assert.ok(south-north>6,'summer pole must bootstrap clearly milder than winter pole; got '+(south-north).toFixed(2));
const landCell=dirToIndex(N,[Math.cos(1.3),Math.sin(1.3),0]),seaCell=dirToIndex(N,[Math.cos(0.9),Math.sin(0.9),0]);
assert.equal(season.surfaceWaterFraction[landCell],0);assert.equal(season.surfaceWaterFraction[seaCell],1);
assert.ok(season.ahtSeasonAnomalyK[landCell]<-3,'winter polar land must cool by several kelvin');
assert.ok(Math.abs(season.ahtSeasonAnomalyK[seaCell])<Math.abs(season.ahtSeasonAnomalyK[landCell]),'ocean must respond less than land');
for(let i=0;i<season.count;i++)assert.ok(Math.abs(season.ahtSeasonAnomalyK[i])<=24.0001);
const noTilt=makeCore(N,()=>0);ctx.ahtSeasonBootstrap(noTilt,{pressureBar:1,S:1,axialTiltDeg:0},[0,1,0]);
for(let i=0;i<noTilt.count;i++)assert.equal(noTilt.ahtSeasonAnomalyK[i],0,'no tilt means no seasonal anomaly');

/* Moist static energy: wetter atmospheres transport more, dry ones less, Earth reference = 1. */
assert.ok(Math.abs(ctx.ahtMoistFactor({h2oBar:0.0019})-1)<1e-9,'Earth reference must reproduce the calibrated diffusivity');
assert.ok(ctx.ahtMoistFactor({h2oBar:0})<0.4,'a dry atmosphere transports only sensible heat');
assert.ok(ctx.ahtMoistFactor({h2oBar:0.004})>1.4,'a wetter atmosphere transports more');
assert.ok(ctx.ahtMoistFactor({h2oBar:1})<=(1+1.67*4)/2.67+1e-9,'latent enhancement must stay capped');

/* Wrapper integration. */
publishes=0;covers=0;ctx.weatherCoreStep(core,300,climate,[0,1,0]);
assert.ok(publishes>0&&covers>0,'step must republish surface and refresh cryosphere covers');
assert.ok(core.ahtHeatMovedJ>0,'step must report moved heat');
console.log('atmospheric-heat-transport.test.js: OK');
