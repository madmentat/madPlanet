'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={weatherCoreCreate(){},weatherCoreStep(){}};vm.createContext(ctx);
for(const name of ['river-drainage','river-gpu'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+name+'.js'),'utf8'),ctx);
function check(h,w,m,nb,options={sourceArea:1,sourceInset:2}){
  const r=ctx.riverDrainageBuild(h,w,m,nb,null,options),incoming=new Int32Array(h.length);
  for(let i=0;i<h.length;i++)if(r.channel[i]){
    assert.equal(w[i],0,'water must never supply a surface river');
    const j=r.down[i];assert.ok(j>=0,'every visible segment has a receiver');
    assert.ok(h[j]<=h[i],'no uphill flow, including into lakes and the ocean');
    assert.equal(r.basin[i],r.basin[j],'each river stays within its own outlet basin');
    assert.ok(w[j]||r.channel[j],'a river cannot vanish before reaching water');incoming[j]++;
    const seen=new Set([i]);let k=j;
    while(!w[k]){assert.ok(!seen.has(k),'no cycles');seen.add(k);k=r.down[k];assert.ok(k>=0);}
  }
  for(let i=0;i<h.length;i++)if(r.channel[i]&&!incoming[i])
    assert.ok(r.coastDistance[i]>=options.sourceInset,'headwaters must start inland');
  const visited=new Set();
  for(let i=0;i<h.length;i++)if(r.channel[i]&&!visited.has(i)){
    const queue=[i];visited.add(i);let contacts=0;
    for(const j of queue){
      if(w[r.down[j]])contacts++;
      for(let k=0;k<h.length;k++)if(r.channel[k]&&(r.down[k]===j||r.down[j]===k)&&!visited.has(k)){
        visited.add(k);queue.push(k);
      }
    }
    assert.equal(contacts,1,'each visible river system has exactly one mouth');
  }
  const audit=ctx.riverDrainageDiagnostics(r);
  assert.equal(audit.uphill,0);
  assert.equal(audit.dangling,0);
  assert.ok(audit.basins<=audit.mouths,'several independent river mouths may enter the same lake cell');
  return r;
}
function line(h,wet,moist=h.map(()=>0.65),options){
  const w=h.map((_,i)=>wet.includes(i)?1:0),nb=h.map((_,i)=>[...(i?[i-1,1]:[]),...(i+1<h.length?[i+1,1]:[])]);
  return check(h,w,moist,nb,options);
}
// Physical proxy W = k * Q^b must stay monotonic, deterministic, and
// become visibly wider from trickles to the large river downstream.
const widthQs=[0,1,4,16,64,256,1024,4096];
const widthBins=widthQs.map(q=>ctx.riverDrainageWidthBin(q));
assert.ok(widthBins.every((w,i)=>w>=1&&w<=15&&(!i||w>=widthBins[i-1])));
assert.ok(widthBins[widthBins.length-1]-widthBins[0]>=10,
  'small streams and large rivers must have different sizes');
assert.equal(ctx.riverDrainageWidthBin(16),ctx.riverDrainageWidthBin(16));

// Two shores of the same landmass: the watershed splits two distinct basins.
const split=line([-0.1,0.03,0.12,0.25,0.40,0.25,0.12,0.03,-0.1],[0,8]);
assert.equal(split.down[2],1);assert.equal(split.down[6],7);
assert.ok(split.channel[2]&&split.channel[6]);
// A narrow island is not pierced with an ocean-to-ocean artificial channel.
assert.equal(line([-0.1,0.05,0.05,-0.1],[0,3]).channel.reduce((a,b)=>a+b),0);
// No forced uphill breach out of a dry closed depression.
assert.equal(line([-0.1,0.3,0.1,0.2,0.4],[0]).channel[3],0);
// A connected stream through an arid reach keeps its upstream supply.
const dry=line([-0.1,0.03,0.08,0.12,0.2,0.3],[0],[0,0,0,0.8,0.8,0.8]);
assert.ok(dry.channel[1]&&dry.channel[2]);assert.ok(dry.flow[1]>=dry.flow[3]);
assert.equal(line([0.1,0.2,0.3],[]).channel.reduce((a,b)=>a+b),0,'no invented outlets on a dry planet');
assert.equal(line([0.12,0.04,0.30],[2]).channel.reduce((a,b)=>a+b),0,
  'a high inland lake must not pull water uphill from a lower depression');
// Inland lake accepts two tributaries but is never used as an ocean source.
const h=[0.08,0.15,0.3,0.15,0.3],w=[1,0,0,0,0],nb=[[1,1,3,1],[0,1,2,1],[1,1],[0,1,4,1],[3,1]];
const lake=check(h,w,h.map(()=>0.7),nb);assert.ok(lake.channel[1]&&lake.channel[3]);assert.equal(lake.down[0],-1);

