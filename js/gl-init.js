/* ============ инициализация GL ============ */
const canvas = document.getElementById('gl');
let gl = null;
let webglVersion = 0;

function showFatal(message){
  const errorBox = document.getElementById('err');
  errorBox.textContent = message;
  errorBox.style.display = 'flex';
}

/* Попытка получить контекст */
function tryContext(version){
  const attrs = {
    antialias: false, alpha: false, depth: false,
    stencil: false, powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  };
  if(version === 2) return canvas.getContext('webgl2', attrs);
  return canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
}

/* Пробуем WebGL2, затем WebGL1 */
gl = tryContext(2);
if(gl){ webglVersion = 2; }
else {
  gl = tryContext(1);
  if(gl) webglVersion = 1;
}

if(!gl){
  showFatal('Для рендеринга планеты нужен WebGL.\nОбновите браузер или включите аппаратное ускорение.');
  throw new Error('no webgl');
}

/* Диагностика GPU */
const dbgInfo = {
  version: gl.getParameter(gl.VERSION),
  renderer: gl.getParameter(gl.RENDERER),
  vendor: gl.getParameter(gl.VENDOR),
  shadingLang: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
};
console.log('[madPlanet] WebGL' + webglVersion, dbgInfo);

/* ── Трансформация шейдеров для WebGL1 ── */
function transformForWebGL1(src, type){
  let s = src;
  s = s.replace(/#version\s+\d+\s+es\s*/g, '');
  if(type === 'vertex'){
    s = s.replace(/\bin\s+vec/g, 'attribute vec');
    s = s.replace(/\bout\s+/g, 'varying ');
  } else {
    s = s.replace(/\bin\s+/g, 'varying ');
    s = s.replace(/out\s+vec4\s+fragColor\s*;/g, '');
    s = s.replace(/\bfragColor\b/g, 'gl_FragColor');
  }
  /* sampler2DArray → sampler2D + ручной расчёт UV */
  s = s.replace(/mediump\s+sampler2DArray/g, 'sampler2D');
  s = s.replace(/highp\s+sampler2DArray/g, 'sampler2D');
  s = s.replace(/sampler2DArray/g, 'sampler2D');
  /* textureLod(uTex, vec3(uv, layer), lod) → texture2D(uTex, vec2(uv)) — упрощённо */
  s = s.replace(/textureLod\s*\(\s*(\w+)\s*,\s*vec3\s*\(\s*([^)]+)\)\s*,\s*([^)]+)\)/g,
    'texture2D($1, vec2($2))');
  s = s.replace(/textureLod\s*\(\s*(\w+)\s*,\s*([^,]+)\s*,\s*([^)]+)\)/g,
    'texture2D($1, vec2($2.xy))');
  return s;
}

function compile(type, src){
  const sh = gl.createShader(type);
  const toCompile = (webglVersion >= 2) ? src : transformForWebGL1(src, type);
  gl.shaderSource(sh, toCompile);
  gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    const stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    const log = gl.getShaderInfoLog(sh) || 'no compiler log';
    const shortLog = log.split('\n').slice(0, 10).join('\n');
    gl.deleteShader(sh);
    /* Do not show a fatal screen here. A failed full shader is recoverable:
       the next variant or balanced Chromium/ANGLE renderer may compile. */
    throw new Error(stage + ' shader compile: ' + shortLog);
  }
  return sh;
}

/* ── Сборка программы: компактный рендер сразу, полный — в фоне ──
   Драйверу ANGLE/D3D нужны от секунд до минут, чтобы превратить основной
   шейдер в байткод, и почти всё это время уходит на линковку. Прежний код
   вызывал getProgramParameter(LINK_STATUS) сразу после linkProgram(), а этот
   вызов блокирует главный поток до конца компиляции — вкладка стояла белой
   всё это время и выглядела зависшей.

   Теперь порядок другой:
     1. сразу линкуется компактный совместимый рендер — десятки миллисекунд,
        планета появляется практически мгновенно;
     2. основная программа линкуется в фоне, а готовность опрашивается через
        KHR_parallel_shader_compile, то есть без единого блокирующего вызова;
     3. как только она готова, рендер переключается на неё.
   Если расширения нет, опрос всё равно идёт по кадрам: первый же
   getProgramParameter заблокирует поток, но к этому моменту уже нарисован
   хотя бы один кадр и показана надпись о компиляции. */
const parallelExt = gl.getExtension('KHR_parallel_shader_compile');

