/* ============ 0.5.42: pressure-gradient wind dynamics ============ */
/*
   Weather Core v4: local wind is now an actual tangent velocity field driven
   by the 0.5.41 pressure field. Four ingredients act on every fixed weather
   tick:
     - pressure-gradient acceleration: -grad(P)/rho;
     - Coriolis deflection from the real planetary rotation period;
     - near-surface friction;
     - orographic drag/deflection from the same tectonic plate geometry used
       by the visible terrain shader.

   The CPU does NOT rebuild the full GLSL terrain. Instead it derives a cheap
   plate-boundary/orogenic proxy from world.plateP/world.plateW. That keeps the
   causal source aligned with visible mountain belts without duplicating the
   expensive fragment-shader terrain generator on every weather tick.

   Pressure mass transport/continuity is intentionally still owned by the
   baric scaffold. This milestone turns pressure gradients into momentum; the
   following milestones can use that momentum for vapor/heat advection.
*/

const WIND_DYNAMICS_MODEL = 1;
const WIND_EARTH_RADIUS_M = 6371000.0;
const WIND_GAS_R = 8.314462618;
const WIND_BASE_DRAG_LAND_SEC = 7.0*3600;
const WIND_BASE_DRAG_OCEAN_SEC = 14.0*3600;
const WIND_MAX_ACCEL_MS2 = 0.05;
const WIND_MAX_MACH = 0.78;

function windClamp(x,a,b){ return Math.max(a,Math.min(b,Number(x)||0)); }
function windDot(ax,ay,az,bx,by,bz){ return ax*bx+ay*by+az*bz; }
function windNorm3(x,y,z,out){
  const q=Math.hypot(x,y,z)||1;
  out.x=x/q;out.y=y/q;out.z=z/q;return out;
}
function windPlanetRadiusM(climate){
  if(Number.isFinite(climate?.radiusM)&&climate.radiusM>0) return windClamp(climate.radiusM,1e5,1e9);
  if(typeof planetPhysics==='function'){
    const p=planetPhysics();
    if(Number.isFinite(p?.radiusEarth)&&p.radiusEarth>0) return WIND_EARTH_RADIUS_M*p.radiusEarth;
  }
  return WIND_EARTH_RADIUS_M;
}
function windRotationPeriodSec(climate){
  if(Number.isFinite(climate?.rotationPeriodSec)&&climate.rotationPeriodSec>0)
    return windClamp(climate.rotationPeriodSec,600,1e9);
  if(typeof planetPhysics==='function'){
    const p=planetPhysics();
    if(Number.isFinite(p?.rotationHours)&&p.rotationHours>0) return p.rotationHours*3600;
  }
  return 86400;
}
function windMeanMolarMassKg(climate){
  if(Number.isFinite(climate?.meanMolarMassKg)&&climate.meanMolarMassKg>0)
    return windClamp(climate.meanMolarMassKg,0.001,0.2);
  if(typeof baricMeanMolarMassKg==='function') return baricMeanMolarMassKg(climate);
  return 0.02897;
}

/* Inverse of weatherFaceDir(). This gives a stable way to step across cube
   face seams and build a four-neighbour stencil only once per core. */
function windDirToIndex(core,dx,dy,dz){
  const ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz);
  let face,u,v,a;
  if(ax>=ay&&ax>=az){
    if(dx>=0){face=0;a=Math.max(1e-12,dx);u=-dz/a;v=dy/a;}
    else{face=1;a=Math.max(1e-12,-dx);u=dz/a;v=dy/a;}
  }else if(ay>=az){
    if(dy>=0){face=2;a=Math.max(1e-12,dy);u=dx/a;v=-dz/a;}
    else{face=3;a=Math.max(1e-12,-dy);u=dx/a;v=dz/a;}
  }else{
    if(dz>=0){face=4;a=Math.max(1e-12,dz);u=dx/a;v=dy/a;}
    else{face=5;a=Math.max(1e-12,-dz);u=-dx/a;v=dy/a;}
  }
  const N=core.N;
  const x=Math.max(0,Math.min(N-1,Math.floor((u+1)*0.5*N)));
  const y=Math.max(0,Math.min(N-1,Math.floor((v+1)*0.5*N)));
  return face*N*N+y*N+x;
}
function windTangentBasis(dx,dy,dz,axis,out){
  /* East follows planetary rotation: axis x radius. Near a pole use a stable
     fallback that is still tangent; Coriolis itself naturally reaches max. */
  let ex=axis[1]*dz-axis[2]*dy;
  let ey=axis[2]*dx-axis[0]*dz;
  let ez=axis[0]*dy-axis[1]*dx;
  let q=Math.hypot(ex,ey,ez);
  if(q<1e-7){
    const rx=Math.abs(dx)<0.8?1:0, ry=Math.abs(dx)<0.8?0:0, rz=Math.abs(dx)<0.8?0:1;
    ex=ry*dz-rz*dy;ey=rz*dx-rx*dz;ez=rx*dy-ry*dx;q=Math.hypot(ex,ey,ez)||1;
  }
  ex/=q;ey/=q;ez/=q;
  /* north = radius x east */
  let nx=dy*ez-dz*ey,ny=dz*ex-dx*ez,nz=dx*ey-dy*ex;
  q=Math.hypot(nx,ny,nz)||1;nx/=q;ny/=q;nz/=q;
  out.ex=ex;out.ey=ey;out.ez=ez;out.nx=nx;out.ny=ny;out.nz=nz;
  return out;
}

