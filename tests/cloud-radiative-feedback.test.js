const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const src=read('js/cloud-radiative-feedback.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');
const surface=read('shaders/surface.glsl');
const bridge=read('shaders/weather-cloud-visual.glsl');
const header=read('shaders/header.glsl');
const version=read('VERSION.txt');

const m=version.match(/^VERSION\s+(\d+)\.(\d+)\.(\d+)\s*$/m);assert.ok(m);
assert.ok(+m[1]>0||+m[2]>5||(+m[2]===5&&+m[3]>=55),'cloud radiative feedback requires 0.5.55+');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/deep-convection-coupling.js','js/cloud-radiative-feedback.js','js/lightning-weather.js'],'shell radiative order');
ordered(buildPs,['js/deep-convection-coupling.js','js/cloud-radiative-feedback.js','js/lightning-weather.js'],'PowerShell radiative order');

assert.match(src,/cloudLowMass/);assert.match(src,/cloudMidMass/);assert.match(src,/cloudHighMass/);
assert.match(src,/cloudShortwaveForcing/);assert.match(src,/cloudLongwaveForcing/);assert.match(src,/cloudNetForcing/);
assert.match(src,/A-0\.230\*cov/,'clear baseline must remove old global cloud albedo');
assert.ok(!/Math\.random|requestAnimationFrame/.test(src),'radiative physics must be deterministic and fixed-tick only');

/* Visual shadows must consume the same current cloud morphology that samples
   the temporally interpolated physical influence. No raw mass/grid mask is
   allowed in surface shading. */
assert.match(surface,/lowCover\(normalize\(n0 \+ uSunDir\*0\.030\)/);
assert.match(surface,/midCover\(normalize\(n0 \+ uSunDir\*0\.055\)/);
assert.match(surface,/uLowOn\s*>\s*0\.5/);assert.match(surface,/uMidOn\s*>\s*0\.5/);
assert.match(bridge,/weatherCloudInfluence\(dir\)/);
assert.match(bridge,/mix\(a,b,clamp\(uWeatherCloudBlend,0\.0,1\.0\)\)/);
assert.match(header,/uWeatherCloudPrevTex/);assert.match(header,/uWeatherCloudTex/);assert.match(header,/uWeatherCloudBlend/);
assert.ok(!/cloudLowMass|cloudMidMass|cloudHighMass/.test(surface),'surface shadow shader must not sample raw Weather Core mass');

const ctx={
  console,Math,Number,Float32Array,
  weatherClamp:(x,a,b)=>Math.max(a,Math.min(b,Number(x)||0)),
  WEATHER_CORE_FIXED_DT_SEC:300,
  climateCloudCover:()=>0.5,
  climateModel:()=>({A:0.30,cloudCov:0.5,iceArea:0,tau:0.5}),
  localEnergyIceAlbedo:()=>0.62,
  localEnergyIceFraction:()=>0,
  localEnergyHeatCapacity:()=>1.6e7,
  localEnergyCellAlbedo:()=>0.30,
  weatherCoreClimateSnapshot:()=>({A:0.30,cloudCov:0.5,iceArea:0,tau:0.5,T:288.15}),
  weatherCoreCreate:()=>null,
  weatherCoreStep:(core)=>core,
  weatherCoreFinite:()=>true,
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'cloud-radiative-feedback.js'});
const climate={A:0.30,cloudCov:0.5,clearSkyAlbedo:0.185,iceArea:0,tau:0.5,T:288.15};
assert.equal(ctx.localEnergyCellAlbedo(288,0,climate),ctx.localEnergyCellAlbedo(288,1,climate),
  'old cloudWater proxy must no longer alter baseline albedo');

function coreWith({low=0,mid=0,high=0,insolation=430,olr=240,deep=0}={}){
  return {count:1,N:4,ticks:1,seed:1,
    surfaceTemp:new Float32Array([288]),airTemp:new Float32Array([282]),
    pressure:new Float32Array([101325]),windU:new Float32Array([5]),windV:new Float32Array([-2]),
    vaporColumn:new Float32Array([20]),cloudWaterState:new Float32Array([low+mid+high]),
    cloudLowMass:new Float32Array([low]),cloudMidMass:new Float32Array([mid]),cloudHighMass:new Float32Array([high]),
    deepConvectiveState:new Float32Array([deep]),environmentLapseKPerKm:new Float32Array([6.5]),
    cloudBaseHeightM:new Float32Array([900]),cloudTopHeightM:new Float32Array([9000]),scaleHeight:new Float32Array([8500]),
    insolation:new Float32Array([insolation]),localAlbedo:new Float32Array([0.185]),
    absorbedSolar:new Float32Array([insolation*(1-0.185)]),outgoingLongwave:new Float32Array([olr]),
    netRadiation:new Float32Array([insolation*(1-0.185)-olr]),areaWeight:new Float32Array([1])};
}
const out={};
let c=coreWith();ctx.cloudRadEnsureFields(c);ctx.cloudRadCellForcing(c,0,climate,out);
assert.ok(Math.abs(out.sw)<1e-9&&Math.abs(out.lw)<1e-9&&Math.abs(out.net)<1e-9,'clear sky must have zero cloud forcing');

c=coreWith({low:0.55});ctx.cloudRadEnsureFields(c);ctx.cloudRadCellForcing(c,0,climate,out);
assert.ok(out.sw<-100,'thick low cloud must strongly reflect shortwave');
assert.ok(out.lw>0,'low cloud must also trap some longwave');
assert.ok(out.net<0,'thick low daytime cloud should cool in this reference column');

c=coreWith({high:0.20,insolation:0,deep:0.8});ctx.cloudRadEnsureFields(c);ctx.cloudRadCellForcing(c,0,climate,out);
assert.ok(Math.abs(out.sw)<1e-9,'night cloud has no SW forcing');
assert.ok(out.lw>0&&out.net>0,'high night cloud must warm by reducing OLR');

c=coreWith({low:0.35,mid:0.18,high:0.08,deep:0.6});ctx.cloudRadEnsureFields(c);
const vapor0=c.vaporColumn[0],water0=c.cloudWaterState[0],p0=c.pressure[0],u0=c.windU[0],v0=c.windV[0],T0=c.surfaceTemp[0];
ctx.cloudRadApply(c,300,climate);
assert.ok(Number.isFinite(c.surfaceTemp[0])&&c.surfaceTemp[0]!==T0,'radiative forcing must affect local surface temperature');
assert.equal(c.vaporColumn[0],vapor0);assert.equal(c.cloudWaterState[0],water0);assert.equal(c.pressure[0],p0);assert.equal(c.windU[0],u0);assert.equal(c.windV[0],v0);
assert.ok(c.localAlbedo[0]>=c.clearSkyAlbedo[0],'clouds must not reduce SW albedo in this model');
assert.ok(c.outgoingLongwave[0]<=240,'cloud greenhouse must not increase OLR');

console.log('cloud-radiative-feedback.test.js: OK');
