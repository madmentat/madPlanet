const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/ocean-heat-transport.js'),'utf8');
const edge=fs.readFileSync(path.join(root,'js/cryosphere-edge-display.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=112),'geographic heat forcing requires 0.5.112+');
for(const [name,text] of [['shell',buildSh],['PowerShell',buildPs]]){
  const a=text.indexOf('js/ocean-circulation.js'),b=text.indexOf('js/ocean-heat-transport.js'),c=text.indexOf('js/cryosphere-sublimation.js');
  assert.ok(a>0&&b>a&&c>b,name+' build must load heat forcing after circulation and before sublimation');
}
assert.ok(!/requestAnimationFrame|Math\.random/.test(src),'geographic forcing must stay deterministic and off render FPS');
assert.match(src,/ohtRemoveBandMeans\(core,sea,/,'ocean forcing must be a zero-mean redistribution inside every latitude band');
assert.match(src,/ohtRemoveBandMeans\(core,land,/,'land forcing must be a zero-mean redistribution inside every latitude band');
assert.match(src,/ohtMeridionalOpenness/,'warm inflow must depend on an open equatorward pathway');
assert.match(src,/ohtArcToLand\(core,dx,dy,dz,axis,s,1\)/,'basin-side asymmetry must look for land to the east');
assert.match(src,/ohtArcToLand\(core,dx,dy,dz,axis,s,-1\)/,'basin-side asymmetry must look for land to the west');
assert.match(src,/OHT_LAPSE_K_PER_KM/,'elevated terrain must be colder');
assert.match(src,/core\.ohtSeaAnomalyK\[i\]=seaK;core\.ohtLandAnomalyK\[i\]=landK;/,'bootstrap anomaly must be tracked so rebuilds shift only the difference');
assert.doesNotMatch(edge,/cryoDisplayWarpDirection/,'display-side polar warp must stay retired once geography lives in physics');

/* Synthetic cubed sphere with the canonical madPlanet face orientation. */
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
function makeCore(N,geography,axis=[0,1,0]){
  const count=6*N*N,core={count,N,seed:11,ticks:0,simSeconds:0,
    dirX:new Float32Array(count),dirY:new Float32Array(count),dirZ:new Float32Array(count),
    areaWeight:new Float32Array(count),surfaceWaterFraction:new Float32Array(count),macroTerrain:new Float32Array(count),
    surfaceTemp:new Float32Array(count),landSurfaceTemp:new Float32Array(count),seaSurfaceTemp:new Float32Array(count),airTemp:new Float32Array(count),
    outgoingLongwave:new Float32Array(count),oceanHeatCapacity:new Float32Array(count),
    windNeighbor:[new Int32Array(count),new Int32Array(count),new Int32Array(count),new Int32Array(count)],
    h2oSurfaceSignature:'synthetic'};
  let i=0;
  for(let face=0;face<6;face++)for(let y=0;y<N;y++)for(let x=0;x<N;x++,i++){
    const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1,d=faceDir(face,u,v);
    core.dirX[i]=d[0];core.dirY[i]=d[1];core.dirZ[i]=d[2];
    const mm=Math.max(Math.abs(d[0]),Math.abs(d[1]),Math.abs(d[2]));core.areaWeight[i]=mm*mm*mm;
    const s=d[0]*axis[0]+d[1]*axis[1]+d[2]*axis[2];
    const lat=Math.asin(Math.max(-1,Math.min(1,s)))*180/Math.PI;
    const lon=Math.atan2(d[2],d[0])*180/Math.PI;
    const g=geography(lat,lon);
    core.surfaceWaterFraction[i]=g.water;core.macroTerrain[i]=g.height;
    const T=288-38*(Math.pow(Math.abs(s),2.4)-0.294);
    core.surfaceTemp[i]=T;core.landSurfaceTemp[i]=T;core.seaSurfaceTemp[i]=T;core.airTemp[i]=T-6;
    core.outgoingLongwave[i]=5.67e-8*Math.pow(T,4)/1.75;core.oceanHeatCapacity[i]=1.4e8;
    const h=2/N;
    const nb=[faceDir(face,u+h,v),faceDir(face,u-h,v),faceDir(face,u,v+h),faceDir(face,u,v-h)];
    for(let k=0;k<4;k++)core.windNeighbor[k][i]=dirToIndex(N,nb[k]);
  }
  return core;
}
let covers=0,publishes=0;
const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,
  WEATHER_CORE_FIXED_DT_SEC:300,
  weatherCoreAxis:()=>[0,1,0],
  h2oSeaLevelProxy:()=>0.0,
  weatherCoreCreate:()=>null,
  weatherCoreStep:core=>core,
  weatherCoreFinite:()=>true,
  oceanPublishSurface:core=>{publishes++;for(let i=0;i<core.count;i++){const w=core.surfaceWaterFraction[i];core.surfaceTemp[i]=core.landSurfaceTemp[i]*(1-w)+core.seaSurfaceTemp[i]*w;}return core;},
  cryoRefreshCovers:core=>{covers++;return core;},
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'ocean-heat-transport.js'});

/* Geography A: one meridional continent (lon -25..25), a mountain plateau on
   its northern half, plus a land ring over half the longitudes at 55..70N
   that encloses the polar sea on that side. */
const geoA=(lat,lon)=>{
  const continent=Math.abs(lon)<25&&Math.abs(lat)<80;
  const ring=lat>55&&lat<70&&lon>60&&lon<180;
  const plateau=continent&&lat>30&&lat<55&&lon<0;
  return {water:(continent||ring)?0:1,height:plateau?0.45:(continent||ring)?0.05:-0.4};
};
const N=16,core=makeCore(N,geoA);
const bootstrapTemp=Float32Array.from(core.seaSurfaceTemp);
assert.ok(ctx.ohtRefreshForcing(core,[0,1,0]),'first refresh must build the field');
assert.equal(core.oceanHeatTransportModel,1);
assert.ok(core.ohtSeaForcing instanceof Float32Array&&core.ohtLandForcing instanceof Float32Array);
assert.ok(!ctx.ohtRefreshForcing(core,[0,1,0]),'unchanged geography must not rebuild');

function cellAt(lat,lon){
  const la=lat*Math.PI/180,lo=lon*Math.PI/180;
  return dirToIndex(N,[Math.cos(la)*Math.cos(lo),Math.sin(la),Math.cos(la)*Math.sin(lo)]);
}
/* Global closure: the forcing redistributes heat, it does not create it. */
let sa=0,sq=0,maxAbs=0;
for(let i=0;i<core.count;i++){
  const a=core.areaWeight[i],w=core.surfaceWaterFraction[i];
  const q=w*core.ohtSeaForcing[i]+(1-w)*core.ohtLandForcing[i];sa+=a;sq+=a*q;maxAbs=Math.max(maxAbs,Math.abs(q));
}
assert.ok(Math.abs(sq/sa)<1e-3,'area-weighted forcing must have zero global mean; got '+(sq/sa));
assert.ok(maxAbs>8&&maxAbs<=110,'forcing must be a visible but bounded redistribution; got '+maxAbs);

/* Basin sides at 60N. East follows rotation (axis x r), which for the test
   frame is DECREASING lon. The ocean at lon +33 therefore has land close to
   its east (east side of a basin, Norway-like) and must run warmer than the
   ocean at lon -33 whose land lies to the west (Labrador-like). */
const eastSide=cellAt(60,33),westSide=cellAt(60,-33);
assert.equal(core.surfaceWaterFraction[eastSide],1);assert.equal(core.surfaceWaterFraction[westSide],1);
assert.ok(core.ohtSeaForcing[eastSide]-core.ohtSeaForcing[westSide]>8,
  'east side of a basin must receive clearly more ocean heat than the west side; got '+
  core.ohtSeaForcing[eastSide].toFixed(1)+' vs '+core.ohtSeaForcing[westSide].toFixed(1));

/* Enclosed polar sea: above the land ring (lon 120) the polar ocean has no open
   pathway to the subtropics and must be colder than the open side (lon -120). */
const enclosed=cellAt(74,120),open=cellAt(74,-120);
assert.equal(core.surfaceWaterFraction[enclosed],1);assert.equal(core.surfaceWaterFraction[open],1);
assert.ok(core.ohtSeaForcing[open]-core.ohtSeaForcing[enclosed]>4,
  'a landlocked polar sea must receive less warm inflow than an open one; got '+
  core.ohtSeaForcing[open].toFixed(1)+' vs '+core.ohtSeaForcing[enclosed].toFixed(1));

/* Elevation: the plateau must be colder than lowland at the same latitude. */
const plateau=cellAt(42,-12),lowland=cellAt(42,12);
assert.equal(core.surfaceWaterFraction[plateau],0);assert.equal(core.surfaceWaterFraction[lowland],0);
assert.ok(core.ohtLandForcing[lowland]-core.ohtLandForcing[plateau]>15,
  'high terrain must sit under a colder budget than lowland; got '+
  core.ohtLandForcing[plateau].toFixed(1)+' vs '+core.ohtLandForcing[lowland].toFixed(1));

/* Maritime spill-over: coastal land beside the warm basin side is milder than
   the continental interior at the same latitude. */
const coast=cellAt(60,22),interior=cellAt(60,0);
assert.equal(core.surfaceWaterFraction[coast],0);assert.equal(core.surfaceWaterFraction[interior],0);
assert.ok(core.ohtLandForcing[coast]>core.ohtLandForcing[interior],'a coast beside warm water must be milder than the interior');

/* Bootstrap: the steady-state anomaly Q/lambda is applied immediately so a
   freshly created world already carries geographic polar temperatures. */
let moved=0,maxK=0;
for(let i=0;i<core.count;i++){
  const d=core.seaSurfaceTemp[i]-bootstrapTemp[i];
  if(core.surfaceWaterFraction[i]>0.5){moved+=Math.abs(d)>0.5?1:0;maxK=Math.max(maxK,Math.abs(d));}
  assert.ok(Math.abs(d)<=14.0001,'bootstrap anomaly must stay within the clamp');
}
assert.ok(moved>core.count*0.1,'a large share of ocean cells must carry a geographic anomaly');
assert.ok(maxK>3,'bootstrap anomaly must be several kelvin; got '+maxK);
assert.ok(Math.abs(core.ohtSeaAnomalyK[eastSide]-core.ohtSeaForcing[eastSide]/core.ohtFeedbackWm2K)<1e-4,'anomaly must equal Q/lambda');

/* Zonal ice edge is no longer a circle: SST at 62N must vary by many kelvin
   around the globe. */
let mn=1e9,mx=-1e9;
for(let lon=-180;lon<180;lon+=5){const i=cellAt(62,lon);if(core.surfaceWaterFraction[i]>0.5){mn=Math.min(mn,core.seaSurfaceTemp[i]);mx=Math.max(mx,core.seaSurfaceTemp[i]);}}
assert.ok(mx-mn>6,'sea surface temperature along one polar parallel must vary geographically; got '+(mx-mn).toFixed(2)+' K');

/* Fixed tick: the persistent flux conserves the combined reservoir energy. */
const before=(()=>{let e=0;for(let i=0;i<core.count;i++){const a=core.areaWeight[i],w=core.surfaceWaterFraction[i];e+=a*(w*core.oceanHeatCapacity[i]*core.seaSurfaceTemp[i]+(1-w)*1.6e7*core.landSurfaceTemp[i]);}return e;})();
ctx.ohtStep(core,300);
const after=(()=>{let e=0;for(let i=0;i<core.count;i++){const a=core.areaWeight[i],w=core.surfaceWaterFraction[i];e+=a*(w*core.oceanHeatCapacity[i]*core.seaSurfaceTemp[i]+(1-w)*1.6e7*core.landSurfaceTemp[i]);}return e;})();
assert.ok(Math.abs(after-before)/Math.abs(before)<1e-6,'persistent geographic flux must conserve total surface heat');

/* Geography change: only the DIFFERENCE of the anomaly is applied, so a
   running world stays continuous and does not double-count the bootstrap. */
const prevSea=Float32Array.from(core.seaSurfaceTemp);
core.h2oSurfaceSignature='synthetic-2';
for(let i=0;i<core.count;i++)core.macroTerrain[i]=Math.min(core.macroTerrain[i],0.05);
assert.ok(ctx.ohtRefreshForcing(core,[0,1,0]),'changed geography must rebuild');
assert.equal(core.ohtSignatureBuilds,2);
for(let i=0;i<core.count;i++)if(core.surfaceWaterFraction[i]>0.5)
  assert.ok(Math.abs(core.seaSurfaceTemp[i]-prevSea[i])<0.5,'unchanged ocean geography must not jump on a land-only rebuild');
assert.ok(core.ohtLandForcing[plateau]>-3,'flattened plateau must lose its elevation cooling');

/* Wrapper integration. */
const wrapped=ctx.weatherCoreCreate(11,N,{},[0,1,0]);assert.equal(wrapped,null,'null inner core must pass through');
covers=0;publishes=0;
ctx.weatherCoreStep(core,300,{},[0,1,0]);
assert.ok(covers>0&&publishes>0,'step must republish surface and refresh cryosphere covers');
assert.ok(ctx.weatherCoreFinite(core),'forcing fields must remain finite');
console.log('ocean-heat-transport.test.js: OK');