function windBuildPressureStencil(core,axis,radiusM){
  const count=core.count,N=core.N,step=2/N;
  core.windNeighbor=[new Int32Array(count),new Int32Array(count),new Int32Array(count),new Int32Array(count)];
  core.windGradE=[new Float32Array(count),new Float32Array(count),new Float32Array(count),new Float32Array(count)];
  core.windGradN=[new Float32Array(count),new Float32Array(count),new Float32Array(count),new Float32Array(count)];
  const basis={};
  let i=0;
  for(let face=0;face<6;face++) for(let y=0;y<N;y++) for(let x=0;x<N;x++,i++){
    const u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1;
    const candidates=[
      weatherFaceDir(face,u+step,v),weatherFaceDir(face,u-step,v),
      weatherFaceDir(face,u,v+step),weatherFaceDir(face,u,v-step)
    ];
    const rx=core.dirX[i],ry=core.dirY[i],rz=core.dirZ[i];
    windTangentBasis(rx,ry,rz,axis,basis);
    for(let k=0;k<4;k++){
      const d=candidates[k],j=windDirToIndex(core,d[0],d[1],d[2]);
      core.windNeighbor[k][i]=j;
      const dot=windClamp(windDot(rx,ry,rz,core.dirX[j],core.dirY[j],core.dirZ[j]),-1,1);
      const ang=Math.max(1e-7,Math.acos(dot));
      const dist=Math.max(1,radiusM*ang);
      const sx=core.dirX[j]-rx*dot,sy=core.dirY[j]-ry*dot,sz=core.dirZ[j]-rz*dot;
      const sn=Math.hypot(sx,sy,sz)||1;
      /* Four directional differences sum to ~2*grad on a regular stencil. */
      const inv=0.5/(dist*sn);
      core.windGradE[k][i]=(sx*basis.ex+sy*basis.ey+sz*basis.ez)*inv;
      core.windGradN[k][i]=(sx*basis.nx+sy*basis.ny+sz*basis.nz)*inv;
    }
  }
}
function windPressureGradient(core,i,out){
  const p=core.pressure[i];let ge=0,gn=0;
  for(let k=0;k<4;k++){
    const j=core.windNeighbor[k][i],dp=core.pressure[j]-p;
    ge+=core.windGradE[k][i]*dp;gn+=core.windGradN[k][i]*dp;
  }
  out.e=ge;out.n=gn;return out;
}

function windOrographicSignature(){
  const tect=(typeof state!=='undefined'&&Number.isFinite(state.tect))?state.tect:0;
  const seed=(typeof state!=='undefined')?(state.seed|0):0;
  const pn=(typeof world!=='undefined'&&world)?(world.plateN|0):0;
  return seed+'|'+tect.toFixed(4)+'|'+pn;
}
function windRefreshOrography(core,axis){
  if(!core.orographicRoughness||core.orographicRoughness.length!==core.count){
    core.orographicRoughness=new Float32Array(core.count);
    core.orographicBarrierE=new Float32Array(core.count);
    core.orographicBarrierN=new Float32Array(core.count);
  }
  core.orographicRoughness.fill(0);core.orographicBarrierE.fill(0);core.orographicBarrierN.fill(0);
  core.orographySignature=windOrographicSignature();
  if(typeof world==='undefined'||!world||!(world.plateN>1)||!world.plateP||!world.plateW) return core;
  const n=Math.min(world.plateN|0,Math.floor(world.plateP.length/4),Math.floor(world.plateW.length/4));
  if(n<2) return core;
  const tect=windClamp((typeof state!=='undefined'?state.tect:0.5),0,1);
  const basis={};
  for(let i=0;i<core.count;i++){
    const dx=core.dirX[i],dy=core.dirY[i],dz=core.dirZ[i];
    let ia=-1,ib=-1,da=Infinity,db=Infinity;
    for(let p=0;p<n;p++){
      const o=4*p;
      const d=-windDot(dx,dy,dz,world.plateP[o],world.plateP[o+1],world.plateP[o+2])-Number(world.plateP[o+3]||0);
      if(d<da){db=da;ib=ia;da=d;ia=p;}else if(d<db){db=d;ib=p;}
    }
    if(ia<0||ib<0) continue;
    const oa=4*ia,ob=4*ib;
    let bx=world.plateP[ob]-world.plateP[oa],by=world.plateP[ob+1]-world.plateP[oa+1],bz=world.plateP[ob+2]-world.plateP[oa+2];
    const base=Math.max(1e-4,Math.hypot(bx,by,bz));
    const seam=Math.abs(db-da)/base;
    const radial=bx*dx+by*dy+bz*dz;bx-=dx*radial;by-=dy*radial;bz-=dz*radial;
    const bn=Math.hypot(bx,by,bz);if(bn<1e-5) continue;bx/=bn;by/=bn;bz/=bn;
    const wx=world.plateW[oa]-world.plateW[ob],wy=world.plateW[oa+1]-world.plateW[ob+1],wz=world.plateW[oa+2]-world.plateW[ob+2];
    const cx=wy*dz-wz*dy,cy=wz*dx-wx*dz,cz=wx*dy-wy*dx;
    const conv=Math.abs(cx*bx+cy*by+cz*bz);
    const width=0.055+0.085*tect;
    const band=Math.exp(-Math.pow(seam/Math.max(0.01,width),2));
    const rough=windClamp(tect*band*(0.24+2.0*conv),0,1);
    windTangentBasis(dx,dy,dz,axis,basis);
    core.orographicRoughness[i]=rough;
    core.orographicBarrierE[i]=bx*basis.ex+by*basis.ey+bz*basis.ez;
    core.orographicBarrierN[i]=bx*basis.nx+by*basis.ny+bz*basis.nz;
  }
  return core;
}

