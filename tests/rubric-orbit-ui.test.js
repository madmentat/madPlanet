const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const grid=read('js/rubric-grid.js');
const orbit=read('js/orbit-overlay.js');
const orbitDrag=read('js/orbit-overlay-drag.js');
const orbitScene=read('js/orbit-scene-path.js');
const ecliptic=read('js/ecliptic-overlay.js');
const thermal=read('js/thermal-display.js');
const thermalShader=read('shaders/thermal.glsl');
const mainShader=read('shaders/main.glsl');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
ordered(buildSh,['js/ui.js','js/rubric-grid.js','js/render.js','js/orbit-overlay.js','js/orbit-overlay-drag.js','js/orbit-scene-path.js','js/ecliptic-overlay.js','js/thermal-display.js','js/runtime-settings.js'],'shell instrument order');
ordered(buildPs,['js/ui.js','js/rubric-grid.js','js/render.js','js/orbit-overlay.js','js/orbit-overlay-drag.js','js/orbit-scene-path.js','js/ecliptic-overlay.js','js/thermal-display.js','js/runtime-settings.js'],'PowerShell instrument order');
ordered(buildSh,['shaders/sphere.glsl','shaders/thermal.glsl','shaders/main.glsl'],'shell thermal shader order');
ordered(buildPs,['shaders/sphere.glsl','shaders/thermal.glsl','shaders/main.glsl'],'PowerShell thermal shader order');

