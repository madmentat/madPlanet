/* ============ рубрикатор и панели ============ */
const rubricEl = document.getElementById('rubric');
const sliders = {};
const panels = {};
const groupOrder = [...new Set(PARAMS.map(p => p.group))];

/* Иконки для каждой группы (SVG) */
const GROUP_ICONS = {
  'Планета':      '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M9 2.5a6.5 6.5 0 010 13" fill="currentColor" opacity=".15"/></svg>',
  'Поверхность':  '<svg viewBox="0 0 18 18" fill="none"><path d="M2 12c2-3 4-1 6-4s3-4 8-5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M2 15h14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".4"/></svg>',
  'Климат':       '<svg viewBox="0 0 18 18" fill="none"><path d="M3 9c0-3 3-6 6-6s6 3 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M5 11c1-2 2.5-1 4-3s2.5-2 5-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".6"/></svg>',
  'Атмосфера':    '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="4" stroke="currentColor" stroke-width="1.2"/><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.2" opacity=".3"/></svg>',
  'Магнитосфера': '<svg viewBox="0 0 18 18" fill="none"><path d="M9 2v14M5 5c2 2 2 6 0 8M13 5c-2 2-2 6 0 8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  'Кольца':       '<svg viewBox="0 0 18 18" fill="none"><ellipse cx="9" cy="9" rx="7.5" ry="2.6" stroke="currentColor" stroke-width="1.2"/><ellipse cx="9" cy="9" rx="4.6" ry="1.5" stroke="currentColor" stroke-width="1" opacity=".55"/></svg>',
  'Звезда':       '<svg viewBox="0 0 18 18" fill="none"><path d="M9 2l1.5 4.5L15 8l-4.5 1.5L9 14l-1.5-4.5L3 8l4.5-1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
};

const GROUP_SHORT = {
  'Планета':'ПЛ', 'Поверхность':'ПВ', 'Климат':'КЛ',
  'Атмосфера':'АТ', 'Магнитосфера':'МГ', 'Звезда':'ЗВ', 'Кольца':'КЦ'
};

const isMobile = () => matchMedia('(max-width:700px)').matches;

/* ── Создание рубрикатора ── */
groupOrder.forEach(g => {
  const btn = document.createElement('button');
  btn.className = 'rubric-btn';
  btn.dataset.group = g;
  btn.title = g;
  btn.innerHTML = (GROUP_ICONS[g] || '') + '<span>' + (GROUP_SHORT[g] || g.substring(0,2)) + '</span>';
  btn.addEventListener('click', () => togglePanel(g));
  rubricEl.appendChild(btn);
});

