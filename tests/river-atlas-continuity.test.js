'use strict';
/* Raster acceptance: every river centerline must land on visible pixels of
   the SAME static RGBA8 mask that WebGL uploads, including cube face seams.
   It replaces the obsolete RGBA32UI 18-segment lookup test. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={weatherCoreCreate(){},weatherCoreStep(){}};
vm.createContext(ctx);
for(const name of ['river-gpu','river-drainage'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+name+'.js'),'utf8'),ctx);
let allSamples=0,allSeams=0,allMissing=0,allSegments=0,allDrawn=0;
for(const [N,seed] of [[14,8127344],[48,8127344],[48,55807208],[48,5569959]]){
  const grid=ctx.riverDrainageGrid(N),count=grid.area.length,
    h=new Float32Array(count),w=new Uint8Array(count),m=new Float32Array(count);
  const phase=seed*0.000001;
  for(let i=0;i<count;i++){
    const x=grid.dirs[3*i],y=grid.dirs[3*i+1],z=grid.dirs[3*i+2];
    h[i]=0.14+0.48*y+0.1*Math.sin(11*x+2*z+phase)+0.04*Math.cos(5*x-7*z-phase);
    w[i]=h[i]<0?1:0;
    m[i]=0.65+0.3*Math.sin(5*x+3*z+phase);
  }
  const net=ctx.riverDrainageBuild(h,w,m,grid.neighbors,grid.area,
    {sourceArea:2*(N/160)**2,sourceInset:3});
  const M=N*4,mask=ctx.riverDrainageRaster(grid,net,M),
    geo=ctx.riverDrainageCurveGeometry(grid,net),pos=[0,0,0],uv={};
  const audit=ctx.riverDrainageDiagnostics(net);
  assert.equal(audit.uphill,0);
  assert.equal(audit.dangling,0);
  assert.ok(mask.segments>100);
  let samples=0,missing=0,seams=0,examples=[];
  for(let i=0;i<net.down.length;i++){
    if(!net.channel[i])continue;
    for(const t of [0.2,0.5,0.8]){
      ctx.riverDrainageCurvePoint(geo,i,net.down[i],t,pos);
      ctx.riverGpuDirToFaceUV(pos[0],pos[1],pos[2],uv);
      const face=uv.face,x=Math.floor((uv.u+1)*M/2),
        y=Math.floor((1-uv.v)*M/2);
      let painted=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;
        if(xx<0||xx>=M||yy<0||yy>=M)continue;
        painted=Math.max(painted,mask.faces[face][4*(yy*M+xx)]);
      }
      if(Math.abs(uv.u)>0.96||Math.abs(uv.v)>0.96)seams++;
      samples++;
      if(!painted){
        missing++;
        if(examples.length<8)examples.push({i,t,face,x,y});
      }
    }
  }
  assert.equal(missing,0,'Painted river disappeared at '+N+'/'+seed+': '+JSON.stringify(examples));
  allSamples+=samples;allMissing+=missing;allSeams+=seams;
  allSegments+=mask.segments;allDrawn+=mask.painted;
}
assert.ok(allSeams>1000,'real globe seam segments must be tested');
assert.ok(allDrawn>allSegments,'curved lines must be sampled and drawn, not stored as abstract endpoints');
console.log('river-atlas-continuity.test.js: OK',JSON.stringify({
  riverSegments:allSegments,curveDabs:allDrawn,pixelSamples:allSamples,
  seamSamples:allSeams,missing:allMissing
}));