const shaderVariants = [
  {name: 'original', fragMod: null},
  {name: 'highp_tex', fragMod: s => s.replace(/mediump sampler2DArray/g, 'highp sampler2DArray')},
  {name: 'no_tex', fragMod: s => s.replace(/uniform mediump sampler2DArray uTex;/g, '// sampler2DArray removed')
    .replace(/textureLod\s*\([^)]+\)/g, 'vec4(0.5)')
    .replace(/uTexOn/g, '0.0')
    .replace(/uTexMean\[\d+\]/g, 'vec3(0.5)')},
];

let prog = null;
let usedVariant = 'none';
const shaderFailureLog = [];

const UNIFORM_NAMES = ['uRes','uTime','uCamPos','uCamMat','uFocal','uCamDist','uPixA','uRotS','uRotC','uRotCInv',
 'uRotC2','uRotC3','uSunDir','uAxis','uMilky','uTemp','uCloudLow','uCloudMid','uCloudHigh','uSea','uCont','uTect','uIsle','uRingInner','uRingWidth','uRingDens','uRingCount','uRingMaterial',
 'uLake','uCity','uAtmo','uRingsOn','uRingMat','uSeedS','uSeedC','uTex','uTexOn','uDraft','uVoid',
 'uStarCol','uMagAxis','uAtmoComp','uLowOn','uMidOn','uHighOn','uWind','uConvection','uMagField','uAurora',
 'uStarRadius','uStarFlux','uStarDist','uPlateN'];

/* Один и тот же объект U переиспользуется при смене программы: render.js
   держит на него ссылку, поэтому поля переписываются на месте. */
const U = {};
function bindUniforms(p){
  for(const k in U) delete U[k];
  UNIFORM_NAMES.forEach(n => U[n] = gl.getUniformLocation(p, n));
  U.uTexMean = gl.getUniformLocation(p, 'uTexMean[0]');
  U.uCycA = gl.getUniformLocation(p, 'uCycA[0]');
  U.uCycB = gl.getUniformLocation(p, 'uCycB[0]');
  U.uPlateP = gl.getUniformLocation(p, 'uPlateP[0]');
  U.uPlateW = gl.getUniformLocation(p, 'uPlateW[0]');
}

function buildProgram(fragSrc){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  return p;
}
function linkFinished(p){
  return parallelExt ? (gl.getProgramParameter(p, parallelExt.COMPLETION_STATUS_KHR) === true) : true;
}
/* Состояние уровня JS (юниформы, средние цвета тайлов, автокачество)
   переприменяет render.js в начале кадра: первая смена программы
   происходит ещё до того, как его переменные инициализированы. */
let programSwapPending = false;
function adoptProgram(p, name){
  prog = p;
  usedVariant = name;
  gl.useProgram(prog);
  bindUniforms(prog);
  programSwapPending = true;
}

/* ---- шаг 1: компактный рендер, доступный сразу ---- */
try{
  const p = buildProgram(COMPAT_FRAG);
  if(gl.getProgramParameter(p, gl.LINK_STATUS)) adoptProgram(p, 'balanced-compat');
  else {
    shaderFailureLog.push('balanced-compat link: ' + (gl.getProgramInfoLog(p) || '').substring(0,1200));
    gl.deleteProgram(p);
  }
} catch(e){
  shaderFailureLog.push('balanced-compat compile: ' + String(e.message || e).substring(0,1200));
}

/* ---- шаг 2: полная программа в фоне ---- */
let variantIndex = 0;
let pendingProgram = null;
let pendingVariant = '';
let fullShaderDone = false;
const linkStartedAt = performance.now();

function startNextVariant(){
  while(variantIndex < shaderVariants.length){
    const v = shaderVariants[variantIndex++];
    try{
      pendingProgram = buildProgram(v.fragMod ? v.fragMod(FRAG) : FRAG);
      pendingVariant = v.name;
      return true;
    } catch(e){
      shaderFailureLog.push(v.name + ' compile: ' + String(e.message || e).substring(0,800));
      console.warn('[madPlanet] variant "' + v.name + '" error:', String(e.message || e).substring(0,120));
    }
  }
  pendingProgram = null;
  return false;
}

