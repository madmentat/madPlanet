/* ============ 0.5.117 / 0.5.120 / 0.5.122: thermal imager display mode ============ */
(function installThermalDisplay(){
  if(typeof document==='undefined'||typeof drawFrame!=='function'||typeof gl==='undefined')return;
  let enabled=false,boundProgram=null,loc=null;
  const POS_KEY='madPlanet.thermalLegend.pos.v1';

  const legend=document.createElement('div');legend.id='thermalLegend';legend.setAttribute('aria-hidden','true');
  legend.innerHTML='<div class="thermal-scale"></div><div class="thermal-labels"><span style="left:0%">−190 °C</span><span style="left:41%">0 °C</span><span style="left:76%">+100 °C</span><span style="left:93%">+700 °C</span><span style="left:100%">+1200 °C</span></div><div class="thermal-caption">температура поверхности · Weather Core + активная лава</div>';
  const style=document.createElement('style');style.id='madplanet-thermal-style';
  style.textContent=`
    #thermalLegend{position:fixed;z-index:6;left:18px;bottom:calc(var(--safe-b) + 54px);width:250px;padding:8px 10px 7px;border:1px solid rgba(159,194,255,.14);border-radius:10px;background:rgba(7,12,20,.56);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;pointer-events:auto;touch-action:none;cursor:grab;box-shadow:0 4px 20px rgba(0,0,0,.28)}
    #thermalLegend.on{display:block}#thermalLegend.dragging{cursor:grabbing;border-color:rgba(159,194,255,.32)}
    .thermal-scale{height:8px;border-radius:5px;background:linear-gradient(90deg,rgb(20,3,38) 0%,rgb(20,31,158) 20%,rgb(0,194,230) 42%,rgb(250,230,31) 64%,rgb(245,46,8) 84%,rgb(255,247,229) 100%)}
    .thermal-labels{position:relative;height:13px;margin-top:4px;font:7.5px var(--mono);color:rgba(232,237,245,.72)}.thermal-labels span{position:absolute;transform:translateX(-50%);white-space:nowrap}.thermal-labels span:first-child{transform:none}.thermal-labels span:last-child{transform:translateX(-100%)}
    .thermal-caption{margin-top:3px;font:8px/1.2 var(--sans);letter-spacing:.035em;color:rgba(139,150,168,.76)}
    @media(max-width:700px){#thermalLegend{left:8px;bottom:calc(var(--safe-b) + 150px);width:230px}.thermal-labels{font-size:7px}}
  `;document.head.appendChild(style);document.body.appendChild(legend);

  function clampPosition(x,y){
    const r=legend.getBoundingClientRect(),m=4;
    const maxX=Math.max(m,innerWidth-r.width-m),maxY=Math.max(m,innerHeight-r.height-m);
    return [Math.max(m,Math.min(maxX,x)),Math.max(m,Math.min(maxY,y))];
  }
  function applyPosition(x,y,save=false){
    const p=clampPosition(x,y);legend.style.left=p[0]+'px';legend.style.top=p[1]+'px';legend.style.right='auto';legend.style.bottom='auto';
    if(save){try{localStorage.setItem(POS_KEY,JSON.stringify({x:p[0],y:p[1]}));}catch(_e){}}
  }
  function restorePosition(){
    try{
      const p=JSON.parse(localStorage.getItem(POS_KEY)||'null');
      if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)){requestAnimationFrame(()=>applyPosition(p.x,p.y,false));return true;}
    }catch(_e){}
    return false;
  }
  let drag=null;
  legend.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    const r=legend.getBoundingClientRect();drag={id:e.pointerId,dx:e.clientX-r.left,dy:e.clientY-r.top};
    legend.classList.add('dragging');legend.setPointerCapture?.(e.pointerId);e.preventDefault();
  });
  legend.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;applyPosition(e.clientX-drag.dx,e.clientY-drag.dy,false);e.preventDefault();});
  function endDrag(e){
    if(!drag||e.pointerId!==drag.id)return;
    const r=legend.getBoundingClientRect();applyPosition(r.left,r.top,true);legend.classList.remove('dragging');drag=null;
  }
  legend.addEventListener('pointerup',endDrag);legend.addEventListener('pointercancel',endDrag);
  addEventListener('resize',()=>{if(legend.style.top){const r=legend.getBoundingClientRect();applyPosition(r.left,r.top,false);}});
  restorePosition();

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
