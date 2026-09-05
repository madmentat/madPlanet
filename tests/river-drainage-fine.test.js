'use strict';
/* 0.5.160: river geometry from the baked terrain. Priority-Flood + D8 on a
   fine cubed sphere must drain every land cell monotonically to the sea,
   turn pits into lakes, publish source-to-mouth chains whose nodes follow
   the downstream pointers, and hand the renderer chords through the same
   vector table the analytic shader reads. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const fine=read('js/river-drainage-fine.js');
const gpu=read('js/river-gpu.js');
const bake=read('js/terrain-bake.js');
const bakeGlsl=read('shaders/terrain-bake.glsl');
const worker=read('js/weather-worker.js');
const shader=read('shaders/surface.glsl');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

assert.match(bakeGlsl,/float h = terrain\(d, rock, mount, lee\);/,'the bake must evaluate the rendered terrain function');
assert.match(bakeGlsl,/if\(f == 0\) d = vec3\(1\.0, v, -u\);/,'bake face 0 must follow riverGpuDirToFaceUV conventions');
assert.match(bake,/gl\.uniform1f\(Uu\.uCamDist,10\.0\);gl\.uniform1f\(Uu\.uDraft,1\.0\);/,'no camera-dependent detail octave may be baked');
assert.match(bake,/gl\.uniformMatrix3fv\(Uu\.uRotS,false,new Float32Array\(\[1,0,0,0,1,0,0,0,1\]\)\);/,'heights must be baked in surface space');
assert.match(bake,/gl\.readPixels\(0,0,F,F,gl\.RGBA,gl\.UNSIGNED_BYTE,pix\);/,'readback must use the always-available RGBA8 path');
assert.match(worker,/riverFineTerrainForWorker\(\)/,'the tick request must carry a fresh terrain bake');
assert.match(worker,/weatherWorker\.postMessage\(msg,\[terrain\.h\.buffer\]\)/,'the height buffer must be transferred, not copied');
assert.match(worker,/riverFineSetTerrain\(m\.terrain\.F,m\.terrain\.h,m\.terrain\.sig\)\)wwTicksSinceRiver=1e9;/,'a new terrain must force a river refresh');
assert.match(gpu,/if\(typeof riverFineActive==='function'&&riverFineActive\(core\)\)\{\s*riverVecReset\(\);riverFineReadCurrent\(core\);riverVecFinish\(\);return;/,'fine drainage must own the river bridge when available');
for(const b of [buildSh,buildPs]){
  assert.ok(b.includes('shaders/terrain-bake.glsl'),'build must assemble the terrain bake shader');
  assert.ok(b.indexOf('js/river-render.js')<b.indexOf('js/terrain-bake.js')&&b.indexOf('js/terrain-bake.js')<b.indexOf('js/river-drainage-fine.js'),'bake and fine drainage must load after the river renderer');
  assert.ok(b.indexOf('js/river-drainage-fine.js')<b.indexOf('js/weather-worker.js'),'fine drainage must exist before the worker bridge');
}
assert.match(buildSh,/TERRAIN_BAKE_FRAG="#version 300 es\n\$\(cat "\$DIR\/shaders\/header\.glsl"\)\n\$\(cat "\$DIR\/shaders\/noise\.glsl"\)\n\$\(cat "\$DIR\/shaders\/terrain\.glsl"\)\n\$\(cat "\$DIR\/shaders\/terrain-bake\.glsl"\)"/,'bake shader must be header+noise+terrain+bake');

const ctx={console,Math,Number,Date,Array,Map,Set,String,Float32Array,Float64Array,Int32Array,Int16Array,Uint8Array,ArrayBuffer,
  UNIFORM_NAMES:[],weatherCoreCreate:()=>({count:1}),weatherCoreStep:c=>c,MP_IS_WEATHER_WORKER:true};
vm.createContext(ctx);
vm.runInContext(gpu,ctx,{filename:'river-gpu.js'});
vm.runInContext(fine,ctx,{filename:'river-drainage-fine.js'});
ctx.gl={TEXTURE_CUBE_MAP:1,TEXTURE_CUBE_MAP_POSITIVE_X:10,TEXTURE0:20,RGBA:30,UNSIGNED_BYTE:40,
  TEXTURE_MIN_FILTER:50,TEXTURE_MAG_FILTER:51,TEXTURE_WRAP_S:52,TEXTURE_WRAP_T:53,TEXTURE_WRAP_R:54,
  LINEAR:60,LINEAR_MIPMAP_LINEAR:61,CLAMP_TO_EDGE:62,
  createTexture:()=>({}),deleteTexture:()=>{},activeTexture:()=>{},bindTexture:()=>{},
  texParameteri:()=>{},texImage2D:()=>{},texSubImage2D:()=>{},generateMipmap:()=>{}};
ctx.webglVersion=1;
const g=expr=>vm.runInContext(expr,ctx);

/* Synthetic planet: one large continental cap around C, a trough valley
   across it that collects a trunk river, a ridge, and a closed pit. */
