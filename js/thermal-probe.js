/* ============ 0.5.126: interactive thermal surface probe ============ */
/*
   A thermography instrument should answer "what is the temperature here?"
   without forcing a synchronous GPU readback on every mouse move. The probe
   therefore reproduces the camera ray on the CPU, intersects the unit planet,
   rotates the hit into the same body frame used by physicalFogSample(), and
   samples the authoritative Weather Core surfaceSkinTemp field.

   The A channel used by the thermal shader is linearly filtered and then
   averaged over a small tetrahedral neighbourhood to hide cubemap seams. The
   CPU probe mirrors that idea with bilinear cell interpolation plus the same
   four 0.014-direction offsets. Large-scale mountains, polar ice skin and all
   other physical Weather Core effects are therefore numerical data, not a
   colour guess. The shader-only sub-grid peak/lava residual remains a visual
   diagnostic refinement; the readout deliberately reports the physical model.
*/
(function installThermalProbe(){
  if(typeof document==='undefined'||typeof canvas==='undefined'||typeof drawFrame!=='function')return;

  const overlay=document.createElement('canvas');
  overlay.id='thermalProbeOverlay';overlay.setAttribute('aria-hidden','true');document.body.appendChild(overlay);
  const ctx=overlay.getContext('2d',{alpha:true});if(!ctx)return;

  const style=document.createElement('style');style.id='madplanet-thermal-probe-style';
  style.textContent=`
    #thermalProbeOverlay{position:fixed;inset:0;width:100%;height:100%;z-index:2147483000;pointer-events:none;display:block}
    #gl.thermal-probe-hit{cursor:none!important}
  `;document.head.appendChild(style);

  let cssW=0,cssH=0,dpr=1,lastSimNow=performance.now();
  let pointer={active:false,x:0,y:0,uvX:0,uvY:0,rect:null,type:'mouse'};
  let lastVisible=false,lastK=NaN;

  function resizeOverlay(){
    const w=Math.max(1,innerWidth),h=Math.max(1,innerHeight),q=Math.min(2,Math.max(1,devicePixelRatio||1));
    if(w===cssW&&h===cssH&&q===dpr)return;
    cssW=w;cssH=h;dpr=q;overlay.width=Math.round(w*q);overlay.height=Math.round(h*q);
    ctx.setTransform(q,0,0,q,0,0);
  }
  addEventListener('resize',resizeOverlay,{passive:true});resizeOverlay();

  function thermalEnabled(){return !!window.__madPlanetThermalDisplay?.isEnabled?.();}
  function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
  function norm(v){const q=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/q,v[1]/q,v[2]/q];}
  function addOffset(v,x,y,z){return norm([v[0]+x,v[1]+y,v[2]+z]);}

  function rememberPointer(e){
    const r=canvas.getBoundingClientRect();
    if(!(r.width>0&&r.height>0)){pointer.active=false;return;}
    pointer={
      active:true,x:e.clientX,y:e.clientY,type:e.pointerType||'mouse',rect:{left:r.left,top:r.top,width:r.width,height:r.height},
      uvX:(e.clientX-(r.left+r.width*0.5))/r.height,
      uvY:((r.top+r.height*0.5)-e.clientY)/r.height
    };
  }
  canvas.addEventListener('pointermove',rememberPointer,{passive:true});
  canvas.addEventListener('pointerenter',rememberPointer,{passive:true});
  canvas.addEventListener('pointerleave',()=>{pointer.active=false;canvas.classList.remove('thermal-probe-hit');},{passive:true});

  function cameraRay(){
    if(!pointer.active||typeof cam==='undefined')return null;
    const cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
    const pos=[cam.dist*cp*Math.sin(cam.yaw),cam.dist*sp,cam.dist*cp*Math.cos(cam.yaw)];
    const fwd=norm([-pos[0],-pos[1],-pos[2]]);
    /* render.js uses rgt = normalize(cross(fwd,[0,1,0])). */
    const rgt=norm([-fwd[2],0,fwd[0]]);
    const up=[rgt[1]*fwd[2]-rgt[2]*fwd[1],rgt[2]*fwd[0]-rgt[0]*fwd[2],rgt[0]*fwd[1]-rgt[1]*fwd[0]];
    const local=norm([pointer.uvX,pointer.uvY,(typeof FOCAL==='number'?FOCAL:1.025)]);
    const rd=norm([
      rgt[0]*local[0]+up[0]*local[1]+fwd[0]*local[2],
      rgt[1]*local[0]+up[1]*local[1]+fwd[1]*local[2],
      rgt[2]*local[0]+up[2]*local[1]+fwd[2]*local[2]
    ]);
    return {pos,rd};
  }
  function sphereHit(){
    const ray=cameraRay();if(!ray)return null;
    const ro=ray.pos,rd=ray.rd,b=ro[0]*rd[0]+ro[1]*rd[1]+ro[2]*rd[2];
    const c=ro[0]*ro[0]+ro[1]*ro[1]+ro[2]*ro[2]-1,disc=b*b-c;
    if(!(disc>=0))return null;
    const t=-b-Math.sqrt(disc);if(!(t>0))return null;
    return norm([ro[0]+rd[0]*t,ro[1]+rd[1]*t,ro[2]+rd[2]*t]);
  }
  function bodyDirection(surfaceNormal){
    if(!surfaceNormal||typeof world==='undefined'||!world)return null;
    const t=(Number(lastSimNow)-Number(t0))/1000;
    const rot=m3axis(world.axis,-(t*SPIN+world.surfOff));
    return norm(m3v(rot,surfaceNormal));
  }

  function faceUv(dir){
    const dx=dir[0],dy=dir[1],dz=dir[2],ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz);
    let face,u,v,m;
    if(ax>=ay&&ax>=az){
      if(dx>=0){face=0;m=dx;u=-dz/m;v=dy/m;}
      else{face=1;m=-dx;u=dz/m;v=dy/m;}
    }else if(ay>=ax&&ay>=az){
      if(dy>=0){face=2;m=dy;u=dx/m;v=-dz/m;}
      else{face=3;m=-dy;u=dx/m;v=dz/m;}
    }else{
      if(dz>=0){face=4;m=dz;u=dx/m;v=dy/m;}
      else{face=5;m=-dz;u=-dx/m;v=dy/m;}
    }
    return {face,u:clamp(u,-1,1),v:clamp(v,-1,1)};
  }
  function sampleFieldLinear(core,field,dir){
    if(!core?.N||!field||field.length!==core.count)return NaN;
    const q=faceUv(dir),N=core.N;
    const fx=clamp((q.u+1)*0.5*N-0.5,0,N-1),fy=clamp((q.v+1)*0.5*N-0.5,0,N-1);
    const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(N-1,x0+1),y1=Math.min(N-1,y0+1);
    const tx=fx-x0,ty=fy-y0,base=q.face*N*N;
    const a=Number(field[base+y0*N+x0]),b=Number(field[base+y0*N+x1]);
    const c=Number(field[base+y1*N+x0]),d=Number(field[base+y1*N+x1]);
    if(![a,b,c,d].every(Number.isFinite))return NaN;
    return (a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty;
  }
  function physicalTemperatureAt(body){
    const core=(typeof weatherCore!=='undefined')?weatherCore:null;if(!core?.count||!body)return NaN;
    const field=(core.surfaceSkinTemp&&core.surfaceSkinTemp.length===core.count)?core.surfaceSkinTemp:core.surfaceTemp;
    if(!field)return NaN;
    /* Match physicalFogSample()'s temperature seam-smoothing footprint. */
    const o=0.014,dirs=[body,addOffset(body,o,o,0),addOffset(body,-o,o,0),addOffset(body,0,-o,o),addOffset(body,0,-o,-o)];
    let sum=0,n=0;for(const d of dirs){const T=sampleFieldLinear(core,field,d);if(Number.isFinite(T)){sum+=T;n++;}}
    return n?sum/n:NaN;
  }

  function thermalDisplayCoordK(K){
    const C=clamp(K-273.15,-193.15,1200);
    if(C<-100)return 0.04*clamp((C+193.15)/93.15,0,1);
    if(C<=60)return 0.04+0.78*clamp((C+100)/160,0,1);
    if(C<=150)return 0.82+0.08*clamp((C-60)/90,0,1);
    return 0.90+0.10*clamp((C-150)/1050,0,1);
  }
  function mix3(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
  function thermalPaletteK(K){
    const t=clamp(thermalDisplayCoordK(K),0,1);
    const c0=[.035,.010,.090],c1=[.080,.120,.620],c2=[0,.760,.900],c3=[.980,.900,.120],c4=[.960,.180,.030],c5=[1,.970,.900];
    let c;if(t<.20)c=mix3(c0,c1,t/.20);else if(t<.42)c=mix3(c1,c2,(t-.20)/.22);else if(t<.64)c=mix3(c2,c3,(t-.42)/.22);else if(t<.84)c=mix3(c3,c4,(t-.64)/.20);else c=mix3(c4,c5,(t-.84)/.16);
    return `rgb(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)})`;
  }
  function formatTemperature(K){
    if(!Number.isFinite(K))return '— °C';const C=K-273.15,sign=C>0.049?'+':C<-0.049?'−':'';
    return sign+Math.abs(C).toFixed(1)+' °C';
  }

  function planetScreenGeometry(){
    const r=pointer.rect;if(!r||typeof cam==='undefined')return null;
    const center=[r.left+r.width*0.5,r.top+r.height*0.5];
    const focal=(typeof FOCAL==='number'?FOCAL:1.025),den=Math.sqrt(Math.max(1e-6,cam.dist*cam.dist-1));
    return {center,radius:r.height*focal/den};
  }
  function roundedRect(x,y,w,h,r){
    r=Math.min(r,w*0.5,h*0.5);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  }
  function drawThermometer(x,y,color){
    ctx.save();ctx.lineCap='round';
    ctx.strokeStyle='rgba(4,8,14,.90)';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x,y-14);ctx.lineTo(x,y-4);ctx.stroke();
    ctx.strokeStyle='rgba(245,249,255,.92)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y-14);ctx.lineTo(x,y-4);ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,4.2,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(245,249,255,.95)';ctx.lineWidth=1.4;ctx.stroke();
    ctx.fillStyle='rgba(245,249,255,.98)';ctx.beginPath();ctx.arc(x,y,1.05,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function drawProbe(K){
    resizeOverlay();ctx.clearRect(0,0,cssW,cssH);if(!Number.isFinite(K))return;
    const g=planetScreenGeometry();if(!g)return;
    const dx=pointer.x-g.center[0],dy=pointer.y-g.center[1],dl=Math.hypot(dx,dy);
    const side=pointer.x>=g.center[0]?1:-1;
    const ux=dl>1?dx/dl:side,uy=dl>1?dy/dl:0;
    const knee=[g.center[0]+ux*(g.radius+12),g.center[1]+uy*(g.radius+12)];
    const boxW=112,boxH=48,margin=6;
    let bx=side>0?knee[0]+14:knee[0]-14-boxW;
    bx=clamp(bx,margin,cssW-boxW-margin);
    const by=clamp(knee[1]-boxH*0.5,margin,cssH-boxH-margin);
    const edgeX=side>0?bx:bx+boxW,edgeY=clamp(knee[1],by+9,by+boxH-9);
    const color=thermalPaletteK(K);

    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor='rgba(0,0,0,.48)';ctx.shadowBlur=5;
    ctx.beginPath();ctx.moveTo(pointer.x,pointer.y);ctx.lineTo(knee[0],knee[1]);ctx.lineTo(edgeX,edgeY);ctx.strokeStyle='rgba(231,239,251,.78)';ctx.lineWidth=1.15;ctx.stroke();
    ctx.shadowBlur=12;roundedRect(bx,by,boxW,boxH,8);ctx.fillStyle='rgba(6,11,18,.86)';ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(159,194,255,.28)';ctx.lineWidth=1;ctx.stroke();

    const sw=22,sh=10,swx=side>0?bx+boxW-sw-8:bx+8,swy=by+29;
    ctx.fillStyle='rgba(232,237,245,.90)';ctx.font='600 13px ui-monospace,monospace';ctx.textAlign=side>0?'left':'right';ctx.textBaseline='alphabetic';
    ctx.fillText(formatTemperature(K),side>0?bx+8:bx+boxW-8,by+18);
    roundedRect(swx,swy,sw,sh,2.5);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='rgba(255,255,255,.45)';ctx.lineWidth=.8;ctx.stroke();
    ctx.fillStyle='rgba(139,150,168,.72)';ctx.font='7.5px system-ui,sans-serif';ctx.textAlign=side>0?'left':'right';ctx.fillText('поверхность',side>0?bx+8:bx+boxW-8,by+41);
    drawThermometer(pointer.x,pointer.y,color);ctx.restore();
  }

  function clearProbe(){
    if(lastVisible){resizeOverlay();ctx.clearRect(0,0,cssW,cssH);}lastVisible=false;lastK=NaN;canvas.classList.remove('thermal-probe-hit');
  }
  function updateProbe(){
    const dragging=(typeof pointers!=='undefined'&&pointers&&pointers.size>0);
    if(!thermalEnabled()||!pointer.active||dragging){clearProbe();requestAnimationFrame(updateProbe);return;}
    const surface=sphereHit();if(!surface){clearProbe();requestAnimationFrame(updateProbe);return;}
    const body=bodyDirection(surface),K=physicalTemperatureAt(body);
    if(!Number.isFinite(K)){clearProbe();requestAnimationFrame(updateProbe);return;}
    lastK=K;lastVisible=true;canvas.classList.add('thermal-probe-hit');drawProbe(K);requestAnimationFrame(updateProbe);
  }

  /* runtime-settings.js is loaded after this module. Its synthetic clock wraps
     us from the outside, so the value received here is the exact scaled/paused
     time that the planet renderer receives. */
  const drawFrameBeforeThermalProbe=drawFrame;
  drawFrame=function(now){lastSimNow=Number(now);return drawFrameBeforeThermalProbe(now);};

  requestAnimationFrame(updateProbe);
  window.__madPlanetThermalProbe={
    isVisible:()=>lastVisible,temperatureK:()=>lastK,
    paletteK:thermalPaletteK,formatTemperature,
    sampleBodyTemperature:physicalTemperatureAt
  };
})();