function windApplyCoriolis(u,v,f,dt,out){
  const th=f*dt,c=Math.cos(th),s=Math.sin(th);
  out.u=u*c+v*s;out.v=v*c-u*s;return out;
}
function windSoundSpeed(T,molarMassKg){
  return Math.sqrt(1.4*WIND_GAS_R*windClamp(T,40,3000)/windClamp(molarMassKg,0.001,0.2));
}

/* Extend the shared snapshot with the planetary properties needed by momentum. */
const weatherCoreClimateSnapshotBeforeWind=weatherCoreClimateSnapshot;
weatherCoreClimateSnapshot=function(){
  const s=weatherCoreClimateSnapshotBeforeWind();
  const p=(typeof planetPhysics==='function')?planetPhysics():null;
  s.radiusM=p&&Number.isFinite(p.radiusEarth)?WIND_EARTH_RADIUS_M*p.radiusEarth:WIND_EARTH_RADIUS_M;
  s.rotationPeriodSec=p&&Number.isFinite(p.rotationHours)?p.rotationHours*3600:86400;
  s.meanMolarMassKg=windMeanMolarMassKg(s);
  return s;
};

const weatherCoreCreateBeforeWind=weatherCoreCreate;
weatherCoreCreate=function(seed,N,climate,axis){
  const core=weatherCoreCreateBeforeWind(seed,N,climate,axis);
  core.windModel=WIND_DYNAMICS_MODEL;
  core.pgfEast=new Float32Array(core.count);core.pgfNorth=new Float32Array(core.count);
  const ax=weatherNorm3(axis[0],axis[1],axis[2]);
  windBuildPressureStencil(core,ax,windPlanetRadiusM(climate));
  windRefreshOrography(core,ax);
  return core;
};

