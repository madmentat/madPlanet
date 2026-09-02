const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const src=read('js/thermal-probe.js');
const sh=read('build.sh');
const ps=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(sh,['js/thermal-display.js','js/thermal-probe.js','js/runtime-settings.js'],'shell thermal instrument order');
ordered(ps,["'js/thermal-display.js'","'js/thermal-probe.js'","'js/runtime-settings.js'"],'PowerShell thermal instrument order');

assert.match(src,/surfaceSkinTemp/,'probe must read physical visible-surface temperature');
assert.match(src,/m3axis\(world\.axis,-\(t\*SPIN\+world\.surfOff\)\)/,'probe point must rotate into the same body frame as the surface');
assert.match(src,/const rgt=norm\(\[-fwd\[2\],0,fwd\[0\]\]\)/,'CPU ray must use render.js camera handedness');
assert.match(src,/disc=b\*b-c/,'probe must ray-intersect the actual unit sphere');
assert.match(src,/const o=0\.014/,'probe must mirror thermal cubemap seam-smoothing footprint');
assert.match(src,/sampleFieldLinear/,'physical temperature lookup must be spatially interpolated');
assert.match(src,/0\.78\*clamp\(\(C\+100\)\/160/,'probe colour sample must use the thermal climate palette mapping');
assert.match(src,/z-index:2147483000/,'probe callout must stay above application windows');
assert.match(src,/#gl\.thermal-probe-hit\{cursor:none!important\}/,'native cursor must disappear only on a valid thermal hit');
assert.match(src,/drawThermometer/,'probe must draw a thermometer cursor');
assert.match(src,/pointer\.x>=g\.center\[0\]\?1:-1/,'callout side must follow the viewed side of the planet');
assert.match(src,/g\.radius\+12/,'leader must exit beyond the planet limb');
assert.match(src,/swx=side>0\?bx\+boxW-sw-8:bx\+8/,'colour swatch must mirror to the outside edge of the callout');
assert.match(src,/pointerleave/,'probe must disappear when leaving the scene');
assert.match(src,/window\.__madPlanetThermalDisplay\?\.isEnabled/,'probe must only run in thermal mode');
assert.match(src,/const drawFrameBeforeThermalProbe=drawFrame/,'probe must receive the scaled render clock');
assert.doesNotMatch(src,/readPixels|createFramebuffer/,'interactive probe must not add synchronous GPU readback stalls');
assert.match(src,/window\.__madPlanetThermalProbe/,'probe must expose a small diagnostics API');

console.log('thermal-probe-ui.test.js: OK');
