/* ============ 0.5.119: compact smartphone portrait control dock ============ */
/*
   Portrait phones get one coherent layout instead of four unrelated mobile
   exceptions: service controls are right-aligned at the top, the sixteen
   rubric slots form an 8x2 grid above the bottom utility area, and the utility
   area itself becomes two fixed rows (display toggles, then seed/actions).

   This module is intentionally loaded last. runtime-settings.js and pause-ui.js
   create their buttons dynamically and carry older mobile positioning rules;
   one late stylesheet can therefore override all of them without changing the
   desktop/tablet contracts or duplicating their behavior.
*/
(function installMobilePortraitLayout(){
  if(typeof document==='undefined')return;

  /* Mark the four existing utility toggle wrappers so CSS can place them in a
     deterministic row without moving DOM nodes or disturbing their listeners. */
  const toggleClasses={rings:'mp-toggle-rings',starsOn:'mp-toggle-stars',detailOn:'mp-toggle-detail',platesOn:'mp-toggle-plates'};
  for(const [id,cls] of Object.entries(toggleClasses)){
    const input=document.getElementById(id),wrap=input&&input.closest('.tgw');
    if(wrap)wrap.classList.add(cls);
  }

  const style=document.createElement('style');
  style.id='madplanet-mobile-portrait-layout';
  style.textContent=`
    @media (max-width:700px) and (orientation:portrait){
      :root{
        --mp-edge-r:max(4px,env(safe-area-inset-right));
        --mp-edge-t:max(4px,env(safe-area-inset-top));
        --mp-dock-x:6px;
        --mp-tool-gap:3px;
        --mp-tool-cell:clamp(34px,calc((100vw - 32px)/8),40px);
        --mp-util-h:75px;
        --mp-tool-bottom:calc(var(--safe-b) + var(--mp-util-h) + 4px);
        --mp-dock-top:calc(var(--mp-tool-bottom) + (2 * var(--mp-tool-cell)) + var(--mp-tool-gap) + 5px);
      }

      /* Top-right service cluster. Hamburger owns the corner, then settings,
         Pause and the speed control march left from it. */
      .rub-toggle{
        top:var(--mp-edge-t)!important;right:var(--mp-edge-r)!important;
        bottom:auto!important;left:auto!important;transform:none!important;
      }
      .runtime-settings-btn{
        top:var(--mp-edge-t)!important;right:calc(var(--mp-edge-r) + 44px)!important;
        bottom:auto!important;left:auto!important;transform:none!important;
      }
      .pause-btn{
        top:var(--mp-edge-t)!important;right:calc(var(--mp-edge-r) + 88px)!important;
        bottom:auto!important;left:auto!important;
      }
      .sim-speed-control{
        top:var(--mp-edge-t)!important;right:calc(var(--mp-edge-r) + 132px)!important;
        bottom:auto!important;left:auto!important;
      }

      /* The complete sixteen-slot rubric is visible as an 8x2 dock. Empty
         logical cells keep their footprint but stay invisible until dragging. */
      .rubric.rubric-grid{
        left:50%!important;right:auto!important;top:auto!important;bottom:var(--mp-tool-bottom)!important;
        transform:translateX(-50%)!important;
        display:grid!important;
        grid-template-columns:repeat(8,var(--mp-tool-cell))!important;
        grid-template-rows:repeat(2,var(--mp-tool-cell))!important;
        grid-auto-flow:row!important;
        gap:var(--mp-tool-gap)!important;
        width:max-content!important;max-width:calc(100vw - 12px)!important;height:auto!important;
        padding:0!important;overflow:visible!important;
      }
      .rubric.rubric-grid.hidden{
        transform:translateX(-50%) translateY(calc(100% + 90px))!important;
        opacity:0!important;pointer-events:none!important;
      }
      .rubric-grid .rubric-slot{
        grid-column:auto!important;grid-row:auto!important;
        width:var(--mp-tool-cell)!important;height:var(--mp-tool-cell)!important;
        min-width:var(--mp-tool-cell)!important;min-height:var(--mp-tool-cell)!important;
        display:block!important;border-radius:9px!important;
      }
      .rubric-grid .rubric-slot:empty{visibility:hidden!important}
      .rubric-grid.rubric-dragging .rubric-slot:empty{visibility:visible!important}
      .rubric-grid .rubric-slot>.rubric-btn{
        width:var(--mp-tool-cell)!important;height:var(--mp-tool-cell)!important;
        min-width:var(--mp-tool-cell)!important;min-height:var(--mp-tool-cell)!important;
        border-radius:9px!important;font-size:7px!important;padding:2px!important;
      }
      .rubric-grid .rubric-btn svg{width:15px!important;height:15px!important}
      .rubric-drag-ghost{width:var(--mp-tool-cell)!important;height:var(--mp-tool-cell)!important;border-radius:9px!important}

      /* Bottom rows. The existing utilBar becomes a two-line ten-column grid:
         row 1 = four toggles, row 2 = seed / reroll / random / screenshot. */
      .util-bar{
        left:var(--mp-dock-x)!important;right:var(--mp-dock-x)!important;
        bottom:var(--safe-b)!important;width:auto!important;height:var(--mp-util-h)!important;
        display:grid!important;grid-template-columns:repeat(10,minmax(0,1fr))!important;
        grid-template-rows:30px 34px!important;grid-auto-flow:unset!important;
        align-items:center!important;gap:3px 4px!important;
        padding:4px 5px!important;overflow:visible!important;
        border-radius:11px!important;
      }
      .util-bar.hidden{transform:translateY(calc(100% + 18px))!important;opacity:0!important;pointer-events:none!important}
      .util-bar .util-sep{display:none!important}
      .util-bar > *{min-width:0!important}

      .util-bar>.mp-toggle-rings{grid-row:1;grid-column:1/3}
      .util-bar>.mp-toggle-stars{grid-row:1;grid-column:3/5}
      .util-bar>.mp-toggle-detail{grid-row:1;grid-column:5/8}
      .util-bar>.mp-toggle-plates{grid-row:1;grid-column:8/11}
      .util-bar>.tgw{justify-self:center;gap:4px!important}
      .util-bar .tg-lbl{font-size:8px!important;letter-spacing:.025em!important}
      .util-bar .tg{width:28px!important;height:15px!important}
      .util-bar .tg i{border-radius:8px}
      .util-bar .tg i::after{width:11px;height:11px}
      .util-bar .tg input:checked+i::after{transform:translateX(13px)}

      .util-bar>label[for='seed']{grid-row:2;grid-column:1/2;justify-self:center;font-size:8px!important;letter-spacing:.05em!important}
      .util-bar>#seed{grid-row:2;grid-column:2/4;width:100%!important;height:27px;padding:3px 5px!important}
      .util-bar>#reroll{grid-row:2;grid-column:4/5;justify-self:center;width:27px!important;height:27px!important}
      .util-bar>#rand{grid-row:2;grid-column:5/8;width:100%;padding:5px 3px!important;font-size:9px!important}
      .util-bar>#shotBtn{grid-row:2;grid-column:8/11;width:100%;padding:5px 3px!important;font-size:9px!important}

      /* Any opened parameter/settings panel stops above the complete dock. */
      .param-panel{
        left:8px!important;right:8px!important;top:auto!important;
        bottom:calc(var(--mp-dock-top) + 2px)!important;width:auto!important;
        max-height:min(55vh,420px)!important;
      }
      .runtime-settings-panel{
        left:8px!important;right:8px!important;top:calc(var(--mp-edge-t) + 48px)!important;
        bottom:calc(var(--mp-dock-top) + 2px)!important;width:auto!important;
        max-height:none!important;
      }
      #thermalLegend{bottom:calc(var(--mp-dock-top) + 8px)!important}

      /* Keep transient help below the service cluster rather than underneath it. */
      .hint{top:calc(var(--mp-edge-t) + 48px)!important;right:8px!important;bottom:auto!important}
    }

    /* On very narrow portrait phones the three compact service buttons still
       fit one line; only the wide speed cluster drops to a second right-aligned
       row so it never collides with the madPlanet wordmark. */
    @media (max-width:380px) and (orientation:portrait){
      .sim-speed-control{
        top:calc(var(--mp-edge-t) + 44px)!important;right:var(--mp-edge-r)!important;
      }
      .runtime-settings-panel{top:calc(var(--mp-edge-t) + 88px)!important}
      .hint{top:calc(var(--mp-edge-t) + 88px)!important}
    }
  `;
  document.head.appendChild(style);

  window.__madPlanetMobilePortraitLayout={
    isActive:()=>matchMedia('(max-width:700px) and (orientation:portrait)').matches
  };
})();
