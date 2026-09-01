/* ============ 0.5.116: schematic orbit / axial-tilt overlay ============ */
/*
   Drawn on a tiny transparent 2D canvas instead of the WebGL planet pass so
   enabling the diagram has negligible GPU cost. This module is loaded after
   render.js but before runtime-settings.js. runtime-settings therefore feeds
   its scaled simulation clock into this drawFrame wrapper automatically.
*/
(function installOrbitOverlay(){
  if(typeof document==='undefined'||typeof drawFrame!=='function')return;

  const wrap=document.createElement('div');
  wrap.id='orbitOverlay';wrap.className='orbit-overlay';wrap.setAttribute('aria-hidden','true');
  const canvas=document.createElement('canvas');canvas.width=520;canvas.height=360;
  const text=document.createElement('div');text.className='orbit-overlay-text';
  wrap.append(canvas,text);document.body.appendChild(wrap);
  const ctx=canvas.getContext('2d',{alpha:true});

  const style=document.createElement('style');style.id='madplanet-orbit-overlay-style';
  style.textContent=`
    .orbit-overlay{position:fixed;z-index:6;right:calc(var(--safe-b) + 112px);top:calc(var(--safe-t) + 50px);width:260px;height:196px;display:none;pointer-events:none;border:1px solid rgba(159,194,255,.14);border-radius:13px;background:rgba(7,12,20,.48);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 4px 22px rgba(0,0,0,.30);overflow:hidden}
    .orbit-overlay.on{display:block}.orbit-overlay canvas{display:block;width:260px;height:160px}.orbit-overlay-text{height:36px;padding:1px 10px 7px;font:9px/1.35 var(--mono);color:rgba(232,237,245,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.orbit-overlay-text b{font-weight:500;color:var(--acc)}
    @media(max-width:700px){.orbit-overlay{right:8px;top:calc(var(--safe-t) + 48px);width:220px;height:172px}.orbit-overlay canvas{width:220px;height:140px}.orbit-overlay-text{height:32px;font-size:8px;padding:0 8px 5px}}
  `;document.head.appendChild(style);

  let enabled=false;
  const btn=()=>document.getElementById('orbitOverlayBtn');
  function setEnabled(on){
    enabled=!!on;wrap.classList.toggle('on',enabled);wrap.setAttribute('aria-hidden',String(!enabled));
    const b=btn();if(b){b.classList.toggle('orbit-enabled',enabled);b.setAttribute('aria-pressed',String(enabled));b.title=enabled?'Скрыть орбиту':'Показать орбиту';b.setAttribute('aria-label',b.title);}
    if(!enabled){ctx.clearRect(0,0,canvas.width,canvas.height);text.textContent='';}
  }
  function toggle(){setEnabled(!enabled);}
  function bindButton(){const b=btn();if(b&&!b.dataset.orbitBound){b.dataset.orbitBound='1';b.addEventListener('click',toggle);}}
  bindButton();

  function line(x1,y1,x2,y2,stroke,width=1,dash=null){
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=stroke;ctx.lineWidth=width;
    ctx.setLineDash(dash||[]);ctx.stroke();ctx.setLineDash([]);
  }
  function circle(x,y,r,fill,stroke=null,width=1){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  function label(s,x,y,fill='rgba(232,237,245,.68)',align='left'){
    ctx.fillStyle=fill;ctx.font='18px ui-monospace, monospace';ctx.textAlign=align;ctx.fillText(s,x,y);
  }
  function resizeBacking(){
    const rect=canvas.getBoundingClientRect();const dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
    const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);return {w:rect.width,h:rect.height};
  }
  let staticKey='',cached={tilt:0,period:SEASONS_EARTH_YEAR_SEC,au:1};
  function staticOrbitData(){
    const key=[state.seed,state.axialTilt,state.distance,state.star,state.luminosity].join('|');
    if(key===staticKey)return cached;staticKey=key;
    const tilt=(typeof seasonAxialTiltDeg==='function')?seasonAxialTiltDeg(null):((typeof axialTiltDeg==='function')?axialTiltDeg(state.axialTilt):0);
    const period=(typeof seasonOrbitalPeriodSec==='function')?seasonOrbitalPeriodSec(null):SEASONS_EARTH_YEAR_SEC;
    const au=(typeof orbitDistanceAU==='function')?orbitDistanceAU(state.distance):1;
    cached={tilt,period,au};return cached;
  }
  function draw(simNowMs){
    if(!enabled||!ctx)return;
    const sz=resizeBacking(),w=sz.w,h=sz.h;ctx.clearRect(0,0,w,h);
    const d=staticOrbitData();
    const simSec=(Number(simNowMs)-Number(t0))/1000;
    const phase=(typeof seasonOrbitPhaseRad==='function')?seasonOrbitPhaseRad(state.seed,simSec,{orbitalPeriodSec:d.period}):0;
    const frac=((phase/(Math.PI*2))%1+1)%1;
    const decl=(typeof seasonDeclinationRadForPhase==='function')?seasonDeclinationRadForPhase(phase,d.tilt)*180/Math.PI:0;

    const cx=w*0.43,cy=h*0.49,rx=w*0.32,ry=h*0.205;
    ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,-0.12,0,Math.PI*2);ctx.strokeStyle='rgba(159,194,255,.38)';ctx.lineWidth=1;ctx.stroke();
    line(cx-rx-8,cy,cx+rx+8,cy,'rgba(159,194,255,.13)',1,[4,5]);
    label('плоскость орбиты',cx-rx,cy+ry+22,'rgba(139,150,168,.62)','left');

    /* Quarter-phase marks: two equinoxes and two solstices. */
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2,x=cx+rx*Math.cos(a),y=cy+ry*Math.sin(a);
      circle(x,y,2.0,'rgba(159,194,255,.38)');
    }

    circle(cx,cy,8,'rgba(232,163,92,.92)');
    circle(cx,cy,13,'rgba(232,163,92,.09)','rgba(232,163,92,.24)');
    label('звезда',cx,cy-17,'rgba(232,163,92,.72)','center');

    const px=cx+rx*Math.cos(phase),py=cy+ry*Math.sin(phase);
    line(px,py,cx,cy,'rgba(232,237,245,.16)',1,[3,4]);
    circle(px,py,5.2,'rgba(159,194,255,.95)','rgba(232,237,245,.8)');

    /* Dashed orbital normal and solid spin axis. The spin axis keeps a fixed
       inertial direction in this schematic, so the season changes as the
       planet travels around the star rather than by rotating the axis itself. */
    const L=26,normal=-Math.PI/2,axis=normal+d.tilt*Math.PI/180;
    line(px+Math.cos(normal)*L,py+Math.sin(normal)*L,px-Math.cos(normal)*L,py-Math.sin(normal)*L,'rgba(139,150,168,.45)',1,[3,3]);
    line(px+Math.cos(axis)*L,py+Math.sin(axis)*L,px-Math.cos(axis)*L,py-Math.sin(axis)*L,'rgba(232,237,245,.86)',1.4);
    const axx=px+Math.cos(axis)*L,axy=py+Math.sin(axis)*L;
    label('ось',axx+4,axy-3,'rgba(232,237,245,.72)','left');

    /* Small tilt arc. */
    ctx.beginPath();ctx.arc(px,py,17,normal,axis,d.tilt<0);ctx.strokeStyle='rgba(232,163,92,.70)';ctx.lineWidth=1;ctx.stroke();
    label(d.tilt.toFixed(1)+'°',px+20,py-12,'rgba(232,163,92,.82)','left');

    const season=(typeof seasonLabel==='function')?seasonLabel(frac):('фаза '+Math.round(frac*100)+'%');
    const yearDays=d.period/86400;
    text.innerHTML='<b>'+season+'</b> · δ '+(decl>=0?'+':'')+decl.toFixed(1)+'°<br>'+d.au.toFixed(2)+' AU · год '+yearDays.toFixed(yearDays<100?1:0)+' сут';
  }

  const drawFrameBeforeOrbitOverlay=drawFrame;
  drawFrame=function(now){
    const result=drawFrameBeforeOrbitOverlay(now);draw(now);return result;
  };

  window.__madPlanetOrbitOverlay={setEnabled,toggle,isEnabled:()=>enabled};
})();
