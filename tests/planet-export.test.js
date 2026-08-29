const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const shot=read('js/screenshot.js');
const trigger=read('js/screenshot-trigger.js');
const exp=read('js/planet-export.js');
const shader=read('shaders/lightning.glsl');
const buildSh=read('build.sh');
const buildPs=read('build.ps1');
const version=read('VERSION.txt');

assert.match(version,/^VERSION\s+\d+\.\d+\.\d+\s*$/m,'planet export test must see semantic version');
function ordered(text,names,label){let p=-1;for(const n of names){const q=text.indexOf(n);assert.ok(q>p,label+': '+n);p=q;}}
const order=['js/screenshot.js','js/lightning-weather.js','js/planet-export.js','js/render.js','js/screenshot-trigger.js'];
ordered(buildSh,order,'shell export order');
ordered(buildPs,order,'PowerShell export order');

/* Save is deliberately a downloaded archive, not browser/cloud persistence. */
assert.match(exp,/\.madplanet\.json/,'local archive extension missing');
assert.match(exp,/prompt\('Название планеты:'/,'save must ask the user for a planet name');
assert.match(exp,/format:'madPlanet\.save'/,'save document format marker missing');
assert.match(exp,/shareUrl:planetUrlWithName\(\)/,'save document must include canonical share URL');
assert.ok(!/localStorage|IndexedDB|indexedDB/.test(exp),'0.5.53 must not introduce browser/database persistence');

/* Name is metadata carried by the named hash, not a physical PARAM. */
assert.match(exp,/name='\+encodeURIComponent\(state\.planetName\)/,'planet name must be encoded into shared URL');
assert.match(exp,/planetReadNameFromHash/,'shared URL must restore planet name');
assert.ok(!/PARAMS\.push\([^\n]*planetName/.test(exp),'planet name must not become a physical slider');

/* Planet card must source real model diagnostics rather than duplicate them. */
for(const token of ['planetPhysics()','starPhysics(state.star,state.luminosity)','distanceInfo(state.distance)','atmosphereSurfacePressureBar()','ringMatLabel(state.ringMat)'])
  assert.ok(exp.includes(token),'summary must reuse '+token);
assert.match(exp,/diameterKm:[^\n]*12742\.0/,'diameter must be derived from physical Earth-radius scaffold');
assert.match(exp,/planetDrawSummaryCard/,'styled screenshot card missing');
assert.match(exp,/АТМОСФЕРА/,'card atmosphere footer missing');
assert.match(exp,/КОЛЬЦА/,'card ring composition footer missing');

/* Share uses the platform share sheet when available and a mail/link fallback. */
assert.match(exp,/navigator\.share/,'Web Share path missing');
assert.match(exp,/new File\(\[blob\]/,'share should attach the rendered PNG when supported');
assert.match(exp,/mailto:\?subject=/,'mail fallback missing');
assert.match(exp,/navigator\.clipboard\.writeText/,'copy-link fallback missing');

/* Screenshot menu includes a true armed trigger and an optional planet card. */
assert.match(shot,/⚡ Молния — trigger/,'lightning trigger option missing');
assert.match(shot,/Паспорт планеты/,'planet-card screenshot toggle missing');
assert.match(shot,/lightningShotTrigger=\{armed:false/,'armed trigger state missing');
assert.ok(!/deadline|timeoutMs|setTimeout\([^\n]*shotArmLightning/.test(shot),'oscilloscope trigger must not auto-timeout');
assert.match(shot,/planetDrawSummaryCard\(ctx,W,H\)/,'high-res screenshot must composite planet card');

/* Mirror the shader flash phase exactly enough to capture the triggering bolt. */
assert.match(shader,/float ph=lt\*rate \+ B\.w\*37\.0 \+ fi\*5\.17/,'reference shader phase changed');
assert.match(shader,/float first=exp\(-fr\*42\.0\)/,'reference first-stroke window changed');
assert.match(shader,/0\.70\*exp\(-abs\(fr-0\.105\)\*58\.0\)/,'reference second-stroke window changed');
assert.match(trigger,/lt\*rate\+phase\*37\.0\+i\*5\.17/,'trigger phase must mirror shader');
assert.match(trigger,/Math\.exp\(-fr\*42\.0\)/,'trigger first-stroke window must mirror shader');
assert.match(trigger,/0\.70\*Math\.exp\(-Math\.abs\(fr-0\.105\)\*58\.0\)/,'trigger second-stroke window must mirror shader');
assert.match(trigger,/prev<lightningShotTrigger\.threshold/,'trigger must fire on a rising threshold crossing');
assert.match(trigger,/takeShot\(\{now,includeCard,showPreview:true\}\)/,'capture must reuse the exact triggering frame timestamp');
assert.match(trigger,/world\.cycB/,'trigger must consume the physical Weather Core lightning payload');
assert.ok(!/Math\.random/.test(trigger),'trigger must not invent random lightning events');

console.log('planet-export.test.js: OK');
