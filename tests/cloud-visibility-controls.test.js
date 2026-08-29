const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const src=read('js/cloud-visibility-controls.js');
const sh=read('build.sh');
const ps=read('build.ps1');

for(const text of [sh,ps]){
  const ui=text.indexOf('js/ui-toggle-layout.js');
  const vis=text.indexOf('js/cloud-visibility-controls.js');
  const physics=text.indexOf('js/planet-physics.js');
  assert.ok(ui>=0&&vis>ui&&physics>vis,'cloud visibility controls must load after UI and before later wrappers');
}
for(const id of ['cloudVisLow','cloudVisMid','cloudVisHigh'])assert.ok(src.includes(id),'missing '+id);
for(const key of ['lowOn','midOn','highOn'])assert.ok(src.includes("key:'"+key+"'"),'missing renderer visibility key '+key);
assert.match(src,/Видимость облаков · только рендер/,'UI must explicitly say these are render-only controls');
assert.match(src,/state\[def\.key\]=!state\[def\.key\]/,'buttons must only flip renderer visibility state');
assert.match(src,/markRenderUniformsDirty/,'visibility change must invalidate renderer uniforms');
assert.match(src,/saveHash/,'visibility state must remain shareable/backward-compatible');
const executable=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'$1');
assert.ok(!/weatherCore(?:Create|Step|Ensure|Tick)\s*\(/.test(executable),'visual cloud buttons must never create/reset/step Weather Core');
assert.ok(!/state\.cloud(?:Low|Mid|High)\s*=/.test(executable),'visibility buttons must not change physical/amount sliders');
console.log('cloud-visibility-controls.test.js: OK');
