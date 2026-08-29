const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js','lightning-weather.js'),'utf8');

const world={cycA:new Float32Array(20),cycB:new Float32Array(20)};
const ctx={
  console,Math,Number,Float32Array,Int32Array,world,
  weatherCoreCreate(){return null;},weatherCoreStep(){return null;},weatherCoreFinite(){return true;},
  markRenderUniformsDirty(){}
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'lightning-weather.js'});

const climate={T:288.15,pressureBar:1.01325};
function one(v={}){
  return {
    count:1,seed:1,
    deepConvectiveState:new Float32Array([v.deep??0.25]),
    deepUpdraftMS:new Float32Array([v.up??9]),
    cloudWaterState:new Float32Array([v.cloud??0.10]),
    cloudBaseHeightM:new Float32Array([v.base??1000]),
    cloudTopHeightM:new Float32Array([v.top??7000]),
    scaleHeight:new Float32Array([8400]),airTemp:new Float32Array([v.temp??292]),
    precipRate:new Float32Array([v.precip??0.0005]),
    frontStrength:new Float32Array([0]),cycloneStrength:new Float32Array([0]),
    dirX:new Float32Array([0]),dirY:new Float32Array([0]),dirZ:new Float32Array([1]),
    areaWeight:new Float32Array([1])
  };
}

/* A moderate but genuinely deep mixed-phase storm should not wait tens of
   seconds solely because its electrical potential is below 0.1. */
const moderate=one();
const d=ctx.lightningDiagnoseCell(moderate,0,climate);
assert.ok(d.mixed>2000,'moderate test plume must span a real mixed-phase layer');
assert.ok(d.potential>0.006&&d.potential<0.35,'moderate storm should have finite non-supercell potential');
const oldLinear=d.potential*(0.18+0.090*Math.min(42,d.up)+0.022*Math.min(35,d.precipHr));
assert.ok(d.rate>oldLinear*1.25,'sub-linear cadence response must materially lift moderate-storm flash rate');

ctx.lightningRefresh(moderate,climate);
assert.equal(moderate.lightningActiveCount,1,'moderate real storm must populate a renderer slot');
assert.ok(moderate.lightningRenderB[1]>0,'selected storm must publish a nonzero flash cadence');

/* Physics is still mandatory: a shallow warm cloud has no mixed-phase charge
   separation and therefore remains electrically dead. */
const shallow=one({deep:0.8,up:30,cloud:0.8,base:500,top:2400,temp:296,precip:0.004});
const s=ctx.lightningDiagnoseCell(shallow,0,climate);
assert.equal(s.mixed,0,'shallow warm cloud must have zero mixed-phase depth');
assert.equal(s.potential,0,'shallow warm cloud must have zero lightning potential');
assert.equal(s.rate,0,'shallow warm cloud must have zero flash cadence');

assert.match(src,/LIGHTNING_SELECTION_FLOOR\s*=\s*0\.006/,'secondary physical storms should use the lowered selection floor');
assert.match(src,/Math\.pow\(potential,0\.78\)/,'moderate-storm cadence must use the sub-linear potential response');
console.log('lightning-abundance.test.js: OK');
