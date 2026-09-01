/* ============ 0.5.117: projected ecliptic/equator instrument ============ */
(function installEclipticOverlay(){
  if(typeof document==='undefined'||typeof drawFrame!=='function')return;

  const canvas=document.createElement('canvas');canvas.id='eclipticOverlay';canvas.setAttribute('aria-hidden','true');
  const style=document.createElement('style');style.id='madplanet-ecliptic-overlay-style';
  style.textContent=`
    #eclipticOverlay{position:fixed;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;display:none}
    #eclipticOverlay.on{display:block}
  `;document.head.appendChild(style);document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d',{alpha:true});
  let enabled=false;

  function button(){return document.getElementById('eclipticOverlayBtn');}
  function syncButton(){const b=button();if(!b)return;b.classList.toggle('tool-enabled',enabled);b.setAttribute('aria-pressed',String(enabled));b.title=enabled?'Скрыть эклиптику':'Показать эклиптику';b.setAttribute('aria-label',b.title);}
  function setEnabled(on){enabled=!!on;canvas.classList.toggle('on',enabled);syncButton();if(!enabled&&ctx)ctx.clearRect(0,0,canvas.width,canvas.height);}
  function bind(){const b=button();if(b&&!b.dataset.eclipticBound){b.dataset.eclipticBound='1';b.addEventListener('click',()=>setEnabled(!enabled));syncButton();}}
  bind();

  function norm(v){const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l];}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function resize(){const dpr=Math.min(2,Math.max(1,devicePixelRatio||1));const w=Math.max(1,Math.round(innerWidth*dpr)),h=Math.max(1,Math.round(innerHeight*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}ctx.setTransform(dpr,0,0,dpr,0,0);return {w:innerWidth,h:innerHeight};}
  function projectedBasis(){
    const cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
    const pos=[cam.dist*cp*Math.sin(cam.yaw),cam.dist*sp,cam.dist*cp*Math.cos(cam.yaw)];
    const fwd=norm([-pos[0],-pos[1],-pos[2]]),rgt=norm(cross(fwd,[0,1,0])),up=cross(rgt,fwd);
    return {fwd,rgt,up};
  }
  function drawPlane(cx,cy,r,n,basis,stroke,label,dash){
    const nx=dot(n,basis.rgt),ny=-dot(n,basis.up),nz=Math.abs(dot(n,basis.fwd));
    const angle=Math.atan2(ny,nx)+Math.PI/2,minor=r*Math.max(0.035,Math.min(1,nz));
    ctx.beginPath();ctx.ellipse(cx,cy,r,minor,angle,0,Math.PI*2);ctx.strokeStyle=stroke;ctx.lineWidth=1.25;ctx.setLineDash(dash||[]);ctx.stroke();ctx.setLineDash([]);
    const lx=cx+Math.cos(angle)*r*0.72,ly=cy+Math.sin(angle)*r*0.72;
    ctx.fillStyle=stroke;ctx.font='10px ui-monospace,monospace';ctx.textAlign='left';ctx.fillText(label,lx+5,ly-4);
  }
  function draw(){
    if(!enabled||!ctx)return;const sz=resize();ctx.clearRect(0,0,sz.w,sz.h);
    if(typeof cam==='undefined'||typeof world==='undefined'||!world.axis)return;
    const basis=projectedBasis(),axis=norm(world.axis);
    let ref=Math.abs(axis[1])<0.92?[0,1,0]:[1,0,0];let e1=norm(cross(axis,ref));
    const tilt=((typeof planetPhysics==='function'?planetPhysics().axialTiltDeg:0)||0)*Math.PI/180;
    const ecl=norm([axis[0]*Math.cos(tilt)+e1[0]*Math.sin(tilt),axis[1]*Math.cos(tilt)+e1[1]*Math.sin(tilt),axis[2]*Math.cos(tilt)+e1[2]*Math.sin(tilt)]);
    const cx=sz.w/2,cy=sz.h/2;
    const denom=Math.sqrt(Math.max(0.05,cam.dist*cam.dist-1));
    const r=Math.min(sz.h*0.44,sz.h*((typeof FOCAL==='number'?FOCAL:1)/denom));
    drawPlane(cx,cy,r,axis,basis,'rgba(159,194,255,.52)','экватор',[4,4]);
    drawPlane(cx,cy,r,ecl,basis,'rgba(232,163,92,.78)','эклиптика',null);
    const axx=dot(axis,basis.rgt),axy=-dot(axis,basis.up),al=Math.hypot(axx,axy);
    if(al>0.02){const ux=axx/al,uy=axy/al;ctx.beginPath();ctx.moveTo(cx-ux*r*1.12,cy-uy*r*1.12);ctx.lineTo(cx+ux*r*1.12,cy+uy*r*1.12);ctx.strokeStyle='rgba(232,237,245,.78)';ctx.lineWidth=1.15;ctx.stroke();ctx.fillStyle='rgba(232,237,245,.72)';ctx.font='10px ui-monospace,monospace';ctx.fillText('ось',cx+ux*r*1.12+5,cy+uy*r*1.12-4);}
    ctx.fillStyle='rgba(232,163,92,.78)';ctx.font='10px ui-monospace,monospace';ctx.fillText('ε '+(tilt*180/Math.PI).toFixed(1)+'°',cx+r*0.08,cy-r*0.08);
  }

  const before=drawFrame;drawFrame=function(now){const r=before(now);draw();return r;};
  window.__madPlanetEclipticOverlay={setEnabled,isEnabled:()=>enabled};
})();