'use strict';
/* CPU mirror of the fragment shader's 3x3 cubemap neighborhood and its two
   packed channel candidates. It checks that every visible routed edge is
   discoverable at 12%, 50%, and 88% of its length, even across cube seams.
   Run in CI with: node tests/river-atlas-continuity.test.js. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx={weatherCoreCreate(){},weatherCoreStep(){}};vm.createContext(ctx);
for(const file of ['river-gpu','river-drainage'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+file+'.js'),'utf8'),ctx);

function dirFromFace(f,u,v){
  const out=[0,0,0];
  ctx.riverLoopFaceDir(f,(u+1)*0.5,(1-v)*0.5,1,out);
  return out;
}
function distance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
const uv={};
function storedEdgeAvailable(atlas,M,query,a,b){
  ctx.riverGpuDirToFaceUV(query[0],query[1],query[2],uv);
  const face=uv.face;
  const x=Math.floor((uv.u+1)*0.5*M),y=Math.floor((1-uv.v)*0.5*M);
  const nearSeam=Math.abs(uv.u)>0.97||Math.abs(uv.v)>0.97;
  // Mirror the shader's 3x3 cubemap queries, including cross-face samples.
  for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
    const p=dirFromFace(face,(x+ox+0.5)/M*2-1,1-(y+oy+0.5)/M*2);
    ctx.riverGpuDirToFaceUV(p[0],p[1],p[2],uv);
    const f=uv.face,
      xx=Math.max(0,Math.min(M-1,Math.floor((uv.u+1)*0.5*M))),
      yy=Math.max(0,Math.min(M-1,Math.floor((1-uv.v)*0.5*M))),
      offset=4*(yy*M+xx),pixels=atlas.faces[f];
    for(let slot=0;slot<2;slot++){
      const candidate=ctx.riverDrainageUnpackSegment(pixels,offset,slot);
      if(!candidate.widthA)continue;
      const aa=dirFromFace(f,candidate.uv[0],candidate.uv[1]);
      const bb=dirFromFace(f,candidate.uv[2],candidate.uv[3]);
      if(Math.max(distance(aa,a),distance(bb,b))<0.0006)
        return {found:true,seam:nearSeam,slot};
    }
  }
  return {found:false,seam:nearSeam};
}

let allSamples=0,allSeams=0,allSecondary=0,allMissing=0,allSegments=0;
function run(N,seed){
  const grid=ctx.riverDrainageGrid(N),count=grid.area.length;
  const h=new Float32Array(count),water=new Uint8Array(count),wet=new Float32Array(count);
  for(let i=0;i<count;i++){
    const x=grid.dirs[3*i],y=grid.dirs[3*i+1],z=grid.dirs[3*i+2];
    const phase=seed*0.000001;
    h[i]=0.14+0.48*y+0.1*Math.sin(11*x+2*z+phase)+0.04*Math.cos(5*x-7*z-phase);
    water[i]=h[i]<0?1:0;
    wet[i]=0.65+0.3*Math.sin(5*x+3*z+phase);
  }
  const net=ctx.riverDrainageBuild(h,water,wet,grid.neighbors,grid.area,
    {sourceArea:2*(N/160)**2,sourceInset:3});
  const M=N*2,atlas=ctx.riverDrainageRaster(grid,net,M);
  const geometry=ctx.riverDrainageCurveGeometry(grid,net);
  const steps=vm.runInContext('RIVER_DRAINAGE_CURVE_STEPS',ctx);
  const audit=ctx.riverDrainageDiagnostics(net);
  assert.equal(audit.uphill,0);assert.equal(audit.dangling,0);
  assert.ok(atlas.segments>100,'scenario should contain rivers');
  let samples=0,seams=0,secondary=0,missing=0;
  const missingExamples=[];
  for(let i=0;i<net.down.length;i++){
    if(!net.channel[i])continue;
    const j=net.down[i];
    for(const t of [0.12,0.5,0.88]){
      const part=Math.min(steps-1,
        Math.floor(t*steps));
      const a=[0,0,0],b=[0,0,0],v=[0,0,0];
      ctx.riverDrainageCurvePoint(geometry,i,j,
        part/steps,a);
      ctx.riverDrainageCurvePoint(geometry,i,j,
        (part+1)/steps,b);
      ctx.riverDrainageCurvePoint(geometry,i,j,t,v);
      const found=storedEdgeAvailable(atlas,M,v,a,b);
      samples++;if(found.seam)seams++;
      if(found.slot===1)secondary++;
      if(!found.found){missing++;if(missingExamples.length<8)missingExamples.push({edge:i,j,t});}
    }
  }
  assert.equal(missing,0,
    'atlas lost channel edges at '+N+'/'+seed+': '+JSON.stringify(missingExamples));
  allSamples+=samples;allSeams+=seams;allSecondary+=secondary;
  allMissing+=missing;allSegments+=atlas.segments;
}
for(const [N,seed] of [[20,8127344],[48,8127344],[96,8127344],[160,8127344],
                        [48,55807208],[48,5569959]])
  run(N,seed);
assert.ok(allSeams>1000,'test must exercise actual cube seams');
assert.ok(allSecondary>100,'some confluences must need the secondary atlas slot');
console.log('river-atlas-continuity.test.js: OK',JSON.stringify({
  segments:allSegments,samples:allSamples,seamSamples:allSeams,
  secondarySlotSamples:allSecondary,missing:allMissing
}));
