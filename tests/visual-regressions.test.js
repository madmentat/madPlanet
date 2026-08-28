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

assert.equal(version, '0.5.28', 'visual regression test belongs to release 0.5.28');
assert.match(shell, /<div class="ver">v0\.5\.28<\/div>/, 'visible app version must match');
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
assert.match(terrainSrc, /for\(int j=i\+1;j<uPlateN;j\+\+\)/, 'belt must sum over plate pairs, not a selected pair');
assert.ok(!/else if\(d < d2\)/.test(terrainSrc), 'second-neighbour selection must not return');
assert.match(surface, /temp -= 2\.0\*mount;/, 'snow line must follow orogenic height, not total elevation');
assert.match(surface, /float arid = /, 'desertification missing');
assert.match(surface, /0\.22\*coastal\*coastal/, 'coastal greening must compete with aridity');
assert.match(state, /k:'tect'.*Тектоника/s, 'mountain slider must be renamed to tectonics');

/* 0.5.22: испарение облака над засушливой зоной необратимо — по следу
   берётся худшее из встреченного, а не среднее, иначе за краем зоны
   возвращалась прежняя картина. */
assert.ok(/suit=min\(suit,/.test(lowClimate), 'cloud moisture memory must keep the worst of the trail');
assert.ok(!/acc\/max\(wsum/.test(lowClimate), 'the reversible trail average must not return');
/* Кромка покрова не должна совпадать с берегом. */
assert.match(clouds, /mix\(0\.44\+0\.50\*humidLand,0\.90,ocean\)/, 'ocean/land suitability gap must stay narrow');
/* Охра — цвет песка, а не предгорья: склон окрашен породой. */
assert.match(surface, /float warmRock = /, 'slope colour must be rock-based, not ochre-by-altitude');
assert.ok(!/vec3 SLOPE = vec3\(0\.420,0\.340,0\.180\)/.test(surface), 'the sandy foothill colour must not return');
/* Настройки колец. */
assert.match(state, /k:'ringInner'/, 'ring radius control missing');
assert.match(state, /k:'ringWidth'/, 'ring width control missing');
assert.match(state, /k:'ringDens'/, 'ring density control missing');

/* 0.5.23: хэш обязан нести версию и число параметров. Формат позиционный,
   и без счётчика добавление ползунка сдвигало флаги — у старой ссылки молча
   пропадали звёзды, потому что «средний ярус» читался как «пустой космос». */
const ui = read('js/ui.js');
assert.match(ui, /parts\[0\] === 'v3'/, 'v3 links must still be readable');
assert.match(ui, /const V2_KEYS = /, 'old v2 links must be migrated by name, not by position');
/* Закрыть панель должно быть чем угодно, а не только крестиком 18x18. */
assert.match(shell, /\.param-panel \.p-close\{[^}]*width:36px;height:36px/s, 'close button needs a finger-sized target');
assert.match(ui, /e\.key === 'Escape'/, 'Escape must close the open panel');
/* Кольца: количество и материал. */
assert.match(state, /k:'ringCount'/, 'ring count control missing');
assert.match(state, /k:'ringMat'/, 'ring material control missing');
assert.match(state, /function ringMatLabel/, 'ring material label missing');
/* Шапка не круглая, снег на хребтах не сплошной. */
assert.match(surface, /float capEdge = /, 'polar cap edge must be perturbed at continental scale');
assert.match(surface, /float steepBare = /, 'ridges must lose snow on steep faces');

/* 0.5.24: схема плит, разноразмерные плиты, вулканизм, чаще молнии. */
assert.match(terrainSrc, /uPlateP\[i\]\.w/, 'plates need a size weight: equal cells meet at regular 120 degree stars');
assert.match(terrainSrc, /wgt > 0\.30 && seam < gSeamNear/, 'the schematic must show real neighbours only, not every bisector');
assert.match(surface, /if\(uPlatesOn > 0\.5\)/, 'plate schematic overlay missing');
assert.match(surface, /float volc = /, 'volcanism missing');
assert.match(surface, /uLava > 0\.01/, 'lava glow missing');
assert.match(state, /k:'volcano'/, 'volcanism slider missing');
assert.match(state, /k:'lava'/, 'lava glow slider missing');
assert.match(shell, /id="platesOn"/, 'plate schematic toggle missing');
assert.ok(!/if\(storm < 0\.16\)/.test(lightning), 'the old strict lightning threshold must not return');

/* 0.5.25: иерархия размеров плит и несимметричное схождение. */
assert.match(state, /const bigPlates = /, 'plate size hierarchy missing: equal cells look artificial');
assert.match(terrainSrc, /float over = \(uPlateP\[i\]\.w >= uPlateP\[j\]\.w\)/, 'subduction polarity must come from plate weight');
assert.match(terrainSrc, /float trench = /, 'convergent margin needs a trench on the subducting side');
assert.ok(!/for\(int i=0;i<12;i\+\+\)/.test(terrainSrc), 'plate loops must be bounded by the uniform, not by the array size');

/* 0.5.26: текстуры биомов удалены — атлас грузился всегда ради выключенной
   по умолчанию опции, а biomeTex() инлайнился восемь раз. */
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/biomeTex|triTex|uTexMean|sampler2DArray/.test(stripComments(surface + terrainSrc)),
  'biome texture sampling must be gone');
assert.ok(!/uTexOn|uTexMean/.test(shell), 'texture uniforms must not remain in the build shell');
assert.ok(!fs.existsSync(path.join(root, 'shaders/textures.glsl')), 'textures.glsl must be removed');
assert.ok(!fs.existsSync(path.join(root, 'textures')), 'the biome atlas must be removed');
/* Хэш по именам: позиционный ломался дважды. */
assert.match(ui, /const out = \['v4', 's' \+ state\.seed\]/, 'hash must be written by names');
assert.match(ui, /const FLAG_KEYS = /, 'flags must be named, not positional');
/* У «пустого космоса» должен быть видимый выключатель. */
assert.match(shell, /id="starsOn"/, 'starfield toggle missing: a blanked sky had no way back');

/* 0.5.27: черновик по умолчанию, тумблер и подпись неразрывны,
   полоса компиляции с таймером и оценкой по прошлому запуску. */
assert.match(state, /draft: true/, 'draft rendering must be the default');
assert.match(shell, /id="detailOn"/, 'the draft toggle must read as an inverted Detail switch');
assert.match(shell, /\.tgw\{[^}]*white-space:nowrap/s, 'a toggle and its label must not wrap apart');
const glInitSrc = read('js/gl-init.js');
assert.match(glInitSrc, /function showCompileProgress/, 'compile progress bar missing');
assert.match(glInitSrc, /COMPILE_ESTIMATE_KEY/, 'progress must be estimated from the previous compile');
assert.match(glInitSrc, /Math\.min\(95,/, 'progress must stop short of 100% instead of lying');

/* 0.5.28: пороги должны лежать внутри реального размаха шума.
   0.5+0.5*fbm(...,3) не выходит за 0.308..0.694, поэтому прежние 0.84..0.97
   означали, что горячие точки не появлялись ни разу. */
assert.ok(!/ss\(0\.84, 0\.97,/.test(surface), 'volcano hotspot threshold must stay inside the noise range');
assert.ok(!/ss\(0\.60, 0\.88,/.test(surface), 'volcano vent threshold must stay inside the noise range');
assert.ok(!/ss\(0\.58,0\.84,inst\)/.test(clouds), 'storm threshold must stay inside the noise range');
assert.match(clouds, /float stormy=mix\(0\.55,1\.45,uAtmo\)/, 'storms must scale with atmosphere and cloud cover');
/* Ползунки должны браться пальцем. */
assert.ok(!/user-select:none;touch-action:none\}/.test(shell), 'touch-action:none on body blocks native slider dragging');
assert.match(shell, /input\[type=range\]\{[^}]*height:34px/s, 'slider hit area must be finger sized');

console.log('visual-regressions.test.js: OK');