assert.match(grid,/const SLOT_COUNT=16/,'rubric must expose sixteen logical positions');
assert.match(grid,/const COLUMN_ROWS=8/,'each desktop rubric column must remain eight buttons tall');
assert.match(grid,/if\(i<COLUMN_ROWS\)\{slot\.style\.gridColumn='2'/,'original logical column must stay on the right');
assert.match(grid,/else\{slot\.style\.gridColumn='1'/,'new logical column must be placed to the left');
assert.match(grid,/defaultIds\[COLUMN_ROWS\]=orbitBtn\.dataset\.toolId/,'Orbit must start at the top of the new column');
assert.match(grid,/defaultIds\[COLUMN_ROWS\+1\]=eclipticBtn\.dataset\.toolId/,'Ecliptic must occupy the second new-column cell');
assert.match(grid,/defaultIds\[COLUMN_ROWS\+2\]=thermalBtn\.dataset\.toolId/,'Thermal must occupy the third new-column cell');
assert.match(grid,/localStorage\.setItem\(STORAGE_KEY,JSON\.stringify\(layout\)\)/,'custom rubric order must persist per browser/device');
assert.match(grid,/layout\[src\]=layout\[dst\];layout\[dst\]=tmp/,'dropping on another slot must swap positions');
assert.match(grid,/rubric-dragging \.rubric-slot:empty/,'empty destinations must become visible during drag');
for(const id of ['orbitOverlayBtn','eclipticOverlayBtn','thermalDisplayBtn'])assert.ok(grid.includes("'"+id+"'"),'instrument rubric button missing: '+id);
for(const id of ['action:orbit','action:ecliptic','action:thermal'])assert.ok(grid.includes(id),'instrument must be action tool: '+id);

assert.match(orbit,/const drawFrameBeforeOrbitOverlay=drawFrame/,'orbit overlay must attach to the frame loop');
assert.match(orbit,/eccentricSeasonState/,'orbit marker must use the physical Kepler state');
assert.match(orbit,/seasonAxialTiltDeg/,'axis diagram must use the physical axial tilt');
assert.match(orbit,/seasonDeclinationRadForPhase/,'diagram must expose seasonal solar declination');
assert.match(orbit,/orbitDisplayEccentricity/,'mini-map must visually amplify otherwise unreadable low eccentricity');
assert.match(orbit,/focus=rotatePoint\(cx,cy,-rx\*visualE/,'mini-map star must be placed at the displayed ellipse focus');
assert.match(orbit,/canvas\.getContext\('2d'/,'orbit schematic must stay on a cheap 2D overlay canvas');
assert.ok(!/state\.orbitOverlay\s*=/.test(orbit),'display-only Orbit mode must not enter planet state/hash');

assert.match(orbitDrag,/orbit-overlay-head/,'Orbit window must have a dedicated drag handle');
assert.match(orbitDrag,/pointerdown/,'Orbit window must support pointer/touch dragging');
assert.match(orbitDrag,/madPlanet\.orbitOverlay\.pos\.v1/,'Orbit window position must persist locally');
assert.match(orbitDrag,/window\.__madPlanetOrbitOverlay\?\.setEnabled\(false\)/,'Orbit title bar close control must use the existing overlay state');

assert.match(orbitScene,/Орбита в основной сцене/,'Orbit mini-map must expose the scene-orbit toggle');
assert.match(orbitScene,/madPlanet\.orbitOverlay\.scenePath\.v1/,'scene-orbit preference must persist locally');
assert.match(orbitScene,/window\.__madPlanetOrbitOverlay\?\.isEnabled/,'scene orbit must disappear when Orbit mode is closed');
assert.match(orbitScene,/Math\.cos\(sunEl\)\*Math\.sin\(sunAz\)/,'scene orbit must use the same system-star direction as the sky pass');
assert.match(orbitScene,/planetPhysics\(\)\.axialTiltDeg/,'scene orbit orientation must follow the physical ecliptic plane');
assert.match(orbitScene,/const HUD_RADIUS_FRACTION=0\.23/,'scene orbit must use a fixed screen-space navigation radius');
assert.match(orbitScene,/const radial=norm\(\[-sun\[0\],-sun\[1\],-sun\[2\]\]\)/,'current planet must define the star-to-planet radial basis');
assert.match(orbitScene,/orbitNormalThroughRadial/,'displayed orbital plane must contain the current star-planet radius vector');
assert.match(orbitScene,/points\[nearest\]\.x=planetScreen\[0\];points\[nearest\]\.y=planetScreen\[1\]/,'current orbit point must be pinned exactly to planet screen centre');
assert.doesNotMatch(orbitScene,/cam\.dist/,'zoom must be excluded from navigation-orbit scale');
assert.doesNotMatch(orbitScene,/Math\.sqrt\(ex\*ex\+\(ey\*ey\)\/\(q\*q\)\)/,'singular projected-star radius solve must not return');
assert.doesNotMatch(orbitScene,/FOCAL\*dot\(sun/,'scene orbit must not size itself from perspective star projection');
assert.match(orbitScene,/orbitEccentricityForSeed/,'scene orbit must use seeded physical eccentricity');
assert.match(orbitScene,/orbitDisplayEccentricity/,'scene orbit shape must use the shared visual eccentricity mapping');
assert.match(orbitScene,/const starScreen=\[planetScreen\[0\]-radius\*cur2\[0\]/,'scene orbit must place the schematic sun at the displayed Kepler focus');
assert.match(orbitScene,/ctx\.setLineDash\(\[4,5\]\).*rgba\(255,184,88,\.34\)/s,'far side of stabilized orbit must remain dashed and dim');
assert.match(orbitScene,/drawNode\(s\[0\],s\[1\],5\.2,'rgba\(255,177,73,\.96\)'\)/,'sun focus must be drawn over the orbit so the line passes behind it');
assert.match(orbitScene,/window\.__madPlanetOrbitScenePath/,'scene orbit must expose a diagnostic display API');
assert.ok(!/state\.[A-Za-z0-9_]*orbit/i.test(orbitScene),'scene-orbit display state must not enter planet state/hash');

assert.match(ecliptic,/eclipticOverlayBtn/,'Ecliptic tool must bind to its rubric button');
assert.match(ecliptic,/drawPlane\(cx,cy,r,axis/,'Ecliptic overlay must draw the equatorial plane');
assert.match(ecliptic,/drawPlane\(cx,cy,r,ecl/,'Ecliptic overlay must draw the ecliptic plane');
assert.match(ecliptic,/planetPhysics\(\)\.axialTiltDeg/,'Ecliptic overlay must use physical axial tilt');
assert.match(ecliptic,/projectedBasis/,'Ecliptic geometry must follow the current camera viewpoint');

assert.match(thermal,/thermalDisplayBtn/,'Thermal tool must bind to its rubric button');
assert.match(thermal,/gl\.getUniformLocation\(prog,'uThermalOn'\)/,'Thermal mode must bind its display uniform lazily across shader swaps');
assert.match(thermal,/≤−100 °C/,'Thermal legend must expose its climate cold range');
assert.match(thermal,/−50 °C/,'Thermal legend must resolve Antarctic-class temperatures');
assert.match(thermal,/\+1200 °C/,'Thermal legend must expose its Celsius volcanic hot bound');
assert.ok(!/180 K|380 K/.test(thermal),'Thermal legend must not regress to kelvin labels');
assert.match(thermal,/madPlanet\.thermalLegend\.pos\.v1/,'thermal legend position must persist locally');
assert.match(thermal,/legend\.addEventListener\('pointerdown'/,'thermal legend must support mouse/touch dragging');
assert.match(thermal,/touch-action:none/,'thermal drag must own its touch gesture');
assert.match(thermalShader,/uniform float uThermalOn/,'Thermal shader display switch missing');
assert.match(thermalShader,/thermalSurfaceColorK/,'Thermal shader palette missing');
assert.match(mainShader,/physicalFogSample\(n0\)\.a/,'Thermal mode must use Weather Core surface temperature rather than visual colour');
assert.match(mainShader,/if\(uThermalOn > 0\.5\)/,'Thermal display override missing from planet disk');

console.log('rubric-orbit-ui.test.js: OK');
