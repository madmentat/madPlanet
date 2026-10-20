'use strict';
// Screenshot regression: no coast-facing 'rake' of dozens of short D8 teeth,
// shared smooth tangents, sharp water banks, and preserved downhill outlets.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx={weatherCoreCreate(){},weatherCoreStep(){}};
vm.createContext(ctx);
for(const file of ['river-drainage','river-gpu'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+file+'.js'),'utf8'),ctx);
const gpu=fs.readFileSync(path.join(__dirname,'../js/river-gpu.js'),'utf8');
const surface=fs.readFileSync(path.join(__dirname,'../shaders/surface.glsl'),'utf8');
assert.match(gpu,/sourceArea:28\*\(N\/160\)\*\*2/,'remove near-coast rake by requiring a real drainage catchment');
assert.match(gpu,/sourceInset:Math\.max\(4,Math\.round\(N\/28\)\)/,'no short coastline headwaters');
assert.match(gpu,/const M=mobile\?640:1024/,'raster resolution must preserve river bank detail at regional zoom');
assert.match(surface,/alb = mix\(alb, inlandWater, inlandLiquid\);/,
  'opaque river interior must be real water, not muddy land/water blending');

const N=48,grid=ctx.riverDrainageGrid(N),n=grid.area.length;
const heights=new Float32Array(n),water=new Uint8Array(n),moist=new Float32Array(n);
const phase=8127344*0.000001;
for(let i=0;i<n;i++){
  const x=grid.dirs[3*i],y=grid.dirs[3*i+1],z=grid.dirs[3*i+2];
  heights[i]=0.14+0.48*y+0.1*Math.sin(11*x+2*z+phase)+0.04*Math.cos(5*x-7*z-phase);
  water[i]=heights[i]<0?1:0;
  moist[i]=0.65+0.3*Math.sin(5*x+3*z+phase);
}
const baseline=ctx.riverDrainageBuild(heights,water,moist,grid.neighbors,grid.area,
  {sourceArea:2*(N/160)**2,sourceInset:3});
const cleaner=ctx.riverDrainageBuild(heights,water,moist,grid.neighbors,grid.area,
  {sourceArea:28*(N/160)**2,sourceInset:Math.max(4,Math.round(N/28))});
const before=ctx.riverDrainageDiagnostics(baseline),after=ctx.riverDrainageDiagnostics(cleaner);
assert.equal(after.uphill,0);assert.equal(after.dangling,0);
assert.ok(after.mouths<before.mouths*.5,
  'coastal teeth must be substantially fewer, not cosmetically softened');
assert.ok(after.segments<before.segments*.45);
assert.ok(after.segments>500,'retain flowing rivers and tributaries');
assert.ok(after.sources>25,'do not make the planet barren');

const geo=ctx.riverDrainageCurveGeometry(grid,cleaner),p=[0,0,0],q=[0,0,0],mid=[0,0,0];
let curved=0,checked=0,axisCount=0,axisAligned=0;
for(let i=0;i<n;i++){
  if(!cleaner.channel[i]||cleaner.coastDistance[i]<=3)continue;
  const j=cleaner.down[i];
  ctx.riverDrainageCurvePoint(geo,i,j,0,p);
  ctx.riverDrainageCurvePoint(geo,i,j,1,q);
  ctx.riverDrainageCurvePoint(geo,i,j,.5,mid);
  const v=p.map((x,k)=>x+q[k]),len=Math.hypot(...v);
  const deviation=Math.hypot(...mid.map((x,k)=>x-v[k]/len));
  checked++;if(deviation>1e-5)curved++;
  // The previous look kept almost every stroke aligned to eight D8 compass
  // directions. Measure the actual tangent through this rendered curved edge.
  const v1=[0,0,0],v2=[0,0,0];
  ctx.riverDrainageCurvePoint(geo,i,j,.2,v1);
  ctx.riverDrainageCurvePoint(geo,i,j,.8,v2);
  const face=Math.floor(i/(N*N));
  const a=ctx.riverDrainageProject(face,...v1);
  const b=ctx.riverDrainageProject(face,...v2);
  const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
  const error=Math.abs(((angle+Math.PI/8)%(Math.PI/4)+Math.PI/4)%(Math.PI/4)-Math.PI/8);
  axisCount++;if(error<Math.PI/36)axisAligned++;
}
assert.ok(checked>150,'test must inspect real long rivers');
assert.ok(curved/checked>.75,'river network needs flowing curves, not long straight/90-degree strokes');
assert.ok(axisCount>150&&axisAligned/axisCount<.42,
  'the network must not collapse back onto eight visible D8 compass directions');
const mask=ctx.riverDrainageRaster(grid,cleaner,N*4);
assert.ok(mask.painted>mask.segments);
let paint=0;for(const face of mask.faces)for(let k=0;k<face.length;k+=4)
  if(face[k]>0)paint++;
assert.ok(paint>2000,'enough visible riverbank pixels are painted');
console.log('river-natural-look.test.js: OK',JSON.stringify({
  before:{segments:before.segments,mouths:before.mouths},
  after:{segments:after.segments,mouths:after.mouths},
  inspected:checked,curved,axisAligned,axisCount,paint
}));
