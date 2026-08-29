const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const version=read('VERSION.txt');
const header=read('shaders/header.glsl');
const prelude=read('shaders/weather-cloud-prelude.glsl');
const bridge=read('shaders/weather-cloud-visual.glsl');
const main=read('shaders/main.glsl');
const gpu=read('js/weather-cloud-gpu.js');
const response=read('js/cloud-visual-response.js');
const render=read('js/weather-cloud-render.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m);
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const shaderOrder=['shaders/header.glsl','shaders/weather-cloud-prelude.glsl','shaders/clouds.glsl','shaders/weather-cloud-visual.glsl','shaders/atmosphere.glsl'];
ordered(buildSh,shaderOrder,'shell shader order');ordered(buildPs,shaderOrder,'PowerShell shader order');
const jsOrder=['js/lightning-weather.js','js/cloud-visual-response.js','js/weather-cloud-gpu.js','js/planet-export.js','js/render.js','js/weather-cloud-render.js'];
ordered(buildSh,jsOrder,'shell JS order');ordered(buildPs,jsOrder,'PowerShell JS order');

assert.match(header,/uniform\s+samplerCube\s+uWeatherCloudTex\s*;/,'current cloud influence cubemap missing');
assert.match(header,/uniform\s+samplerCube\s+uWeatherCloudTexPrev\s*;/,'previous cloud influence cubemap missing');
assert.match(header,/uniform\s+float\s+uWeatherCloudBlend\s*;/,'temporal cloud blend uniform missing');
for(const name of ['lowCover','midCover','lowDeck','midDeck','highDeck','volumeLow']){
  assert.match(prelude,new RegExp('#define\\s+'+name+'\\s+legacy'+name[0].toUpperCase()+name.slice(1)),'legacy '+name+' must remain privately available');
  assert.match(bridge,new RegExp('#undef\\s+'+name),'bridge must reclaim '+name);
}
assert.match(bridge,/texture\(uWeatherCloudTexPrev,body\)/);
assert.match(bridge,/texture\(uWeatherCloudTex,body\)/);
assert.match(bridge,/textureCube\(uWeatherCloudTexPrev,body\)/);
assert.match(bridge,/textureCube\(uWeatherCloudTex,body\)/);
assert.match(bridge,/return\s+mix\(prev,curr,b\)/,'shader must interpolate fixed-tick influence targets');
assert.match(bridge,/s\.rgb\*2\.0-1\.0/,'RGB must decode to signed influence, not density');
assert.match(bridge,/legacyLowDeck\(dir,foot,weatherLowClimateFromInfluence\(inf\.r\)\)/,
  'low cloud must keep 0.5.53 morphology and move its threshold via influence');
assert.match(bridge,/coverageMask\(body,amount\)/,'mid/high geography must be changed through old morphology thresholds');
assert.ok(!bridge.includes('weatherCloudEnvelope'),'old physical opacity envelope must be gone');
assert.ok(!/m\.x\s*=\s*clamp\(m\.x\s*\*\s*gate/.test(bridge),'physical field must never multiply finished cloud density as a mask');
assert.ok(!/if\s*\(gate\s*[<=>]/.test(bridge),'physical field must never hard gate a cloud');
assert.ok(!/gSyn\s*=\s*synoptic\s*\(|gWx\s*=\s*weather\s*\(|lowCloudClimate\s*\(wd\)/.test(main),
  'procedural climate/synoptic geography must remain retired');

assert.match(gpu,/cloudVisualLow/);assert.match(gpu,/cloudVisualMid/);assert.match(gpu,/cloudVisualHigh/);assert.match(gpu,/deepConvectiveState/);
assert.match(gpu,/weatherCloudSignedToByte/,'GPU must encode signed response');
assert.ok(!/cloudLowMass|cloudMidMass|cloudHighMass/.test(gpu),'GPU visual bridge must not upload physical condensate as a visibility mask');
assert.match(gpu,/weatherCloudGpuTexPrev/,'temporal bridge needs a previous cubemap');
assert.match(gpu,/weatherCloudGpuPrevFaces/,'temporal bridge needs CPU previous-state buffers');
assert.match(gpu,/weatherCloudGpuCollapseVisible\(weatherCloudGpuBlendAt\(now\)\)/,
  'a new tick must preserve the exact state visible before accepting its new target');
assert.match(gpu,/dstY=N-1-y/);
assert.match(gpu,/gl\.texSubImage2D/);
assert.ok(!/requestAnimationFrame/.test(gpu));
assert.ok(!/texSubImage2D/.test(render),'render loop may bind/blend but never upload fixed weather grids');
assert.match(render,/uWeatherCloudTexPrev/);
assert.match(render,/uniform1f\(U\.uWeatherCloudBlend,weatherCloudGpuBlendAt/,'render must advance temporal blend every frame');
assert.match(response,/CLOUD_VISUAL_GROW_TAU_SEC/);assert.match(response,/CLOUD_VISUAL_DISSIPATE_TAU_SEC/);
assert.match(response,/cloudVisualDiffuse/);

/* Exercise signed transfer, row orientation and temporal interpolation. */
const calls=[];
let fakeNow=1000,activeUnit=0;
const fakeGl={
  TEXTURE0:33984,TEXTURE_CUBE_MAP:34067,TEXTURE_CUBE_MAP_POSITIVE_X:34069,
  TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,TEXTURE_WRAP_R:32882,
  LINEAR:9729,CLAMP_TO_EDGE:33071,RGBA:6408,UNSIGNED_BYTE:5121,
  createTexture(){return {};},deleteTexture(){},activeTexture(u){activeUnit=u;},bindTexture(){},texParameteri(){},texImage2D(){},
  texSubImage2D(target,level,x,y,w,h,format,type,pix){calls.push({unit:activeUnit,target,w,h,pix:Array.from(pix)});}
};
const ctx={console,Math,Number,Date,Uint8Array,Array,performance:{now:()=>fakeNow},gl:fakeGl,webglVersion:2,UNIFORM_NAMES:[],
  weatherCoreCreate(){return null;},weatherCoreStep(){return null;}};
vm.createContext(ctx);vm.runInContext(gpu,ctx,{filename:'weather-cloud-gpu.js'});
assert.ok(Math.abs(ctx.weatherCloudByteToSigned(ctx.weatherCloudSignedToByte(0)))<0.01,'neutral influence must survive RGBA8 encoding');
assert.ok(ctx.weatherCloudSignedToByte(0.8)>ctx.weatherCloudSignedToByte(0),'positive magnet must encode brighter than neutral');
assert.ok(ctx.weatherCloudSignedToByte(-0.8)<ctx.weatherCloudSignedToByte(0),'disperser must encode darker than neutral');
const N=4,count=6*N*N;
const core={N,count,ticks:7,seed:9,
  cloudVisualLow:new Float32Array(count),cloudVisualMid:new Float32Array(count),cloudVisualHigh:new Float32Array(count),deepConvectiveState:new Float32Array(count)};
core.cloudVisualLow[0]=-0.8;
core.cloudVisualLow[(N-1)*N]=0.8;
core.cloudVisualMid[5]=0.4;core.cloudVisualHigh[10]=-0.4;core.deepConvectiveState[15]=0.9;
const lowBefore=Array.from(core.cloudVisualLow);
ctx.weatherCloudGpuEnsure(N);
const packed=ctx.weatherCloudGpuPackFace(core,0);
assert.equal(packed[0],ctx.weatherCloudSignedToByte(0.8),'first texture row must come from highest weather v row');
assert.equal(packed[((N-1)*N)*4],ctx.weatherCloudSignedToByte(-0.8),'last texture row must come from lowest weather v row');
ctx.weatherCloudGpuUpload(core);
assert.equal(calls.length,12,'initial publication must upload six identical prev + six current cubemap faces');
assert.deepEqual(Array.from(core.cloudVisualLow),lowBefore,'GPU bridge must not mutate inertial response');
assert.equal(ctx.weatherCloudGpuBlendAt(fakeNow),0,'a freshly published target starts at previous state');

/* Next fixed tick: target changes, but visible state begins continuously at prev. */
fakeNow=2000;core.ticks++;
core.cloudVisualLow[0]=0.9;core.cloudVisualLow[(N-1)*N]=-0.9;
ctx.weatherCloudGpuUpload(core);
assert.equal(calls.length,24,'each weather tick uploads prev + current faces exactly once');
assert.equal(ctx.weatherCloudGpuBlendAt(2000),0,'new target must not appear instantly on its publication frame');
const half=ctx.weatherCloudGpuBlendAt(2460);
assert.ok(half>0.45&&half<0.55,'halfway through the tick interval the blend should be about halfway, got '+half);
assert.equal(ctx.weatherCloudGpuBlendAt(3000),1,'blend must finish before the next nominal weather tick');

/* Timer jitter: accepting another target mid-blend must still restart from the
   currently visible mixed state, not jump to either old endpoint. */
fakeNow=2300;core.ticks++;
core.cloudVisualMid[5]=-0.7;
ctx.weatherCloudGpuUpload(core);
assert.equal(ctx.weatherCloudGpuBlendAt(2300),0,'jittered target begins from collapsed visible state');
assert.equal(calls.length,36,'jittered tick still performs only two six-face uploads');

console.log('weather-cloud-visual.test.js: OK');
