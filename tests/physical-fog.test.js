const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const phys=read('js/physical-fog.js');
const gpu=read('js/fog-gpu.js');
const render=read('js/fog-render.js');
const shader=read('shaders/fog.glsl');
const header=read('shaders/header.glsl');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');
const spatial=read('js/fog-spatial-fix.js');
const version=read('VERSION.txt');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=56),'physical fog requires 0.5.56+');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/cloud-radiative-feedback.js','js/physical-fog.js','js/lightning-weather.js'],'shell fog physics order');
ordered(buildPs,['js/cloud-radiative-feedback.js','js/physical-fog.js','js/lightning-weather.js'],'PowerShell fog physics order');
ordered(buildSh,['js/weather-cloud-gpu.js','js/fog-gpu.js','js/planet-export.js'],'shell fog GPU order');
ordered(buildPs,['js/weather-cloud-gpu.js','js/fog-gpu.js','js/planet-export.js'],'PowerShell fog GPU order');
ordered(buildSh,['js/weather-cloud-render.js','js/fog-render.js','js/screenshot-trigger.js'],'shell fog render order');
ordered(buildPs,['js/weather-cloud-render.js','js/fog-render.js','js/screenshot-trigger.js'],'PowerShell fog render order');

for(const u of ['uFogTex','uFogTexPrev','uFogBlend'])assert.match(header,new RegExp('\\b'+u+'\\b'));
assert.ok(!/inversionBelt|coastal\s*=|terminator\s*=/.test(shader),'legacy latitude/coast/terminator fog heuristics must stay retired');
assert.match(shader,/physicalFogSample/);assert.match(shader,/uRotS\*normalize\(dir\)/);
assert.match(shader,/#define FOG_TAP\(D\) mix\([^\n]*uFogTexPrev[^\n]*uFogTex[^\n]*b\)/,
  'fog samples must interpolate previous/current fixed-tick targets before spatial averaging');
assert.match(shader,/vec4 c0 = FOG_TAP\(body\)/,'fog center sample must use the interpolated fixed-tick helper');
assert.match(shader,/const float o = 0\.035/,'fog reconstruction must span enough of a coarse Weather Core cell to hide square texels');
assert.match(shader,/c0\.rg = c0\.rg\*0\.56 \+ \(c1\.rg\+c2\.rg\+c3\.rg\+c4\.rg\)\*0\.11/,
  'physical fog optical/depth channels must receive compact spherical spatial reconstruction');
assert.match(shader,/c0\.ba = c0\.ba\*0\.44 \+ \(c1\.ba\+c2\.ba\+c3\.ba\+c4\.ba\)\*0\.14/,
  'soil/temperature channels must remain spatially reconstructed after temporal interpolation');
