const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const camera=read('js/camera.js');
const pacing=read('js/input-frame-pacing.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/smooth-motion-ui.js','js/input-frame-pacing.js','js/screenshot-trigger.js'],'shell pacing layer order');
ordered(buildPs,["'js/smooth-motion-ui.js'","'js/input-frame-pacing.js'","'js/screenshot-trigger.js'"],'PowerShell pacing layer order');

assert.match(camera,/getCoalescedEvents/,'Chromium coalesced pointer samples must be consumed');
assert.match(camera,/if\(applyFinal\)cameraProcessPointerEvent\(e,false\);[\s\S]*pointers\.delete\(e\.pointerId\)/,
  'pointerup final coordinates must be applied before capture state is deleted');
assert.match(camera,/CAMERA_INPUT_MAX_STEP_RAD=0\.16/,'base queued drag must retain a bounded fallback angular step');
assert.match(camera,/cameraPendingYaw\+=dyaw/,'pointer motion must accumulate independently of render cadence');
assert.match(camera,/cameraReleaseVYaw/,'inertia must be staged until the visible drag queue is drained');
assert.match(camera,/if\(pointers\.size===0&&!cameraInputPending\(\)/,
  'release inertia must not start while queued pointer movement remains');

assert.match(pacing,/navigator\.scheduling\.isInputPending/,'Chromium pending-input scheduler hint must be used when available');
assert.match(pacing,/includeContinuous:true/,'continuous mouse\/touch motion must count as pending input');
assert.match(pacing,/cameraInputStep\(span\)/,'queued input must receive the actual visible frame span immediately before camera matrices are drawn');
assert.match(pacing,/weatherCoreInteractionBusy=function/,'Weather Core interaction guard must include queued/browser input');
assert.match(pacing,/smoothDrainVisualPublish=function/,'deferred visual uploads must yield to queued input');
assert.match(pacing,/interacting&&span>28/,'a long interaction frame should trigger early adaptive-quality response');
assert.ok(!/readPixels|gl\.finish\(/.test(pacing),'frame pacing must not introduce synchronous GPU stalls');

/* Functional short-flick regression for the base input queue: no pointermove at
   all. pointerup is the first event whose coordinates differ from pointerdown,
   and it still has to rotate the camera on the next visible input step. The
   later frame-pacing-polish regression separately verifies its tighter,
   frame-time-aware drain ceiling. */
const listeners={};
const canvas={
  style:{},classList:{add(){},remove(){}},
  addEventListener(name,fn){(listeners[name]||(listeners[name]=[])).push(fn);},
  setPointerCapture(){},
};
const document={documentElement:{style:{}},body:{style:{}}};
const windowObj={scrollX:0,scrollY:0,scrollTo(){},addEventListener(){}};
const ctx={
  console,Math,Number,Map,Date,performance:{now:()=>1000},
  innerWidth:1000,innerHeight:1000,canvas,document,window:windowObj,
  matchMedia:()=>({matches:false}),
};
vm.createContext(ctx);vm.runInContext(camera,ctx,{filename:'camera.js'});
const fire=(name,e)=>{for(const fn of listeners[name]||[])fn(e);};
const base={pointerId:1,pointerType:'mouse',button:0,cancelable:false,preventDefault(){}};
const yaw0=vm.runInContext('cam.yaw',ctx);
fire('pointerdown',{...base,clientX:100,clientY:300,timeStamp:10});
fire('pointerup',{...base,clientX:300,clientY:300,timeStamp:26});
const queued=ctx.window.__madPlanetCameraInput.queued;
assert.ok(Math.abs(queued.yaw)>0.5,'pointerup-only flick must queue its full final displacement');
ctx.window.__madPlanetCameraInput.step();
const yaw1=vm.runInContext('cam.yaw',ctx);
assert.ok(Math.abs(yaw1-yaw0)>0.10,'first visible base-queue step must respond to the short flick');
assert.ok(Math.abs(yaw1-yaw0)<=0.160001,'base queue must retain its fallback frame cap before late pacing overrides it');
assert.ok(ctx.window.__madPlanetCameraInput.pending(),'large delayed flick should remain queued for following frames');

console.log('input-frame-pacing.test.js: OK');
