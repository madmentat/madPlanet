/* ============ 0.5.117: draggable orbit instrument window ============ */
(function installOrbitOverlayDrag(){
  if(typeof document==='undefined')return;
  const wrap=document.getElementById('orbitOverlay');
  if(!wrap||wrap.dataset.dragInstalled==='1')return;
  wrap.dataset.dragInstalled='1';

  const STORAGE_KEY='madPlanet.orbitOverlay.pos.v1';
  const style=document.createElement('style');style.id='madplanet-orbit-overlay-drag-style';
  style.textContent=`
    .orbit-overlay{height:226px!important;pointer-events:auto!important}
    .orbit-overlay-head{height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 7px 0 10px;border-bottom:1px solid rgba(159,194,255,.10);cursor:grab;touch-action:none;color:rgba(232,237,245,.70);font:9px var(--mono);letter-spacing:.14em;text-transform:uppercase}
    .orbit-overlay-head:active{cursor:grabbing}.orbit-overlay-head button{width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--mut);cursor:pointer;font:16px/1 var(--sans)}
    .orbit-overlay-head button:hover{color:var(--txt);background:rgba(255,255,255,.06)}
    .orbit-overlay canvas,.orbit-overlay-text{pointer-events:none}
    @media(max-width:700px){.orbit-overlay{height:202px!important}}
  `;document.head.appendChild(style);

  const head=document.createElement('div');head.className='orbit-overlay-head';
  const title=document.createElement('span');title.textContent='Орбита';
  const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Закрыть орбиту');close.textContent='×';
  head.append(title,close);wrap.insertBefore(head,wrap.firstChild);
  close.addEventListener('click',e=>{e.stopPropagation();window.__madPlanetOrbitOverlay?.setEnabled(false);});

  function clampPos(left,top){
    const w=wrap.offsetWidth||260,h=wrap.offsetHeight||226;
    return {left:Math.max(4,Math.min(innerWidth-w-4,left)),top:Math.max(4,Math.min(innerHeight-h-4,top))};
  }
  function applyPos(left,top,save){
    const p=clampPos(left,top);wrap.style.left=p.left+'px';wrap.style.top=p.top+'px';wrap.style.right='auto';wrap.style.bottom='auto';
    if(save){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(p));}catch(_e){}}
  }
  try{
    const p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(p&&Number.isFinite(p.left)&&Number.isFinite(p.top))requestAnimationFrame(()=>applyPos(p.left,p.top,false));
  }catch(_e){}

  let drag=null;
  head.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    const r=wrap.getBoundingClientRect();drag={id:e.pointerId,dx:e.clientX-r.left,dy:e.clientY-r.top};
    try{head.setPointerCapture(e.pointerId);}catch(_e){}
    e.preventDefault();
  });
  head.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;e.preventDefault();applyPos(e.clientX-drag.dx,e.clientY-drag.dy,false);
  },{passive:false});
  function end(e){if(!drag||drag.id!==e.pointerId)return;const r=wrap.getBoundingClientRect();drag=null;applyPos(r.left,r.top,true);}
  head.addEventListener('pointerup',end);head.addEventListener('pointercancel',end);
  addEventListener('resize',()=>{const r=wrap.getBoundingClientRect();if(wrap.style.left)applyPos(r.left,r.top,false);});
})();