const weatherCoreStepBeforeWind=weatherCoreStep;
weatherCoreStep=function(core,dtSec,climate,axis){
  if(!core||!core.count) return core;
  weatherCoreStepBeforeWind(core,dtSec,climate,axis);
  const dt=weatherClamp(dtSec,0,WEATHER_CORE_FIXED_DT_SEC);
  if(!core.windNeighbor) windBuildPressureStencil(core,weatherNorm3(axis[0],axis[1],axis[2]),windPlanetRadiusM(climate));
  const ax=weatherNorm3(axis[0],axis[1],axis[2]);
  if(core.orographySignature!==windOrographicSignature()) windRefreshOrography(core,ax);
  const omega=2*Math.PI/Math.max(600,windRotationPeriodSec(climate));
  const sea=windClamp(Number(climate?.sea??(typeof state!=='undefined'?state.sea:0.58)),0,1);
  const baseTau=WIND_BASE_DRAG_LAND_SEC*(1-sea)+WIND_BASE_DRAG_OCEAN_SEC*sea;
  const M=windMeanMolarMassKg(climate);
  const grad={e:0,n:0},cor={u:0,v:0};

  for(let i=0;i<core.count;i++){
    windPressureGradient(core,i,grad);
    const rho=Math.max(1e-5,Number(core.airDensity?.[i])||1e-5);
    const ae=windClamp(-grad.e/rho,-WIND_MAX_ACCEL_MS2,WIND_MAX_ACCEL_MS2);
    const an=windClamp(-grad.n/rho,-WIND_MAX_ACCEL_MS2,WIND_MAX_ACCEL_MS2);
    core.pgfEast[i]=ae;core.pgfNorth[i]=an;
    let u=core.windU[i]+ae*dt,v=core.windV[i]+an*dt;

    const sinLat=windClamp(core.dirX[i]*ax[0]+core.dirY[i]*ax[1]+core.dirZ[i]*ax[2],-1,1);
    const f=2*omega*sinLat;
    windApplyCoriolis(u,v,f,dt,cor);u=cor.u;v=cor.v;

    const rough=windClamp(core.orographicRoughness?.[i]||0,0,1);
    const be=core.orographicBarrierE?.[i]||0,bn=core.orographicBarrierN?.[i]||0;
    const cross=u*be+v*bn;
    const block=(1-Math.exp(-dt*rough/3600))*0.78;
    u-=cross*be*block;v-=cross*bn*block;

    const tau=Math.max(900,baseTau/(1+4.5*rough));
    const drag=Math.exp(-dt/tau);u*=drag;v*=drag;
    const sound=windSoundSpeed(core.airTemp[i],M),cap=windClamp(WIND_MAX_MACH*sound,45,500);
    const speed=Math.hypot(u,v);
    if(speed>cap){const k=cap/speed;u*=k;v*=k;}
    core.windU[i]=u;core.windV[i]=v;
  }
  return core;
};

const weatherCoreFiniteBeforeWind=weatherCoreFinite;
weatherCoreFinite=function(core){
  if(!weatherCoreFiniteBeforeWind(core)) return false;
  for(const k of ['pgfEast','pgfNorth','orographicRoughness','orographicBarrierE','orographicBarrierN']){
    const a=core?.[k];if(!a||a.length!==core.count)return false;
    for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false;
  }
  if(!core.windNeighbor||core.windNeighbor.length!==4||!core.windGradE||!core.windGradN)return false;
  return true;
};

function windDiagnostics(core){
  if(!core||!core.count)return {mean:NaN,max:NaN,pgf:NaN,rough:NaN};
  let sw=0,mean=0,max=0,pgf=0,rough=0;
  for(let i=0;i<core.count;i++){
    const w=Math.max(1e-12,core.areaWeight?.[i]||1),s=Math.hypot(core.windU[i],core.windV[i]);
    sw+=w;mean+=w*s;if(s>max)max=s;pgf+=w*Math.hypot(core.pgfEast[i],core.pgfNorth[i]);rough+=w*(core.orographicRoughness[i]||0);
  }
  const d=Math.max(1e-12,sw);return {mean:mean/d,max,pgf:pgf/d,rough:rough/d};
}

if(typeof createPanel==='function'){
  const createPanelBeforeWind=createPanel;
  createPanel=function(group){
    const el=createPanelBeforeWind(group);
    if(group==='Погода'){
      const box=el.querySelector('#weatherCoreDiag');
      if(box&&!box.querySelector('[data-winddyn="speed"]')){
        appendWeatherCoreRow(box,'Ветер mean / max','wind-speed');
        const a=box.lastElementChild?.querySelector('[data-weathercore="wind-speed"]');if(a){delete a.dataset.weathercore;a.dataset.winddyn='speed';}
        appendWeatherCoreRow(box,'Pressure-gradient accel','wind-pgf');
        const b=box.lastElementChild?.querySelector('[data-weathercore="wind-pgf"]');if(b){delete b.dataset.weathercore;b.dataset.winddyn='pgf';}
        appendWeatherCoreRow(box,'Орографическое сопротивление','wind-rough');
        const c=box.lastElementChild?.querySelector('[data-weathercore="wind-rough"]');if(c){delete c.dataset.weathercore;c.dataset.winddyn='rough';}
      }
    }
    return el;
  };
}
if(typeof refreshWeatherCoreDiagnostics==='function'){
  const refreshWeatherCoreDiagnosticsBeforeWind=refreshWeatherCoreDiagnostics;
  refreshWeatherCoreDiagnostics=function(){
    refreshWeatherCoreDiagnosticsBeforeWind();
    if(typeof document==='undefined')return;
    const box=document.getElementById('weatherCoreDiag');if(!box)return;
    const core=weatherCoreEnsure();if(!core||!core.pgfEast)return;
    const d=windDiagnostics(core);
    const set=(k,v)=>{const e=box.querySelector('[data-winddyn="'+k+'"]');if(e)e.textContent=v;};
    set('speed',d.mean.toFixed(1)+' / '+d.max.toFixed(1)+' м/с');
    set('pgf',(d.pgf*1000).toFixed(2)+' мм/с²');
    set('rough',(100*d.rough).toFixed(1)+'%');
  };
}
