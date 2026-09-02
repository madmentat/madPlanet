const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/polar-continentality.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');

for(const [name,text] of [['shell',buildSh],['PowerShell',buildPs]]){
  const a=text.indexOf('js/polar-surface-thermodynamics.js');
  const b=text.indexOf('js/polar-continentality.js');
  const c=text.indexOf('js/cryosphere-sublimation.js');
  assert.ok(a>0&&b>a&&c>b,name+' build must load continentality after polar skin physics and before sublimation');
}
assert.ok(!/requestAnimationFrame|Math\.random/.test(src),'polar continentality must stay deterministic and off render FPS');
assert.match(src,/PCI_MAX_EXTRA_K=22\.0/,'continental interior must have a bounded but strong cold anomaly');
assert.match(src,/polarContinentality/,'continentality cache field missing');
assert.match(src,/pstTargetLandOffsetKBeforeContinentality/,'continentality must extend the physical polar target, not recolor the shader');

function makeCore(allLand){
  const n=5;
  const water=new Float32Array(n);
  if(!allLand){for(let i=1;i<n;i++)water[i]=1;}
  const nb=Array.from({length:4},()=>new Int32Array(n));
  for(let k=0;k<4;k++){
    nb[k][0]=k+1;
    for(let i=1;i<n;i++)nb[k][i]=0;
  }
  return {
    count:n,N:1,h2oSurfaceSignature:allLand?'interior':'coast',surfaceWaterFraction:water,
    windNeighbor:nb,dirX:new Float32Array(n),dirY:new Float32Array(n).fill(-1),dirZ:new Float32Array(n),
    snowCoverFraction:new Float32Array(n).fill(1),landIceCoverFraction:new Float32Array(n).fill(1)
  };
}
const ctx={console,Math,Number,Float32Array,window:{},
  pstTargetLandOffsetK:()=>-12,
  pstPolarStrength:()=>1,pstDarkness:()=>1,
  weatherCoreCreate:()=>null,weatherCoreStep:c=>c,weatherCoreFinite:()=>true
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'polar-continentality.js'});
const climate={T:286.3};
const interior=makeCore(true);ctx.pciEnsure(interior);
const coast=makeCore(false);ctx.pciEnsure(coast);
assert.ok(interior.polarContinentality[0]>0.95,'land-surrounded polar cell must classify as continental interior');
assert.ok(coast.polarContinentality[0]<0.10,'ocean-surrounded polar cell must classify as maritime/coastal');
const interiorTarget=ctx.pstTargetLandOffsetK(interior,0,climate,[0,1,0]);
const coastTarget=ctx.pstTargetLandOffsetK(coast,0,climate,[0,1,0]);
assert.ok(interiorTarget<-30,'icy continental polar interior must receive >30 K total extra cooling; got '+interiorTarget.toFixed(1));
assert.ok(coastTarget>-16,'maritime polar land must not receive the continental-interior penalty; got '+coastTarget.toFixed(1));
assert.ok(interiorTarget<coastTarget-15,'continental interior must be far colder than a coastal polar cell');
assert.ok(ctx.pciClimateGate({T:315})<0.01,'continental cold trap must disappear on genuinely hot worlds');
console.log('polar-continentality.test.js: OK');
