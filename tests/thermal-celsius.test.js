const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const thermalUi=read('js/thermal-display.js');
const units=read('js/celsius-ui.js');
const thermalShader=read('shaders/thermal.glsl');
const mainShader=read('shaders/main.glsl');
const surfaceShader=read('shaders/surface.glsl');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');

assert.match(thermalUi,/−190 °C/,'thermal legend lower bound must be Celsius');
assert.match(thermalUi,/\+1200 °C/,'thermal legend lava range must be Celsius');
assert.ok(!/<span>[^<]*\bK<\/span>/.test(thermalUi),'thermal legend must not expose kelvin labels');

assert.match(units,/celsiusFromK/,'shared UI Kelvin-to-Celsius conversion missing');
assert.match(units,/data-climate="temp"/,'climate diagnostic must be converted to Celsius');
assert.match(units,/data-weathercore="temp"/,'Weather Core air-temperature diagnostic must be converted to Celsius');
assert.match(units,/data-oceanthermal="depth"/,'ocean temperature contrast must be relabelled in Celsius');
assert.match(units,/unit:'°C'/,'public temperature unit must be Celsius');

assert.match(thermalShader,/thermalDecodeSurfaceK/,'thermal view must decode the packed temperature channel');
assert.match(thermalShader,/code < 0\.05/,'cold-tail packed-temperature decoding missing');
assert.match(thermalShader,/code < 0\.90/,'normal/hot packed-temperature decoding missing');
assert.match(thermalShader,/thermalVolcanicMask/,'volcanic thermal signature missing');
assert.match(thermalShader,/terrain\(n0,ridge,mount,lee\)/,'thermal volcano mask must follow the rendered terrain geography');
assert.match(thermalShader,/uVolcano/,'thermal volcanic heat must follow volcanic activity');
assert.match(thermalShader,/uLava/,'thermal lava skin temperature must follow lava activity');
assert.match(thermalShader,/873\.15,1473\.15/,'lava thermal envelope must span 600..1200 C');

for(const token of ['sN*7.2+uSeedS*3.8','sN*3.3+uSeedS*4.1','sN*44.0+uSeedS*2.9']){
  assert.ok(surfaceShader.includes(token),'visible volcano geography token missing: '+token);
  assert.ok(thermalShader.includes(token),'thermal volcano geography must match visible surface: '+token);
}
assert.match(mainShader,/thermalInstrumentSurfaceK\(n0, encodedTemp\)/,'main shader must use decoded surface plus volcanic skin heat');
assert.match(mainShader,/thermalSurfaceColorK\(thermalK\)/,'main shader must use absolute-temperature thermal palette');

assert.ok(buildSh.indexOf('js/mobile-portrait-layout.js')<buildSh.indexOf('js/celsius-ui.js'),'Celsius adapter must load last in shell build');
assert.ok(buildPs.indexOf("'js/mobile-portrait-layout.js'")<buildPs.indexOf("'js/celsius-ui.js'"),'Celsius adapter must load last in PowerShell build');

console.log('thermal-celsius.test.js: OK');
