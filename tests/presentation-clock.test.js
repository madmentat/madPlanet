'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js/presentation-clock.js'),'utf8');
const buildSh=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const buildPs=fs.readFileSync(path.join(root,'build.ps1'),'utf8');

for(const build of [buildSh,buildPs]){
  assert.ok(build.indexOf('js/runtime-settings.js')<build.indexOf('js/presentation-clock.js'),'presentation clock must wrap the runtime clock');
  assert.ok(build.indexOf('js/presentation-clock.js')<build.indexOf('js/weather-cloud-render.js'),'wall-time visual bridges must stay outside presentation smoothing');
}
assert.match(src,/PRESENTATION_HITCH_MIN_MS=46/,'isolated long frames need a concrete hitch threshold');
assert.match(src,/PRESENTATION_HITCH_MULT=1\.75/,'hitch detection must adapt to stable 30\/45\/60 fps cadence');
assert.match(src,/PRESENTATION_CATCHUP_FRACTION=0\.28/,'presentation debt must be repaid gradually');
assert.match(src,/presentNow=Math\.min\(now,presentNow\+Math\.max\(0,advance\)\)/,'presentation clock may never run ahead of wall time');
assert.match(src,/rawGap>PRESENTATION_RESET_GAP_MS/,'hidden-tab\/debugger gaps must reset rather than create seconds of debt');

const seen=[];
const context={
  console,Math,Number,Date,
  state:{paused:false},
  performance:{now:()=>0},
  window:{},
  drawFrame:(now)=>{seen.push(now);return now;}
};
vm.createContext(context);
vm.runInContext(src,context,{filename:'presentation-clock.js'});

context.drawFrame(0);
context.drawFrame(16.7);
context.drawFrame(33.4);
assert.ok(Math.abs(seen[2]-33.4)<1e-6,'ordinary 60 Hz cadence must remain unfiltered');
context.drawFrame(100.0);
assert.ok(seen[3]>33.4&&seen[3]<70,'one 66 ms hitch must not teleport the presentation clock to wall time');
assert.ok(context.window.__madPlanetPresentationClock.debtMs>20,'clipped hitch must become explicit presentation debt');
assert.equal(context.window.__madPlanetPresentationClock.recentJank(100),true,'scheduler must be able to see the recent hitch');
const afterHitch=seen[3];
context.drawFrame(116.7);
assert.ok(seen[4]>afterHitch&&seen[4]<116.7,'debt must catch up monotonically over later frames');

context.window.__madPlanetPresentationClock.reset(0);
seen.length=0;
context.drawFrame(0);
context.drawFrame(33.3);
context.drawFrame(66.6);
context.drawFrame(99.9);
assert.ok(Math.abs(seen[3]-99.9)<1e-6,'stable 30 fps must remain exact rather than be mistaken for stutter');

console.log('presentation-clock.test.js: OK');
