/* ============ 0.5.50 polish: compact right-aligned panel toggles ============ */
/*
   .row label is intentionally flexible for ordinary slider labels, but that
   selector is more specific than .tg and used to make checkbox switches grow
   across the whole parameter row. Restore the switch as a fixed-size control
   and keep it pinned to the right edge of its row.
*/
(function installCompactPanelToggles(){
  if(typeof document==='undefined') return;
  const style=document.createElement('style');
  style.id='madplanet-toggle-layout-fix';
  style.textContent=`
    .param-panel .row label.tg{
      flex:0 0 30px!important;
      width:30px!important;
      min-width:30px!important;
      max-width:30px!important;
      margin-left:auto;
    }
  `;
  document.head.appendChild(style);
})();
