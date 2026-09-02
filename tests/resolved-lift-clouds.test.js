const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/resolved-lift-clouds.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m);
assert.ok(buildSh.indexOf('js/cloud-visual-response.js')<buildSh.indexOf('js/resolved-lift-clouds.js'));
assert.ok(buildSh.indexOf('js/resolved-lift-clouds.js')<buildSh.indexOf('js/weather-cloud-gpu.js'));
assert.ok(buildPs.indexOf('js/cloud-visual-response.js')<buildPs.indexOf('js/resolved-lift-clouds.js'));
assert.ok(buildPs.indexOf('js/resolved-lift-clouds.js')<buildPs.indexOf('js/weather-cloud-gpu.js'));
assert.ok(!/Math\.random|requestAnimationFrame/.test(src),'lifting condensation must stay deterministic and off render FPS');
for(const name of ['frontVerticalVelocity','systemVerticalVelocity','orographicVerticalVelocity','verticalLclHeightM','h2oSaturationColumnKgM2'])
  assert.ok(src.includes(name),'missing physical lift dependency '+name);
assert.ok(!/latitude|latGate|cloudBand/.test(src),'resolved cloud formation must not hard-code a latitude cloud band');

const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number(x)||0));
const ctx={
  console,Math,Number,Float32Array,Float64Array,Int32Array,
  WEATHER_CORE_FIXED_DT_SEC:300,
  h2oSaturationColumnKgM2:(T)=>10*Math.exp((Number(T)-288)/18),
  verticalScaleHeightM:()=>8000,
  verticalLclHeightM:(T,rh,H)=>clamp(700*(0.70/Math.max(0.10,rh)),120,0.9*H),
  condApplyLatentHeat:(core,i,dm)=>{const d=dm*0.02;core.airTemp[i]+=d;return d;},
  condPhaseChange:()=>({condensed:0,evaporated:0,latentK:0}),
  cloudVisualWeights:()=>({growth:0.08,diss:0.28,moist:0.12,deep:0}),
  weatherCoreCreate:()=>({count:1}),weatherCoreFinite:()=>true
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'resolved-lift-clouds.js'});

function core(){
  return {
    count:1,N:1,
    airTemp:new Float32Array([288]),vaporColumn:new Float32Array([7.0]),cloudWaterState:new Float32Array([0]),
    relativeHumidity:new Float32Array([0.70]),areaWeight:new Float32Array([1]),
    frontVerticalVelocity:new Float32Array([0.55]),frontStrength:new Float32Array([0.82]),
    systemVerticalVelocity:new Float32Array([0.14]),cycloneStrength:new Float32Array([0.45]),
    orographicVerticalVelocity:new Float32Array([0]),orographicRoughness:new Float32Array([0]),
    deepConvectiveState:new Float32Array([0])
  };
}

/* A 70% RH column is not saturated at the surface, but a strong frontal ascent
   must cool a fractional parcel through its LCL and create real condensate. */
const c=core();
assert.ok(c.vaporColumn[0]<ctx.h2oSaturationColumnKgM2(c.airTemp[0]),'test column must begin sub-saturated');
const total0=c.vaporColumn[0]+c.cloudWaterState[0];
const out=ctx.resolvedLiftCondensationAssist(c,300,{});
const total1=c.vaporColumn[0]+c.cloudWaterState[0];
assert.ok(out.condensed>0,'frontal/cyclonic lift must condense a moderately humid sub-saturated column');
assert.ok(c.cloudWaterState[0]>0&&c.vaporColumn[0]<7,'condensate must be transferred from vapor');
assert.ok(Math.abs(total1-total0)<2e-6,'lifting condensation must conserve local H2O');
assert.ok(c.resolvedLiftCloudPotential[0]>0.05,'successful ascent should publish cloud support');
assert.ok(c.resolvedLiftCloudDepthM[0]>500,'storm lift should reach a plausible cloud-producing depth');
assert.ok(c.resolvedLiftCondensationRate[0]>0,'physical lift condensation rate should be diagnosed');

/* No resolved ascent: ordinary 70% RH air must not acquire cloud by magic. */
const calm=core();calm.frontVerticalVelocity[0]=0;calm.frontStrength[0]=0;calm.systemVerticalVelocity[0]=0;calm.cycloneStrength[0]=0;
const calmOut=ctx.resolvedLiftCondensationAssist(calm,300,{});
assert.equal(calmOut.condensed,0);assert.equal(calm.cloudWaterState[0],0);

/* Anticyclonic subsidence must strongly suppress the same frontal opportunity. */
const down=core();down.systemVerticalVelocity[0]=-0.8;down.cycloneStrength[0]=0;
const downOut=ctx.resolvedLiftCondensationAssist(down,300,{});
assert.ok(downOut.condensed<out.condensed*0.35,'subsidence should suppress lifting condensation rather than create a latitude mask');

/* Truly dry air must remain clear even under a lift impulse. */
const dry=core();dry.relativeHumidity[0]=0.25;dry.vaporColumn[0]=2.5;
const dryOut=ctx.resolvedLiftCondensationAssist(dry,300,{});
assert.equal(dryOut.condensed,0);assert.equal(dry.cloudWaterState[0],0);

/* Once physics diagnoses lift-cloud support, the inertial visual layer should
   not immediately erase it merely because coarse-cell surface RH is < 0.78. */
ctx.rlcEnsureFields(c);c.resolvedLiftCloudPotential[0]=0.72;c.resolvedLiftCondensationRate[0]=3e-5;
const w=ctx.cloudVisualWeights(c,0);
assert.ok(w.growth>0.20,'resolved physical lift should reinforce visual cloud growth');
assert.ok(w.diss<0.20,'resolved physical lift should reduce false dry-cell dispersal');
assert.ok(w.moist>0.30,'visual response should retain finite moisture support in a diagnosed lifted cloud');

console.log('resolved-lift-clouds.test.js: OK');
