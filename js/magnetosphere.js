/* ============ магнитосфера: силовые линии поверх WebGL ============ */
const magCanvas = document.getElementById('magOverlay');
const magCtx = magCanvas.getContext('2d', {alpha:true});
let magDpr = 1;
let magOverlayWasActive = false;

function fitMagCanvas(){
  const w = Math.max(1, Math.round(magCanvas.clientWidth  * Math.min(devicePixelRatio || 1, 2)));
  const h = Math.max(1, Math.round(magCanvas.clientHeight * Math.min(devicePixelRatio || 1, 2)));
  if(magCanvas.width !== w || magCanvas.height !== h){
    magCanvas.width = w; magCanvas.height = h;
  }
  magDpr = magCanvas.width / Math.max(1, magCanvas.clientWidth);
}

function magBasis(axis){
  const ref = Math.abs(axis[1]) < 0.92 ? [0,1,0] : [1,0,0];
  const t = norm3(cross3(axis, ref));
  return [t, cross3(axis,t)];
}
function dot3(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function add3(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function mul3(a,k){ return [a[0]*k,a[1]*k,a[2]*k]; }

/* r = L sin²(theta), theta относительно магнитной оси. */
function dipolePoint(axis, t, b, L, phi, theta, radiusScale=1){
  const st=Math.sin(theta), ct=Math.cos(theta);
  const r=L*st*st*radiusScale;
  const radial=[
    t[0]*Math.cos(phi)+b[0]*Math.sin(phi),
    t[1]*Math.cos(phi)+b[1]*Math.sin(phi),
    t[2]*Math.cos(phi)+b[2]*Math.sin(phi)
  ];
  return [
    r*(radial[0]*st + axis[0]*ct),
    r*(radial[1]*st + axis[1]*ct),
    r*(radial[2]*st + axis[2]*ct)
  ];
}

function projectMagPoint(p, camPos, rgt, up, fwd, W, H){
  const q=[p[0]-camPos[0],p[1]-camPos[1],p[2]-camPos[2]];
  const z=dot3(q,fwd);
  if(z <= 0.015) return null;
  const x=dot3(q,rgt), y=dot3(q,up);
  const sx=W*0.5 + FOCAL*(x/z)*H;
  const sy=H*0.5 - FOCAL*(y/z)*H;
  if(sx < -W*0.7 || sx > W*1.7 || sy < -H*0.7 || sy > H*1.7) return null;

  /* Если луч от камеры к точке сначала пересекает планету, участок линии
     находится за шаром и не должен просвечивать сквозь поверхность. */
  const dist=Math.hypot(q[0],q[1],q[2]);
  const d=[q[0]/dist,q[1]/dist,q[2]/dist];
  const B=dot3(camPos,d), C=dot3(camPos,camPos)-1.003*1.003;
  const disc=B*B-C;
  if(disc > 0){
    const hit=-B-Math.sqrt(disc);
    if(hit > 0 && hit < dist-0.012) return null;
  }
  return [sx,sy,z];
}

function sunDirection(){
  return norm3([Math.cos(sunEl)*Math.sin(sunAz), Math.sin(sunEl), Math.cos(sunEl)*Math.cos(sunAz)]);
}

function drawAuroraFootpoints(axis,t,b,camPos,rgt,up,fwd,W,H,sunDir){
  if(!state.auroraFootpoints) return;
  const lat=auroraLatitudeRad();
  const colat=Math.PI*0.5-lat;
  const r=1.026 + 0.015*state.atmo;
  magCtx.save();
  magCtx.shadowBlur=8; magCtx.shadowColor='rgba(90,255,155,.75)';
  for(let hemi=-1; hemi<=1; hemi+=2){
    const theta=hemi>0 ? colat : Math.PI-colat;
    for(let i=0;i<18;i++){
      const phi=(i/18)*Math.PI*2;
      const st=Math.sin(theta), ct=Math.cos(theta);
      const radial=[t[0]*Math.cos(phi)+b[0]*Math.sin(phi),t[1]*Math.cos(phi)+b[1]*Math.sin(phi),t[2]*Math.cos(phi)+b[2]*Math.sin(phi)];
      const p=[r*(radial[0]*st+axis[0]*ct),r*(radial[1]*st+axis[1]*ct),r*(radial[2]*st+axis[2]*ct)];
      const q=projectMagPoint(p,camPos,rgt,up,fwd,W,H); if(!q) continue;
      const n=norm3(p); const night=1-Math.max(0,Math.min(1,(dot3(n,sunDir)+0.12)/0.65));
      const a=0.12+0.62*night*state.aurora;
      magCtx.fillStyle=`rgba(105,255,165,${a.toFixed(3)})`;
      magCtx.beginPath(); magCtx.arc(q[0],q[1],1.4+1.2*state.aurora,0,Math.PI*2); magCtx.fill();
    }
  }
  magCtx.restore();
}

function drawMagnetosphereOverlay(timeSec, camPos, rgt, up, fwd, axisOverride=null, sunDirOverride=null){
  const active=(state.fieldLinesOn || state.auroraFootpoints) && state.magnet >= 0.01;
  /* В обычном режиме overlay выключен. Раньше мы всё равно каждый кадр читали
     его layout, выставляли transform и очищали прозрачный canvas. Теперь при
     выключении не трогаем 2D-контекст вообще, кроме единственного clear после
     перехода active -> off. */
  if(!active){
    if(magOverlayWasActive){
      fitMagCanvas();
      const W=magCanvas.clientWidth, H=magCanvas.clientHeight;
      magCtx.setTransform(magDpr,0,0,magDpr,0,0);
      magCtx.clearRect(0,0,W,H);
      magOverlayWasActive=false;
    }
    return;
  }
  magOverlayWasActive=true;
  fitMagCanvas();
  const W=magCanvas.clientWidth, H=magCanvas.clientHeight;
  magCtx.setTransform(magDpr,0,0,magDpr,0,0);
  magCtx.clearRect(0,0,W,H);

  const axis=axisOverride || currentMagAxis();
  const [t,b]=magBasis(axis);
  const sunDir=sunDirOverride || sunDirection();

  drawAuroraFootpoints(axis,t,b,camPos,rgt,up,fwd,W,H,sunDir);
  if(!state.fieldLinesOn) return;

  const count=10;
  const samples=86;
  const activity=state.aurora;
  magCtx.save();
  magCtx.globalCompositeOperation='lighter';
  magCtx.lineCap='round';
  magCtx.shadowBlur=5;
  magCtx.shadowColor='rgba(95,170,255,.38)';

  for(let i=0;i<count;i++){
    const u=i/(count-1);
    /* Представительные L-оболочки. Дальние линии намеренно полупрозрачны:
       при близкой камере они могут уходить за границы кадра, но геометрия
       остаётся истинной дипольной, без искусственного радиального сжатия. */
    const L=1.50 + Math.pow(u,1.55)*6.50;   // 1.50 .. 8.00 R
    const phi=(i/count)*Math.PI*2 + (i%2)*0.23;
    const theta0=Math.asin(Math.sqrt(1/L));
    let prev=null, prevR=0;
    /* Один stroke на дальнюю часть и один на приповерхностную вместо stroke
       для каждого из ~85 сегментов. ShadowBlur особенно дорог при сотнях
       отдельных Canvas2D-вызовов. */
    const canBatch = (typeof Path2D !== 'undefined');
    const farPath=canBatch?new Path2D():null, nearPath=canBatch?new Path2D():null;
    let farSeg=0, nearSeg=0;
    const farSegments=[], nearSegments=[];
    for(let j=0;j<samples;j++){
      const f=j/(samples-1);
      const theta=theta0 + (Math.PI-2*theta0)*f;
      const p=dipolePoint(axis,t,b,L,phi,theta,1);
      const r=Math.hypot(p[0],p[1],p[2]);
      const q=projectMagPoint(p,camPos,rgt,up,fwd,W,H);
      if(q && prev){
        const surface=Math.min(prevR,r) < 1.18;
        if(canBatch){
          const path=surface?nearPath:farPath;
          path.moveTo(prev[0],prev[1]); path.lineTo(q[0],q[1]);
        } else {
          (surface?nearSegments:farSegments).push([prev,q]);
        }
        if(surface) nearSeg++; else farSeg++;
      }
      prev=q; prevR=r;
    }
    const fade=(1-u*0.42)*(0.36+0.64*state.magnet);
    if(farSeg){
      magCtx.lineWidth=1.05;
      magCtx.strokeStyle=`rgba(155,207,255,${(0.18*fade).toFixed(3)})`;
      if(canBatch) magCtx.stroke(farPath);
      else for(const seg of farSegments){ magCtx.beginPath(); magCtx.moveTo(seg[0][0],seg[0][1]); magCtx.lineTo(seg[1][0],seg[1][1]); magCtx.stroke(); }
    }
    if(nearSeg){
      magCtx.lineWidth=1.45;
      magCtx.strokeStyle=`rgba(235,246,255,${(0.34*fade).toFixed(3)})`;
      if(canBatch) magCtx.stroke(nearPath);
      else for(const seg of nearSegments){ magCtx.beginPath(); magCtx.moveTo(seg[0][0],seg[0][1]); magCtx.lineTo(seg[1][0],seg[1][1]); magCtx.stroke(); }
    }

    /* Световые импульсы вдоль B-линий. При reduced-motion оставляем их
       неподвижными, чтобы настройка ОС соблюдалась и здесь. */
    for(let k=0;k<2;k++){
      const phase=reduceMotion ? (0.26+0.43*k) : ((timeSec*(0.055+0.035*activity)+i*0.071+k*0.47)%1);
      const theta=theta0 + (Math.PI-2*theta0)*phase;
      const p=dipolePoint(axis,t,b,L,phi,theta,1);
      const q=projectMagPoint(p,camPos,rgt,up,fwd,W,H); if(!q) continue;
      const rr=Math.hypot(p[0],p[1],p[2]);
      const a=(0.34+0.46*state.magnet)*(1-u*0.36);
      magCtx.shadowBlur=10;
      magCtx.shadowColor='rgba(175,225,255,.8)';
      magCtx.fillStyle=`rgba(220,245,255,${a.toFixed(3)})`;
      magCtx.beginPath(); magCtx.arc(q[0],q[1],rr<1.25?2.0:1.45,0,Math.PI*2); magCtx.fill();
      magCtx.shadowBlur=5;
    }
  }
  magCtx.restore();
}
