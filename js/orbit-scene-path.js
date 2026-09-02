/* ============ 0.5.118 / 0.5.121 / 0.5.122: stabilized Keplerian orbit HUD ============ */
/*
   Main-scene orbit is navigation symbology, not astronomical scale. Its major
   axis stays fixed in screen space, but the shape and focus now use the same
   seeded eccentricity/Kepler solution as the seasonal physics. The current
   planet is forced to exact screen centre every frame. The schematic sun is
   drawn last at the orbital focus, naturally occluding the line behind it.
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
  canvas.id='orbitScenePath';canvas.setAttribute('aria-hidden','true');document.body.appendChild(canvas);
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
    const cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
    const pos=[cp*Math.sin(cam.yaw),sp,cp*Math.cos(cam.yaw)];
    const fwd=norm([-pos[0],-pos[1],-pos[2]]);
    const ref=Math.abs(fwd[1])>0.96?[1,0,0]:[0,1,0];
    const rgt=norm(cross(fwd,ref)),up=cross(rgt,fwd);return {fwd,rgt,up};
  }
  function desiredOrbitNormal(){
    const axis=norm(world.axis||[0,1,0]);
    const ref=Math.abs(axis[1])<0.92?[0,1,0]:[1,0,0];
    const side=norm(cross(axis,ref));
    const tilt=((typeof planetPhysics==='function'?planetPhysics().axialTiltDeg:0)||0)*Math.PI/180;
    return norm([axis[0]*Math.cos(tilt)+side[0]*Math.sin(tilt),axis[1]*Math.cos(tilt)+side[1]*Math.sin(tilt),axis[2]*Math.cos(tilt)+side[2]*Math.sin(tilt)]);
  }
  function orbitNormalThroughRadial(desired,radial){
    const k=dot(desired,radial);
    let n=[desired[0]-radial[0]*k,desired[1]-radial[1]*k,desired[2]-radial[2]*k];
    if(Math.hypot(n[0],n[1],n[2])<1e-5){const ref=Math.abs(radial[1])<0.90?[0,1,0]:[1,0,0];n=cross(radial,ref);}
    return norm(n);
  }
  function projectUnit(v,basis){return [dot(v,basis.rgt),-dot(v,basis.up)];}
  function hudRadius(sz){return Math.min(HUD_RADIUS_MAX_PX,Math.max(HUD_RADIUS_MIN_PX,Math.min(sz.w,sz.h)*HUD_RADIUS_FRACTION));}
  function mul(a,k){return [a[0]*k,a[1]*k,a[2]*k];}
  function add(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}

  function orbitState(simNowMs){
    const simSec=(Number(simNowMs)-Number(t0))/1000;
    const a=(typeof orbitDistanceAU==='function')?orbitDistanceAU(state.distance):1;
    const e=(typeof orbitEccentricityForSeed==='function')?orbitEccentricityForSeed(state.seed):0;
    const period=(typeof seasonOrbitalPeriodSec==='function')?seasonOrbitalPeriodSec({}):SEASONS_EARTH_YEAR_SEC;
    if(typeof eccentricSeasonState==='function')return eccentricSeasonState(state.seed,simSec,{orbitalPeriodSec:period,semiMajorAxisAU:a,orbitalEccentricity:e});
    const M=(typeof seasonOrbitPhaseRad==='function')?seasonOrbitPhaseRad(state.seed,simSec,{orbitalPeriodSec:period}):0;
    return orbitStateFromMeanAnomaly(a,e,M);
  }
  function makeGeometry(sz,basis,sun,o){
    const planetScreen=[sz.w*0.5,sz.h*0.5];
    const radial=norm([-sun[0],-sun[1],-sun[2]]);
    const n=orbitNormalThroughRadial(desiredOrbitNormal(),radial);
    const tangent=norm(cross(n,radial));
    const nu=o.trueAnomaly,c=Math.cos(nu),s=Math.sin(nu);
    const peri=norm(add(mul(radial,c),mul(tangent,-s)));
    const quad=norm(add(mul(radial,s),mul(tangent,c)));
    const b=Math.sqrt(Math.max(0.04,1-o.e*o.e));
    const current=add(mul(peri,Math.cos(o.eccentricAnomaly)-o.e),mul(quad,b*Math.sin(o.eccentricAnomaly)));
    const radius=hudRadius(sz),cur2=projectUnit(current,basis);
    const starScreen=[planetScreen[0]-radius*cur2[0],planetScreen[1]-radius*cur2[1]];
    const points=[];
    for(let i=0;i<=ORBIT_SAMPLES;i++){
      const E=2*Math.PI*i/ORBIT_SAMPLES;
      const p3=add(mul(peri,Math.cos(E)-o.e),mul(quad,b*Math.sin(E)));
      const p2=projectUnit(p3,basis),depth=dot(sub(p3,current),basis.fwd);
      points.push({x:starScreen[0]+radius*p2[0],y:starScreen[1]+radius*p2[1],depth});
    }
    let nearest=0,best=Infinity;
    for(let i=0;i<points.length;i++){const dx=points[i].x-planetScreen[0],dy=points[i].y-planetScreen[1],d=dx*dx+dy*dy;if(d<best){best=d;nearest=i;}}
    points[nearest].x=planetScreen[0];points[nearest].y=planetScreen[1];
    return {planetScreen,starScreen,points,radius,normal:n,currentIndex:nearest};
  }
  function pathAll(points){ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)ctx.lineTo(points[i].x,points[i].y);}
  function pathDepth(points,near){
    ctx.beginPath();for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=0.5*(a.depth+b.depth);if((near&&d<=0)||(!near&&d>0)){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}}
  }
  function drawNode(x,y,r,fill){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();}
  let wasVisible=false;
  function clear(){if(wasVisible&&ctx)ctx.clearRect(0,0,canvas.width,canvas.height);wasVisible=false;canvas.classList.remove('on');}
  function draw(now){
    const orbitMode=!!window.__madPlanetOrbitOverlay?.isEnabled?.();
    if(!enabled||!orbitMode||!ctx||typeof cam==='undefined'||typeof world==='undefined'){clear();return;}
    const sz=resize(),basis=cameraBasis();ctx.clearRect(0,0,sz.w,sz.h);
    const sun=norm([Math.cos(sunEl)*Math.sin(sunAz),Math.sin(sunEl),Math.cos(sunEl)*Math.cos(sunAz)]);
    const o=orbitState(now),g=makeGeometry(sz,basis,sun,o),pts=g.points;

    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    pathAll(pts);ctx.setLineDash([]);ctx.strokeStyle='rgba(255,170,72,.10)';ctx.lineWidth=7;ctx.stroke();
    pathDepth(pts,false);ctx.setLineDash([4,5]);ctx.strokeStyle='rgba(255,184,88,.34)';ctx.lineWidth=1.15;ctx.stroke();
    pathDepth(pts,true);ctx.setLineDash([]);ctx.strokeStyle='rgba(255,191,101,.82)';ctx.lineWidth=1.65;ctx.stroke();
    pathDepth(pts,true);ctx.strokeStyle='rgba(255,221,166,.36)';ctx.lineWidth=.65;ctx.stroke();

    for(const k of [Math.round(ORBIT_SAMPLES/4),Math.round(ORBIT_SAMPLES/2),Math.round(3*ORBIT_SAMPLES/4)]){
      const p=pts[k];drawNode(p.x,p.y,1.55,'rgba(255,193,105,.54)');
    }
    const c=g.planetScreen;drawNode(c[0],c[1],5.0,'rgba(255,171,68,.10)');drawNode(c[0],c[1],2.15,'rgba(184,211,255,.92)');
    ctx.beginPath();ctx.arc(c[0],c[1],4.0,0,Math.PI*2);ctx.strokeStyle='rgba(255,202,126,.62)';ctx.lineWidth=.8;ctx.stroke();

    /* Focus marker is deliberately drawn after the orbit. Its opaque warm core
       masks the underlying line, so the path reads as passing behind the sun. */
    const s=g.starScreen;
    drawNode(s[0],s[1],9.0,'rgba(255,170,67,.08)');
    drawNode(s[0],s[1],5.2,'rgba(255,177,73,.96)');
    ctx.beginPath();ctx.arc(s[0],s[1],7.0,0,Math.PI*2);ctx.strokeStyle='rgba(255,218,151,.42)';ctx.lineWidth=1;ctx.stroke();
    for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.beginPath();ctx.moveTo(s[0]+Math.cos(a)*7.5,s[1]+Math.sin(a)*7.5);ctx.lineTo(s[0]+Math.cos(a)*10.5,s[1]+Math.sin(a)*10.5);ctx.strokeStyle='rgba(255,200,116,.52)';ctx.lineWidth=.8;ctx.stroke();}

    if(sz.w>420){
      const labelPoint=pts[Math.round(ORBIT_SAMPLES*0.56)];ctx.font='8px ui-monospace,monospace';ctx.fillStyle='rgba(255,194,108,.50)';ctx.textAlign='left';
      ctx.fillText('ОРБИТА · e '+o.e.toFixed(3),labelPoint.x+6,labelPoint.y-5);
      ctx.fillStyle='rgba(255,193,105,.64)';ctx.fillText('☉',s[0]+10,s[1]-8);
    }
    ctx.restore();canvas.classList.add('on');wasVisible=true;
  }

  const before=drawFrame;
  drawFrame=function(now){const r=before(now);draw(now);return r;};
  window.__madPlanetOrbitScenePath={setEnabled,isEnabled:()=>enabled};
})();
