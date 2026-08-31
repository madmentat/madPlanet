const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/cryosphere-edge-display.js'),'utf8');

assert.match(src,/CRYOSPHERE_EDGE_DISPLAY_MODEL=3/,'hard-edge display model must stay active');
assert.doesNotMatch(src,/const feather=/,'polar ice must not regain an optical feather');
assert.match(src,/raw>=edgeNoise\?1:0/,'fractional physical coverage must resolve to binary visible ice');
assert.match(src,/raw<0\.15/,'very sparse sea ice must not become a milky coherent fringe');
assert.match(src,/gl\.TEXTURE_MIN_FILTER,gl\.NEAREST/,'linear cubemap filtering must not blur the binary ice mask');
assert.match(src,/cryoGpuBlendAt=function\(\)\{return 1;\}/,'temporal crossfade must not create translucent ice between updates');

const ctx={console,Math,Number,
  weatherFaceDir(face,u,v){
    const p=face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1];
    const q=Math.hypot(...p)||1;return p.map(x=>x/q);
  },
  cryoGpuEdgeNoise(){return 0.5;},cryoGpuVisualCoverage(raw){return raw;}
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'cryosphere-edge-display.js'});

assert.equal(ctx.cryoGpuVisualCoverage(0,0.5,false),0);
assert.equal(ctx.cryoGpuVisualCoverage(0.8,0.5,false),1,'dense continental ice is opaque');
assert.equal(ctx.cryoGpuVisualCoverage(0.35,0.20,true),1,'partial sea ice resolves to an opaque floe');
assert.equal(ctx.cryoGpuVisualCoverage(0.35,0.80,true),0,'same concentration can resolve to open water');
assert.equal(ctx.cryoGpuVisualCoverage(0.14,0.01,true),0,'<15% sea ice must not paint a coherent white fringe');
for(const v of [ctx.cryoGpuVisualCoverage(0.31,0.20,false),ctx.cryoGpuVisualCoverage(0.31,0.40,false)])
  assert.ok(v===0||v===1,'visible ice coverage must be strictly binary');

const at15=ctx.cryoDisplayTemperateTrimWeight(288.15);
const cold=ctx.cryoDisplayTemperateTrimWeight(260);
const hot=ctx.cryoDisplayTemperateTrimWeight(315);
assert.ok(at15>0.999,'+15 C must receive the full ~10% outer-cap trim');
assert.ok(cold<0.001&&hot<0.001,'the +15 C calibration must fade away in extreme climates');

console.log('cryosphere-hard-edge.test.js: OK');
