const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const src=read('js/cloud-visibility-controls.js');
const fogRender=read('js/fog-render.js');
const header=read('shaders/header.glsl');
const fog=read('shaders/fog.glsl');
const main=read('shaders/main.glsl');
const sh=read('build.sh');
const ps=read('build.ps1');

for(const text of [sh,ps]){
  const ui=text.indexOf('js/ui-toggle-layout.js');
  const vis=text.indexOf('js/cloud-visibility-controls.js');
  const physics=text.indexOf('js/planet-physics.js');
  assert.ok(ui>=0&&vis>ui&&physics>vis,'atmosphere visibility controls must load after UI and before later wrappers');
}
for(const id of ['cloudVisLow','cloudVisMid','cloudVisHigh','atmoVisFog','atmoVisLightning','atmoVisScattering','atmoVisAurora'])
  assert.ok(src.includes(id),'missing '+id);
for(const key of ['lowOn','midOn','highOn','fogOn','lightningOn','atmoVisualOn','auroraOn'])
  assert.ok(src.includes("key:'"+key+"'"),'missing renderer visibility key '+key);
assert.match(src,/Видимость атмосферы · только рендер/,'UI must explicitly say these are render-only controls');
assert.match(src,/inp\.type='checkbox'/,'diagnostic controls must be real on/off toggles');
assert.match(src,/Физика продолжает работать/,'UI must make visual-only semantics explicit');
assert.match(src,/markRenderUniformsDirty/,'visibility change must invalidate renderer uniforms');
assert.match(src,/saveHash/,'visibility state must remain shareable/backward-compatible');
for(const key of ['fogOn','lightningOn','atmoVisualOn'])
  assert.match(src,new RegExp("FLAG_KEYS\\.push\\(k\\)"),'new visibility flags must join named hash persistence');
const executable=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'$1');
assert.ok(!/weatherCore(?:Create|Step|Ensure|Tick)\s*\(/.test(executable),'visual toggles must never create/reset/step Weather Core');
assert.ok(!/state\.cloud(?:Low|Mid|High)\s*=/.test(executable),'visibility toggles must not change cloud amount sliders');
assert.ok(!/state\.atmo\s*=/.test(executable),'atmospheric visibility must not change physical atmosphere inventory');

assert.match(header,/uniform float uFogOn, uLightningOn, uAtmoVisualOn/,'full shader needs independent diagnostic visibility uniforms');
assert.match(fog,/if\(uFogOn<0\.5\)/,'fog visibility must be independent of low-cloud visibility');
assert.doesNotMatch(fog,/if\(uLowOn<0\.5\)/,'low-cloud switch must no longer be the fog switch');
assert.match(main,/if\(uLightningOn > 0\.5/,'lightning must have its own visibility switch');
assert.match(main,/uAtmo \* visualAtmo/,'atmospheric scattering must be suppressible without changing uAtmo physics');
for(const n of ['uFogOn','uLightningOn','uAtmoVisualOn'])assert.ok(fogRender.includes(n),'fog-render must bind '+n);

console.log('cloud-visibility-controls.test.js: OK');
