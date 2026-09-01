/* ============ 0.5.115: runtime settings, simulation time + performance controls ============ */
/* Program/device policy lives here rather than in the planet seed/hash. */
(function installRuntimeSettingsCore(){
  if(typeof window==='undefined'||typeof document==='undefined')return;

  const STORAGE_KEY='madPlanet.runtime.v1';
  const SPEED_STEPS=[0.25,0.5,1,2,4];
  const TICK_STEPS=[30,60,120,180,300];
  const GRID_STEPS=[0,24,28,32,36];
  const defaults={
    speed:1,
    tickSeconds:300,
    profile:'auto',
    targetFps:(typeof mobileDevice!=='undefined'&&mobileDevice)?55:60,
    adaptiveResolution:true,
    renderScaleMin:(typeof mobileDevice!=='undefined'&&mobileDevice)
      ?((typeof deviceMemory==='number'&&deviceMemory<=4)?0.60:0.68):0.55,
    renderScaleMax:(typeof SCALE_MAX==='number')?SCALE_MAX:1,
    weatherGrid:0,
    deferWeatherInteraction:true
  };

  function clamp(x,a,b){x=Number(x);return Math.max(a,Math.min(b,Number.isFinite(x)?x:a));}
  function nearest(list,x){
    x=Number(x);let best=list[0],bd=Infinity;
    for(const v of list){const d=Math.abs(v-x);if(d<bd){bd=d;best=v;}}
    return best;
  }
  function load(){
    let saved={};
    try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};}catch(_e){}
    const s=Object.assign({},defaults,saved);
    s.speed=nearest(SPEED_STEPS,s.speed);
    s.tickSeconds=nearest(TICK_STEPS,s.tickSeconds);
    s.targetFps=Math.round(clamp(s.targetFps,24,90));
    s.renderScaleMin=clamp(s.renderScaleMin,0.50,2.0);
    s.renderScaleMax=clamp(s.renderScaleMax,0.60,2.0);
    if(s.renderScaleMin>s.renderScaleMax)s.renderScaleMin=s.renderScaleMax;
    s.weatherGrid=GRID_STEPS.includes(Number(s.weatherGrid))?Number(s.weatherGrid):0;
    s.adaptiveResolution=s.adaptiveResolution!==false;
    s.deferWeatherInteraction=s.deferWeatherInteraction!==false;
    if(!['auto','quality','balanced','performance','custom'].includes(s.profile))s.profile='auto';
    return s;
  }
  const settings=load();
  function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));}catch(_e){}}
  function runtimeNowMs(){
    return (typeof performance!=='undefined'&&performance&&typeof performance.now==='function')
      ?performance.now():Date.now();
  }

  /* Synthetic render clock. It keeps performance.now()'s epoch so render.js's
     existing t0 subtraction remains valid. */
  let clockWall=runtimeNowMs(),clockSim=clockWall;
  let clockPaused=false,clockPauseWall=0,clockPauseSim=clockSim;
  function commitClock(wallNow){
    const now=Number.isFinite(Number(wallNow))?Number(wallNow):runtimeNowMs();
    const paused=(typeof state!=='undefined'&&state&&state.paused);
    if(paused){
      if(!clockPaused){
        clockSim+=Math.max(0,now-clockWall)*settings.speed;
        clockWall=now;clockPaused=true;clockPauseWall=now;clockPauseSim=clockSim;
      }
      return clockPauseSim;
    }
    if(clockPaused){
      /* pause-ui shifts t0 by paused wall time. Add the same epoch offset here
         so pause is not counted twice when the simulation resumes. */
      clockSim=clockPauseSim+Math.max(0,now-clockPauseWall);
      clockWall=now;clockPaused=false;return clockSim;
    }
    clockSim+=Math.max(0,now-clockWall)*settings.speed;
    clockWall=now;return clockSim;
  }
  function visualNowMs(wallNow){
    return commitClock((typeof state!=='undefined'&&state&&state.paused)?runtimeNowMs():wallNow);
  }

  function speedLabel(v=settings.speed){return '×'+String(v);}
  function tickLabel(sec=settings.tickSeconds){return sec<60?sec+' с':(sec/60)+' мин';}
  function runtimeTickIntervalMs(){return Math.max(250,Math.min(4000,1000/Math.max(0.25,settings.speed)));}
  function renderBounds(){
    const hardMax=(typeof SCALE_MAX==='number')?SCALE_MAX:2;
    let lo=clamp(settings.renderScaleMin,0.50,hardMax);
    let hi=clamp(settings.renderScaleMax,0.60,hardMax);
    if(lo>hi)lo=hi;
    return {min:lo,max:hi};
  }

  /* Outer Weather/Fog/Cryosphere render bridges still receive wall time for
     their interpolation; only the base visual simulation gets scaled time. */
  if(typeof drawFrame==='function'){
    const drawFrameBeforeRuntimeClock=drawFrame;
    drawFrame=function(now){return drawFrameBeforeRuntimeClock(visualNowMs(now));};
  }
  /* Derived atmospheric relaxation is simulation; camera inertia is not. */
  if(typeof relaxDerived==='function'){
    const relaxDerivedBeforeRuntimeClock=relaxDerived;
    relaxDerived=function(dtSec){
      return relaxDerivedBeforeRuntimeClock(Math.max(0,Number(dtSec)||0)*settings.speed);
    };
  }

  function profileValues(name){
    const mobile=(typeof mobileDevice!=='undefined'&&mobileDevice);
    const mem=(typeof deviceMemory==='number')?deviceMemory:8;
    const hardMax=(typeof SCALE_MAX==='number')?SCALE_MAX:2;
    if(name==='quality')return {targetFps:30,renderScaleMin:mobile?0.88:0.85,renderScaleMax:hardMax,weatherGrid:mobile?32:36,adaptiveResolution:true};
    if(name==='balanced')return {targetFps:45,renderScaleMin:mobile?0.70:0.65,renderScaleMax:Math.min(hardMax,mobile?1.20:1.55),weatherGrid:mobile?28:32,adaptiveResolution:true};
    if(name==='performance')return {targetFps:60,renderScaleMin:0.55,renderScaleMax:Math.min(hardMax,mobile?0.95:1.20),weatherGrid:mobile?24:28,adaptiveResolution:true};
    return {targetFps:mobile?55:60,renderScaleMin:mobile?(mem<=4?0.60:0.68):0.55,renderScaleMax:hardMax,weatherGrid:0,adaptiveResolution:true};
  }

  let controls=null,diagTimer=0;
  function markCustom(){
    if(settings.profile!=='custom'){
      settings.profile='custom';
      if(controls&&controls.profile)controls.profile.value='custom';
    }
  }
  function rescheduleWeather(){
    try{
      if(typeof weatherCoreSchedulerTimer!=='undefined'&&weatherCoreSchedulerTimer){
        clearTimeout(weatherCoreSchedulerTimer);weatherCoreSchedulerTimer=0;
      }
      if(typeof weatherCoreSchedulerIdle!=='undefined'&&weatherCoreSchedulerIdle&&typeof cancelIdleCallback==='function'){
        cancelIdleCallback(weatherCoreSchedulerIdle);weatherCoreSchedulerIdle=0;
      }
      if(typeof weatherCoreSchedule==='function')weatherCoreSchedule();
    }catch(_e){}
  }
  function refreshSpeedUI(){
    const text=speedLabel();
    const badge=document.getElementById('simSpeedBadge');
    if(badge){badge.textContent=text;badge.title='Скорость симуляции '+text+' · нажмите для ×1';}
    const panelVal=document.querySelector('[data-runtime-value="speed"]');
    if(panelVal)panelVal.textContent=text;
  }
  function setSpeed(next){
    commitClock(runtimeNowMs());settings.speed=nearest(SPEED_STEPS,next);
    save();refreshSpeedUI();rescheduleWeather();
  }
  function nudgeSpeed(dir){
    let i=SPEED_STEPS.indexOf(settings.speed);
    if(i<0)i=SPEED_STEPS.indexOf(nearest(SPEED_STEPS,settings.speed));
    setSpeed(SPEED_STEPS[Math.max(0,Math.min(SPEED_STEPS.length-1,i+(dir<0?-1:1)))]);
  }

  /* Runs after smooth-motion-ui.js and pause-ui.js define their final wrappers. */
  function installLateHooks(){
    if(typeof weatherCoreTick==='function'){
      weatherCoreTick=function(){
        if(typeof document!=='undefined'&&document.hidden)return false;
        if(typeof state!=='undefined'&&state&&state.paused)return false;
        const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
        if(!core)return false;
        weatherCoreStep(core,settings.tickSeconds,weatherCoreClimateSnapshot(),weatherCoreAxis());
        if(typeof refreshWeatherCoreDiagnostics==='function')refreshWeatherCoreDiagnostics();
        return true;
      };
    }
    if(typeof weatherCoreSchedule==='function'){
      weatherCoreSchedule=function(delayMs){
        if(typeof setTimeout!=='function')return;
        if(typeof weatherCoreSchedulerTimer!=='undefined'&&weatherCoreSchedulerTimer)clearTimeout(weatherCoreSchedulerTimer);
        let requested=(delayMs===undefined||Number(delayMs)===WEATHER_CORE_REAL_TICK_MS)
          ?runtimeTickIntervalMs():Number(delayMs);
        requested=Math.max(16,Number.isFinite(requested)?requested:runtimeTickIntervalMs());
        weatherCoreSchedulerTimer=setTimeout(weatherCoreRequestTick,requested);
      };
    }
    if(typeof weatherCoreRequestedResolution==='function'){
      const requestedBeforeRuntime=weatherCoreRequestedResolution;
      weatherCoreRequestedResolution=function(){return settings.weatherGrid>0?settings.weatherGrid:requestedBeforeRuntime();};
    }
    if(typeof weatherCoreInteractionBusy==='function'){
      const busyBeforeRuntime=weatherCoreInteractionBusy;
      weatherCoreInteractionBusy=function(nowMs){
        if(settings.deferWeatherInteraction)return busyBeforeRuntime(nowMs);
        if(typeof document!=='undefined'&&document.hidden)return true;
        if(typeof state!=='undefined'&&state&&state.paused)return true;
        return false;
      };
    }
    if(typeof setRenderScale==='function'){
      setRenderScale=function(next){
        const b=renderBounds();
        next=Math.max(b.min,Math.min(b.max,Number(next)||b.min));next=Math.round(next*100)/100;
        if(Math.abs(next-renderScale)<0.009)return;
        renderScale=next;requestCanvasFit();
      };
    }
    if(typeof tuneRenderScale==='function'){
      tuneRenderScale=function(ms){
        if(!settings.adaptiveResolution||!Number.isFinite(ms)||ms<=0||document.hidden)return;
        if(qualityCooldown>0)return;
        const b=renderBounds(),target=1000/settings.targetFps;
        const interacting=(typeof pointers!=='undefined'&&pointers&&pointers.size>0);
        if(ms>target*(interacting?1.06:1.10)&&renderScale>b.min){
          const k=Math.max(0.76,Math.min(0.94,Math.sqrt(target/ms)*0.965));
          setRenderScale(renderScale*k);qualityCooldown=interacting?72:45;
        }else if(!interacting&&ms<target*0.64&&renderScale<b.max){
          setRenderScale(renderScale*1.020);qualityCooldown=120;
        }
      };
    }
    const b=renderBounds();
    if(typeof setRenderScale==='function'&&typeof renderScale==='number')setRenderScale(Math.max(b.min,Math.min(b.max,renderScale)));
    buildUI();rescheduleWeather();
  }

  function applyProfile(name){
    settings.profile=name;Object.assign(settings,profileValues(name));save();syncControls();
    if(typeof setRenderScale==='function'){
      const b=renderBounds();setRenderScale(Math.max(b.min,Math.min(b.max,renderScale)));
    }
    rescheduleWeather();
  }
  function makeSelect(options,value){
    const el=document.createElement('select');
    for(const pair of options){const o=document.createElement('option');o.value=String(pair[0]);o.textContent=pair[1];el.appendChild(o);}
    el.value=String(value);return el;
  }
  function makeRow(label,control,valueKey){
    const row=document.createElement('div');row.className='runtime-row';
    const lab=document.createElement('label');lab.textContent=label;row.append(lab,control);
    if(valueKey){const val=document.createElement('span');val.className='runtime-val';val.dataset.runtimeValue=valueKey;row.appendChild(val);}
    return row;
  }
  function makeRange(min,max,step,value){const el=document.createElement('input');el.type='range';el.min=min;el.max=max;el.step=step;el.value=value;return el;}
  function makeCheck(value){const el=document.createElement('input');el.type='checkbox';el.checked=!!value;return el;}

  function buildUI(){
    if(document.getElementById('runtimeSettingsBtn'))return;
    const style=document.createElement('style');style.id='madplanet-runtime-settings-style';
    style.textContent=`
      .runtime-settings-btn{position:fixed;z-index:10;right:calc(var(--safe-b) + 48px);bottom:var(--safe-b);width:40px;height:40px;border-radius:10px;border:1px solid var(--line);background:var(--glass2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:var(--mut);cursor:pointer;display:grid;place-items:center;box-shadow:0 2px 12px rgba(0,0,0,.35);transition:color .15s,background .15s,border-color .15s}
      .runtime-settings-btn:hover,.runtime-settings-btn.active{color:var(--txt);background:rgba(159,194,255,.14)}
      .runtime-settings-btn.active{border-color:rgba(159,194,255,.42)} .runtime-settings-btn svg{width:17px;height:17px}
      .sim-speed-control{position:fixed;z-index:10;top:var(--safe-t);right:calc(var(--safe-b) + 48px);height:40px;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--line);border-radius:10px;background:var(--glass2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 2px 12px rgba(0,0,0,.35)}
      .sim-speed-control button{border:0;background:transparent;color:var(--mut);height:32px;min-width:30px;border-radius:7px;cursor:pointer;font:500 13px var(--mono);display:grid;place-items:center}
      .sim-speed-control button:hover{color:var(--txt);background:rgba(159,194,255,.12)} .sim-speed-control .sim-speed-badge{min-width:42px;color:var(--acc);font-size:10px}
      .runtime-settings-panel{position:fixed;z-index:11;right:var(--safe-b);bottom:calc(var(--safe-b) + 50px);width:300px;max-height:min(76vh,590px);overflow:auto;display:none;background:var(--glass2);border:1px solid var(--line);border-radius:14px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 12px 48px rgba(0,0,0,.55);padding:12px 14px 14px;overscroll-behavior:contain}
      .runtime-settings-panel.open{display:block} .runtime-settings-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
      .runtime-settings-head b{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--txt);font-weight:500}.runtime-settings-head button{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--mut);cursor:pointer}.runtime-settings-head button:hover{color:var(--txt);background:rgba(255,255,255,.06)}
      .runtime-section{margin-top:11px;padding-top:10px;border-top:1px solid rgba(159,194,255,.10)} .runtime-section-title{font-size:8px;letter-spacing:.18em;text-transform:uppercase;color:rgba(159,194,255,.68);margin-bottom:7px}
      .runtime-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(86px,118px) auto;gap:8px;align-items:center;min-height:32px}.runtime-row>label{font-size:9px;line-height:1.25;letter-spacing:.04em;color:var(--mut)}
      .runtime-row select{width:100%;min-width:0;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:6px;color:var(--txt);font:10px var(--sans);padding:5px 6px}.runtime-row input[type=range]{height:28px}.runtime-row input[type=checkbox]{justify-self:end;width:16px;height:16px;accent-color:var(--acc)}
      .runtime-val{font:9px var(--mono);color:var(--acc);min-width:38px;text-align:right;white-space:nowrap}.runtime-note{font-size:8.5px;line-height:1.45;color:rgba(139,150,168,.82);margin-top:7px}.runtime-diag{font:9px/1.55 var(--mono);color:var(--mut);white-space:pre-line}
      .runtime-reset{margin-top:10px;width:100%;background:rgba(159,194,255,.06);border:1px solid var(--line);border-radius:8px;color:var(--mut);font:9px var(--sans);padding:7px;cursor:pointer}.runtime-reset:hover{color:var(--txt);background:rgba(159,194,255,.12)}
      @media(max-width:700px){.runtime-settings-btn{right:auto;left:calc(50% - 48px);bottom:auto;top:var(--safe-t);transform:translateX(-50%)}.sim-speed-control{top:auto;right:auto;left:calc(var(--safe-b) + 48px);bottom:calc(var(--safe-b) + 102px)}.runtime-settings-panel{left:8px;right:8px;bottom:calc(var(--safe-b) + 150px);width:auto;max-height:48vh}}
      @media(min-width:701px) and (orientation:portrait){.runtime-settings-btn{top:auto;left:auto;right:calc(var(--safe-b) + 48px);transform:none;bottom:calc(var(--safe-b) + 58px)}.sim-speed-control{top:auto;right:auto;left:calc(var(--safe-b) + 48px);bottom:calc(var(--safe-b) + 58px)}.runtime-settings-panel{bottom:calc(var(--safe-b) + 108px)}}
      @media(prefers-reduced-motion:reduce){.runtime-settings-btn{transition:none}}
    `;document.head.appendChild(style);

    const btn=document.createElement('button');btn.id='runtimeSettingsBtn';btn.className='runtime-settings-btn';btn.type='button';btn.setAttribute('aria-label','Настройки программы');btn.title='Настройки программы';
    btn.innerHTML='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M8.1 2.2h3.8l.5 2a6.6 6.6 0 0 1 1.4.8l2-.6 1.9 3.2-1.5 1.4c.1.4.1.7.1 1s0 .7-.1 1l1.5 1.4-1.9 3.2-2-.6a6.6 6.6 0 0 1-1.4.8l-.5 2H8.1l-.5-2a6.6 6.6 0 0 1-1.4-.8l-2 .6-1.9-3.2L3.8 11a6 6 0 0 1 0-2L2.3 7.6l1.9-3.2 2 .6a6.6 6.6 0 0 1 1.4-.8l.5-2Z" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.2"/></svg>';
    const speed=document.createElement('div');speed.className='sim-speed-control';speed.setAttribute('aria-label','Скорость симуляции');
    speed.innerHTML='<button type="button" data-sim-speed="-1" aria-label="Замедлить симуляцию" title="Замедлить симуляцию">−</button><button type="button" class="sim-speed-badge" id="simSpeedBadge" aria-label="Сбросить скорость к один" title="Скорость симуляции">×1</button><button type="button" data-sim-speed="1" aria-label="Ускорить симуляцию" title="Ускорить симуляцию">+</button>';
    const panel=document.createElement('div');panel.id='runtimeSettingsPanel';panel.className='runtime-settings-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Настройки программы');
    const head=document.createElement('div');head.className='runtime-settings-head';head.innerHTML='<b>Настройки программы</b><button type="button" aria-label="Закрыть">×</button>';panel.appendChild(head);

    const secTime=document.createElement('div');secTime.className='runtime-section';secTime.innerHTML='<div class="runtime-section-title">Модельное время</div>';
    const tick=makeSelect([[30,'30 секунд'],[60,'1 минута'],[120,'2 минуты'],[180,'3 минуты'],[300,'5 минут']],settings.tickSeconds);secTime.appendChild(makeRow('Время за тик Weather Core',tick,'tick'));
    const speedRead=document.createElement('span');speedRead.className='runtime-val';speedRead.dataset.runtimeValue='speed';
    const speedRow=document.createElement('div');speedRow.className='runtime-row';const speedLab=document.createElement('label');speedLab.textContent='Текущая скорость';speedRow.append(speedLab,document.createElement('span'),speedRead);secTime.appendChild(speedRow);
    const timeNote=document.createElement('div');timeNote.className='runtime-note';timeNote.textContent='Ускорение меняет непрерывную анимацию и желаемую частоту физических тиков. Если устройство не успевает, Weather Core пропускает работу, а не создаёт очередь догоняющих тиков.';secTime.appendChild(timeNote);panel.appendChild(secTime);

    const secPerf=document.createElement('div');secPerf.className='runtime-section';secPerf.innerHTML='<div class="runtime-section-title">Быстродействие на этом устройстве</div>';
    const profile=makeSelect([['auto','Авто'],['quality','Качество'],['balanced','Баланс'],['performance','Быстродействие'],['custom','Свой']],settings.profile);
    const fps=makeRange(24,90,1,settings.targetFps),adapt=makeCheck(settings.adaptiveResolution);
    const hardMax=Math.min(2,(typeof SCALE_MAX==='number'?SCALE_MAX:2));
    const minScale=makeRange(0.50,hardMax,0.05,settings.renderScaleMin),maxScale=makeRange(0.60,hardMax,0.05,settings.renderScaleMax);
    const grid=makeSelect([[0,'Авто'],[24,'24² × 6'],[28,'28² × 6'],[32,'32² × 6'],[36,'36² × 6']],settings.weatherGrid),defer=makeCheck(settings.deferWeatherInteraction);
    secPerf.append(makeRow('Профиль',profile),makeRow('Целевой FPS',fps,'fps'),makeRow('Адаптивное разрешение',adapt),makeRow('Масштаб рендера min',minScale,'minScale'),makeRow('Масштаб рендера max',maxScale,'maxScale'),makeRow('Сетка Weather Core',grid),makeRow('Не считать погоду при управлении',defer));
    const perfNote=document.createElement('div');perfNote.className='runtime-note';perfNote.textContent='Смена сетки Weather Core пересоздаёт физическую сетку при следующем тике. Профиль влияет только на это устройство и не входит в сид планеты.';secPerf.appendChild(perfNote);panel.appendChild(secPerf);

    const secDiag=document.createElement('div');secDiag.className='runtime-section';secDiag.innerHTML='<div class="runtime-section-title">Диагностика</div>';const diag=document.createElement('div');diag.className='runtime-diag';diag.id='runtimeDiag';secDiag.appendChild(diag);panel.appendChild(secDiag);
    const reset=document.createElement('button');reset.type='button';reset.className='runtime-reset';reset.textContent='Сбросить настройки программы';panel.appendChild(reset);
    document.body.append(btn,speed,panel);controls={btn,panel,profile,fps,adapt,minScale,maxScale,grid,defer,tick,diag};

    function setOpen(on){on=!!on;panel.classList.toggle('open',on);btn.classList.toggle('active',on);btn.setAttribute('aria-expanded',String(on));if(on)startDiag();else stopDiag();}
    btn.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();setOpen(!panel.classList.contains('open'));});head.querySelector('button').addEventListener('click',()=>setOpen(false));document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&panel.classList.contains('open'))setOpen(false);});
    speed.querySelector('[data-sim-speed="-1"]').addEventListener('click',()=>nudgeSpeed(-1));speed.querySelector('[data-sim-speed="1"]').addEventListener('click',()=>nudgeSpeed(1));speed.querySelector('#simSpeedBadge').addEventListener('click',()=>setSpeed(1));
    tick.addEventListener('change',()=>{settings.tickSeconds=nearest(TICK_STEPS,Number(tick.value));save();syncControls();rescheduleWeather();});
    profile.addEventListener('change',()=>{if(profile.value!=='custom')applyProfile(profile.value);else{settings.profile='custom';save();}});
    fps.addEventListener('input',()=>{settings.targetFps=Math.round(clamp(fps.value,24,90));markCustom();save();syncControls();});adapt.addEventListener('change',()=>{settings.adaptiveResolution=adapt.checked;markCustom();save();});
    minScale.addEventListener('input',()=>{settings.renderScaleMin=clamp(minScale.value,0.50,2);if(settings.renderScaleMin>settings.renderScaleMax)settings.renderScaleMax=settings.renderScaleMin;markCustom();save();syncControls();if(typeof setRenderScale==='function')setRenderScale(renderScale);});
    maxScale.addEventListener('input',()=>{settings.renderScaleMax=clamp(maxScale.value,0.60,2);if(settings.renderScaleMax<settings.renderScaleMin)settings.renderScaleMin=settings.renderScaleMax;markCustom();save();syncControls();if(typeof setRenderScale==='function')setRenderScale(renderScale);});
    grid.addEventListener('change',()=>{settings.weatherGrid=GRID_STEPS.includes(Number(grid.value))?Number(grid.value):0;markCustom();save();rescheduleWeather();});defer.addEventListener('change',()=>{settings.deferWeatherInteraction=defer.checked;save();});
    reset.addEventListener('click',()=>{commitClock(runtimeNowMs());Object.assign(settings,defaults);save();syncControls();if(typeof setRenderScale==='function')setRenderScale(renderBounds().max);rescheduleWeather();});
    syncControls();refreshSpeedUI();
  }

  function syncControls(){
    if(!controls)return;controls.profile.value=settings.profile;controls.fps.value=String(settings.targetFps);controls.adapt.checked=settings.adaptiveResolution;controls.minScale.value=String(settings.renderScaleMin);controls.maxScale.value=String(settings.renderScaleMax);controls.grid.value=String(settings.weatherGrid);controls.defer.checked=settings.deferWeatherInteraction;controls.tick.value=String(settings.tickSeconds);
    const put=(k,v)=>{const el=controls.panel.querySelector('[data-runtime-value="'+k+'"]');if(el)el.textContent=v;};
    put('speed',speedLabel());put('tick',tickLabel());put('fps',settings.targetFps);put('minScale',Number(settings.renderScaleMin).toFixed(2));put('maxScale',Number(settings.renderScaleMax).toFixed(2));refreshSpeedUI();
  }
  function updateDiag(){
    if(!controls||!controls.diag)return;const lines=[];
    lines.push('renderScale  '+(typeof renderScale==='number'?renderScale.toFixed(2):'—'));
    lines.push('frame EMA    '+(typeof frameMsEwma==='number'?(1000/Math.max(1,frameMsEwma)).toFixed(0)+' FPS':'—'));
    let core=null;try{core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;}catch(_e){}
    lines.push('Weather Core '+(core?core.N+'² × 6':'—'));
    const sched=window.__madPlanetWeatherScheduler;lines.push('weather tick '+(sched&&Number.isFinite(sched.costEwmaMs)?sched.costEwmaMs.toFixed(1)+' ms':'—'));
    lines.push('deviceMemory '+(typeof deviceMemory==='number'?deviceMemory+' GB':'—'));lines.push('WebGL        '+(typeof webglVersion!=='undefined'?webglVersion:'—'));controls.diag.textContent=lines.join('\n');
  }
  function startDiag(){stopDiag();updateDiag();diagTimer=setInterval(updateDiag,600);}
  function stopDiag(){if(diagTimer){clearInterval(diagTimer);diagTimer=0;}}

  window.__madPlanetRuntime={settings,speedSteps:SPEED_STEPS.slice(),setSpeed,get speed(){return settings.speed;},get tickSeconds(){return settings.tickSeconds;},get requestedTickIntervalMs(){return runtimeTickIntervalMs();},get renderBounds(){return renderBounds();}};
  Promise.resolve().then(installLateHooks);
})();