/* ── Создание панели параметров ── */
function createPanel(group){
  const el = document.createElement('div');
  el.className = 'param-panel';
  el.dataset.group = group;

  const head = document.createElement('div');
  head.className = 'p-head';
  const title = document.createElement('span');
  title.textContent = group;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'p-close';
  closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(group); });
  head.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'p-body';

  el.append(head, body);
  document.body.appendChild(el);

  /* Создание слайдеров для этой группы */
  const groupParams = PARAMS.filter(p => p.group === group);
  groupParams.forEach(p => {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = p.label;
    lab.htmlFor = 'sl_' + p.k;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.001;
    inp.value = state[p.k]; inp.id = 'sl_' + p.k;
    inp.style.setProperty('--fill', (state[p.k]*100)+'%');
    const valSpan = document.createElement('span');
    valSpan.className = 'slval';
    const updateLabel = () => {
      let text = (state[p.k]*100).toFixed(0)+'%';
      if(p.k==='star') text = starLabel(state.star);
      if(p.k==='magTilt') text = ((state.magTilt-0.5)*80).toFixed(0)+'°';
      if(p.k==='magAzimuth') text = (state.magAzimuth*360).toFixed(0)+'°';
      if(p.k==='aurora') text = auroraKpLabel(state.aurora);
      if(p.k==='atmoComp') text = atmoLabel(state.atmoComp);
      if(p.k==='ringMat') text = ringMatLabel(state.ringMat);
      if(p.k==='luminosity') text = luminosityLabel(state.luminosity);
      if(p.k==='distance'){ const q=distanceInfo(state.distance); text=q.label; }
      valSpan.textContent = text;
    };
    updateLabel();
    inp.addEventListener('input', () => {
      state[p.k] = +inp.value;
      markRenderUniformsDirty();
      inp.style.setProperty('--fill', (state[p.k]*100)+'%');
      syncDynamicLabels();
      saveHash();
    });
    row.append(lab, inp, valSpan);
    body.appendChild(row);
    sliders[p.k] = inp;
  });

  /* Тоглы облаков в панели «Климат» */
  if(group === 'Климат'){
    const cloudToggles = [
      {id:'lowOn',  label:'Низкие облака',  key:'lowOn',  title:'Кумулус / стратус'},
      {id:'midOn',  label:'Средние облака',  key:'midOn',  title:'Альто-'},
      {id:'highOn', label:'Высокие облака',  key:'highOn', title:'Цирусы'},
      {id:'voidbg', label:'Чёрный фон',     key:'voidbg', title:'Космос чёрным для скриншотов'},
    ];
    cloudToggles.forEach(t => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px';
      const lbl = document.createElement('span');
      lbl.textContent = t.label;
      lbl.title = t.title;
      lbl.style.cssText = 'font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:var(--mut)';
      const wrap = document.createElement('label');
      wrap.className = 'tg';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.id = t.id;
      inp.checked = !!state[t.key];
      const slider = document.createElement('i');
      wrap.append(inp, slider);
      row.append(lbl, wrap);
      body.appendChild(row);
      inp.addEventListener('change', e => { state[t.key] = e.target.checked; markRenderUniformsDirty(); saveHash(); });
    });
  }

  /* Управление визуализацией магнитосферы. Сияние и линии независимы. */
  if(group === 'Магнитосфера'){
    const magToggles = [
      {id:'auroraOn', label:'Полярное сияние', key:'auroraOn', title:'Включить/выключить авроральные овалы'},
      {id:'fieldLinesOn', label:'Силовые линии', key:'fieldLinesOn', title:'Показать дипольные L-оболочки'},
      {id:'auroraFootpoints', label:'Точки входа', key:'auroraFootpoints', title:'Показать авроральные точки входа частиц в атмосферу'},
    ];
    magToggles.forEach(t => {
      const row=document.createElement('div');
      row.className='row';
      row.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px';
      const lbl=document.createElement('span');
      lbl.textContent=t.label; lbl.title=t.title;
      lbl.style.cssText='font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:var(--mut)';
      const wrap=document.createElement('label'); wrap.className='tg';
      const inp=document.createElement('input'); inp.type='checkbox'; inp.id=t.id; inp.checked=!!state[t.key];
      const slider=document.createElement('i'); wrap.append(inp,slider); row.append(lbl,wrap); body.appendChild(row);
      inp.addEventListener('change',e=>{ state[t.key]=e.target.checked; markRenderUniformsDirty(); saveHash(); });
    });
  }

  /* Перетаскивание панели */
  initDrag(el, head);

  panels[group] = el;
  return el;
}

/* ── Toggle панели ── */
let openPanelGroup = null;
function togglePanel(group){
  if(openPanelGroup === group){
    closePanel(group);
  } else {
    if(openPanelGroup) closePanel(openPanelGroup);
    openPanel(group);
  }
}
function openPanel(group){
  const el = panels[group] || createPanel(group);
  el.classList.add('open');
  openPanelGroup = group;
  /* Подсветка кнопки в рубрикаторе */
  rubricEl.querySelectorAll('.rubric-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.group === group);
  });
  /* Позиционирование */
  positionPanel(el);
}
/* Три способа закрыть панель вместо одного: крестик, Escape и щелчок мимо.
   Если по какой-то причине не срабатывает один, остаются другие. */
addEventListener('keydown', e => {
  if(e.key === 'Escape' && openPanelGroup) closePanel(openPanelGroup);
});
addEventListener('pointerdown', e => {
  if(!openPanelGroup) return;
  const el = panels[openPanelGroup];
  if(!el) return;
  if(el.contains(e.target)) return;
  if(rubricEl.contains(e.target)) return;      /* по кнопке рубрикатора работает toggle */
  closePanel(openPanelGroup);
}, true);

function closePanel(group){
  const el = panels[group];
  if(el) el.classList.remove('open');
  if(openPanelGroup === group) openPanelGroup = null;
  rubricEl.querySelectorAll('.rubric-btn').forEach(b => b.classList.remove('active'));
}

