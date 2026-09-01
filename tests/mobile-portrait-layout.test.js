const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mobile=read('js/mobile-portrait-layout.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/pause-ui.js','js/mobile-portrait-layout.js'],'shell mobile layout must override all dynamic controls last');
ordered(buildPs,['js/pause-ui.js','js/mobile-portrait-layout.js'],'PowerShell mobile layout must override all dynamic controls last');

assert.match(mobile,/@media \(max-width:700px\) and \(orientation:portrait\)/,'layout must be scoped to smartphone portrait');
assert.match(mobile,/grid-template-columns:repeat\(8,var\(--mp-tool-cell\)\)/,'sixteen tools must form eight columns');
assert.match(mobile,/grid-template-rows:repeat\(2,var\(--mp-tool-cell\)\)/,'sixteen tools must form two rows');
assert.match(mobile,/grid-column:auto!important;grid-row:auto!important/,'desktop column-major slot coordinates must be neutralized on phone');
assert.match(mobile,/rubric-grid \.rubric-slot:empty\{visibility:hidden!important\}/,'empty logical tool slots must keep their footprint without showing placeholders');
assert.match(mobile,/rubric-grid\.rubric-dragging \.rubric-slot:empty\{visibility:visible!important\}/,'empty tool slots must reappear as drag destinations');

assert.match(mobile,/\.rub-toggle\{[\s\S]*top:var\(--mp-edge-t\)!important;right:var\(--mp-edge-r\)!important/,'hamburger must own the top-right corner');
assert.match(mobile,/\.runtime-settings-btn\{[\s\S]*right:calc\(var\(--mp-edge-r\) \+ 44px\)!important/,'settings must sit immediately left of hamburger');
assert.match(mobile,/\.pause-btn\{[\s\S]*right:calc\(var\(--mp-edge-r\) \+ 88px\)!important/,'Pause must share the right-aligned top service row');
assert.match(mobile,/\.sim-speed-control\{[\s\S]*right:calc\(var\(--mp-edge-r\) \+ 132px\)!important/,'speed control must join the top service row when width permits');
assert.match(mobile,/@media \(max-width:380px\) and \(orientation:portrait\)[\s\S]*top:calc\(var\(--mp-edge-t\) \+ 44px\)!important/,'narrow phones must drop speed to a second right-aligned row');

for(const cls of ['mp-toggle-rings','mp-toggle-stars','mp-toggle-detail','mp-toggle-plates'])assert.ok(mobile.includes(cls),'toggle row class missing: '+cls);
assert.match(mobile,/grid-template-columns:repeat\(10,minmax\(0,1fr\)\)/,'bottom utilities need deterministic shared columns');
assert.match(mobile,/\.util-bar>#seed\{grid-row:2;grid-column:2\/4/,'seed field must occupy the fourth bottom row');
assert.match(mobile,/\.util-bar>#rand\{grid-row:2;grid-column:5\/8/,'random action must occupy the action row');
assert.match(mobile,/\.util-bar>#shotBtn\{grid-row:2;grid-column:8\/11/,'screenshot action must occupy the action row');
assert.match(mobile,/bottom:calc\(var\(--mp-dock-top\) \+ 2px\)!important/,'open panels must clear the complete four-row bottom dock');

console.log('mobile-portrait-layout.test.js: OK');
