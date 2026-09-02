const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ux = fs.readFileSync(path.join(root,'js/touch-ux.js'),'utf8');
const pause = fs.readFileSync(path.join(root,'js/pause-ui.js'),'utf8');
const camera = fs.readFileSync(path.join(root,'js/camera.js'),'utf8');
const buildPs = fs.readFileSync(path.join(root,'build.ps1'),'utf8');
const buildSh = fs.readFileSync(path.join(root,'build.sh'),'utf8');
const version = fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,
  'touch UX test must see a semantic version');

function ordered(text,names,label){
  let p=-1;
  for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}
}
ordered(buildPs,["'js/camera.js'","'js/magnetosphere.js'","'js/magnet-axis-rotation.js'","'js/touch-ux.js'","'js/ui.js'"],
  'PowerShell build must register magnetic rotation and touch arbitration before ui outside-tap capture');
ordered(buildSh,['js/camera.js','js/magnetosphere.js','js/magnet-axis-rotation.js','js/touch-ux.js','js/ui.js'],
  'shell build must register magnetic rotation and touch arbitration before ui outside-tap capture');

assert.ok(camera.includes("let orbitControlMode = 'planet'"),
  'camera needs an explicit planet/sun drag mode');
assert.match(camera,/orbitControlMode\s*===\s*'sun'/,
  'primary pointer must rotate the sun in star mode');
assert.match(camera,/e\.button\s*===\s*2/,
  'desktop right-button sun rotation must remain available');
assert.ok(camera.includes('function setOrbitControlMode'),
  'touch UI must have a public mode setter');
/* 0.5.77 regression: the planet canvas owns its touch/pen gesture. Android
   Chromium must never pan the visual viewport/toolbars together with orbit. */
assert.ok(camera.includes("canvas.style.touchAction='none'"),
  'runtime camera setup must explicitly disable browser touch panning');
assert.ok(camera.includes("canvas.style.overscrollBehavior='none'"),
  'canvas drag must not chain into viewport overscroll');
assert.match(camera,/function ownCanvasPointer\(e\)[\s\S]*e\.preventDefault\(\)/,
  'touch/pen pointer events on the canvas must cancel native browser motion');
assert.ok((camera.match(/\{passive:false\}/g)||[]).length>=5,
  'canvas pointer and wheel listeners must be explicitly non-passive');

assert.ok(ux.includes('scrollbar-width:none'),
  'panel scrollbar must be visually removed');
assert.ok(ux.includes('touch-action:none!important'),
  'panel touch pan must be arbitrated by our gesture handler');
assert.ok(ux.includes("e.pointerType === 'touch' || e.pointerType === 'pen'"),
  'mouse behaviour must remain untouched');
assert.ok(ux.includes('e.stopImmediatePropagation()'),
  'open-panel touch gestures must not leak to the old outside-close handler or canvas');
assert.ok(ux.includes("gesture.mode=gesture.slider && Math.abs(dx) > Math.abs(dy)*RANGE_AXIS_BIAS"),
  'a range may move only after a clearly horizontal touch gesture');
assert.ok(ux.includes("? 'slider' : 'scroll'"),
  'vertical gestures over ranges must resolve to panel scrolling');
assert.ok(ux.includes("slider.dispatchEvent(new Event('input',{bubbles:true}))"),
  'custom range drag must still reuse the existing input pipeline');
assert.ok(ux.includes('gesture.body.scrollTop=gesture.startScroll-dy'),
  'dragging anywhere while a panel is open must scroll its body');
assert.ok(ux.includes('!gesture.startInPanel'),
  'a free-space tap outside the panel must be distinguishable from a swipe');
assert.ok(ux.includes("btn.textContent=mode === 'sun' ? '☀ Звезда' : '◉ Планета'"),
  'the mobile-accessible rotation-mode button must expose both states');

/* 0.5.111 regression: on portrait tablets the bottom utility bar spans almost
   the whole screen, so corner buttons must be lifted above it rather than
   painted over the controls. Phones have two stacked bottom rows and need a
   larger pause clearance while their hamburger remains top-center. */
assert.match(pause,/@media \(min-width:701px\) and \(orientation:portrait\)[\s\S]*\.pause-btn[\s\S]*bottom:calc\(var\(--safe-b\) \+ 58px\)[\s\S]*\.rub-toggle[\s\S]*bottom:calc\(var\(--safe-b\) \+ 58px\)/,
  'portrait tablet pause and hamburger must clear the bottom utility bar');
assert.match(pause,/@media \(max-width:700px\)[\s\S]*\.pause-btn\{bottom:calc\(var\(--safe-b\) \+ 102px\)\}/,
  'phone pause must clear both stacked bottom control rows');

console.log('touch-ux.test.js: OK');