/* ── Позиционирование панели ── */
function positionPanel(el){
  if(isMobile()){
    /* На мобилке — по центру снизу */
    el.style.left = '8px';
    el.style.right = '8px';
    el.style.top = '';
    el.style.bottom = 'calc(56px + var(--safe-b))';
    el.style.width = 'auto';
  } else {
    /* На десктопе — слева от рубрикатора */
    const rubRect = rubricEl.getBoundingClientRect();
    const pw = 272;
    let left = rubRect.left - pw - 12;
    if(left < 10) left = 10;
    let top = Math.max(20, (window.innerHeight - 420) / 2);
    el.style.left = left + 'px';
    el.style.right = '';
    el.style.top = top + 'px';
    el.style.bottom = '';
    el.style.width = pw + 'px';
  }
}

/* ── Перетаскивание ── */
function initDrag(el, handle){
  let dragging = false, startX, startY, startLeft, startTop;
  const onDown = (e) => {
    if(isMobile()) return; /* На мобилке не перетаскиваем */
    const touch = e.touches ? e.touches[0] : e;
    dragging = true;
    startX = touch.clientX;
    startY = touch.clientY;
    const rect = el.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    el.style.transition = 'none';
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  };
  const onMove = (e) => {
    if(!dragging) return;
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    let newLeft = startLeft + dx;
    let newTop = startTop + dy;
    /* Ограничение viewport */
    newLeft = Math.max(4, Math.min(window.innerWidth - el.offsetWidth - 4, newLeft));
    newTop = Math.max(4, Math.min(window.innerHeight - el.offsetHeight - 4, newTop));
    el.style.left = newLeft + 'px';
    el.style.top = newTop + 'px';
    el.style.right = '';
    el.style.bottom = '';
    el.style.width = el.offsetWidth + 'px';
  };
  const onUp = () => {
    if(!dragging) return;
    dragging = false;
    handle.style.cursor = '';
    el.style.transition = '';
  };
  handle.addEventListener('mousedown', onDown);
  handle.addEventListener('touchstart', onDown, {passive: false});
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, {passive: false});
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);
}

/* ── Toggle рубрикатора ── */
let rubricVisible = true;
document.getElementById('rubToggle').addEventListener('click', () => {
  rubricVisible = !rubricVisible;
  rubricEl.classList.toggle('hidden', !rubricVisible);
  document.getElementById('utilBar').classList.toggle('hidden', !rubricVisible);
});

/* ── Синхронизация UI ── */
function syncDynamicLabels(){
  PARAMS.forEach(p => {
    const el = sliders[p.k]?.parentElement?.querySelector('.slval');
    if(!el) return;
    if(p.k==='star') el.textContent = starLabel(state.star);
    else if(p.k==='magTilt') el.textContent = ((state.magTilt-0.5)*80).toFixed(0)+'°';
    else if(p.k==='magAzimuth') el.textContent = (state.magAzimuth*360).toFixed(0)+'°';
    else if(p.k==='aurora') el.textContent = auroraKpLabel(state.aurora);
    else if(p.k==='atmoComp') el.textContent = atmoLabel(state.atmoComp);
    else if(p.k==='ringMat') el.textContent = ringMatLabel(state.ringMat);
    else if(p.k==='luminosity') el.textContent = luminosityLabel(state.luminosity);
    else if(p.k==='distance') el.textContent = distanceInfo(state.distance).label;
  });
}
function syncUI(){
  PARAMS.forEach(p => {
    if(!sliders[p.k]) return;
    sliders[p.k].value = state[p.k];
    sliders[p.k].style.setProperty('--fill', (state[p.k]*100)+'%');
  });
  syncDynamicLabels();
  document.getElementById('rings').checked = state.rings;
  document.getElementById('draft').checked = state.draft;
  document.getElementById('platesOn').checked = state.platesOn;
  document.getElementById('texOn').checked = state.texShow;
  /* Тоглы облаков — могут быть в панелях или ещё не созданы */
  ['lowOn','midOn','highOn','voidbg'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.checked = !!state[id === 'voidbg' ? 'voidbg' : id];
  });
  ['auroraOn','fieldLinesOn','auroraFootpoints'].forEach(id => {
    const el=document.getElementById(id); if(el) el.checked=!!state[id];
  });
  document.getElementById('seedLabel').textContent = '№ ' + state.seed;
  document.getElementById('seed').value = state.seed;
}

