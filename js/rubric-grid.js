/* ============ 0.5.116: two-column draggable rubric ============ */
/*
   The original eight parameter buttons remain the right-hand column. A second
   eight-slot column is added immediately to its left, aligned above the
   runtime-settings gear. Buttons can be dragged between all 16 logical slots;
   dropping on an occupied slot swaps the two buttons, while dropping on an
   empty slot simply moves the button. Layout is device-local UI state and is
   deliberately not part of the planet seed/hash.
*/
(function installRubricGrid(){
  if(typeof document==='undefined')return;
  const rubric=document.getElementById('rubric');
  if(!rubric||rubric.dataset.gridInstalled==='1')return;
  rubric.dataset.gridInstalled='1';
  rubric.classList.add('rubric-grid');

  const STORAGE_KEY='madPlanet.rubric.layout.v1';
  const SLOT_COUNT=16;
  const COLUMN_ROWS=8;

  const style=document.createElement('style');
  style.id='madplanet-rubric-grid-style';
  style.textContent=`
    .rubric.rubric-grid{
      display:grid;grid-template-columns:44px 44px;grid-template-rows:repeat(8,44px);
      gap:6px;width:94px;align-content:start;justify-content:start;overflow:visible;
    }
    .rubric-grid .rubric-slot{width:44px;height:44px;min-width:44px;min-height:44px;position:relative;border-radius:12px}
    .rubric-grid .rubric-slot>.rubric-btn{width:44px;height:44px;margin:0;touch-action:none}
    .rubric-grid.rubric-dragging .rubric-slot:empty{
      border:1px dashed rgba(159,194,255,.22);background:rgba(159,194,255,.025)
    }
    .rubric-grid .rubric-btn.rubric-drag-source{opacity:.28}
    .rubric-drag-ghost{
      position:fixed;z-index:40;pointer-events:none;width:44px;height:44px;border-radius:12px;
      opacity:.92;transform:translate(-50%,-50%) scale(1.04);box-shadow:0 8px 28px rgba(0,0,0,.45)
    }
    .rubric-btn.orbit-enabled{color:var(--warm);border-color:rgba(232,163,92,.50);background:rgba(232,163,92,.14)}
    @media(max-width:700px){
      .rubric.rubric-grid{
        display:flex;width:auto;max-width:calc(100vw - 16px);height:40px;gap:5px;overflow-x:auto;
        align-items:center;justify-content:flex-start;padding:0 4px
      }
      .rubric-grid .rubric-slot{width:40px;height:40px;min-width:40px;min-height:40px;display:block;flex:0 0 40px}
      .rubric-grid .rubric-slot:empty{display:none}
      .rubric-grid.rubric-dragging .rubric-slot:empty{display:block}
      .rubric-grid .rubric-slot>.rubric-btn{width:40px;height:40px}
    }
    @media(prefers-reduced-motion:reduce){.rubric-drag-ghost{transform:translate(-50%,-50%)}}
  `;
  document.head.appendChild(style);

  const existing=[...rubric.querySelectorAll(':scope > .rubric-btn')];
  existing.forEach((btn,i)=>{
    btn.dataset.toolId='group:'+String(btn.dataset.group||i);
  });

  const orbitBtn=document.createElement('button');
  orbitBtn.type='button';
  orbitBtn.id='orbitOverlayBtn';
  orbitBtn.className='rubric-btn rubric-action-btn';
  orbitBtn.dataset.toolId='action:orbit';
  orbitBtn.title='Показать орбиту';
  orbitBtn.setAttribute('aria-label','Показать орбиту');
  orbitBtn.setAttribute('aria-pressed','false');
  orbitBtn.innerHTML='<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><ellipse cx="9" cy="9" rx="7" ry="3.7" transform="rotate(-20 9 9)" stroke="currentColor" stroke-width="1.1"/><circle cx="9" cy="9" r="1.6" fill="currentColor" opacity=".85"/><circle cx="14.5" cy="5.7" r="1.1" fill="currentColor"/></svg><span>ОР</span>';

  /* Logical slot order is column-major on purpose: 0..7 are the original
     right column; 8..15 are the new left column. On narrow phones the same
     order naturally flattens to the old eight buttons followed by additions. */
  const slots=[];
  rubric.textContent='';
  for(let i=0;i<SLOT_COUNT;i++){
    const slot=document.createElement('div');
    slot.className='rubric-slot';slot.dataset.slot=String(i);
    if(i<COLUMN_ROWS){slot.style.gridColumn='2';slot.style.gridRow=String(i+1);}
    else{slot.style.gridColumn='1';slot.style.gridRow=String(i-COLUMN_ROWS+1);}
    slots.push(slot);rubric.appendChild(slot);
  }

  const defaultIds=Array(SLOT_COUNT).fill(null);
  existing.slice(0,COLUMN_ROWS).forEach((btn,i)=>{defaultIds[i]=btn.dataset.toolId;});
  defaultIds[COLUMN_ROWS]=orbitBtn.dataset.toolId;
  const toolMap=new Map(existing.map(btn=>[btn.dataset.toolId,btn]));
  toolMap.set(orbitBtn.dataset.toolId,orbitBtn);

  function loadIds(){
    let saved=null;
    try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch(_e){}
    if(!Array.isArray(saved)||saved.length!==SLOT_COUNT)return defaultIds.slice();
    const out=Array(SLOT_COUNT).fill(null),seen=new Set();
    for(let i=0;i<SLOT_COUNT;i++){
      const id=typeof saved[i]==='string'?saved[i]:null;
      if(id&&toolMap.has(id)&&!seen.has(id)){out[i]=id;seen.add(id);}
    }
    /* New tools added by later versions occupy their default cell when it is
       free, otherwise the first available empty cell. */
    for(const [id] of toolMap){
      if(seen.has(id))continue;
      let wanted=defaultIds.indexOf(id);
      if(wanted<0||out[wanted])wanted=out.indexOf(null);
      if(wanted>=0){out[wanted]=id;seen.add(id);}
    }
    return out;
  }
  let layout=loadIds();

  function saveLayout(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));}catch(_e){}
  }
  function renderLayout(){
    slots.forEach(slot=>{while(slot.firstChild)slot.removeChild(slot.firstChild);});
    for(let i=0;i<SLOT_COUNT;i++){
      const id=layout[i],btn=id?toolMap.get(id):null;
      if(btn)slots[i].appendChild(btn);
    }
  }
  renderLayout();

  let drag=null,suppressClickUntil=0;
  function makeGhost(btn,x,y){
    const g=btn.cloneNode(true);g.removeAttribute('id');g.classList.add('rubric-drag-ghost');
    g.style.left=x+'px';g.style.top=y+'px';document.body.appendChild(g);return g;
  }
  function slotAtPoint(x,y){
    const el=document.elementFromPoint(x,y);return el&&el.closest?el.closest('.rubric-slot'):null;
  }
  function beginDrag(e,btn){
    if(e.button!==undefined&&e.button!==0)return;
    const source=btn.closest('.rubric-slot');if(!source)return;
    drag={pointerId:e.pointerId,btn,source,startX:e.clientX,startY:e.clientY,active:false,ghost:null,target:null};
    try{btn.setPointerCapture(e.pointerId);}catch(_e){}
  }
  function moveDrag(e){
    if(!drag||e.pointerId!==drag.pointerId)return;
    const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
    if(!drag.active&&dx*dx+dy*dy<49)return;
    if(!drag.active){
      drag.active=true;rubric.classList.add('rubric-dragging');drag.btn.classList.add('rubric-drag-source');
      drag.ghost=makeGhost(drag.btn,e.clientX,e.clientY);
    }
    e.preventDefault();
    drag.ghost.style.left=e.clientX+'px';drag.ghost.style.top=e.clientY+'px';
    const target=slotAtPoint(e.clientX,e.clientY);
    if(drag.target&&drag.target!==target)drag.target.style.outline='';
    drag.target=target;
    if(target)target.style.outline='1px solid rgba(159,194,255,.55)';
  }
  function endDrag(e){
    if(!drag||e.pointerId!==drag.pointerId)return;
    const d=drag;drag=null;
    if(d.target)d.target.style.outline='';
    rubric.classList.remove('rubric-dragging');d.btn.classList.remove('rubric-drag-source');
    if(d.ghost)d.ghost.remove();
    if(!d.active)return;
    suppressClickUntil=performance.now()+350;
    const src=Number(d.source.dataset.slot),dst=d.target?Number(d.target.dataset.slot):src;
    if(Number.isInteger(src)&&Number.isInteger(dst)&&src>=0&&dst>=0&&src<SLOT_COUNT&&dst<SLOT_COUNT&&src!==dst){
      const tmp=layout[src];layout[src]=layout[dst];layout[dst]=tmp;saveLayout();renderLayout();
    }
  }

  rubric.addEventListener('pointerdown',e=>{
    const btn=e.target.closest&&e.target.closest('.rubric-btn');if(btn)beginDrag(e,btn);
  });
  rubric.addEventListener('pointermove',moveDrag,{passive:false});
  rubric.addEventListener('pointerup',endDrag);
  rubric.addEventListener('pointercancel',endDrag);
  rubric.addEventListener('click',e=>{
    if(performance.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}
  },true);

  window.__madPlanetRubricLayout={
    get layout(){return layout.slice();},
    reset(){layout=defaultIds.slice();saveLayout();renderLayout();}
  };
})();
