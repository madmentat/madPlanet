/* ============ touch UX: safe panel scrolling + orbit mode ============ */
/*
   Touch screens have two conflicting gestures in madPlanet: vertical panel
   scrolling and horizontal range editing. Native range handling used to win
   too early, so a harmless swipe through a long panel changed several values.

   While a parameter panel is open we arbitrate the gesture before either the
   panel or the canvas receives it:
     - vertical/ordinary drag scrolls the open panel, even when started over a
       range or over the planet outside the panel;
     - a clearly horizontal drag (or a tap) on a range edits that range;
     - a tap on free space outside the panel closes it;
     - after the panel closes, the next canvas drag controls the scene again.
*/

(function installTouchUx(){
  if(typeof document === 'undefined' || typeof window === 'undefined') return;

  const style=document.createElement('style');
  style.textContent=`
    .param-panel .p-body{
      scrollbar-width:none!important;
      -ms-overflow-style:none;
      touch-action:none!important;
    }
    .param-panel .p-body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
    .param-panel .p-body input[type=range]{touch-action:none!important}
    .orbit-mode-btn[data-mode="sun"]{
      background:rgba(232,163,92,.16);
      border-color:rgba(232,163,92,.42);
      color:#ffd7aa;
    }
  `;
  document.head.appendChild(style);

  function currentOrbitMode(){
    return (typeof getOrbitControlMode === 'function') ? getOrbitControlMode() : 'planet';
  }
  function updateOrbitModeUi(btn){
    if(!btn) return;
    const mode=currentOrbitMode();
    btn.dataset.mode=mode;
    btn.textContent=mode === 'sun' ? '☀ Звезда' : '◉ Планета';
    btn.title=mode === 'sun'
      ? 'Перетаскивание вращает источник света и видимую звезду'
      : 'Перетаскивание вращает планету; ПКМ по-прежнему вращает звезду';
    btn.setAttribute('aria-label',btn.title);
    btn.setAttribute('aria-pressed',mode === 'sun' ? 'true' : 'false');
    const hint=document.getElementById('hint');
    if(hint){
      hint.textContent=mode === 'sun'
        ? 'свайп — звезда / свет · щипок — зум · кнопка — планета'
        : 'свайп — планета · щипок — зум · кнопка — звезда / свет';
    }
  }

  const utilBar=document.getElementById('utilBar');
  if(utilBar && !document.getElementById('orbitModeBtn')){
    const btn=document.createElement('button');
    btn.type='button';
    btn.id='orbitModeBtn';
    btn.className='act-btn orbit-mode-btn';
    btn.addEventListener('click',()=>{
      const next=currentOrbitMode() === 'sun' ? 'planet' : 'sun';
      if(typeof setOrbitControlMode === 'function') setOrbitControlMode(next);
      updateOrbitModeUi(btn);
    });
    const sep=utilBar.querySelector('.util-sep');
    utilBar.insertBefore(btn,sep || null);
    updateOrbitModeUi(btn);
  }

  const gesture={
    active:false,pointerId:-1,startX:0,startY:0,startScroll:0,
    body:null,panel:null,slider:null,startInPanel:false,mode:'',moved:false
  };
  const GESTURE_THRESHOLD=7;
  const RANGE_AXIS_BIAS=1.15;

  function isTouchLike(e){ return e.pointerType === 'touch' || e.pointerType === 'pen'; }
  function activePanelContext(){
    if(typeof openPanelGroup === 'undefined' || !openPanelGroup) return null;
    if(typeof panels === 'undefined') return null;
    const panel=panels[openPanelGroup];
    if(!panel || !panel.classList.contains('open')) return null;
    const body=panel.querySelector('.p-body');
    return body ? {panel,body} : null;
  }
  function elementTarget(e){
    const t=e.target;
    return t && typeof t.closest === 'function' ? t : null;
  }
  function shouldLeaveNative(target,slider){
    if(slider) return false;
    /* Buttons/toggles/selects remain ordinary taps. The rubric and utility
       strip also keep their own horizontal-scroll behaviour on narrow phones. */
    return !!target.closest('button,select,textarea,a,.tg,#rubric,#utilBar,.rub-toggle');
  }
  function setSliderFromClientX(slider,clientX){
    if(!slider) return;
    const r=slider.getBoundingClientRect();
    if(!(r.width > 1)) return;
    const min=Number(slider.min || 0), max=Number(slider.max || 1);
    const u=Math.max(0,Math.min(1,(clientX-r.left)/r.width));
    slider.value=String(min+(max-min)*u);
    slider.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function resetGesture(){
    gesture.active=false; gesture.pointerId=-1; gesture.body=null;
    gesture.panel=null; gesture.slider=null; gesture.mode=''; gesture.moved=false;
  }

  /* Registered before ui.js on purpose. ui.js has its own window-capture
     pointerdown that closes a panel on outside taps; we must decide whether a
     touch is a scroll before that listener sees it. */
  window.addEventListener('pointerdown',e=>{
    if(!isTouchLike(e)) return;
    const ctx=activePanelContext();
    if(!ctx) return;
    const target=elementTarget(e);
    if(!target) return;
    const slider=target.closest('input[type="range"]');
    if(shouldLeaveNative(target,slider)) return;

    gesture.active=true;
    gesture.pointerId=e.pointerId;
    gesture.startX=e.clientX; gesture.startY=e.clientY;
    gesture.startScroll=ctx.body.scrollTop;
    gesture.body=ctx.body; gesture.panel=ctx.panel;
    gesture.slider=slider && ctx.panel.contains(slider) ? slider : null;
    gesture.startInPanel=ctx.panel.contains(target);
    gesture.mode=''; gesture.moved=false;

    e.preventDefault();
    e.stopImmediatePropagation();
  },{capture:true,passive:false});

  window.addEventListener('pointermove',e=>{
    if(!gesture.active || e.pointerId !== gesture.pointerId) return;
    const dx=e.clientX-gesture.startX, dy=e.clientY-gesture.startY;
    const distance=Math.hypot(dx,dy);
    if(!gesture.mode && distance >= GESTURE_THRESHOLD){
      gesture.moved=true;
      gesture.mode=gesture.slider && Math.abs(dx) > Math.abs(dy)*RANGE_AXIS_BIAS
        ? 'slider' : 'scroll';
    }
    if(gesture.mode === 'slider'){
      setSliderFromClientX(gesture.slider,e.clientX);
    }else if(gesture.mode === 'scroll' && gesture.body){
      gesture.body.scrollTop=gesture.startScroll-dy;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  },{capture:true,passive:false});

  window.addEventListener('pointerup',e=>{
    if(!gesture.active || e.pointerId !== gesture.pointerId) return;
    if(!gesture.moved){
      if(gesture.slider){
        setSliderFromClientX(gesture.slider,e.clientX);
      }else if(!gesture.startInPanel && typeof closePanel === 'function' &&
               typeof openPanelGroup !== 'undefined' && openPanelGroup){
        closePanel(openPanelGroup);
      }
    }
    resetGesture();
    e.preventDefault();
    e.stopImmediatePropagation();
  },{capture:true,passive:false});

  window.addEventListener('pointercancel',e=>{
    if(!gesture.active || e.pointerId !== gesture.pointerId) return;
    resetGesture();
    e.preventDefault();
    e.stopImmediatePropagation();
  },{capture:true,passive:false});
})();
