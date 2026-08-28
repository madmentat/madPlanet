const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/stellar-weather-coupling.js'),'utf8');
const surface=fs.readFileSync(path.join(root,'shaders/surface.glsl'),'utf8');
const version=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m);
assert.ok(buildPs.includes("'js/climate-regimes.js','js/stellar-weather-coupling.js','js/render.js'"),
  'PowerShell build must apply stellar/weather bridge after climate and before render');
assert.ok(buildSh.includes('js/climate-regimes.js js/stellar-weather-coupling.js js/render.js'),
  'shell build must apply stellar/weather bridge after climate and before render');

function clamp01(x){return Math.max(0,Math.min(1,Number(x)||0));}
function pivotLogSlider(v,pivot,lo,hi){
  v=clamp01(v);
  if(v<=pivot){const u=v/Math.max(1e-9,pivot);return Math.pow(10,Math.log10(lo)+u*(0-Math.log10(lo)));}
  const u=(v-pivot)/Math.max(1e-9,1-pivot);return Math.pow(10,u*Math.log10(hi));
}
function habitableZoneForStar(T,L){return {conservativeInner:Math.sqrt(L/1.1),conservativeOuter:Math.sqrt(L/0.35),optimisticInner:Math.sqrt(L/1.7),optimisticOuter:Math.sqrt(L/0.32),approx:T>7200,flux:{}};}
function hzStatus(au,hz){return {code:au<hz.conservativeInner?'hot':'conservative',label:au<hz.conservativeInner?'горячее HZ':'зона Златовласки'};}
const state={star:0.38,luminosity:0.43,distance:0.51,temp:0.52,gasH2O:0.004};
const PARAMS=[{k:'star',def:0.38}];
let steamFraction=0.004;
let climate={C:15,T:288.15,S:1,iceArea:0.02,waterAvail:1,moistIndex:0.02,partialPressures:{h2o:0.004}};
const transientKeys=['snowAlt','cloudLow','cloudMid','cloudHigh','wind','convection','storm'];
for(const k of transientKeys) state[k]=0.5;
const ctx={
  console,Math,Number,Date,state,PARAMS,location:{hash:''},
  pivotLogSlider,habitableZoneForStar,hzStatus,
  orbitalFluxEarth:(L,au)=>L/(au*au),
  tempToSlider:C=>Math.max(0,Math.min(1,(C+78)/175)),
  climateModel:()=>climate,
  gasFractions:()=>({gasH2O:steamFraction}),
  atmoCompFromGases:()=>0,
  TRANSIENT_DERIVED_KEYS:transientKeys,
  TRANSIENT_TAU:{snowAlt:14,cloudLow:8,cloudMid:9,cloudHigh:10,wind:6,convection:7,storm:8},
  transientHeld:Object.create(null),transientManualUntil:Object.create(null),
  relaxTransientScalar:(v,t,dt,tau)=>v+(t-v)*(1-Math.exp(-dt/tau)),
  relaxTransientControls:()=>false,
  performance:{now:()=>1000}
};
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'stellar-weather-coupling.js'});

/* Blank-world solar pivot. */
assert.equal(state.star,0.43,'new blank worlds must start on the G/Sun anchor');
assert.equal(PARAMS[0].def,0.43,'star parameter default must advertise the solar anchor');
let s=ctx.starPhysics(0.43,0.43);
assert.ok(Math.abs(s.T-5772)<1e-9);
assert.ok(Math.abs(s.L-1)<1e-10,'G + nominal luminosity must equal 1 Lsun');
assert.ok(Math.abs(s.M-1)<1e-10,'G + nominal luminosity must equal 1 Msun');

const m=ctx.starPhysics(0.00,0.43);
const k=ctx.starPhysics(0.17,0.43);
const f=ctx.starPhysics(0.57,0.43);
const b=ctx.starPhysics(0.86,0.43);
const o=ctx.starPhysics(1.00,0.43);
assert.ok(m.L<k.L&&k.L<s.L&&s.L<f.L&&f.L<b.L&&b.L<o.L,
  'spectral class must now change nominal radiative power monotonically');
assert.ok(m.M<s.M&&s.M<b.M&&b.M<o.M,'spectral class must change main-sequence mass estimate');
assert.ok(o.L>1e5,'O-star baseline must be orders of magnitude brighter than Sun');

const gDim=ctx.starPhysics(0.43,0.1);
const gBright=ctx.starPhysics(0.43,0.9);
assert.ok(gBright.L>gDim.L*10,'luminosity control must remain an independent multiplier within one class');
assert.ok(Math.abs(ctx.orbitDistanceAU(0.51)-1)<1e-12,'distance pivot must remain exactly 1 AU');
assert.ok(ctx.orbitDistanceAU(0)<0.011&&ctx.orbitDistanceAU(1)>999,'distance range must cover 0.01..1000 AU');
assert.ok(ctx.orbitalFluxEarth(o.L,1)>ctx.orbitalFluxEarth(m.L,1)*1e6,
  'class change at fixed orbit must strongly change stellar forcing');

/* The old +97 C clamp was the direct cause of +460 C snow. */
assert.ok(ctx.tempToSlider(460)>3,'calculated climate channel must extrapolate beyond old +97 C slider ceiling');
assert.ok(surface.includes('mix(-0.55, 1.55, uTemp)'),
  'surface shader must consume extrapolating uTemp channel');
assert.ok(!/clamp\s*\(\s*uTemp/.test(surface),'surface must not clamp the extrapolating temperature channel back to 0..1');

const earthTargets=ctx.climateWeatherTargets();
climate={C:460,T:733.15,S:3,iceArea:0,waterAvail:1,moistIndex:1,partialPressures:{h2o:120}};
const steamTargets=ctx.climateWeatherTargets();
assert.ok(steamTargets.cloudLow<earthTargets.cloudLow*0.5,
  'supercritical steam climate must suppress ordinary white low cloud decks');
assert.ok(steamTargets.convection<earthTargets.convection,
  'supercritical global climate must stop using Earth-like liquid-cloud convection');
climate={C:-45,T:228.15,S:0.55,iceArea:0.95,waterAvail:1,moistIndex:0,partialPressures:{h2o:1e-5}};
const snowTargets=ctx.climateWeatherTargets();
assert.ok(snowTargets.snowAlt<earthTargets.snowAlt,'cold climate must lower the snow line target');
assert.ok(snowTargets.wind>0.4,'strong cold forcing still needs active global circulation target');

steamFraction=0.8;
assert.ok(ctx.atmoCompFromGases()>0.4,'steam-dominated greenhouse must no longer remain Earth-blue in haze adapter');
assert.ok(src.includes('No stellar age is inferred here'),'module must explicitly avoid inventing a unique stellar age from class');

console.log('stellar-weather-coupling.test.js: OK');
