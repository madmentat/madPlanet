const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/cryosphere-edge-display.js'),'utf8');
const surface=fs.readFileSync(path.join(root,'shaders/surface.glsl'),'utf8');

assert.match(src,/CRYOSPHERE_EDGE_DISPLAY_MODEL=5/,'global-warp hard-edge display model must stay active');
assert.match(src,/CRYO_CAP_GLOBAL_WARP_MAX_RAD=0\.18/,'orbital-scale polar deformation needs an explicit ~10 degree cap');
assert.doesNotMatch(src,/const feather=/,'polar ice must not regain an optical feather');
assert.match(src,/raw>=edgeNoise\?1:0/,'fractional physical coverage must resolve to binary visible ice');
assert.match(src,/raw<0\.15/,'very sparse sea ice must not become a milky coherent fringe');
assert.match(src,/gl\.TEXTURE_MIN_FILTER,gl\.NEAREST/,'linear cubemap filtering must not blur the binary ice mask');
assert.match(src,/cryoGpuBlendAt=function\(\)\{return 1;\}/,'temporal crossfade must not create translucent ice between updates');

/* 0.5.108 removed the 70% circular shortcut; 0.5.109 must go further and move
   the physical snow line itself on orbital/continental scales. Merely adding
   more fine edge noise is not enough. */
assert.doesNotMatch(src,/!sea\s*&&\s*raw>=0\.70/,'the old 70% circular dense-cap shortcut must never return');
assert.match(src,/raw>=0\.995\)return 1/,'only a truly saturated physical ice core may bypass geographic edge breakup');
assert.match(src,/function cryoDisplayPolarWarpFrame\(/,'polar deformation needs a body-fixed geographic frame');
assert.match(src,/function cryoDisplayPolarOffsetRad\(/,'polar deformation needs a low-order sector displacement');
assert.match(src,/0\.060\*h1\+0\.090\*h2\+0\.050\*h3\+0\.025\*h5/,
  'global cap outline must combine several large sectors instead of one circular isocontour');
assert.match(src,/function cryoDisplayWarpDirection\(/,'physical cryosphere sampling direction must be displaced');
assert.match(src,/const sampleDir=cryoDisplayWarpDirection\(d,warpFrame\)/,
  'cryosphere rebuild must actually consume the global polar warp');
assert.match(src,/cryoDisplaySampleDirection\(core,sampleDir,false\)/,
  'land ice must be sampled through the displaced direction, not only threshold-noised in place');
for(const f of ['2.35','5.40','13.7','31.1'])assert.ok(src.includes(f),'missing shoreline edge scale '+f);

/* 0.5.82: a second, shader-local cold closure used to bypass all of the hard
   cryosphere rules above. deepColdIce was a smooth 0..1 mask from 258..271 K,
   then mixed directly into ocean colour. The emergency sub-grid closure may
   remain, but it must be a binary phase decision and sea-ice opacity itself
   must stay binary. */
assert.match(surface,/float deepColdIce = \(ecologyK < 258\.15\) \? 1\.0 : 0\.0;/,
  'deep-cold sub-grid closure must be a binary phase decision');
assert.doesNotMatch(surface,/deepColdIce\s*=\s*1\.0-ss\(/,
  'deep-cold correction must not regain a smooth translucent temperature lens');
assert.match(surface,/float seaCover=max\(seaIcePhys,deepColdIce\);\s*\n\s*float ice=seaCover;/,
  'surface sea-ice opacity must come directly from binary coverage');
assert.doesNotMatch(surface,/shoreBiasedSea\*iceMicro/,
  'surface shader must not turn binary sea ice back into fractional opacity');
assert.match(surface,/if\(ice > 0\.5\)\{[\s\S]*?oc = iceCol;/,
  'an ice-covered ocean sample must receive an opaque ice surface colour');

const ctx={console,Math,Number,
  weatherFaceDir(face,u,v){
    const p=face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1];
    const q=Math.hypot(...p)||1;return p.map(x=>x/q);
  },
  cryoGpuEdgeNoise(){return 0.5;},cryoGpuVisualCoverage(raw){return raw;}
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'cryosphere-edge-display.js'});

assert.equal(ctx.cryoGpuVisualCoverage(0,0.5,false),0);
assert.equal(ctx.cryoGpuVisualCoverage(1.0,0.99,false),1,'saturated continental core stays solid');
assert.equal(ctx.cryoGpuVisualCoverage(0.80,0.50,false),1,'dense transitional land ice may be opaque where geography supports it');
assert.equal(ctx.cryoGpuVisualCoverage(0.80,0.85,false),0,'the same physical density may form a bay instead of a forced circular core');
assert.equal(ctx.cryoGpuVisualCoverage(0.35,0.20,true),1,'partial sea ice resolves to an opaque floe');
assert.equal(ctx.cryoGpuVisualCoverage(0.35,0.80,true),0,'same concentration can resolve to open water');
assert.equal(ctx.cryoGpuVisualCoverage(0.14,0.01,true),0,'<15% sea ice must not paint a coherent white fringe');
for(const v of [ctx.cryoGpuVisualCoverage(0.31,0.20,false),ctx.cryoGpuVisualCoverage(0.31,0.40,false)])
  assert.ok(v===0||v===1,'visible ice coverage must be strictly binary');

/* Behavioural guard: at one fixed high latitude the new global warp must move
   the sampled snow line by a clearly orbital-scale amount. This prevents a
   future "fix" from quietly collapsing back to cosmetic edge fuzz. */
const axis=[0,1,0],frame=ctx.cryoDisplayPolarWarpFrame(90636862,axis);
const lat=67*Math.PI/180,warped=[];
for(let i=0;i<72;i++){
  const lon=2*Math.PI*i/72;
  const d=[Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon)];
  const w=ctx.cryoDisplayWarpDirection(d,frame);
  warped.push(Math.asin(Math.max(-1,Math.min(1,w[1]))));
}
const span=(Math.max(...warped)-Math.min(...warped))*180/Math.PI;
assert.ok(span>12,'global polar outline must vary by >12 degrees around a representative latitude; got '+span.toFixed(2));

const at15=ctx.cryoDisplayTemperateTrimWeight(288.15);
const cold=ctx.cryoDisplayTemperateTrimWeight(260);
const hot=ctx.cryoDisplayTemperateTrimWeight(315);
assert.ok(at15>0.999,'+15 C must receive the full ~10% outer-cap trim');
assert.ok(cold<0.001&&hot<0.001,'the +15 C calibration must fade away in extreme climates');

console.log('cryosphere-hard-edge.test.js: OK');
