/* ============ 0.5.118 / 0.5.121: stabilized orbit line in the main scene ============ */
/*
   The 0.5.118 implementation solved the ellipse radius from the projected
   star-to-planet separation. That construction is singular: looking almost
   along the star direction drives the separation toward zero, while an
   edge-on projected plane divides by a tiny minor axis and can explode to
   several screens. It also lets numerical perspective error move the orbit
   away from the planet centre.

   0.5.121 switches the main-scene line to an Elite-like navigation HUD model:
   the physical ecliptic orientation is still respected, but astronomical
   distance is intentionally normalized to a fixed screen-space radius. The
   current planet is the t=0 point of the orbit and is therefore guaranteed to
   project to the exact screen centre every frame. Rotating the camera changes
   only the ellipse orientation/flattening, never its major-axis size. Looking
   directly toward/away from the star correctly collapses the orbit toward a
   straight line through the planet instead of a tiny or displaced ring.
*/
(function installOrbitScenePath(){
  if(typeof document==='undefined'||typeof drawFrame!=='function')return;
  const orbitWindow=document.getElementById('orbitOverlay');
  if(!orbitWindow)return;

  const STORAGE_KEY='madPlanet.orbitOverlay.scenePath.v1';
  const HUD_RADIUS_FRACTION=0.23;
  const HUD_RADIUS_MIN_PX=72;
  const HUD_RADIUS_MAX_PX=260;
  const ORBIT_SAMPLES=176;
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
    toggle.title=enabled?'Скрыть орбитальную линию в основной сцене':'Показать орбитальную линию в основной сцене';
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
  function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function resize(){
    const dpr=Math.min(1.5,Math.max(1,devicePixelRatio||1));
    const w=Math.max(1,Math.round(innerWidth*dpr)),h=Math.max(1,Math.round(innerHeight*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);return {w:innerWidth,h:innerHeight};
  }
  function cameraBasis(){
    /* Orientation only. Deliberately omit cam.dist: zoom must never resize the
       navigation orbit. */
    const cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
    const pos=[cp*Math.sin(cam.yaw),sp,cp*Math.cos(cam.yaw)];
    const fwd=norm([-pos[0],-pos[1],-pos[2]]);
    const ref=Math.abs(fwd[1])>0.96?[1,0,0]:[0,1,0];
    const rgt=norm(cross(fwd,ref)),up=cross(rgt,fwd);
    return {fwd,rgt,up};
  }
  function desiredOrbitNormal(){
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
  function orbitNormalThroughRadial(desired,radial){
    /* A planet-star radius vector must lie in the orbital plane. Project the
       physical ecliptic normal perpendicular to that radius so the displayed
       circle contains the current planet exactly. */
    const k=dot(desired,radial);
    let n=[desired[0]-radial[0]*k,desired[1]-radial[1]*k,desired[2]-radial[2]*k];
    if(Math.hypot(n[0],n[1],n[2])<1e-5){
      const ref=Math.abs(radial[1])<0.90?[0,1,0]:[1,0,0];
      n=cross(radial,ref);
    }
    return norm(n);
  }
  function projectUnit(v,basis){return [dot(v,basis.rgt),-dot(v,basis.up)];}
  function hudRadius(sz){
    const minSide=Math.min(sz.w,sz.h);
    return Math.min(HUD_RADIUS_MAX_PX,Math.max(HUD_RADIUS_MIN_PX,minSide*HUD_RADIUS_FRACTION));
  }
  function makeGeometry(sz,basis,sun){
    const planetScreen=[sz.w*0.5,sz.h*0.5];
    const radial=norm([-sun[0],-sun[1],-sun[2]]); /* star -> current planet */
    const n=orbitNormalThroughRadial(desiredOrbitNormal(),radial);
    const tangent=norm(cross(n,radial));
    const r2=projectUnit(radial,basis),t2=projectUnit(tangent,basis);
    const radius=hudRadius(sz);
    const center=[planetScreen[0]-radius*r2[0],planetScreen[1]-radius*r2[1]];
    const points=[];
    for(let i=0;i<=ORBIT_SAMPLES;i++){
      const a=2*Math.PI*i/ORBIT_SAMPLES,c=Math.cos(a),s=Math.sin(a);
      const p3=[radial[0]*c+tangent[0]*s,radial[1]*c+tangent[1]*s,radial[2]*c+tangent[2]*s];
      const p2=projectUnit(p3,basis);
      const depth=dot(sub(p3,radial),basis.fwd);
      points.push({x:center[0]+radius*p2[0],y:center[1]+radius*p2[1],depth});
    }
    /* t=0 is the current planet. Force the last sub-pixel error away so the
       orbit can never appear to float above/below the planet centre. */
    points[0].x=planetScreen[0];points[0].y=planetScreen[1];
    points[points.length-1].x=planetScreen[0];points[points.length-1].y=planetScreen[1];
    return {planetScreen,center,points,radius,normal:n};
  }
  function pathAll(points){
    ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
    for(let i=1;i<points.length;i++)ctx.lineTo(points[i].x,points[i].y);
  }
  function pathDepth(points,near){
    ctx.beginPath();
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],d=0.5*(a.depth+b.depth);
      if((near&&d<=0)||(!near&&d>0)){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}
    }
  }
  function drawNode(x,y,r,fill){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();}
  let wasVisible=false;
  function clear(){if(wasVisible&&ctx){ctx.clearRect(0,0,canvas.width,canvas.height);}wasVisible=false;canvas.classList.remove('on');}
  function draw(){
    const orbitMode=!!window.__madPlanetOrbitOverlay?.isEnabled?.();
    if(!enabled||!orbitMode||!ctx||typeof cam==='undefined'||typeof world==='undefined'){clear();return;}
    const sz=resize(),basis=cameraBasis();ctx.clearRect(0,0,sz.w,sz.h);
    const sun=norm([Math.cos(sunEl)*Math.sin(sunAz),Math.sin(sunEl),Math.cos(sunEl)*Math.cos(sunAz)]);
    const g=makeGeometry(sz,basis,sun),pts=g.points;

    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    /* Soft amber bloom + dim dashed far side + crisp near side. This is HUD
       styling, not emissive world geometry, and therefore remains readable on
       both day and night hemispheres. */
    pathAll(pts);ctx.setLineDash([]);ctx.strokeStyle='rgba(255,170,72,.10)';ctx.lineWidth=7;ctx.stroke();
    pathDepth(pts,false);ctx.setLineDash([4,5]);ctx.strokeStyle='rgba(255,184,88,.34)';ctx.lineWidth=1.15;ctx.stroke();
    pathDepth(pts,true);ctx.setLineDash([]);ctx.strokeStyle='rgba(255,191,101,.82)';ctx.lineWidth=1.65;ctx.stroke();
    pathDepth(pts,true);ctx.strokeStyle='rgba(255,221,166,.36)';ctx.lineWidth=.65;ctx.stroke();

    /* Quarter-orbit reference pips are deliberately tiny, closer to Elite's
       navigation symbology than to a scientific plot. */
    for(const k of [Math.round(ORBIT_SAMPLES/4),Math.round(ORBIT_SAMPLES/2),Math.round(3*ORBIT_SAMPLES/4)]){
      const p=pts[k];drawNode(p.x,p.y,1.65,'rgba(255,193,105,.58)');
    }

    /* Current body crossing: always exactly the screen centre. */
    const c=g.planetScreen;
    drawNode(c[0],c[1],5.0,'rgba(255,171,68,.10)');
    drawNode(c[0],c[1],2.15,'rgba(184,211,255,.92)');
    ctx.beginPath();ctx.arc(c[0],c[1],4.0,0,Math.PI*2);ctx.strokeStyle='rgba(255,202,126,.62)';ctx.lineWidth=.8;ctx.stroke();

    if(sz.w>420){
      const labelPoint=pts[Math.round(ORBIT_SAMPLES*0.56)];
      ctx.font='8px ui-monospace,monospace';ctx.fillStyle='rgba(255,194,108,.50)';ctx.textAlign='left';
      ctx.fillText('ОРБИТА',labelPoint.x+6,labelPoint.y-5);
    }
    ctx.restore();

    canvas.classList.add('on');wasVisible=true;
  }

  const before=drawFrame;
  drawFrame=function(now){const r=before(now);draw();return r;};
  window.__madPlanetOrbitScenePath={setEnabled,isEnabled:()=>enabled};
})();