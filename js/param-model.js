/* ============ parameter model v1: cause vs calculated state ============ */
/* 0.5.33 does not replace climate physics yet. It only establishes the
   contract future releases use: base/geological parameters persist, derived
   weather may be pushed by hand but relaxes back, and purely visual controls
   never become physical causes. */
const PARAM_ROLE = Object.freeze({
  BASE: 'base', GEO: 'geo', DERIVED: 'derived', VISUAL: 'visual', DIAGNOSTIC: 'diagnostic'
});

const PARAM_ROLE_BY_KEY = Object.freeze({
  /* Physical inputs that remain user-controlled. Some are legacy proxies
     (sea/atmo/magnet) and will get stricter meanings in later patches.
     Planet age, size, interior type, rotation and axial tilt are explicit
     BASE inputs from 0.5.35 onward. Volcanism is also a BASE slow forcing for
     now; later its natural level can follow an interior thermal model without
     making age a magic direct multiplier. Magnetic field is not derived
     directly from volcanism. */
  sea:'base', cont:'base', isle:'base', lake:'base', atmo:'base',
  gasN2:'base', gasO2:'base', gasCH4:'base', gasHHe:'base',
  magnet:'base', magTilt:'base', magAzimuth:'base', aurora:'base',
  star:'base', luminosity:'base', distance:'base', volcano:'base',
  planetAge:'base', planetRadius:'base', coreType:'base',
  rotationPeriod:'base', axialTilt:'base',

  tect:'geo',

  temp:'derived', snowAlt:'derived', cloudLow:'derived', cloudMid:'derived',
  cloudHigh:'derived', wind:'derived', convection:'derived', storm:'derived',
  gasH2O:'derived', gasCO2:'derived', gasSO2:'derived',

  city:'visual', lava:'visual', ringInner:'visual', ringWidth:'visual',
  ringDens:'visual', ringCount:'visual', ringMat:'visual', ringGrain:'visual',
  stormRate:'visual', stormGlow:'visual', skyStars:'visual', skyMilky:'visual',
  skyNebula:'visual', skyHue:'visual'
});

/* These sliders do not yet have a physical target field. Preserve the value
   present after URL/default/random-world initialization as the current
   equilibrium, allow a manual displacement, then return to that equilibrium.
   Temperature and volcanic gases already have real target functions in
   state.js and therefore use relaxDerived() instead. */
const TRANSIENT_DERIVED_KEYS = Object.freeze([
  'snowAlt','cloudLow','cloudMid','cloudHigh','wind','convection','storm'
]);
const TRANSIENT_TAU = Object.freeze({
  snowAlt:14.0, cloudLow:8.0, cloudMid:9.0, cloudHigh:10.0,
  wind:6.0, convection:7.0, storm:8.0
});
const transientEquilibrium = Object.create(null);
const transientHeld = Object.create(null);
const transientManualUntil = Object.create(null);

function clamp01(x){ return Math.max(0, Math.min(1, Number(x) || 0)); }
function parameterRole(key){ return PARAM_ROLE_BY_KEY[key] || PARAM_ROLE.VISUAL; }
const unclassifiedParamKeys = PARAMS.filter(p => !Object.prototype.hasOwnProperty.call(PARAM_ROLE_BY_KEY, p.k)).map(p => p.k);
if(unclassifiedParamKeys.length) throw new Error('unclassified parameters: ' + unclassifiedParamKeys.join(', '));
function isTransientDerived(key){ return TRANSIENT_DERIVED_KEYS.includes(key); }
function captureTransientEquilibrium(){
  TRANSIENT_DERIVED_KEYS.forEach(k => { transientEquilibrium[k] = clamp01(state[k]); });
}
function releaseLegacyPins(){
  state.pinTemp = false; state.pinH2O = false; state.pinCO2 = false; state.pinSO2 = false;
}
function relaxTransientScalar(value, target, dtSec, tauSec){
  const dt = Math.max(0, Math.min(0.5, Number(dtSec) || 0));
  const tau = Math.max(0.05, Number(tauSec) || 1);
  const a = 1 - Math.exp(-dt/tau);
  return value + (target-value)*a;
}
function relaxTransientControls(dtSec){
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  let moved = false;
  TRANSIENT_DERIVED_KEYS.forEach(k => {
    if(transientHeld[k] || now < (transientManualUntil[k] || 0)) return;
    const target = Number.isFinite(transientEquilibrium[k]) ? transientEquilibrium[k] : clamp01(state[k]);
    const old = clamp01(state[k]);
    const next = relaxTransientScalar(old, target, dtSec, TRANSIENT_TAU[k]);
    if(Math.abs(next-old) > 1e-7){ state[k] = next; moved = true; }
  });
  return moved;
}

/* Populate metadata without rewriting state.js in the first architectural
   patch. The legacy base/derived flags remain as an adapter for ui.js. */