assert.match(shader,/float shaped=max\(0\.0,optical-erosion\)/,'procedural erosion must only subtract from physical fog');
assert.match(shader,/float density=shaped\*softVisibility\*textureMod/,'procedural texture may modulate already-positive physical fog only');
const executablePhys=phys.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'$1');
assert.ok(!/Math\.random\s*\(|requestAnimationFrame\s*\(/.test(executablePhys),'fog physics must be deterministic fixed-tick code');
assert.ok(!/requestAnimationFrame\s*\(/.test(gpu),'fog texture upload must not be render-FPS driven');
assert.ok(!/texSubImage2D/.test(render),'fog render bridge must never upload textures per frame');
assert.match(phys,/FOG_FORM_TAU_SEC=90\*60/,'fog must not mature globally within a few accelerated ticks');
assert.match(phys,/FOG_MAX_OPTICAL_DEPTH=0\.72/,'near-surface fog must remain translucent');
assert.match(spatial,/FOG_SPATIAL_BLEND=0\.12/,'fog spatial smoothing must stay weak');
assert.match(spatial,/FOG_SPATIAL_PASSES=1/,'fog smoothing must not repeatedly spread banks');

const ctx={console,Math,Number,Float32Array,Float64Array,Int32Array,WEATHER_CORE_FIXED_DT_SEC:300,
  weatherCoreCreate(){return null;},weatherCoreStep(core){return core;},weatherCoreFinite(){return true;}};
vm.createContext(ctx);vm.runInContext(phys,ctx,{filename:'physical-fog.js'});
function makeCore(){
  return {count:1,N:4,seed:1,ticks:0,
    relativeHumidity:new Float32Array([0.99]),airTemp:new Float32Array([286]),surfaceTemp:new Float32Array([285]),
    windStateU:new Float32Array([1]),windStateV:new Float32Array([0.5]),bulkStabilityIndex:new Float32Array([0.85]),
    deepConvectiveState:new Float32Array([0]),lclHeightM:new Float32Array([100]),surfaceWaterFraction:new Float32Array([1]),
    surfaceLiquidWater:new Float32Array([0.2]),soilMoisture:new Float32Array([100]),soilCapacity:new Float32Array([180]),
    precipRate:new Float32Array([0]),areaWeight:new Float32Array([1]),vaporColumn:new Float32Array([20]),
    cloudWaterState:new Float32Array([0.1]),pressure:new Float32Array([101325])};
}
let c=makeCore();ctx.fogEnsureFields(c);
const vapor0=c.vaporColumn[0],cloud0=c.cloudWaterState[0],p0=c.pressure[0],u0=c.windStateU[0],v0=c.windStateV[0];
ctx.fogStep(c,300);
assert.ok(c.fogState[0]>0&&c.fogState[0]<0.20,'saturated calm fog must form gradually, not pop in one tick');
assert.ok(c.fogOpticalDepth[0]>0&&c.fogDepthM[0]>0,'formed fog must expose optical/depth diagnostics');
for(let k=0;k<23;k++)ctx.fogStep(c,300);
assert.ok(c.fogState[0]>0.45,'persistent saturated calm conditions must still build a mature fog bank');
assert.ok(c.fogOpticalDepth[0]<=0.720001,'mature fog must not become an opaque Venus-like blanket');
assert.equal(c.vaporColumn[0],vapor0);assert.equal(c.cloudWaterState[0],cloud0);assert.equal(c.pressure[0],p0);assert.equal(c.windStateU[0],u0);assert.equal(c.windStateV[0],v0);

/* Merely humid temperate air is not fog. This was the +21 C runaway case:
   RH below ~90%, finite LCL and ordinary breeze must remain mostly clear even
   after hours of accelerated model time. */
c=makeCore();ctx.fogEnsureFields(c);c.relativeHumidity[0]=0.88;c.lclHeightM[0]=900;c.windStateU[0]=3;c.windStateV[0]=1;c.bulkStabilityIndex[0]=0.70;c.surfaceTemp[0]=294;c.airTemp[0]=294;
for(let k=0;k<36;k++)ctx.fogStep(c,300);
assert.ok(c.fogState[0]<0.08,'ordinary 88% RH Earth-like air must not grow a global-looking fog bank');

c=makeCore();ctx.fogEnsureFields(c);c.fogState[0]=0.8;c.relativeHumidity[0]=0.52;c.windStateU[0]=20;c.surfaceTemp[0]=292;c.airTemp[0]=286;c.lclHeightM[0]=1800;
ctx.fogStep(c,300);
assert.ok(c.fogState[0]<0.8&&c.fogState[0]>0.30,'dry strong wind must erode fog but never delete a bank in one fixed tick');
assert.ok(c.fogDissipationWeight[0]>0.8,'strong dry mixing must be a strong fog disperser');

let now=0;const calls=[];
const fakeGl={TEXTURE0:33984,TEXTURE_CUBE_MAP:34067,TEXTURE_CUBE_MAP_POSITIVE_X:34069,
  TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,TEXTURE_WRAP_R:32882,
  LINEAR:9729,CLAMP_TO_EDGE:33071,RGBA:6408,UNSIGNED_BYTE:5121,
  createTexture(){return {};},deleteTexture(){},activeTexture(){},bindTexture(){},texParameteri(){},texImage2D(){},
  texSubImage2D(target,level,x,y,w,h,format,type,pix){calls.push({target,w,h,pix:Array.from(pix)});}};
const gctx={console,Math,Number,Uint8Array,Array,Date,gl:fakeGl,webglVersion:2,UNIFORM_NAMES:[],performance:{now:()=>now},
  weatherCoreCreate(){return null;},weatherCoreStep(core){return core;}};
vm.createContext(gctx);vm.runInContext(gpu,gctx,{filename:'fog-gpu.js'});
const N=4,count=6*N*N,gcore={N,count,seed:3,ticks:1,fogOpticalDepth:new Float32Array(count),fogDepthM:new Float32Array(count),fogFormationWeight:new Float32Array(count),fogDissipationWeight:new Float32Array(count)};
gcore.fogOpticalDepth[0]=0.7;gcore.fogDepthM[0]=450;gcore.fogFormationWeight[0]=0.7;
gctx.fogGpuUpload(gcore);assert.equal(calls.length,12,'initial fog publish must upload 6 faces to both prev/current cubemaps');
now=1000;gcore.ticks=2;gcore.fogOpticalDepth[0]=0.2;gctx.fogGpuUpload(gcore);assert.equal(calls.length,24,'each later fixed tick must update exactly 12 fog faces total');
const b0=gctx.fogGpuBlendAt(1000),b1=gctx.fogGpuBlendAt(1450),b2=gctx.fogGpuBlendAt(2200);
assert.ok(b0<=0.01&&b1>0.1&&b1<0.9&&b2>0.99,'fog blend must move smoothly from previous to current target');

console.log('physical-fog.test.js: OK');
