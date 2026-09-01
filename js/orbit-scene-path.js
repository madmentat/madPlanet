/* ============ 0.5.118: schematic orbit line in the main scene ============ */
/*
   The mini-map remains the authoritative orbit diagram. This optional layer is
   deliberately schematic: it projects a thin orbit ellipse around the visible
   system star and constrains that ellipse to pass through the screen-centre
   planet. The ellipse orientation follows the physical ecliptic plane, but its
   apparent radius is chosen for readability rather than astronomical scale.

   Display state is local UI policy only. Closing Orbit hides this layer even
   when its toggle remains armed for the next time the window is opened.
*/
(function installOrbitScenePath(){
  if(typeof document==='undefined'||typeof drawFrame!=='function')return;
  const orbitWindow=document.getElementById('orbitOverlay');
  if(!orbitWindow)return;

  const STORAGE_KEY='madPlanet.orbitOverlay.scenePath.v1';
  let enabled=false;
  try{enabled=localStorage.getItem(STORAGE_KEY)==='1';}catch(_e){}

  const canvas=document.createElement('canvas');
  canvas.id='orbitScenePath';
  canvas.setAttribute('aria-hidden','true');
  document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d',{alpha:true});

  const style=document.createElement('style');style.id='madplanet-orbit-scene-path-style';
  style.textContent=`
    #orbitScenePath{position:fixed;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;display:none}
    #orbitScenePath.on{display:block}
    .orbit-overlay{height:256px!important}
    .orbit-scene-control{height:30px;display:flex;align-items:center;border-top:1px solid rgba(159,194,255,.10);padding:0 9px}
    .orbit-scene-toggle{width:100%;height:24px;border:0;background:transparent;color:rgba(139,150,168,.88);font:9px var(--sans);display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;padding:0 2px}
    .orbit-scene-toggle:hover{color:var(--txt)}
    .orbit-scene-switch{position:relative;width:30px;height:16px;flex:0 0 30px;border-radius:10px;border:1px solid rgba(159,194,255,.26);background:rgba(255,255,255,.04);transition:background .15s,border-color .15s}
    .orbit-scene-switch::after{content:'';position:absolute;width:10px;height:10px;left:2px;top:2px;border-radius:50%;background:rgba(232,237,245,.56);transition:transform .15s,background .15s}
    .orbit-scene-toggle[aria-pressed='true'] .orbit-scene-switch{background:rgba(232,163,92,.18);border-color:rgba(232,163,92,.52)}
    .orbit-scene-toggle[aria-pressed='true'] .orbit-scene-switch::after{transform:translateX(14px);background:var(--warm)}
    @media(max-width:700px){.orbit-overlay{height:232px!important}}
    @media(prefers-reduced-motion:reduce){.orbit-scene-switch,.orbit-scene-switch::after{transition:none}}
  `;document.head.appendChild(style);

  const row=document.createElement('div');row.className='orbit-scene-control';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='orbit-scene-toggle';
  toggle.innerHTML='<span>Орбита в основной сцене</span><i class="orbit-scene-switch" aria-hidden="true"></i>';
  row.appendChild(toggle);orbitWindow.appendChild(row);

  function syncToggle(){
    toggle.setAttribute('aria-pressed',String(enabled));
    toggle.title=enabled?'Скрыть условную орбиту в основной сцене':'Показать условную орбиту вокруг звезды';
    toggle.setAttribute('aria-label',toggle.title);
  }
  function setEnabled(on){
    enabled=!!on;syncToggle();
    try{localStorage.setItem(STORAGE_KEY,enabled?'1':'0');}catch(_e){}
    if(!enabled){canvas.classList.remove('on');if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height);}
  }
  toggle.addEventListener('click',()=>setEnabled(!enabled));syncToggle();

  function norm(v){const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l];}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function resize(){
    const dpr=Math.min(1.5,Math.max(1,devicePixelRatio||1));
    const w=Math.max(1,Math.round(innerWidth*dpr)),h=Math.max(1,Math.round(innerHeight*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);return {w:innerWidth,h:innerHeight};
  }
  function cameraBasis(){
    const cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
    const pos=[cam.dist*cp*Math.sin(cam.yaw),cam.dist*sp,cam.dist*cp*Math.cos(cam.yaw)];
    const fwd=norm([-pos[0],-pos[1],-pos[2]]),rgt=norm(cross(fwd,[0,1,0])),up=cross(rgt,fwd);
    return {fwd,rgt,up};
  }
  function orbitNormal(){
    const axis=norm(world.axis||[0,1,0]);
    const ref=Math.abs(axis[1])<0.92?[0,1,0]:[1,0,0];
    const side=norm(cross(axis,ref));
    const tilt=((typeof planetPhysics==='function'?planetPhysics().axialTiltDeg:0)||0)*Math.PI/180;
    return norm([
      axis[0]*Math.cos(tilt)+side[0]*Math.sin(tilt),
      axis[1]*Math.cos(tilt)+side[1]*Math.sin(tilt),
      axis[2]*Math.cos(tilt)+side[2]*Math.sin(tilt)
    ]);
  }
  function pointOnEllipse(cx,cy,a,q,ang,t){
    const ca=Math.cos(ang),sa=Math.sin(ang),x=a*Math.cos(t),y=a*q*Math.sin(t);
    return [cx+x*ca-y*sa,cy+x*sa+y*ca];
  }
  function strokeArc(cx,cy,a,q,ang,t0,t1,stroke,width,dash){
    ctx.beginPath();
    const N=72;
    for(let i=0;i<=N;i++){
      const t=t0+(t1-t0)*(i/N),p=pointOnEllipse(cx,cy,a,q,ang,t);
      if(i===0)ctx.moveTo(p[0],p[1]);else ctx.lineTo(p[0],p[1]);
    }
    ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.setLineDash(dash||[]);ctx.stroke();ctx.setLineDash([]);
  }
  let wasVisible=false;
  function clear(){if(wasVisible&&ctx){ctx.clearRect(0,0,canvas.width,canvas.height);}wasVisible=false;canvas.classList.remove('on');}
  function draw(){
    const orbitMode=!!window.__madPlanetOrbitOverlay?.isEnabled?.();
    if(!enabled||!orbitMode||!ctx||typeof cam==='undefined'||typeof world==='undefined'){clear();return;}
    const sz=resize(),basis=cameraBasis();ctx.clearRect(0,0,sz.w,sz.h);
    const sun=norm([Math.cos(sunEl)*Math.sin(sunAz),Math.sin(sunEl),Math.cos(sunEl)*Math.cos(sunAz)]);
    const z=dot(sun,basis.fwd);
    if(z<=0.035){clear();return;}
    const sx=sz.w*0.5+(FOCAL*dot(sun,basis.rgt)/z)*sz.h;
    const sy=sz.h*0.5-(FOCAL*dot(sun,basis.up)/z)*sz.h;
    if(Math.abs(sx-sz.w*0.5)>sz.w*3||Math.abs(sy-sz.h*0.5)>sz.h*3){clear();return;}

    const n=orbitNormal();
    const nx=dot(n,basis.rgt),ny=-dot(n,basis.up),nz=Math.abs(dot(n,basis.fwd));
    const ang=Math.atan2(ny,nx)+Math.PI/2;
    const q=Math.max(0.12,Math.min(1,nz));
    const dx=sz.w*0.5-sx,dy=sz.h*0.5-sy,ca=Math.cos(ang),sa=Math.sin(ang);
    const ex=dx*ca+dy*sa,ey=-dx*sa+dy*ca;
    let a=Math.sqrt(ex*ex+(ey*ey)/(q*q));
    a=Math.max(26,Math.min(a,Math.max(sz.w,sz.h)*3.5));

    /* faint halo plus dashed far side / solid near side: this makes the line
       read like an instrument field line without pretending it is to scale. */
    ctx.save();
    strokeArc(sx,sy,a,q,ang,0,Math.PI*2,'rgba(232,163,92,.11)',5,null);
    strokeArc(sx,sy,a,q,ang,Math.PI,Math.PI*2,'rgba(232,163,92,.34)',1.1,[5,6]);
    strokeArc(sx,sy,a,q,ang,0,Math.PI,'rgba(232,163,92,.72)',1.35,null);
    ctx.restore();

    /* The planet is the current observer and therefore lies on the schematic
       trajectory at screen centre. A small tick makes that relation explicit
       without drawing over the whole planet. */
    const theta=Math.atan2(ey/q,ex);
    const p=pointOnEllipse(sx,sy,a,q,ang,theta);
    ctx.beginPath();ctx.arc(p[0],p[1],3.2,0,Math.PI*2);ctx.fillStyle='rgba(159,194,255,.92)';ctx.fill();
    ctx.beginPath();ctx.arc(sx,sy,4.2,0,Math.PI*2);ctx.fillStyle='rgba(232,163,92,.90)';ctx.fill();
    ctx.font='9px ui-monospace,monospace';ctx.fillStyle='rgba(232,163,92,.68)';ctx.textAlign='left';ctx.fillText('орбита · схема',sx+8,sy-7);

    canvas.classList.add('on');wasVisible=true;
  }

  const before=drawFrame;
  drawFrame=function(now){const r=before(now);draw();return r;};
  window.__madPlanetOrbitScenePath={setEnabled,isEnabled:()=>enabled};
})();