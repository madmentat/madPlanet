/* ============ 0.5.92 / 0.5.111: pause all simulation processes for clean screenshots ============ */
/*
   Freezes the simulation clock, derived-parameter relaxation and time-driven
   weather / cloud / planet motion. Camera navigation (zoom, orbit) stays
   active so the user can frame a screenshot while paused.

   Placement is opposite the hamburger (rub-toggle):
     - landscape / wide viewports: top-right
     - portrait  / narrow viewports: bottom-left

   0.5.111: bottom-corner controls must never sit on top of the utility bar.
   Wide portrait tablets lift both pause and hamburger just above that bar;
   narrow phones lift pause above the two stacked mobile bottom rows while the
   hamburger remains at its existing top-center position.
*/
(function installPauseUI(){
  if(typeof document === 'undefined') return;

  state.paused = false;
  let pauseAccum = 0;          /* total paused wall-time, ms */
  let pauseStartedAt = 0;      /* wall-time when pause began */

  /* ----- styles ----- */
  const style = document.createElement('style');
  style.id = 'madplanet-pause-ui';
  style.textContent = `
    .pause-btn{
      position:fixed;z-index:9;
      width:40px;height:40px;border-radius:10px;border:1px solid var(--line);
      background:var(--glass2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      color:var(--mut);cursor:pointer;display:grid;place-items:center;
      transition:color .15s,background .15s,border-color .15s;
      box-shadow:0 2px 12px rgba(0,0,0,.35);
      /* default (landscape / wide): top-right, opposite bottom-right hamburger */
      top:var(--safe-t);right:var(--safe-b);bottom:auto;left:auto;
    }
    .pause-btn:hover{color:var(--txt);background:rgba(159,194,255,.14)}
    .pause-btn.active{
      color:var(--warm);border-color:rgba(232,163,92,.45);
      background:rgba(232,163,92,.16);
    }
    .pause-btn svg{width:16px;height:16px}
    .pause-btn .ico-play{display:none}
    .pause-btn.active .ico-pause{display:none}
    .pause-btn.active .ico-play{display:block}
    /* portrait / narrow: bottom-left, opposite top-center hamburger on mobile */
    @media (max-width:700px),(orientation:portrait){
      .pause-btn{
        top:auto;right:auto;
        bottom:var(--safe-b);left:var(--safe-b);
      }
    }
    /* Phones have two bottom rows: rubric + horizontally scrolling utility
       bar. Keep pause above both; the hamburger is already top-center there. */
    @media (max-width:700px){
      .pause-btn{bottom:calc(var(--safe-b) + 102px)}
    }
    /* Portrait tablets keep the desktop one-row utility bar at the bottom.
       Raise both corner buttons by one bar height plus a small visual gap.
       This is deliberately injected after index.src.html styles so it also
       overrides rub-toggle without duplicating the whole responsive layout. */
    @media (min-width:701px) and (orientation:portrait){
      .pause-btn{
        top:auto;right:auto;left:var(--safe-b);
        bottom:calc(var(--safe-b) + 58px);
      }
      .rub-toggle{
        top:auto;left:auto;right:var(--safe-b);transform:none;
        bottom:calc(var(--safe-b) + 58px);
      }
    }
  `;
  document.head.appendChild(style);

  /* ----- button ----- */
  const btn = document.createElement('button');
  btn.className = 'pause-btn';
  btn.id = 'pauseBtn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Пауза');
  btn.title = 'Пауза (остановить симуляцию)';
  btn.innerHTML = `
    <svg class="ico-pause" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.8" fill="currentColor"/>
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.8" fill="currentColor"/>
    </svg>
    <svg class="ico-play" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.2 2.4v11.2L13.2 8 4.2 2.4z" fill="currentColor"/>
    </svg>`;
  document.body.appendChild(btn);

  function setPaused(on){
    on = !!on;
    if(on === state.paused) return;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if(on){
      pauseStartedAt = now;
      /* stop free-spin inertia; deliberate drag/zoom still work */
      if(typeof cam !== 'undefined' && cam){
        cam.vyaw = 0; cam.vpitch = 0;
      }
    } else {
      pauseAccum += Math.max(0, now - pauseStartedAt);
      /* shift simulation epoch so rotation / weather time does not jump */
      if(typeof t0 !== 'undefined') t0 += (now - pauseStartedAt);
      if(typeof lastNow !== 'undefined') lastNow = now;
    }
    state.paused = on;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-label', on ? 'Продолжить' : 'Пауза');
    btn.title = on ? 'Продолжить' : 'Пауза (остановить симуляцию)';
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPaused(!state.paused);
  });

  /* keyboard shortcut: Space (when not typing in an input) */
  document.addEventListener('keydown', (e) => {
    if(e.code !== 'Space' && e.key !== ' ') return;
    const tag = (e.target && e.target.tagName) || '';
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    e.preventDefault();
    setPaused(!state.paused);
  });

  /* ----- wrap the main loop: freeze simulation clock, keep camera live ----- */
  if(typeof loop === 'function'){
    const loopBeforePause = loop;
    loop = function(now){
      if(state.paused){
        const dt = Math.min(Math.max(0, now - lastNow), 100);
        lastNow = now;

        /* Camera navigation stays active while paused.
           Zoom (cam.tDist) and orbit from pointer events must still converge. */
        if(typeof cam !== 'undefined' && cam){
          if(typeof pointers !== 'undefined' && pointers && pointers.size === 0){
            /* no free-spin on pause, but keep any residual damping harmless */
            cam.vyaw = 0; cam.vpitch = 0;
          }
          cam.dist += (cam.tDist - cam.dist) * (1 - Math.pow(0.0001, dt/1000));
        }

        fitCanvas();
        if(typeof drawFrame === 'function'){
          /* frozen simulation time so uTime / rotations do not advance */
          const frozenNow = pauseStartedAt - pauseAccum;
          drawFrame(frozenNow);
        }
        requestAnimationFrame(loop);
        return;
      }
      return loopBeforePause(now);
    };
  }

  /* expose for console / tests */
  window.__madPlanetPause = { setPaused, isPaused: () => !!state.paused };
})();