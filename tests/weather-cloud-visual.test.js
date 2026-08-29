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
const render=read('js/weather-cloud-render.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

const vmx=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);
assert.ok(vmx,'Weather Core cloud visual test must see a semantic version');
assert.ok(+vmx[1]>0 || +vmx[2]>5 || (+vmx[2]===5 && +vmx[3]>=54),'cloud visual bridge requires 0.5.54 or newer');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const shaderOrder=['shaders/header.glsl','shaders/weather-cloud-prelude.glsl','shaders/clouds.glsl','shaders/weather-cloud-visual.glsl','shaders/atmosphere.glsl'];
ordered(buildSh,shaderOrder,'shell shader order');ordered(buildPs,shaderOrder,'PowerShell shader order');
const jsOrder=['js/lightning-weather.js','js/weather-cloud-gpu.js','js/planet-export.js','js/render.js','js/weather-cloud-render.js','js/screenshot-trigger.js'];
ordered(buildSh,jsOrder,'shell JS order');ordered(buildPs,jsOrder,'PowerShell JS order');

assert.match(header,/uniform\s+samplerCube\s+uWeatherCloudTex\s*;/,'cloud cubemap uniform missing');
for(const name of ['lowCover','midCover','lowDeck','midDeck','highDeck','volumeLow']){
  assert.match(prelude,new RegExp('#define\\s+'+name+'\\s+legacy'+name[0].toUpperCase()+name.slice(1)),'legacy '+name+' must be privately renamed');
  assert.match(bridge,new RegExp('#undef\\s+'+name),'physical bridge must reclaim '+name);
}
assert.match(bridge,/texture\(uWeatherCloudTex,body\)/,'WebGL2 physical cloud sample missing');
assert.match(bridge,/textureCube\(uWeatherCloudTex,body\)/,'WebGL1 cubemap fallback missing');
assert.match(bridge,/normalize\(uRotS\*normalize\(dirW\)\)/,'Weather Core map must be sampled in body-fixed surface coordinates');
assert.ok(!/\bgWx\b|\bgSyn\b|lowCloudClimate\s*\(|synoptic\s*\(|\bweather\s*\(/.test(bridge),
  'new cloud entry points must not depend on procedural synoptic/climate geography');
assert.ok(!/gSyn\s*=\s*synoptic\s*\(|gWx\s*=\s*weather\s*\(|lowCloudClimate\s*\(wd\)/.test(main),
  'main shader must stop evaluating procedural cloud geography');
assert.match(main,/gSyn\s*=\s*vec4\(0\.0\)/,'legacy synoptic globals should be neutralized');
assert.match(main,/gClimLow\s*=\s*1\.0/,'legacy cloud climate should be neutralized');

assert.match(gpu,/cloudLowMass/);assert.match(gpu,/cloudMidMass/);assert.match(gpu,/cloudHighMass/);assert.match(gpu,/deepConvectiveState/);
assert.match(gpu,/dstY=N-1-y/,'cubemap packing must perform the canonical vertical flip');
assert.match(gpu,/gl\.texSubImage2D/,'tick upload must use cubemap sub-image updates');
assert.match(gpu,/weatherCoreStep=function[\s\S]*weatherCloudGpuUpload\(core\)/,'upload must follow fixed Weather Core step');
assert.ok(!/requestAnimationFrame/.test(gpu),'cloud map upload must never be driven by render FPS');
assert.ok(!/texSubImage2D/.test(render),'render bridge must bind only, never upload cloud grids per frame');

/* Exercise transfer and canonical row orientation with a tiny fake cubemap. */
const calls=[];
const fakeGl={
  TEXTURE0:33984,TEXTURE_CUBE_MAP:34067,TEXTURE_CUBE_MAP_POSITIVE_X:34069,
  TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,TEXTURE_WRAP_R:32882,
  LINEAR:9729,CLAMP_TO_EDGE:33071,RGBA:6408,UNSIGNED_BYTE:5121,
  createTexture(){return {};},deleteTexture(){},activeTexture(){},bindTexture(){},texParameteri(){},texImage2D(){},
  texSubImage2D(target,level,x,y,w,h,format,type,pix){calls.push({target,w,h,pix:Array.from(pix)});}
};
const ctx={console,Math,Number,Uint8Array,Array,gl:fakeGl,webglVersion:2,UNIFORM_NAMES:[],
  weatherCoreCreate(){return null;},weatherCoreStep(){return null;}};
vm.createContext(ctx);vm.runInContext(gpu,ctx,{filename:'weather-cloud-gpu.js'});
assert.equal(ctx.weatherCloudMassToByte(0,0.1),0,'zero condensate must encode clear');
assert.ok(ctx.weatherCloudMassToByte(0.4,0.1)>ctx.weatherCloudMassToByte(0.04,0.1),'mass transfer must be monotonic');
const N=4,count=6*N*N;
const core={N,count,ticks:7,seed:9,
  cloudLowMass:new Float32Array(count),cloudMidMass:new Float32Array(count),cloudHighMass:new Float32Array(count),deepConvectiveState:new Float32Array(count)};
core.cloudLowMass[0]=0.01;                 // weather y=0 -> texture top after flip
core.cloudLowMass[(N-1)*N]=0.60;           // weather y=N-1 -> texture first row
core.cloudMidMass[5]=0.20;core.cloudHighMass[10]=0.12;core.deepConvectiveState[15]=0.9;
const lowBefore=Array.from(core.cloudLowMass),midBefore=Array.from(core.cloudMidMass),highBefore=Array.from(core.cloudHighMass);
ctx.weatherCloudGpuEnsure(N);
const packed=ctx.weatherCloudGpuPackFace(core,0);
assert.equal(packed[0],ctx.weatherCloudMassToByte(0.60,0.16),'first texture row must come from highest weather v row');
assert.equal(packed[((N-1)*N)*4],ctx.weatherCloudMassToByte(0.01,0.16),'last texture row must come from lowest weather v row');
ctx.weatherCloudGpuUpload(core);
assert.equal(calls.length,6,'one fixed-tick upload must update exactly six cubemap faces');
assert.deepEqual(Array.from(core.cloudLowMass),lowBefore,'GPU bridge must not mutate low cloud mass');
assert.deepEqual(Array.from(core.cloudMidMass),midBefore,'GPU bridge must not mutate mid cloud mass');
assert.deepEqual(Array.from(core.cloudHighMass),highBefore,'GPU bridge must not mutate high cloud mass');

console.log('weather-cloud-visual.test.js: OK');
