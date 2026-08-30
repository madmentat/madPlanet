/* ============ 0.5.72: render-only atmospheric visibility diagnostics ============ */
/*
   Surface/climate debugging must not require guessing whether a white patch is
   snow, fog, cloud, lightning glow or aurora.  These switches control only
   renderer visibility.  They never reset, create or step Weather Core and do
   not change cloud amount, atmospheric inventory or any other physical state.

   ui.js still creates the legacy low/mid/high checkboxes for backwards
   compatibility.  This wrapper removes only those duplicate rows and replaces
   them with one obvious diagnostic block at the top of the Weather panel.
*/

const CLOUD_VISIBILITY_CONTROLS_MODEL=2;

/* New diagnostic flags are deliberately added here rather than to the old
   positional state bootstrap.  This module runs before loadHash(), so named
   v4/v6 links can persist them while old links simply keep these defaults. */
if(typeof state.fogOn!=='boolean')state.fogOn=true;
if(typeof state.lightningOn!=='boolean')state.lightningOn=true;
if(typeof state.atmoVisualOn!=='boolean')state.atmoVisualOn=true;
if(typeof FLAG_KEYS!=='undefined'){
  for(const k of ['fogOn','lightningOn','atmoVisualOn'])if(!FLAG_KEYS.includes(k))FLAG_KEYS.push(k);
}

const ATMOSPHERE_VISIBILITY_LAYERS=[
  {key:'lowOn',       id:'cloudVisLow',       label:'Нижние облака'},
  {key:'midOn',       id:'cloudVisMid',       label:'Средние облака'},
  {key:'highOn',      id:'cloudVisHigh',      label:'Верхние облака'},
  {key:'fogOn',       id:'atmoVisFog',        label:'Туман / приземная дымка'},
  {key:'lightningOn', id:'atmoVisLightning',  label:'Молнии'},
  {key:'atmoVisualOn',id:'atmoVisScattering', label:'Атмосферная дымка / ореол'},
  {key:'auroraOn',    id:'atmoVisAurora',     label:'Полярное сияние'},
];

function refreshAtmosphereVisibilityControls(root=document){
  if(!root||typeof root.querySelector!=='function')return;
  for(const def of ATMOSPHERE_VISIBILITY_LAYERS){
    const inp=root.querySelector('#'+def.id);if(!inp)continue;
    inp.checked=!!state[def.key];
    inp.setAttribute('aria-checked',inp.checked?'true':'false');
  }
}
function setAtmosphereVisibility(def,on,root){
  state[def.key]=!!on;
  if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();
  refreshAtmosphereVisibilityControls(root||document);
  if(typeof saveHash==='function')saveHash();
}
function installCloudVisibilityControls(el){
  if(!el||el.dataset.group!=='Погода'||el.querySelector('#cloudVisibilityBar'))return el;
  const body=el.querySelector('.p-body');if(!body)return el;

  /* Remove only the old cloud-layer rows.  The black-background switch remains
     where ui.js created it because it is a sky/screenshot control, not weather. */
  for(const id of ['lowOn','midOn','highOn']){
    const old=el.querySelector('#'+id);const row=old&&old.closest('.row');if(row)row.remove();
  }

  const box=document.createElement('div');box.id='cloudVisibilityBar';
  box.style.cssText='margin:0 0 11px;padding:8px 0 10px;border-bottom:1px solid rgba(159,194,255,.10)';
  const title=document.createElement('div');
  title.textContent='Видимость атмосферы · только рендер';
  title.style.cssText='font-size:9px;letter-spacing:.11em;text-transform:uppercase;color:var(--mut);margin-bottom:3px';
  const note=document.createElement('div');
  note.textContent='Физика продолжает работать';
  note.style.cssText='font-size:9px;color:var(--mut);opacity:.68;margin-bottom:8px';
  box.append(title,note);

  for(const def of ATMOSPHERE_VISIBILITY_LAYERS){
    const row=document.createElement('div');row.className='row';
    row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px';
    const lbl=document.createElement('label');lbl.htmlFor=def.id;lbl.textContent=def.label;
    lbl.style.cssText='font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);line-height:1.25';
    const wrap=document.createElement('label');wrap.className='tg';
    const inp=document.createElement('input');inp.type='checkbox';inp.id=def.id;inp.checked=!!state[def.key];
    const slider=document.createElement('i');wrap.append(inp,slider);row.append(lbl,wrap);box.appendChild(row);
    inp.addEventListener('change',e=>setAtmosphereVisibility(def,e.target.checked,el));
  }

  const actions=document.createElement('div');
  actions.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px';
  const makeAction=(text,on)=>{
    const b=document.createElement('button');b.type='button';b.className='act-btn';b.textContent=text;
    b.style.cssText='padding:6px 5px;min-width:0;font-size:9px';
    b.addEventListener('click',()=>{
      for(const def of ATMOSPHERE_VISIBILITY_LAYERS)state[def.key]=on;
      if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();
      refreshAtmosphereVisibilityControls(el);
      if(typeof saveHash==='function')saveHash();
    });
    return b;
  };
  actions.append(makeAction('Скрыть всё',false),makeAction('Показать всё',true));
  box.appendChild(actions);

  body.prepend(box);refreshAtmosphereVisibilityControls(el);return el;
}

if(typeof createPanel==='function'){
  const createPanelBeforeCloudVisibilityControls=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeCloudVisibilityControls(group);
    return group==='Погода'?installCloudVisibilityControls(el):el;
  };
}
if(typeof syncUI==='function'){
  const syncUIBeforeCloudVisibilityControls=syncUI;
  syncUI=function(){const out=syncUIBeforeCloudVisibilityControls();refreshAtmosphereVisibilityControls();return out;};
}