const F=20,n=6*F*F,h=new Float32Array(n),dir=[0,0,0];
const C=[0.3,0.5,0.81],cq=Math.hypot(...C);C[0]/=cq;C[1]/=cq;C[2]/=cq;
const plane=[0.8,-0.3,-0.11];{const q=Math.hypot(...plane);plane[0]/=q;plane[1]/=q;plane[2]/=q;}
/* the pit sits on the trough axis, where only the gentle cap slope competes */
const t1=[plane[1]*C[2]-plane[2]*C[1],plane[2]*C[0]-plane[0]*C[2],plane[0]*C[1]-plane[1]*C[0]];{const q=Math.hypot(...t1);t1[0]/=q;t1[1]/=q;t1[2]/=q;}
const pit=[C[0]+0.12*t1[0],C[1]+0.12*t1[1],C[2]+0.12*t1[2]],pq=Math.hypot(...pit);pit[0]/=pq;pit[1]/=pq;pit[2]/=pq;
for(let i=0;i<n;i++){
  ctx.rdfCellDir(F,i,dir);
  const d=dir[0]*C[0]+dir[1]*C[1]+dir[2]*C[2];
  let v=(d-0.45)*0.35;
  const t=Math.abs(dir[0]*plane[0]+dir[1]*plane[1]+dir[2]*plane[2]);
  v-=0.12*Math.exp(-Math.pow(t/0.16,2));
  const ridge=Math.exp(-Math.pow((dir[0]-0.15)/0.08,2))*0.10;
  const pd=1-(dir[0]*pit[0]+dir[1]*pit[1]+dir[2]*pit[2]);
  v+=ridge-0.05*Math.exp(-pd/0.004);
  h[i]=v;
}
assert.ok(ctx.riverFineSetTerrain(F,h,'synthetic'),'terrain must be accepted');
const d=ctx.riverFineEnsureBuilt();
assert.equal(d.F,F);
let landCount=0,reached=0;
for(let i=0;i<n;i++){
  if(!d.land[i])continue;landCount++;
  const j=d.ds[i];
  assert.ok(j>=0,'every land cell must have a downstream cell');
  assert.ok(d.filled[j]<d.filled[i],'flow must never go uphill on the filled surface');
  let c=i,guard=0;while(d.land[c]&&guard++<n)c=d.ds[c];
  assert.ok(!d.land[c],'every land cell must drain to the ocean');reached++;
}
assert.ok(landCount>200,'synthetic continent too small: '+landCount);
assert.equal(reached,landCount);
const pitIdx=ctx.rdfDirToIndex(F,pit[0],pit[1],pit[2]);
assert.ok(d.land[pitIdx]&&d.depth[pitIdx]>0.01,'a closed pit must be filled into a lake, depth='+d.depth[pitIdx]);

/* Seams: stepping off a face edge must land on a neighbouring cell of the
   adjacent face, never on the cell itself, and about one cell away. */
for(let face=0;face<6;face++)for(const [x,y,dx,dy] of [[0,7,-1,0],[F-1,3,1,0],[5,0,0,-1],[9,F-1,0,1],[0,0,-1,-1],[F-1,F-1,1,1]]){
  const i=(face*F+y)*F+x,nb=ctx.rdfNeighbour(F,i,dx,dy);
  assert.notEqual(nb,i,'seam neighbour must differ from the cell');
  const a=ctx.rdfCellDir(F,i,[0,0,0]),b=ctx.rdfCellDir(F,nb,[0,0,0]);
  const ang=Math.acos(Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2])));
  assert.ok(ang<2.2*(2/F)*Math.SQRT2,'seam neighbour must be adjacent, angle='+ang);
}

