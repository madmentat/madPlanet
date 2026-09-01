const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const grid=read('js/rubric-grid.js');
const orbit=read('js/orbit-overlay.js');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/ui.js','js/rubric-grid.js','js/render.js','js/orbit-overlay.js','js/runtime-settings.js'],'shell rubric/orbit order');
ordered(buildPs,['js/ui.js','js/rubric-grid.js','js/render.js','js/orbit-overlay.js','js/runtime-settings.js'],'PowerShell rubric/orbit order');

assert.match(grid,/const SLOT_COUNT=16/,'rubric must expose sixteen logical positions');
assert.match(grid,/const COLUMN_ROWS=8/,'each desktop rubric column must remain eight buttons tall');
assert.match(grid,/if\(i<COLUMN_ROWS\)\{slot\.style\.gridColumn='2'/,'original logical column must stay on the right');
assert.match(grid,/else\{slot\.style\.gridColumn='1'/,'new logical column must be placed to the left');
assert.match(grid,/defaultIds\[COLUMN_ROWS\]=orbitBtn\.dataset\.toolId/,'Orbit must start at the top of the new column');
assert.match(grid,/localStorage\.setItem\(STORAGE_KEY,JSON\.stringify\(layout\)\)/,'custom rubric order must persist per browser/device');
assert.match(grid,/layout\[src\]=layout\[dst\];layout\[dst\]=tmp/,'dropping on another slot must swap positions');
assert.match(grid,/rubric-dragging \.rubric-slot:empty/,'empty destinations must become visible during drag');
assert.match(grid,/id='orbitOverlayBtn'/,'Orbit rubric button missing');
assert.match(grid,/action:orbit/,'Orbit must be an action tool rather than a parameter group');

assert.match(orbit,/const drawFrameBeforeOrbitOverlay=drawFrame/,'orbit overlay must attach to the frame loop');
assert.match(orbit,/drawFrame=function\(now\)/,'orbit overlay frame wrapper missing');
assert.match(orbit,/seasonOrbitPhaseRad/,'orbit marker must use the physical seasonal orbit phase');
assert.match(orbit,/seasonAxialTiltDeg/,'axis diagram must use the physical axial tilt');
assert.match(orbit,/seasonDeclinationRadForPhase/,'diagram must expose seasonal solar declination');
assert.match(orbit,/orbitOverlayBtn/,'overlay must bind to the rubric Orbit button');
assert.match(orbit,/canvas\.getContext\('2d'/,'orbit schematic must stay on a cheap 2D overlay canvas');
assert.ok(!/state\.orbitOverlay\s*=/.test(orbit),'display-only Orbit mode must not enter planet state/hash');

console.log('rubric-orbit-ui.test.js: OK');