// At a confluence the largest upstream contributor is the main stem; side
// tributaries keep their narrow width until they meet it.
{
  const h=[-0.1,0.1,0.25,0.45,0.25],w=[1,0,0,0,0];
  const nb=[[1,1],[0,1,2,1,4,1],[1,1,3,1],[2,1],[1,1]];
  const net=check(h,w,[0.7,0.7,0.7,0.7,0.7],nb);
  const primary=ctx.riverDrainagePrimaryUpstream(net);
  assert.equal(primary[1],2,'longer/main stem must be continuous across a tributary junction');
  assert.ok(net.flow[1]>net.flow[2]&&net.flow[2]>net.flow[4],
    'downstream flow includes contributions from the smaller side tributary');
  assert.ok(ctx.riverDrainageWidthBin(net.flow[1])>=ctx.riverDrainageWidthBin(net.flow[2]));
}

// Actual cubed sphere, including polar seams, monotonic drainage and endpoint
// storage. These assertions concern topology/geometry, not source-text shape.
const grid=ctx.riverDrainageGrid(14),n=grid.area.length;
const heights=new Float32Array(n),water=new Uint8Array(n),moisture=new Float32Array(n).fill(0.7);
for(let i=0;i<n;i++){
  const x=grid.dirs[3*i],y=grid.dirs[3*i+1],z=grid.dirs[3*i+2];
  heights[i]=0.2+0.35*y+0.08*Math.sin(8*x)*Math.cos(7*z);water[i]=heights[i]<0?1:0;
}
const network=ctx.riverDrainageBuild(heights,water,moisture,grid.neighbors,grid.area,{sourceArea:1,sourceInset:2});
assert.ok(network.channel.reduce((a,b)=>a+b)>100);
for(let i=0;i<n;i++)if(network.channel[i]){
  assert.ok(heights[network.down[i]]<=heights[i]);
  assert.ok(water[network.down[i]]||network.channel[network.down[i]]);
}
const raster=ctx.riverDrainageRaster(grid,network,56);assert.ok(raster.segments>100);
// Each visible branch shares its endpoint with every branch at the junction.
// The tiny offsets are cached per vertex and deterministic across builds.
const copy=ctx.riverDrainageGrid(14);
let offsetVertices=0;
for(let i=0;i<n;i++){
  const orig=grid.dirs.subarray(3*i,3*i+3),art=grid.artDirs.subarray(3*i,3*i+3);
  const delta=Math.hypot(...orig.map((v,k)=>v-art[k]));
  assert.ok(delta<0.04,'artistic vertex must remain within its drainage cell');
  if(delta>1e-5)offsetVertices++;
  for(let k=0;k<3;k++)assert.equal(art[k],copy.artDirs[3*i+k],
    'the same seed/grid must draw the same river vertices');
}
assert.ok(offsetVertices>n*0.8,'artistic offsets should break D8 compass-line regularity');
for(let i=0;i<n;i++)if(network.channel[i]){
  const j=network.down[i];
  assert.ok(j>=0&&network.reachesWater[i]&&!network.water[i]);
  assert.ok(network.height[j]<=network.height[i]);
  // Only the final edge may enter water; no river flows out of any ocean/lake.
  if(network.water[j])assert.equal(network.down[j],-1);
}

