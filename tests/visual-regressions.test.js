const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const render = read('js/render.js');
const aurora = read('shaders/aurora-pass.glsl');
const clouds = read('shaders/clouds.glsl');
const main = read('shaders/main.glsl');
const shell = read('index.src.html');
const state = read('js/state.js');
const versionText = read('VERSION.txt');
const version = (versionText.match(/^VERSION\s+(\d+\.\d+\.\d+)\s*$/m) || [])[1];

assert.equal(version, '0.5.20', 'visual regression test belongs to release 0.5.20');
assert.match(shell, /<div class="ver">v0\.5\.20<\/div>/, 'visible app version must match');
assert.match(shell, /\.mark h1\{[^}]*font-size:19px/s, 'desktop wordmark should remain larger');
assert.match(shell, /\.mark h1\{font-size:16px/s, 'mobile wordmark should remain compact');

assert.match(render, /deviceMemory <= 4 \? 0\.96 : 1\.20/, 'mobile initial scale should stay near CSS-native or better');
assert.match(render, /deviceMemory <= 4 \? 0\.78 : 0\.88/, 'mobile minimum scale guard missing');
assert.match(render, /mobileDevice \? 31\.0 : 16\.5/, 'mobile target should favor quality near 30 fps');

assert.ok(!/auroraGlow\s*\(/.test(main), 'aurora must not be compiled into monolithic main shader');
assert.match(render, /drawAuroraWebGL/, 'separate aurora draw pass missing');
assert.match(aurora, /const int N=6;/, 'aurora should integrate through a thin atmospheric volume');
assert.match(aurora, /float sector=smoothstep/, 'broken auroral sectors missing');
assert.match(aurora, /float folds=/, 'irregular auroral curtain folds missing');
assert.ok(!/sin\s*\(\s*lon\s*\*/.test(aurora), 'periodic longitude grille/iris must not return');
assert.ok(!/float phase=lon\*/.test(aurora), 'old radial iris phase must not return');

assert.match(clouds, /float cumulusShape\(/, 'cumulus macro shape missing');
assert.match(clouds, /float lowCloudClimate\(/, 'lower cloud climate zoning missing');
assert.match(main, /gClimMid = clamp\(0\.48 \+ 0\.52\*gClimLow/, 'middle cloud climate zoning missing');
assert.match(clouds, /float desert=land\*hot\*dry/, 'hot dry land suppression missing');
assert.ok(!/float worleyD2\(/.test(clouds), 'Worley bubble morphology must not return to the lower cloud model');
const lowDeck = (clouds.match(/vec3 lowDeck\([\s\S]*?\n\}/) || [''])[0];
assert.ok(lowDeck.includes('cumulusCoord'), 'lower deck must use the isotropic cumulus coordinate');
assert.ok(!/curlNoise\s*\(/.test(lowDeck), 'lower cumulus shape must not invoke curl warp that creates tendrils/spokes');
assert.ok(!/ridged\s*\(/.test(lowDeck), 'lower cumulus shape must not invoke ridged spikes');
const surface = read('shaders/surface.glsl');
const lightning = read('shaders/lightning.glsl');
const compat = read('shaders/compat.glsl');
assert.match(surface, /float cs = \(uLowOn > 0\.5\) \? lowCover/, 'lower cloud shadow must obey lowOn toggle');
assert.match(surface, /float cm = \(uMidOn > 0\.5\) \? midCover/, 'middle cloud shadow must obey midOn toggle');
assert.match(lightning, /uLowOn < 0\.5/, 'lightning must stop when lower clouds are disabled');
assert.match(compat, /uLowOn>0\.5 && uCloudLow>0\.015/, 'compat renderer clouds must obey lower-layer toggle');
assert.match(state, /cloudLow'.*Нижний слой/s, 'independent lower cloud slider missing');
assert.match(state, /cloudMid'.*Средний слой/s, 'independent middle cloud slider missing');
assert.match(state, /cloudHigh'.*Верхний слой/s, 'independent upper cloud slider missing');
assert.match(state, /lowOn: true, midOn: false, highOn: false/, 'only lower cloud layer should be enabled by default');

/* 0.5.8: облака над засушливыми зонами рассеиваются постепенно.
   Пригодность усредняется вдоль наветренного следа, поэтому облако не
   срезается по береговой линии и не появляется мгновенно в прежнем виде за
   дальним краем зоны; жёсткая маска ss(0.10,0.43,climate) убрана. */
const lowClimate = (clouds.match(/float lowCloudClimate\([\s\S]*?\n\}/) || [''])[0];
assert.ok(/cross\(uAxis,dir\)/.test(lowClimate), 'cloud climate must be sampled along the ground-relative drift direction');
assert.ok(/for\(int i=0;i<taps;i\+\+\)/.test(lowClimate), 'cloud climate must average several upwind taps');
assert.ok(/noise3\(uRotC\*dir/.test(lowClimate), 'upwind tap phase must be jittered so the taps do not read as a comb');
assert.ok(!/ss\(0\.10,0\.43,clim/.test(clouds), 'the hard arid-zone cut-off must not return');
assert.match(clouds, /region\*mix\(0\.24,1\.0,ss\(0\.05,0\.62,clim\)\)/, 'arid zones must thin clouds gradually and keep a residue');

/* 0.5.8: рассеяние вперёд гасится освещённостью — иначе вся ночная
   облачность вспыхивала «подсветкой», когда камера смотрит в сторону звезды. */
assert.match(clouds, /vec3\(1\.0,0\.94,0\.86\)\*fwd\*lit\*/, 'forward scattering must be gated by cloud illumination');

/* 0.5.20: горы рождаются на швах тектонических плит, а не ridged-шумом,
   размазанным поясами по всей суше. */
const terrainSrc = read('shaders/terrain.glsl');
assert.match(terrainSrc, /vec3 tectonicBelt\(/, 'tectonic plate model missing');
assert.ok(!/float belts = /.test(terrainSrc), 'the old smooth mountain-belt noise must not return');
assert.match(terrainSrc, /uPlateW\[i\]\.xyz - uPlateW\[j\]\.xyz/, 'range/rift sign must come from relative plate motion');
assert.match(terrainSrc, /sN = normalize\(sN \+ wv\*/, 'plate seams must be warped: straight Voronoi arcs read as artificial');
/* Поле должно быть непрерывным: выбор «ближайший + второй сосед» рвал его у
   тройных стыков, и по рельефу шли прямые борозды. Сумма по всем парам от
   выбора не зависит. */
assert.match(terrainSrc, /for\(int j=0;j<12;j\+\+\)/, 'belt must sum over plate pairs, not a selected pair');
assert.ok(!/else if\(d < d2\)/.test(terrainSrc), 'second-neighbour selection must not return');
assert.match(surface, /temp -= 2\.0\*mount;/, 'snow line must follow orogenic height, not total elevation');
assert.match(surface, /float arid = /, 'desertification missing');
assert.match(surface, /0\.22\*coastal\*coastal/, 'coastal greening must compete with aridity');
assert.match(state, /k:'tect'.*Тектоника/s, 'mountain slider must be renamed to tectonics');

console.log('visual-regressions.test.js: OK');