PARAMS.forEach(p => {
  p.role = parameterRole(p.k);
  p.base = p.role === PARAM_ROLE.BASE || p.role === PARAM_ROLE.GEO;
  if(p.role === PARAM_ROLE.DERIVED) p.derived = p.derived || 'system';
  p.transient = isTransientDerived(p.k) || p.k === 'temp';
});

/* Permanent pinning was useful while derived values were ordinary sliders,
   but it contradicts the new model: moving a calculated value is a temporary
   forcing. Volcanic gases are still persisted during the transition to the
   absolute-gas inventory planned for 0.5.36, but they are no longer pinned. */
if(typeof PIN_OF !== 'undefined'){
  delete PIN_OF.temp; delete PIN_OF.gasH2O; delete PIN_OF.gasCO2; delete PIN_OF.gasSO2;
}
releaseLegacyPins();

/* Give lazy-created rows explicit origin tags. createPanel() is called only
   when a rubric is opened, so wrapping it here still affects every panel. */
if(typeof createPanel === 'function'){
  const createPanelLegacy = createPanel;
  createPanel = function(group){
    const el = createPanelLegacy(group);
    PARAMS.filter(p => p.group === group).forEach(p => {
      const inp = el.querySelector('#sl_' + p.k);
      const head = inp && inp.parentElement && inp.parentElement.querySelector('.row-head');
      if(!head) return;
      let tag = head.querySelector('.role-tag');
      const legacyBase = [...head.querySelectorAll('.tag')].find(t => t.textContent === 'база');
      if(p.role === PARAM_ROLE.BASE || p.role === PARAM_ROLE.GEO){
        tag = legacyBase || tag;
        if(tag){
          tag.classList.add('role-tag');
          tag.textContent = p.role === PARAM_ROLE.GEO ? 'гео' : 'база';
          tag.title = p.role === PARAM_ROLE.GEO
            ? 'Медленное геологическое воздействие на климат'
            : 'Исходное условие мира: система сама его не возвращает';
        }
      }else if(p.role === PARAM_ROLE.DERIVED && !tag){
        tag = document.createElement('span');
        tag.className = 'tag role-tag';
        tag.textContent = 'расчёт';
        tag.title = 'Расчётное состояние: ручное отклонение временно';
        const value = head.querySelector('.slval');
        head.insertBefore(tag, value || null);
      }
    });
    return el;
  };
}

/* Old hashes remain readable. After loading one, its weather values become
   the equilibrium for this session, so old shared worlds do not visibly jump.
   New hashes omit transient derived sliders and therefore start from defaults
   until later releases calculate their physical targets. */
if(typeof loadHash === 'function'){
  const loadHashLegacy = loadHash;
  loadHash = function(){
    loadHashLegacy();
    releaseLegacyPins();
    captureTransientEquilibrium();
  };
}

/* Persist causes and visual choices, not a momentary shove of calculated
   weather. Keep v4: the format is already named and missing keys simply use
   defaults, while old v4/v3/v2 links remain readable by ui.js. */
if(typeof saveHash === 'function'){
  saveHash = function(){
    clearTimeout(hashT);
    hashT = setTimeout(() => {
      const out = ['v4', 's' + state.seed];
      PARAMS.forEach(p => {
        if(p.transient) return;
        out.push(p.k + '=' + (+state[p.k]).toFixed(p.gas ? 8 : 3));
      });
      FLAG_KEYS.forEach(k => {
        if(/^pin(?:Temp|H2O|CO2|SO2)$/.test(k)) return;
        out.push(k + '=' + (state[k] ? 1 : 0));
      });
      try{ history.replaceState(null, '', '#' + out.join(',')); }catch(e){}
    }, 200);
  };
}

/* UI input first writes state through the existing handler, then this late
   listener records that the calculated quantity is being forced by hand. */
function sliderParamKey(target){
  const id = target && target.id;
  return (typeof id === 'string' && id.startsWith('sl_')) ? id.slice(3) : '';
}
if(typeof document !== 'undefined'){
  document.addEventListener('pointerdown', e => {
    const k = sliderParamKey(e.target); if(isTransientDerived(k)) transientHeld[k] = true;
  }, true);
  document.addEventListener('input', e => {
    const k = sliderParamKey(e.target); if(!isTransientDerived(k)) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    transientManualUntil[k] = now + 450;
  });
  const release = () => { TRANSIENT_DERIVED_KEYS.forEach(k => { transientHeld[k] = false; }); };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);

  const rand = document.getElementById('rand');
  if(rand) rand.addEventListener('click', () => {
    releaseLegacyPins();
    captureTransientEquilibrium();
  });
}

/* Add transient relaxation to the existing volcanic/temperature relaxation
   without making render.js know about parameter classes. */
if(typeof relaxDerived === 'function'){
  const relaxDerivedLegacy = relaxDerived;
  relaxDerived = function(dtSec){
    const movedPhysical = !!relaxDerivedLegacy(dtSec);
    const movedTransient = relaxTransientControls(dtSec);
    return movedPhysical || movedTransient;
  };
}