/* Chains follow downstream pointers, end at the sea or on another chain. */
ctx.riverGpuEnsure(64);
const core={N:8,count:1,riverChannelStrength:new Float32Array(1)};
ctx.riverGpuReadCurrent(core);
assert.ok(core.riverFineChords>0,'chords must be published: '+core.riverFineChords);
assert.equal(g('riverVecCount'),core.riverFineChords,'published chords must land in the vector table');
const acc=g('rdfAccQ'),ch=ctx.rdfChains(d,acc);
assert.ok(ch.chains.length>0,'a wet continent must have rivers');
const nodes=new Set();
for(const c of ch.chains)for(const x of c.cells)nodes.add(x);
for(const c of ch.chains){
  for(let k=0;k<c.cells.length-1;k++)assert.equal(d.ds[c.cells[k]],c.cells[k+1],'chain nodes must be consecutive downstream cells');
  for(let k=1;k<c.cells.length;k++)assert.ok(acc[c.cells[k]]>=acc[c.cells[k-1]],'accumulated wet area must not decrease downstream');
  const last=c.cells[c.cells.length-1];
  if(c.mouth){
    assert.ok(!d.land[d.ds[last]],'a mouth chain must end at a sea cell');
    const hm=Math.hypot(c.mouth[0],c.mouth[1],c.mouth[2]);assert.ok(Math.abs(hm-1)<1e-6,'mouth point must be on the unit sphere');
  }else{
    assert.ok(nodes.has(last)&&c.cells.length>=2,'a tributary must end on a node of another chain');
    assert.notEqual(ch.chains.find(o=>o!==c&&o.cells.indexOf(last)>=0),undefined,'the junction node must belong to another chain');
  }
}
const seg=g('riverVecSegments');
for(let i=0;i<g('riverVecCount');i++){
  const o=i*8;
  assert.ok(seg[o+7]>0&&seg[o+7]<0.006,'chord half-width must stay a thin line');
  assert.ok(Math.abs(Math.hypot(seg[o+4],seg[o+5],seg[o+6])-1)<1e-5,'chord end must lie on the sphere');
}
/* Coarse ocean cells are no information, not drought: a fine land cell
   mapped to one inherits its land neighbours' runoff. */
{
  const cc={count:3,riverRunoffMean:new Float32Array([0,2.1e-5,0]),windNeighbor:[Int32Array.from([1,0,1]),Int32Array.from([1,2,1]),Int32Array.from([1,0,1]),Int32Array.from([1,2,1])]};
  ctx.riverIsOcean=(core,i)=>core.riverRunoffMean[i]===0;
  const cw=ctx.rdfCoarseWetness(cc);
  assert.ok(Math.abs(cw[1]-(0.3+0.7*2))<1e-6,'land cell keeps its own runoff ratio above the floor');
  assert.ok(Math.abs(cw[0]-cw[1])<1e-6&&Math.abs(cw[2]-cw[1])<1e-6,'coarse ocean cells take the neighbouring land runoff');
  const fresh={count:2,riverRunoffMean:new Float32Array([0,0]),surfaceWaterFraction:new Float32Array([0,0]),windNeighbor:[Int32Array.from([1,0]),Int32Array.from([1,0]),Int32Array.from([1,0]),Int32Array.from([1,0])]};
  ctx.riverIsOcean=(core,i)=>core.surfaceWaterFraction[i]>=0.5;
  const fw=ctx.rdfCoarseWetness(fresh);
  assert.ok(fw[0]===1&&fw[1]===1,'an unbootstrapped runoff memory must not erase every river');
  delete ctx.riverIsOcean;
}
assert.match(bake,/Number\(state\.sea\)\.toFixed\(2\)/,'the derived sea level must be quantised in the bake signature');
assert.match(fine,/RDF_SIGNATURE_SETTLE_MS=1500/,'a changed signature must settle before a rebuild');
assert.match(fine,/const junction=!ch\.mouth&&k===edges-1;/,'a tributary must not inherit the trunk width at its junction');
assert.match(worker,/if\(typeof riverGpuUpload==='function'\)riverGpuUpload=function\(\)\{return false;\};/,'the worker must publish rivers only through wwRiverFaces');
assert.match(bake,/COMPLETION_STATUS_KHR/,'the bake program must link asynchronously where the extension exists');
assert.match(gpu,/RIVER_VEC_BIN_N=128;/,'dense fine networks need 128 chord bins per face');
assert.match(shader,/int count = int\(min\(bin\.y, 48\.0\) \+ 0\.5\);/,'the shader must visit up to 48 chords per bin');
assert.match(fine,/function rdfHalfWidthRad\(strength,widthM\)/,'fine channels need their own width curve');
assert.match(fine,/RDF_WET_FLOOR=0\.30/,'a dry basin must keep a wetness floor');
assert.match(read('js/river-frame-pacing.js'),/if\(core\.__mirror\|\|riverPacingImmediateRequired\(core\)\)return riverPacingRecordPublish\(core\);/,'worker mirrors must publish immediately');
assert.ok(ctx.rdfHalfWidthRad(1,2000)/ctx.rdfHalfWidthRad(0.12,50)>5,'trunks must draw several times wider than threshold creeks');
assert.match(bake,/terrainBakeFailed=true;\n  \}\n  terrainBakeTexN=ok\?F:0;/,'an incomplete bake framebuffer must disable the bake');
/* A dry basin (zero runoff everywhere) must have no rivers. */
ctx.windDirToIndex=()=>0;
ctx.riverIsOcean=(core,i)=>core.surfaceWaterFraction[i]>=0.5;
const dry={N:8,count:2,riverChannelStrength:new Float32Array(2),riverRunoffMean:new Float32Array([0,3e-5]),surfaceWaterFraction:new Float32Array([0,0]),windNeighbor:[Int32Array.from([1,0]),Int32Array.from([1,0]),Int32Array.from([1,0]),Int32Array.from([1,0])]};
ctx.windDirToIndex=()=>0;
ctx.riverFineReadCurrent(dry);
const wetChords=core.riverFineChords;
assert.ok(dry.riverFineChords<wetChords,'a dry basin must carry fewer channels than a wet one: '+dry.riverFineChords+' vs '+wetChords);
console.log('river-drainage-fine.test.js: OK');
