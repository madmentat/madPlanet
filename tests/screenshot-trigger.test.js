const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const mathSrc=fs.readFileSync(path.join(root,'js','math.js'),'utf8');
const triggerSrc=fs.readFileSync(path.join(root,'js','screenshot-trigger.js'),'utf8');
const shaderSrc=fs.readFileSync(path.join(root,'shaders','lightning.glsl'),'utf8');

let baseFrames=0,shots=0;
const world={
  axis:[0,1,0],surfOff:0,
  cycA:new Float32Array(20),cycB:new Float32Array(20)
};
const state={lowOn:true,cloudLow:1,stormRate:1,storm:1,stormGlow:1};
const cam={dist:2,pitch:0,yaw:0};
const lightningShotTrigger={armed:false,includeCard:false,lastScore:0,threshold:0.48};
const ctx={
  console,Math,Number,Promise,Float32Array,
  world,state,cam,lightningShotTrigger,
  SPIN:0,t0:1000,fullShaderDone:true,shotCaptureBusy:false,
  drawFrame(){baseFrames++;},
  takeShot(){shots++;return null;},
  shotTriggerFired(){lightningShotTrigger.armed=false;}
};
vm.createContext(ctx);
vm.runInContext(mathSrc,ctx,{filename:'math.js'});
vm.runInContext(triggerSrc,ctx,{filename:'screenshot-trigger.js'});

assert.equal(lightningShotTrigger.threshold,0.015,'trigger threshold must be recalibrated for physical lightning');
assert.match(triggerSrc,/0\.60\+3\.40\*stormRate\*stormRate/,'trigger must mirror renderer nonlinear flash-rate scale');
assert.match(shaderSrc,/0\.60 \+ 3\.40\*uStormRate\*uStormRate/,'renderer flash-rate scale changed without trigger sync');
assert.match(triggerSrc,/0\.80\+1\.20\*storm\*storm/,'trigger must mirror renderer activity scale');
assert.match(shaderSrc,/0\.80 \+ 1\.20\*uStorm\*uStorm/,'renderer activity scale changed without trigger sync');

function setStormDirection(x,y,z){
  world.cycA.fill(0);world.cycB.fill(0);
  world.cycA[0]=x;world.cycA[1]=y;world.cycA[2]=z;
  world.cycB[0]=0.10;world.cycB[1]=0.25;world.cycB[2]=0.08;world.cycB[3]=0;
}

/* Camera at yaw=0 looks at the planet from +Z. A storm arbitrarily close to
   the limb but still on the +Z hemisphere must be trigger-visible. */
setStormDirection(Math.sqrt(1-0.0001),0,0.01);
assert.equal(ctx.shotLightningFrontVisibility(world.cycA[0],0,world.cycA[2],0),1,'front-side near-limb storm must be visible');
const nearScore=ctx.shotLightningVisualScore(1000);
assert.ok(nearScore>lightningShotTrigger.threshold,'near-limb real flash must exceed trigger threshold');

/* Visibility is a hemisphere test, not projected size or camera distance. */
cam.dist=50;
const farScore=ctx.shotLightningVisualScore(1000);
assert.ok(Math.abs(farScore-nearScore)<1e-12,'trigger score must be independent of camera distance');
assert.equal(ctx.shotLightningFrontVisibility(1,0,0,0),1,'mathematical limb belongs to visible hemisphere');
setStormDirection(Math.sqrt(1-0.0001),0,-0.01);
assert.equal(ctx.shotLightningFrontVisibility(world.cycA[0],0,world.cycA[2],0),0,'back hemisphere must not trigger');
assert.equal(ctx.shotLightningVisualScore(1000),0,'back-side flash must have zero visual trigger score');

/* Armed trigger must fire immediately on a visible rising edge. */
cam.dist=3;
setStormDirection(0,0,1);
lightningShotTrigger.armed=true;lightningShotTrigger.lastScore=0;shots=0;
ctx.drawFrame(1000);
assert.equal(shots,1,'visible flash must capture a screenshot');
assert.equal(lightningShotTrigger.armed,false,'trigger must disarm after firing');
assert.equal(baseFrames,1,'wrapped renderer must still draw the normal frame');

console.log('screenshot-trigger.test.js: OK');
