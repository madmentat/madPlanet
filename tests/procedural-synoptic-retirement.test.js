const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const retireSrc=fs.readFileSync(path.join(root,'js/procedural-synoptic-retirement.js'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const stateSrc=fs.readFileSync(path.join(root,'js/state.js'),'utf8');
const cloudSrc=fs.readFileSync(path.join(root,'shaders/clouds.glsl'),'utf8');

function assertOrdered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
assertOrdered(buildPs,['js/state.js','js/procedural-synoptic-retirement.js','js/camera.js'],'PowerShell retirement order');
assertOrdered(buildSh,['js/state.js','js/procedural-synoptic-retirement.js','js/camera.js'],'shell retirement order');

const hotA=Array.from({length:20},(_,i)=>i%4===3?0.9:0.25+i*0.01);
const hotB=Array.from({length:20},(_,i)=>0.2+i*0.02);
const ctx={Float32Array,
  world:{cycA:new Float32Array(hotA),cycB:new Float32Array(hotB)},
  deriveWorld:function(){this.world={cycA:new Float32Array(hotA),cycB:new Float32Array(hotB)};return this.world;}
};
vm.createContext(ctx);vm.runInContext(retireSrc,ctx,{filename:'procedural-synoptic-retirement.js'});
assert.ok(ctx.world.cycA instanceof Float32Array&&ctx.world.cycB instanceof Float32Array);
assert.equal(ctx.world.cycA.length,20);assert.equal(ctx.world.cycB.length,20);
assert.ok(Array.from(ctx.world.cycA).every(v=>v===0),'current world cycA must be completely neutralised');
assert.ok(Array.from(ctx.world.cycB).every(v=>v===0),'current world cycB must be completely neutralised');
ctx.deriveWorld();
assert.ok(Array.from(ctx.world.cycA).every(v=>v===0),'future deriveWorld must not revive cycA centres/strengths');
assert.ok(Array.from(ctx.world.cycB).every(v=>v===0),'future deriveWorld must not revive cycB radius/spin/front parameters');

/* Historical code can remain in the source tree until the 0.5.53 cloud ABI
   rewrite, but it must be downstream of an always-zero compatibility source. */
assert.ok(stateSrc.includes('cycA')&&cloudSrc.includes('uCycA'),'test must guard the still-present legacy ABI explicitly');
assert.ok(retireSrc.includes('new Float32Array(20)')&&retireSrc.includes('deriveWorldBeforeSynopticRetirement'));
assert.ok(!retireSrc.includes('Math.random'),'retirement must never create replacement procedural synoptics');
console.log('procedural-synoptic-retirement.test.js: OK');
