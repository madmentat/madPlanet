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

assert.match(thermalUi,/≤−100 °C/,'thermal legend must expose the climate cold range');
assert.match(thermalUi,/−50 °C/,'thermal legend must resolve Antarctic-class temperatures');
assert.match(thermalUi,/\+50 °C/,'thermal legend must resolve hot terrestrial climate');
assert.match(thermalUi,/\+1200 °C/,'thermal legend lava range must remain Celsius');
assert.match(thermalUi,/surfaceSkinMinK/,'thermal instrument must expose the actual physical minimum');
assert.match(thermalUi,/northPolarSkinMinK/,'thermal instrument must expose north-polar minimum');
assert.match(thermalUi,/southPolarSkinMinK/,'thermal instrument must expose south-polar minimum');
assert.match(thermalUi,/mountainSkinMinK/,'thermal instrument must expose mountain minimum');
assert.ok(!/<span>[^<]*\bK<\/span>/.test(thermalUi),'thermal legend must not expose kelvin labels');

assert.match(units,/celsiusFromK/,'shared UI Kelvin-to-Celsius conversion missing');
assert.match(units,/data-climate="temp"/,'climate diagnostic must be converted to Celsius');
assert.match(units,/data-weathercore="temp"/,'Weather Core air-temperature diagnostic must be converted to Celsius');
assert.match(units,/data-oceanthermal="depth"/,'ocean temperature contrast must be relabelled in Celsius');
assert.match(units,/unit:'°C'/,'public temperature unit must be Celsius');

/* Top-left thermometer: current observation and equilibrium forecast are
   different quantities and must never collapse back into one readout. */
assert.match(units,/temperatureTelemetrySubLabel\(currentLabel,'a'\)/,'current temperature must be labelled T_a');
assert.match(units,/temperatureTelemetrySubLabel\(label,'f'\)/,'forecast temperature must be labelled T_f');
assert.match(units,/smoothTelemetryValues\.forecast/,'forecast must have its own telemetry value');
assert.match(units,/climateConsistencyCurrentSurfaceC\(\)/,'T_a must come from the actual area-weighted Weather Core surface');
assert.match(units,/weatherCoreEnsure\(\)/,'T_a must initialize Weather Core immediately instead of temporarily showing the forecast');
assert.match(units,/forecast=Number\(climateModel\(\)\?\.C\)/,'T_f must remain the climate-model equilibrium forecast');
assert.match(units,/Ожидаемая T_f режима/,'forecast must be labelled as expected rather than current');
assert.match(units,/Текущая Tₐ поверхности/,'panel must identify the actual current temperature');
assert.match(units,/\[\[-100,0\],\[-50,\.28\],\[0,\.53\],\[50,\.77\],\[1200,1\]\]/,'telemetry colour position must follow the thermal legend Celsius anchors');
assert.match(units,/\[20,3,38\].*\[20,31,158\].*\[0,194,230\].*\[250,230,31\].*\[245,46,8\].*\[255,247,229\]/,'T_a colours must reuse the thermal-imager palette');
assert.match(units,/current\.style\.textShadow=temperatureTelemetryGlow/,'T_a must be visually prominent at a glance');
assert.match(units,/predicted\.title='T_f — ожидаемая температура/,'T_f must explicitly state that it is not current temperature');

assert.match(thermalShader,/thermalDecodeSurfaceK/,'thermal view must decode the packed temperature channel');
assert.match(thermalShader,/code < 0\.05/,'cold-tail packed-temperature decoding missing');
assert.match(thermalShader,/code < 0\.90/,'normal/hot packed-temperature decoding missing');
assert.match(thermalShader,/0\.78\*clamp\(\(C\+100\.0\)\/160\.0/,'most palette range must resolve -100..+60 C climate temperatures');
assert.match(thermalShader,/float stepC=\(C<=80\.0\)\?10\.0:100\.0/,'climate contours must use ten-degree spacing');
assert.match(thermalShader,/thermalSubgridMountainCoolingK/,'thermal view must include bounded sub-grid mountain lapse correction');
assert.match(thermalShader,/mountOut\)\*8\.0\*0\.45/,'sub-grid mountain correction must come from exact rendered mountain uplift');
assert.match(thermalShader,/unresolvedKm\*6\.0/,'sub-grid mountain correction must use the same six-K-per-km lapse scale as CPU physics');
assert.match(thermalShader,/0\.0,2\.4\)/,'sub-grid relief correction must remain bounded to about 2.4 km');
assert.match(thermalShader,/thermalVolcanicMaskFromTerrain/,'volcanic thermal signature missing');
assert.match(thermalShader,/terrain\(n0,ridge,mount,lee\)/,'thermal terrain diagnostics must follow rendered mountain/volcano geography');
assert.match(thermalShader,/float seamNearCenter=gSeamNear/,'terrain must be evaluated once before volcano mask consumes seam geometry');
assert.match(thermalShader,/uVolcano/,'thermal volcanic heat must follow volcanic activity');
assert.match(thermalShader,/uLava/,'thermal lava skin temperature must follow lava activity');
assert.match(thermalShader,/873\.15,1473\.15/,'lava thermal envelope must span 600..1200 C');

for(const token of ['sN*7.2+uSeedS*3.8','sN*3.3+uSeedS*4.1','sN*44.0+uSeedS*2.9']){
  assert.ok(surfaceShader.includes(token),'visible volcano geography token missing: '+token);
  assert.ok(thermalShader.includes(token),'thermal volcano geography must match visible surface: '+token);
}
assert.match(mainShader,/thermalInstrumentSurfaceK\(n0, encodedTemp\)/,'main shader must use decoded surface plus topographic/volcanic skin heat');
assert.match(mainShader,/thermalSurfaceColorK\(thermalK\)/,'main shader must use absolute-temperature thermal palette');

assert.ok(buildSh.indexOf('js/mobile-portrait-layout.js')<buildSh.indexOf('js/celsius-ui.js'),'Celsius adapter must load last in shell build');
assert.ok(buildPs.indexOf("'js/mobile-portrait-layout.js'")<buildPs.indexOf("'js/celsius-ui.js'"),'Celsius adapter must load last in PowerShell build');

console.log('thermal-celsius.test.js: OK');