/* ---- индикатор состояния ---- */
let statusBadge = null;
function setBadge(text, tone){
  if(!statusBadge){
    statusBadge = document.createElement('div');
    statusBadge.id = 'shaderStatus';
    /* Ниже вордмарки: на первой загрузке плашка висит минутами, и в левом
       верхнем углу она закрывала собой название приложения. */
    Object.assign(statusBadge.style,{
      position:'fixed',left:'22px',top:'86px',zIndex:'10000',padding:'7px 10px',
      maxWidth:'calc(100vw - 44px)',
      font:'12px/1.35 system-ui,sans-serif',borderRadius:'7px',pointerEvents:'none'
    });
    document.body.appendChild(statusBadge);
  }
  const warm = tone === 'warn';
  statusBadge.style.color = warm ? '#ffdca8' : '#cfe3ff';
  statusBadge.style.background = warm ? 'rgba(32,20,8,.88)' : 'rgba(10,18,32,.85)';
  statusBadge.style.border = '1px solid ' + (warm ? 'rgba(255,190,100,.45)' : 'rgba(130,180,255,.35)');
  statusBadge.textContent = text;
}
function clearBadge(){
  if(statusBadge){ statusBadge.remove(); statusBadge = null; }
}

/* Вызывается из основного цикла раз в кадр. */
function pollShaderCompile(){
  if(fullShaderDone) return;
  if(!pendingProgram){
    fullShaderDone = true;
    clearBadge();
    if(prog){
      console.warn('[madPlanet] Полный шейдер отклонён GPU, работает совместимый рендер:', shaderFailureLog);
      setBadge('Совместимый рендер Chromium/ANGLE: облегчённый procedural mode', 'warn');
    } else {
      const details = shaderFailureLog.join('\n').substring(0,2600);
      showFatal('madPlanet v' + APP_VERSION + '\n\nWebGL есть, но GPU отклонил оба рендера.\n\n' +
        'GPU: ' + dbgInfo.renderer + '\nGLSL: ' + dbgInfo.shadingLang + '\n\n' + details);
      console.error('[madPlanet] All shader variants failed:', shaderFailureLog);
    }
    return;
  }
  const waited = (performance.now() - linkStartedAt)/1000;
  if(!linkFinished(pendingProgram)){
    setBadge('Компиляция шейдера планеты… ' + waited.toFixed(0) + ' с · пока показан упрощённый рендер');
    return;
  }
  if(gl.getProgramParameter(pendingProgram, gl.LINK_STATUS)){
    const old = prog;
    adoptProgram(pendingProgram, pendingVariant);
    if(old && old !== pendingProgram) gl.deleteProgram(old);
    pendingProgram = null;
    fullShaderDone = true;
    clearBadge();
    console.log('[madPlanet] Полный шейдер готов за ' + waited.toFixed(1) + ' с (variant: ' + usedVariant + ')');
    if(usedVariant !== 'original') setBadge('Совместимый вариант WebGL: ' + usedVariant, 'warn');
    return;
  }
  const log = gl.getProgramInfoLog(pendingProgram) || '';
  shaderFailureLog.push(pendingVariant + ' link: ' + log.substring(0, 800));
  console.warn('[madPlanet] variant "' + pendingVariant + '" link failed:', log.substring(0, 200));
  gl.deleteProgram(pendingProgram);
  pendingProgram = null;
  startNextVariant();
}

startNextVariant();
if(!prog && !pendingProgram){
  const details = shaderFailureLog.join('\n').substring(0,2600);
  showFatal('madPlanet v' + APP_VERSION + '\n\nWebGL есть, но GPU отклонил оба рендера.\n\n' +
    'GPU: ' + dbgInfo.renderer + '\nGLSL: ' + dbgInfo.shadingLang + '\n\n' + details);
  throw new Error('all shader variants failed');
}
setBadge('Компиляция шейдера планеты… пока показан упрощённый рендер');

const errorBoxAfterShader = document.getElementById('err');
if(errorBoxAfterShader) errorBoxAfterShader.style.display = 'none';

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

/* Aurora is a separate tiny additive pass. Keeping it out of the monolithic
   planet shader reduces ANGLE compile pressure and means aurora can be fully
   skipped when disabled. Failure of this optional pass never kills the app. */
let auroraProg = null;
const AU = {};
try{
  const ap = buildProgram(AURORA_FRAG);
  if(gl.getProgramParameter(ap, gl.LINK_STATUS)){
    auroraProg = ap;
    ['uRes','uTime','uCamPos','uCamMat','uFocal','uSunDir','uMagAxis','uMagField','uAurora','uAtmo','uStarFlux']
      .forEach(n => AU[n] = gl.getUniformLocation(ap,n));
  } else {
    console.warn('[madPlanet] Aurora pass link failed:', gl.getProgramInfoLog(ap) || '');
    gl.deleteProgram(ap);
  }
} catch(e){
  console.warn('[madPlanet] Aurora pass disabled:', String(e.message || e));
}
