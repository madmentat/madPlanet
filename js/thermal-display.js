/* ============ 0.5.117: thermal imager display mode ============ */
(function installThermalDisplay(){
  if(typeof document==='undefined'||typeof drawFrame!=='function'||typeof gl==='undefined')return;
  let enabled=false,boundProgram=null,loc=null;

  const legend=document.createElement('div');legend.id='thermalLegend';legend.setAttribute('aria-hidden','true');
  legend.innerHTML='<div class="thermal-scale"></div><div class="thermal-labels"><span>180 K</span><span>280 K</span><span>380 K</span></div><div class="thermal-caption">температура поверхности Weather Core</div>';
  const style=document.createElement('style');style.id='madplanet-thermal-style';
  style.textContent=`
    #thermalLegend{position:fixed;z-index:6;left:18px;bottom:calc(var(--safe-b) + 54px);width:220px;padding:8px 10px 7px;border:1px solid rgba(159,194,255,.14);border-radius:10px;background:rgba(7,12,20,.56);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;pointer-events:none}
    #thermalLegend.on{display:block}.thermal-scale{height:8px;border-radius:5px;background:linear-gradient(90deg,rgb(20,3,38),rgb(20,31,158),rgb(0,194,230),rgb(250,230,31),rgb(245,46,8),rgb(255,247,229))}.thermal-labels{display:flex;justify-content:space-between;margin-top:4px;font:8px var(--mono);color:rgba(232,237,245,.72)}.thermal-caption{margin-top:4px;font:8px/1.2 var(--sans);letter-spacing:.04em;color:rgba(139,150,168,.76)}
    @media(max-width:700px){#thermalLegend{left:8px;bottom:calc(var(--safe-b) + 150px);width:190px}}
  `;document.head.appendChild(style);document.body.appendChild(legend);

  function button(){return document.getElementById('thermalDisplayBtn');}
  function ensureUniform(){
    if(typeof prog==='undefined'||!prog)return null;
    if(boundProgram!==prog){boundProgram=prog;loc=gl.getUniformLocation(prog,'uThermalOn');}
    return loc;
  }
  function applyUniform(){const u=ensureUniform();if(u!==null){gl.useProgram(prog);gl.uniform1f(u,enabled?1:0);}}
  function syncButton(){const b=button();if(!b)return;b.classList.toggle('tool-enabled',enabled);b.setAttribute('aria-pressed',String(enabled));b.title=enabled?'Выключить тепловизор':'Тепловизор';b.setAttribute('aria-label',b.title);}
  function setEnabled(on){enabled=!!on;legend.classList.toggle('on',enabled);legend.setAttribute('aria-hidden',String(!enabled));syncButton();applyUniform();}
  function bind(){const b=button();if(b&&!b.dataset.thermalBound){b.dataset.thermalBound='1';b.addEventListener('click',()=>setEnabled(!enabled));syncButton();}}
  bind();

  const before=drawFrame;
  drawFrame=function(now){if(boundProgram!==prog)applyUniform();return before(now);};
  window.__madPlanetThermalDisplay={setEnabled,isEnabled:()=>enabled};
})();