/* ── Тоглы ── */
document.getElementById('rings').addEventListener('change', e => { state.rings = e.target.checked; markRenderUniformsDirty(); saveHash(); });
document.getElementById('draft').addEventListener('change', e => { state.draft = e.target.checked; markRenderUniformsDirty(); saveHash(); });
document.getElementById('platesOn').addEventListener('change', e => { state.platesOn = e.target.checked; markRenderUniformsDirty(); saveHash(); });
document.getElementById('texOn').addEventListener('change', e => { state.texShow = e.target.checked; markRenderUniformsDirty(); saveHash(); });

/* ── Сид ── */
document.getElementById('seed').addEventListener('change', e => {
  const v = parseInt(e.target.value, 10);
  if(Number.isFinite(v)){ state.seed = Math.abs(v) % 100000000; deriveWorld(); markRenderUniformsDirty(); saveHash(); }
});
document.getElementById('reroll').addEventListener('click', () => {
  state.seed = Math.floor(Math.random()*1e8); deriveWorld(); markRenderUniformsDirty(); saveHash();
});

/* ── Случайный мир ── */
document.getElementById('rand').addEventListener('click', () => {
  const r = mulberry32(Math.floor(Math.random()*2**31));
  state.seed = Math.floor(r()*1e8);
  state.temp  = r() < 0.15 ? (r()<0.5 ? r()*0.22 : 0.78+r()*0.22) : 0.3+r()*0.45;
  state.cloudLow = 0.22 + r()*0.62;
  state.cloudMid = 0.16 + r()*0.58;
  state.cloudHigh = 0.08 + r()*0.46;
  state.wind = 0.25 + r()*0.75;
  state.convection = 0.25 + r()*0.75;
  state.sea   = 0.35 + r()*0.5;
  state.cont  = r();
  state.tect = 0.25 + r()*0.7;
  state.isle  = r();
  state.lake  = r();
  state.city  = r() < 0.2 ? r()*0.15 : 0.35+r()*0.6;
  state.atmo  = 0.4 + r()*0.55;
  state.star     = r() < 0.3 ? 0.43+r()*0.15 : r();
  state.atmoComp = r() < 0.7 ? r()*0.15 : r();
  state.magnet = 0.15 + r()*0.8;
  state.aurora = 0.20 + r()*0.8;
  state.luminosity = 0.25 + r()*0.65;
  state.distance = 0.30 + r()*0.50;
  state.rings = r() < 0.33;
  state.ringInner = 0.2 + r()*0.6;
  state.ringWidth = 0.25 + r()*0.7;
  state.ringDens = 0.3 + r()*0.65;
  state.ringCount = r();
  state.ringMat = r();
  state.volcano = r()*0.8;
  state.lava = 0.3 + r()*0.7;
  deriveWorld(); markRenderUniformsDirty(); syncUI(); saveHash();
});

