const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const src=read('js/weather-audit-diagnostics.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');
const version=read('VERSION.txt');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=61),'H2O normalization telemetry requires 0.5.61+');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/cryosphere-sublimation.js','js/physical-fog.js','js/fog-spatial-fix.js','js/weather-audit-diagnostics.js','js/lightning-weather.js'];
ordered(buildSh,order,'shell audit diagnostics order');
ordered(buildPs,order,'PowerShell audit diagnostics order');

const ctx={
  console,Math,Number,Float32Array,
  h2oNormalizeGlobalVapor(core){
    for(let i=0;i<core.count;i++){
      core.vaporColumn[i]*=2;
      core.cloudWaterState[i]*=2;
    }
    return 2;
  },
  condAreaMeanTotal(core){
    let sw=0,sum=0;
    for(let i=0;i<core.count;i++){
      const w=core.areaWeight[i];sw+=w;sum+=w*(core.vaporColumn[i]+core.cloudWaterState[i]);
    }
    return sum/sw;
  },
  weatherCoreAxis:()=>[0,1,0],
  h2oSaturationColumnKgM2:()=>10,
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'weather-audit-diagnostics.js'});

const core={count:2,
  areaWeight:new Float32Array([1,1]),
  vaporColumn:new Float32Array([1,1]),cloudWaterState:new Float32Array([0.5,0.5]),
  relativeHumidity:new Float32Array([0.15,0.15]),airTemp:new Float32Array([288,288]),
  fogState:new Float32Array([0,0]),windStateU:new Float32Array([1,1]),windStateV:new Float32Array([0,0]),
  surfaceSnowWater:new Float32Array([0,0]),landIceWater:new Float32Array([0,0]),
  dirX:new Float32Array([1,0]),dirY:new Float32Array([0,1]),dirZ:new Float32Array([0,0]),
};

const ret1=ctx.h2oNormalizeGlobalVapor(core,{});
assert.equal(ret1,2,'instrumentation must preserve wrapped normalizer return value');
assert.ok(Math.abs(core.h2oNormalizationCorrectionKgM2-1.5)<1e-6,'delta must equal actual atmospheric column change');
assert.ok(Math.abs(core.h2oNormalizationCumulativeKgM2-1.5)<1e-6);
assert.ok(Math.abs(core.h2oNormalizationAbsCumulativeKgM2-1.5)<1e-6);
assert.equal(core.h2oNormalizationScale,2);assert.equal(core.h2oNormalizationSamples,1);

ctx.h2oNormalizeGlobalVapor(core,{});
assert.ok(Math.abs(core.h2oNormalizationCorrectionKgM2-3.0)<1e-6);
assert.ok(Math.abs(core.h2oNormalizationCumulativeKgM2-4.5)<1e-6,'signed cumulative correction must expose persistent injection/removal');
assert.ok(Math.abs(core.h2oNormalizationAbsCumulativeKgM2-4.5)<1e-6);
assert.equal(core.h2oNormalizationSamples,2);

const d=ctx.weatherAuditStats(core,{});
assert.equal(d.normScale,2);assert.equal(d.normSamples,2);
assert.ok(Math.abs(d.normDelta-3.0)<1e-6&&Math.abs(d.normSum-4.5)<1e-6);
assert.match(src,/H₂O norm Δ \/ Σ/,'Weather panel must expose normalization correction');
assert.ok(!/requestAnimationFrame\s*\(/.test(src),'audit telemetry must stay off render FPS');
console.log('weather-audit-diagnostics.test.js: OK');
