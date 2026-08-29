const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/cloud-visual-response.js'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m);
assert.ok(buildSh.indexOf('js/cloud-visual-response.js')<buildSh.indexOf('js/weather-cloud-gpu.js'),'response must run before GPU pack');
assert.ok(buildPs.indexOf('js/cloud-visual-response.js')<buildPs.indexOf('js/weather-cloud-gpu.js'),'PowerShell response must run before GPU pack');

const ctx={console,Math,Number,Float32Array,WEATHER_CORE_FIXED_DT_SEC:300,
  weatherCoreCreate(){return null;},weatherCoreStep(){},weatherCoreFinite(){return true;}};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'cloud-visual-response.js'});

function core4(){
  const n=4;
  return {count:n,N:2,
    relativeHumidity:new Float32Array(n),humidity:new Float32Array(n),
    condensationRate:new Float32Array(n),cloudEvaporationRate:new Float32Array(n),
    orographicVerticalVelocity:new Float32Array(n),frontVerticalVelocity:new Float32Array(n),systemVerticalVelocity:new Float32Array(n),
    deepConvectiveState:new Float32Array(n),
    cloudLowMass:new Float32Array(n),cloudMidMass:new Float32Array(n),cloudHighMass:new Float32Array(n),
    windNeighbor:[Int32Array.from([1,0,3,2]),Int32Array.from([2,3,0,1]),Int32Array.from([3,2,1,0]),Int32Array.from([1,0,3,2])]
  };
}

const c=core4();ctx.cloudVisualEnsureFields(c);
assert.equal(c.cloudVisualResponseModel,2);
for(const k of ['cloudVisualLow','cloudVisualMid','cloudVisualHigh','cloudGrowthWeight','cloudDissipationWeight']){
  assert.ok(c[k] instanceof Float32Array);assert.equal(c[k].length,c.count);
}
assert.deepEqual(Array.from(c.cloudVisualLow),[0,0,0,0],'new visual response must begin neutral, not as a mask');

/* Wet lifting air becomes a growth magnet gradually, not in one tick. */
c.relativeHumidity[0]=1.05;c.condensationRate[0]=8e-5;c.frontVerticalVelocity[0]=0.7;c.cloudLowMass[0]=0.18;
const waterBefore=Array.from(c.cloudLowMass);
ctx.cloudVisualResponseStep(c,300);
const first=c.cloudVisualLow[0];
assert.ok(first>0&&first<0.15,'one weather tick must only nudge cloud growth');
for(let n=0;n<12;n++)ctx.cloudVisualResponseStep(c,300);
assert.ok(c.cloudVisualLow[0]>first,'favourable environment must accumulate influence over time');
assert.deepEqual(Array.from(c.cloudLowMass),waterBefore,'visual response must never mutate physical cloud mass');

/* A dry/subsident cell is a finite disperser. A large cloud must not vanish. */
const d=core4();ctx.cloudVisualEnsureFields(d);
d.cloudVisualLow.fill(0.72);d.relativeHumidity.fill(0.22);d.cloudEvaporationRate.fill(8e-5);d.systemVerticalVelocity.fill(-0.55);d.cloudLowMass.fill(0.70);
ctx.cloudVisualResponseStep(d,300);
assert.ok(d.cloudVisualLow[0]>0.55,'large cloud must retain most of its response after one strong dispersal tick');
for(let n=0;n<18;n++)ctx.cloudVisualResponseStep(d,300);
assert.ok(d.cloudVisualLow[0]<0.72&&d.cloudVisualLow[0]>-0.5,'dispersal must be gradual, not an on/off deletion');

/* Dry air with no water support cannot become a growth magnet merely from one lift impulse. */
const dry=core4();ctx.cloudVisualEnsureFields(dry);dry.relativeHumidity.fill(0.20);dry.orographicVerticalVelocity.fill(0.9);
ctx.cloudVisualResponseStep(dry,300);
assert.ok(dry.cloudVisualLow[0]<=0.02,'lift without moisture must not instantly create visual cloud support');

/* Spatial blending should leak influence softly into a neighbour instead of preserving a hard cell border. */
const s=core4();ctx.cloudVisualEnsureFields(s);s.cloudVisualLow[0]=1;s.cloudVisualLow[1]=0;s.cloudVisualLow[2]=0;s.cloudVisualLow[3]=0;
ctx.cloudVisualDiffuse(s,s.cloudVisualLow);
assert.ok(s.cloudVisualLow[0]<1,'source cell must soften');
assert.ok(s.cloudVisualLow[1]>0||s.cloudVisualLow[2]>0||s.cloudVisualLow[3]>0,'neighbour influence must become non-zero');

assert.ok(!src.includes('requestAnimationFrame'),'response must stay on Weather Core clock');
assert.ok(!src.includes('Math.random'),'response must be deterministic');
assert.match(src,/CLOUD_VISUAL_GROW_TAU_SEC/);assert.match(src,/CLOUD_VISUAL_DISSIPATE_TAU_SEC/);
assert.match(src,/cloudVisualDiffuse/,'coarse forcing cells require spatial smoothing');
console.log('cloud-visual-response.test.js: OK');
