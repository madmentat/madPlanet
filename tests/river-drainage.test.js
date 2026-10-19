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
const shader=fs.readFileSync(path.join(__dirname,'../shaders/river-channels.glsl'),'utf8');
const surface=fs.readFileSync(path.join(__dirname,'../shaders/surface.glsl'),'utf8');
assert.match(shader,/texture\(uRiverLoopTex,normalize\(d\)\)\.r/,
  'one ordinary prepainted RGBA8 mask lookup must draw the rivers');
assert.doesNotMatch(shader,/uvec4|for\(int slot|widthBin|physicalHalfWidth/,
  'no packed atlas or per-pixel analytic geometric searches');
assert.doesNotMatch(surface,/float floodplain=drainage\.y/,
  'do not reintroduce artificial dark bank halos');
assert.match(surface,/float dryChannel = riverGeom\*land\*\(1\.0-hotLiquidGate\)/,
  'same geographical channel should be represented by dry sediment at high heat');

const raster=ctx.riverDrainageRaster(grid,network,96);
assert.ok(raster.segments>100);
assert.ok(raster.painted>raster.segments,'draw sampled curves, not angular D8 sticks');
assert.equal(raster.resolution,96);
let paintedPixels=0;
const reds=new Set();
for(const face of raster.faces){
  assert.ok(face instanceof Uint8Array||face.constructor.name==='Uint8Array');
  assert.equal(face.length,96*96*4);
  for(let k=0;k<face.length;k+=4){
    const r=face[k];
    assert.equal(face[k+1],0);assert.equal(face[k+2],0);
    assert.equal(face[k+3],255,'plain RGBA8 cubemap must be opaque');
    if(r){paintedPixels++;reds.add(r);}
  }
}
assert.ok(paintedPixels>600,'actual GPU-uploadable river mask must contain visible pixels');
assert.ok(reds.size>5,'mask must store smooth antialiasing rather than binary lines');

// Geometry is static and repeatable, independent of camera and of water
// phase; never recalculate channels in a per-pixel shader.
const repeat=ctx.riverDrainageRaster(grid,network,96);
for(let f=0;f<6;f++)
  assert.deepEqual(Buffer.from(repeat.faces[f]),Buffer.from(raster.faces[f]),
    'the same terrain/seed yields the same painted river map');

// Width must be an attribute of discharge, not a constant on every river.
// Every edge ends at water or another downhill channel in one outlet basin.
for(let i=0;i<n;i++)if(network.channel[i]){
  const j=network.down[i];
  assert.equal(network.basin[i],network.basin[j]);
  assert.ok(network.height[j]<=network.height[i]);
  if(network.water[j])assert.equal(network.down[j],-1);
}
const maskGpu=fs.readFileSync(path.join(__dirname,'../js/river-gpu.js'),'utf8');
assert.match(maskGpu,/gl\.RGBA,gl\.UNSIGNED_BYTE,riverLoopFaces\[f\]/,
  'the raw painted mask should upload as RGBA8, never uint encoded');
assert.doesNotMatch(maskGpu,/RGBA32UI|gl\.RGBA_INTEGER|UNSIGNED_INT/,
  'integer river atlas has been removed');
console.log('river-drainage.test.js: OK',JSON.stringify({
  channels:raster.segments,strokes:raster.painted,paintedPixels,shadeLevels:reds.size
}));
