const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/weather-core.js'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+0\.5\.39\s*$/m,'Weather Core milestone must be 0.5.39');
assert.ok(buildPs.includes("'js/stellar-weather-coupling.js','js/weather-core.js','js/render.js'"),
  'PowerShell build must load Weather Core after climate coupling and before render');
assert.ok(buildSh.includes('js/stellar-weather-coupling.js js/weather-core.js js/render.js'),
  'shell build must load Weather Core after climate coupling and before render');

const state={seed:8127344,draft:true};
const ctx={console,Math,Number,Date,Float32Array,state};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'weather-core.js'});

const climate={T:288.15,pressureBar:1.013,h2oBar:0.004,cloudCov:0.45,iceArea:0.02,waterAvail:1,S:1,regime:'temperate'};
const axis=[0,1,0];
const a=ctx.weatherCoreCreate(12345,32,climate,axis);
const b=ctx.weatherCoreCreate(12345,32,climate,axis);
const c=ctx.weatherCoreCreate(54321,32,climate,axis);
assert.equal(a.count,6*32*32,'draft/mobile grid must contain 6144 cubed-sphere cells');
assert.equal(ctx.weatherCoreCreate(1,48,climate,axis).count,6*48*48,
  'normal desktop grid must contain 13824 cubed-sphere cells');
assert.ok(a.surfaceTemp instanceof Float32Array&&a.humidity instanceof Float32Array,
  'weather fields must use compact persistent typed arrays');
assert.equal(a.surfaceTemp[137],b.surfaceTemp[137],'same seed/base/N must initialize deterministically');
assert.notEqual(a.surfaceTemp[137],c.surfaceTemp[137],'different seed must alter only the small initial perturbation');
assert.ok(ctx.weatherCoreFinite(a),'initial Weather Core must contain no NaN/Infinity');

for(const i of [0,31,1024,4095,6143]){
  const n=Math.hypot(a.dirX[i],a.dirY[i],a.dirZ[i]);
  assert.ok(Math.abs(n-1)<1e-5,'cubed-sphere direction must remain normalized');
  assert.ok(a.pressure[i]>0,'Earth-like cell pressure must stay positive');
  assert.ok(a.humidity[i]>=0&&a.humidity[i]<=1,'humidity must stay bounded');
}

/* Fixed-step determinism: rendering cadence is absent from the API. */
const s1=ctx.weatherCoreCreate(99,16,climate,axis);
const s2=ctx.weatherCoreCreate(99,16,climate,axis);
ctx.weatherCoreStep(s1,300,climate,axis);
ctx.weatherCoreStep(s2,300,climate,axis);
assert.equal(s1.simSeconds,300);
assert.equal(s1.ticks,1);
assert.equal(s1.airTemp[200],s2.airTemp[200],'same fixed weather tick must be deterministic');
assert.ok(ctx.weatherCoreFinite(s1),'stepped Weather Core must contain no NaN/Infinity');

const before=ctx.weatherCoreMeans(s1).T;
const hot={...climate,T:500,h2oBar:2,cloudCov:0.7,iceArea:0};
ctx.weatherCoreStep(s1,300,hot,axis);
assert.ok(ctx.weatherCoreMeans(s1).T>before,'global climate change must move persistent local air temperatures in the same direction');

assert.ok(!src.includes('requestAnimationFrame'),'weather integration must never run at render FPS');
assert.ok(src.includes('WEATHER_CORE_REAL_TICK_MS = 1000'),'CPU weather tick must be explicitly slow');
assert.ok(src.includes('WEATHER_CORE_FIXED_DT_SEC = 300'),'weather simulation must use a fixed model timestep');
assert.ok(src.includes('document.hidden')&&src.includes('return false; /* no catch-up */'),
  'hidden tabs must skip weather work instead of catching up elapsed wall time');
assert.ok(!src.includes('const d=[core.dirX[i]'),
  'hot weather loop must not allocate a temporary vector per cell');
assert.ok(src.includes('new Float32Array(count)'),'weather fields must be preallocated rather than grown per tick');

console.log('weather-core.test.js: OK');