// CPU builds coherent cubic centerlines with shared downstream tangents.
// There are two analytic chords per terrain edge, with no random shader wiggle.
const shader=fs.readFileSync(path.join(__dirname,'../shaders/river-channels.glsl'),'utf8');
const geometry=ctx.riverDrainageCurveGeometry(grid,network);
let curved=0,inspected=0;
for(let i=0;i<n;i++)if(network.channel[i]&&network.coastDistance[i]>3){
  const j=network.down[i];if(network.coastDistance[j]<=3)continue;
  const a=[0,0,0],b=[0,0,0],m=[0,0,0];
  ctx.riverDrainageCurvePoint(geometry,i,j,0,a);
  ctx.riverDrainageCurvePoint(geometry,i,j,1,b);
  ctx.riverDrainageCurvePoint(geometry,i,j,0.5,m);
  const dot=a[0]*m[0]+a[1]*m[1]+a[2]*m[2];
  const linear=[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const len=Math.hypot(...linear);
  const deviation=Math.hypot(m[0]-linear[0]/len,m[1]-linear[1]/len,m[2]-linear[2]/len);
  inspected++;if(deviation>1e-6)curved++;
}
assert.ok(inspected>100&&curved>inspected*0.20,
  'most rivers must smoothly depart from D8 straight-line chords');
assert.equal(vm.runInContext('RIVER_DRAINAGE_CURVE_STEPS',ctx),2,
  'two coherent chords per DEM edge prevent atlas collisions and preserve detail');
assert.doesNotMatch(shader,/float bow=span\*envelope/,
  'no independent shader jitter that breaks smooth river tangents');
assert.match(shader,/physicalHalfWidth\+aa/,
  'camera footprint may affect anti-aliasing but must not redefine river width');
const surface=fs.readFileSync(path.join(__dirname,'../shaders/surface.glsl'),'utf8');
assert.doesNotMatch(surface,/float floodplain=drainage\.y/,
  'do not paint concentric dirty floodplain halos around every river');
assert.match(shader,/widthBin=mix\(widthA,widthB,smoothT\)/,
  'the main stem must preserve smoothly interpolated discharge widths');

// Two segments survive a collision within the SAME RGBA32UI atlas texel.
// The layout uses all 128 bits, with 14-bit UVs and 4-bit endpoint widths.
{
  const arr=new Uint32Array(4),first=[0,1234,16383,8192],second=[16383,8184,14,700];
  ctx.riverDrainagePackSegment(arr,0,0,first,3,9);
  ctx.riverDrainagePackSegment(arr,0,1,second,12,15);
  const unpack0=ctx.riverDrainageUnpackSegment(arr,0,0);
  const unpack1=ctx.riverDrainageUnpackSegment(arr,0,1);
  assert.equal(unpack0.widthA,3);assert.equal(unpack0.widthB,9);
  assert.equal(unpack1.widthA,12);assert.equal(unpack1.widthB,15);
  for(let c=0;c<4;c++){
    assert.ok(Math.abs(unpack0.uv[c]-ctx.riverDrainageDecodeUV(first[c]))<1e-12);
    assert.ok(Math.abs(unpack1.uv[c]-ctx.riverDrainageDecodeUV(second[c]))<1e-12);
  }
  ctx.riverDrainagePackSegment(arr,0,0,[42,43,44,45],6,7);
  assert.equal(ctx.riverDrainageUnpackSegment(arr,0,1).widthA,12,
    'replacing the main stem must not erase the tributary slot');
  ctx.riverDrainageShiftPrimaryToSecondary(arr,0);
  assert.equal(ctx.riverDrainageUnpackSegment(arr,0,1).widthA,6);
  assert.equal(ctx.riverDrainageUnpackSegment(arr,0,1).widthB,7);
  assert.equal(arr[0]>>>28,6);assert.equal(arr[2]>>>28,6);
}
let primaryTexels=0,secondaryTexels=0;
for(let f=0;f<6;f++)for(let k=0;k<raster.faces[f].length;k+=4){
  const a=raster.faces[f],p=ctx.riverDrainageUnpackSegment(a,k,0);
  const q=ctx.riverDrainageUnpackSegment(a,k,1);
  if(!p.widthA){assert.equal(q.widthA,0);continue;}
  primaryTexels++;
  assert.ok(p.widthA>=1&&p.widthA<=15&&p.widthB>=p.widthA&&p.widthB<=15);
  if(q.widthA){
    secondaryTexels++;
    assert.ok(q.widthA>=1&&q.widthA<=15&&q.widthB>=q.widthA&&q.widthB<=15);
  }
  for(let c=0;c<4;c++){
    assert.ok(Number.isFinite(p.uv[c])&&Math.abs(p.uv[c])<=1.125001);
    if(q.widthA)assert.ok(Number.isFinite(q.uv[c])&&Math.abs(q.uv[c])<=1.125001);
  }
}
assert.ok(secondaryTexels>0,'close confluences must retain multiple segments');
assert.equal(secondaryTexels,raster.secondSlots);
assert.ok(primaryTexels>secondaryTexels,'secondary candidates must not fill every margin');
const header=fs.readFileSync(path.join(__dirname,'../shaders/header.glsl'),'utf8');
assert.match(header,/uniform highp usamplerCube uRiverLoopTex;/);
assert.match(shader,/uvec4 edge=texture\(uRiverLoopTex,query\)/,
  'integer atlas should need only one cubemap read for two edges');
assert.match(shader,/for\(int slot=0;slot<2;slot\+\+\)/,
  'both confluence candidates must be considered');

for(let i=0;i<n;i++){
  const d=grid.dirs.subarray(3*i,3*i+3),tmp={};ctx.riverGpuDirToFaceUV(...d,tmp);
  const p=ctx.riverDrainageProject(tmp.face,...d);
  assert.ok(Math.abs(p[0]-tmp.u)<1e-10&&Math.abs(p[1]-tmp.v)<1e-10,'endpoint projection must match the renderer at every cube face');
}
console.log('river-drainage.test.js: OK');
