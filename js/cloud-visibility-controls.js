/* ============ 0.5.66: explicit visual-only cloud visibility controls ============ */
/*
   The Weather panel already had lowOn/midOn/highOn switches, but they lived
   below all sliders and looked like physics toggles. For surface inspection we
   need an obvious, compact set of buttons next to the weather controls.

   These flags are renderer visibility only. They never create/reset/step the
   Weather Core and therefore hiding a deck cannot destroy fronts, humidity,
   convection, cloud water or lightning diagnosis. When the layer is shown
   again, the current physical weather is still there.
*/

const CLOUD_VISIBILITY_CONTROLS_MODEL=1;
const CLOUD_VISIBILITY_LAYERS=[
  {key:'lowOn', id:'cloudVisLow', label:'Нижние'},
  {key:'midOn', id:'cloudVisMid', label:'Средние'},
  {key:'highOn',id:'cloudVisHigh',label:'Верхние'},
];

function cloudVisibilityButtonText(def){
  return def.label+' '+(state[def.key]?'●':'○');
}
function refreshCloudVisibilityButtons(root=document){
  if(!root||typeof root.querySelector!=='function')return;
  for(const def of CLOUD_VISIBILITY_LAYERS){
    const b=root.querySelector('#'+def.id);if(!b)continue;
    const on=!!state[def.key];
    b.textContent=cloudVisibilityButtonText(def);
    b.classList.toggle('active',on);
    b.setAttribute('aria-pressed',on?'true':'false');
    b.title=(on?'Скрыть ':'Показать ')+def.label.toLowerCase()+' облака только в рендере; физика погоды продолжает работать';
  }
}
function installCloudVisibilityControls(el){
  if(!el||el.dataset.group!=='Погода'||el.querySelector('#cloudVisibilityBar'))return el;
  const body=el.querySelector('.p-body');if(!body)return el;

  /* Remove the old duplicate layer switches created by ui.js. The state and
     hash keys remain unchanged, so old links and renderer uniforms keep
     working; only their presentation is replaced. */
  for(const id of ['lowOn','midOn','highOn']){
    const old=el.querySelector('#'+id);const row=old&&old.closest('.row');if(row)row.remove();
  }

  const box=document.createElement('div');box.id='cloudVisibilityBar';
  box.style.cssText='margin:0 0 11px;padding:8px 0 10px;border-bottom:1px solid rgba(159,194,255,.10)';
  const title=document.createElement('div');
  title.textContent='Видимость облаков · только рендер';
  title.style.cssText='font-size:9px;letter-spacing:.11em;text-transform:uppercase;color:var(--mut);margin-bottom:7px';
  const buttons=document.createElement('div');
  buttons.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px';
  for(const def of CLOUD_VISIBILITY_LAYERS){
    const b=document.createElement('button');b.type='button';b.id=def.id;b.className='act-btn';
    b.style.cssText='padding:7px 4px;min-width:0;font-size:9px';
    b.addEventListener('click',()=>{
      state[def.key]=!state[def.key];
      if(typeof markRenderUniformsDirty==='function')markRenderUniformsDirty();
      refreshCloudVisibilityButtons(el);
      if(typeof saveHash==='function')saveHash();
    });
    buttons.appendChild(b);
  }
  box.append(title,buttons);body.prepend(box);refreshCloudVisibilityButtons(el);return el;
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
  syncUI=function(){const out=syncUIBeforeCloudVisibilityControls();refreshCloudVisibilityButtons();return out;};
}