/* ── URL hash ── */
let hashT = 0;
function saveHash(){
  clearTimeout(hashT);
  hashT = setTimeout(() => {
    /* В хэш пишется число параметров. Формат позиционный, и без счётчика
       добавление любого ползунка сдвигало все флаги: старая ссылка читалась
       как новая, «средний ярус» попадал на место «пустого космоса», и у мира
       молча пропадали звёзды. Со счётчиком читатель знает, где кончаются
       параметры, и старые ссылки продолжают работать. */
    const v = ['v3', PARAMS.length, state.seed, ...PARAMS.map(p => (+state[p.k]).toFixed(3)),
               state.rings?1:0, state.draft?1:0, state.voidbg?1:0,
               state.texShow?1:0, state.lowOn?1:0, state.midOn?1:0, state.highOn?1:0,
               state.auroraOn?1:0, state.fieldLinesOn?1:0, state.auroraFootpoints?1:0,
               state.platesOn?1:0].join(',');
    try{ history.replaceState(null, '', '#'+v); }catch(e){}
  }, 200);
}
function loadHash(){
  const h = location.hash.slice(1);
  if(!h) return;
  const parts = h.split(',');

  /* Порядок ползунков в v2. Нужен, чтобы старые ссылки читались по именам,
     а не по позициям: с тех пор список пополнился кольцами, а «Горы» стали
     «Тектоникой». */
  const V2_KEYS = ['temp','sea','cont','tect','isle','lake','city',
                   'cloudLow','cloudMid','cloudHigh','wind','convection',
                   'atmo','atmoComp','magnet','magTilt','magAzimuth','aurora',
                   'star','luminosity','distance'];

  function readFlags(off){
    state.rings   = parts[off+1] === '1';
    state.draft   = parts[off+2] === '1';
    state.voidbg  = parts[off+3] === '1';
    state.texShow = parts[off+4] === '1';
    state.lowOn   = parts[off+5] !== '0';
    state.midOn   = parts[off+6] !== '0';
    state.highOn  = parts[off+7] !== '0';
    if(parts.length > off+8) state.auroraOn = parts[off+8] !== '0';
    if(parts.length > off+9) state.fieldLinesOn = parts[off+9] === '1';
    if(parts.length > off+10) state.auroraFootpoints = parts[off+10] === '1';
    if(parts.length > off+11) state.platesOn = parts[off+11] === '1';
  }

  if(parts[0] === 'v3'){
    const n = parseInt(parts[1],10);
    if(!Number.isFinite(n) || n < 1 || parts.length < n + 3) return;
    const seed = parseInt(parts[2],10);
    if(Number.isFinite(seed)) state.seed = seed;
    /* Читаем столько, сколько записано и сколько знаем: ссылка из более
       старой сборки просто не задаёт новые ползунки, они остаются по
       умолчанию, а флаги всё равно находятся по счётчику. */
    for(let i=0;i<Math.min(n, PARAMS.length);i++){
      const v=parseFloat(parts[i+3]);
      if(Number.isFinite(v)) state[PARAMS[i].k]=Math.max(0,Math.min(1,v));
    }
    readFlags(2+n);
    return;
  }

  if(parts[0] === 'v2'){
    if(parts.length < V2_KEYS.length + 3) return;
    const seed = parseInt(parts[1],10);
    if(Number.isFinite(seed)) state.seed = seed;
    for(let i=0;i<V2_KEYS.length;i++){
      const v=parseFloat(parts[i+2]);
      if(Number.isFinite(v) && (V2_KEYS[i] in state)) state[V2_KEYS[i]]=Math.max(0,Math.min(1,v));
    }
    const off=1+V2_KEYS.length;
    state.rings   = parts[off+1] === '1';
    state.draft   = parts[off+2] === '1';
    state.voidbg  = parts[off+3] === '1';
    state.texShow = parts[off+4] === '1';
    state.lowOn   = parts[off+5] !== '0';
    state.midOn   = parts[off+6] !== '0';
    state.highOn  = parts[off+7] !== '0';
    if(parts.length > off+8) state.auroraOn = parts[off+8] !== '0';
    if(parts.length > off+9) state.fieldLinesOn = parts[off+9] === '1';
    if(parts.length > off+10) state.auroraFootpoints = parts[off+10] === '1';
    return;
  }

  /* Legacy 0.5.6 and earlier hashes used one shared cloud amount. */
  const legacyKeys=['temp','sea','cont','tect','isle','lake','city','cloud','wind','convection',
                    'atmo','atmoComp','magnet','magTilt','magAzimuth','aurora','star','luminosity','distance'];
  if(parts.length < legacyKeys.length+2) return;
  const seed=parseInt(parts[0],10);
  if(Number.isFinite(seed)) state.seed=seed;
  let legacyCloud=0.5;
  for(let i=0;i<legacyKeys.length;i++){
    const v=parseFloat(parts[i+1]);
    if(!Number.isFinite(v)) continue;
    const x=Math.max(0,Math.min(1,v));
    if(legacyKeys[i]==='cloud') legacyCloud=x; else state[legacyKeys[i]]=x;
  }
  state.cloudLow=legacyCloud;
  state.cloudMid=legacyCloud;
  state.cloudHigh=legacyCloud;
  const off=legacyKeys.length;
  state.rings   = parts[off+1] === '1';
  state.draft   = parts[off+2] === '1';
  state.voidbg  = parts[off+3] === '1';
  state.texShow = parts[off+4] === '1';
  state.lowOn   = parts[off+5] !== '0';
  state.midOn   = parts[off+6] !== '0';
  state.highOn  = parts[off+7] !== '0';
  if(parts.length > off+8) state.auroraOn = parts[off+8] !== '0';
  if(parts.length > off+9) state.fieldLinesOn = parts[off+9] === '1';
  if(parts.length > off+10) state.auroraFootpoints = parts[off+10] === '1';
}
