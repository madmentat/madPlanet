const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/frame-pacing-polish.js'),'utf8');
const input=fs.readFileSync(path.join(root,'js/input-frame-pacing.js'),'utf8');

assert.match(input,/cameraInputStep\(span\)/,'input wrapper must pass actual frame span to camera queue drain');
assert.match(src,/CAMERA_PACED_STEP_MAX_RAD=0\.068/,'visible queued camera step needs a tight hard ceiling');
assert.match(src,/CAMERA_PACED_INERTIA_MAX_RAD_S=1\.65/,'release inertia must be bounded below the old 5 rad\/s spike');
assert.match(src,/cameraMotionActive\(\)\|\|weatherCoreInteractionBusyBeforePacing/,'weather CPU work must defer through visible inertia');
assert.match(src,/weatherCloudGpuBlendDurationMs\*1\.55/,'cloud visual targets need temporal low-pass smoothing');
assert.match(src,/fogGpuBlendDurationMs\*1\.55/,'fog visual targets need temporal low-pass smoothing');
assert.match(src,/base\*6\.0/,'slow mobile cryosphere publication must stay in continuous interpolation');

const cam={yaw:0,pitch:0,vyaw:0,vpitch:0,dist:2,tDist:2};
const pointers=new Map();
const ctx={console,Math,Number,window:{},cam,pointers,
  CAMERA_INPUT_EPS:1e-6,
  cameraPendingYaw:0.30,cameraPendingPitch:0,cameraPendingSunAz:0,cameraPendingSunEl:0,
  cameraReleaseVYaw:0,cameraReleaseVPitch:0,sunAz:0,sunEl:0,
  cameraInputStep:()=>{},
  cameraInputPending:function(){return Math.abs(this.cameraPendingYaw)+Math.abs(this.cameraPendingPitch)+Math.abs(this.cameraPendingSunAz)+Math.abs(this.cameraPendingSunEl)>1e-6;},
  cameraDrainPair:(a,b,maxStep)=>{const m=Math.hypot(a,b);if(!(m>1e-6))return[0,0,0];const f=Math.min(1,maxStep/m);return[a*f,b*f,f];}
};
/* Global let bindings in the real concatenated script are lexical. For this
   isolated VM regression use var aliases so the replacement function sees the
   same mutable names. */
vm.createContext(ctx);
vm.runInContext(`var cameraPendingYaw=.30,cameraPendingPitch=0,cameraPendingSunAz=0,cameraPendingSunEl=0;
var cameraReleaseVYaw=0,cameraReleaseVPitch=0;var sunAz=0,sunEl=0;
function cameraInputPending(){return Math.abs(cameraPendingYaw)+Math.abs(cameraPendingPitch)+Math.abs(cameraPendingSunAz)+Math.abs(cameraPendingSunEl)>1e-6;}
function cameraDrainPair(a,b,maxStep){const m=Math.hypot(a,b);if(!(m>1e-6))return[0,0,0];const f=Math.min(1,maxStep/m);return[a*f,b*f,f];}
function cameraInputStep(){}
`,ctx);
vm.runInContext(src,ctx,{filename:'frame-pacing-polish.js'});
ctx.cameraInputStep(16.7);
assert.ok(cam.yaw>0,'queued input must move on the next visible frame');
assert.ok(cam.yaw<=0.037,'60 Hz frame must not consume the old 0.16 rad jump');
const first=cam.yaw;
ctx.cameraInputStep(50);
assert.ok(cam.yaw-first<=0.068+1e-9,'slow frame must still obey the hard spatial ceiling');

vm.runInContext('cameraPendingYaw=0.01;',ctx);
const beforeSmall=cam.yaw;
ctx.cameraInputStep(16.7);
assert.ok(Math.abs((cam.yaw-beforeSmall)-0.01)<1e-9,'small flicks must remain immediate rather than feel filtered');

vm.runInContext('cameraPendingYaw=0;cameraPendingPitch=0;cameraReleaseVYaw=5;cameraReleaseVPitch=-5;',ctx);
ctx.cameraInputStep(16.7);
assert.ok(Math.abs(cam.vyaw)<=1.65+1e-9&&Math.abs(cam.vpitch)<=1.65+1e-9,'release inertia must be clamped before render-loop integration');

console.log('frame-pacing-polish.test.js: OK');
