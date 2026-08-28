/* ============ размер и качество ============ */
const rawDeviceScale = Math.max(1, Number(devicePixelRatio || 1));
const mobileDevice = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') ||
  (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 900);
const deviceMemory = Number(navigator.deviceMemory || 8);

/* Mobile quality profile. Previous releases treated renderScale as if it were
   a fraction of DPR and started Android at 0.55..0.72. In reality this value
   is the number of framebuffer pixels per CSS pixel, so the browser was
   enlarging an already sub-native image. Stars, terrain and cloud edges all
   became visibly soft. Keep mobile near CSS-native resolution and spend the
   saved budget by targeting ~30 fps instead of destroying spatial detail. */
const SCALE_MAX = mobileDevice
  ? Math.min(rawDeviceScale, deviceMemory <= 4 ? 1.15 : 1.50)
  : Math.min(rawDeviceScale, 2.0);
const SCALE_MIN = mobileDevice ? (deviceMemory <= 4 ? 0.78 : 0.88) : 0.55;
let renderScale = mobileDevice
  ? Math.min(SCALE_MAX, deviceMemory <= 4 ? 0.96 : 1.20)
  : SCALE_MAX;
console.log('[madPlanet] render profile', {
  mobile: mobileDevice, deviceMemory, devicePixelRatio: rawDeviceScale,
  initialScale: renderScale, minScale: SCALE_MIN, maxScale: SCALE_MAX
});
let frameCount = 0;
let resizeDirty = true;
let renderUniformRevision = 1;
let appliedUniformRevision = -1;
function markRenderUniformsDirty(){ renderUniformRevision++; }

/* Не читаем clientWidth/clientHeight внутри drawFrame(): это заставляло браузер
   проверять layout каждый кадр и, главное, ломало повышенное разрешение PNG-
   скриншота. ResizeObserver помечает canvas грязным только при реальном resize. */
function requestCanvasFit(){ resizeDirty = true; }
function fitCanvas(force=false){
  if(!resizeDirty && !force) return;
  resizeDirty = false;
  const w = Math.max(1, Math.round(canvas.clientWidth * renderScale));
  const h = Math.max(1, Math.round(canvas.clientHeight * renderScale));
  if(canvas.width !== w || canvas.height !== h){
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}
addEventListener('resize', requestCanvasFit);
if(typeof ResizeObserver !== 'undefined'){
  new ResizeObserver(requestCanvasFit).observe(canvas);
}

/* Асинхронный GPU timer. В прежней версии gl.finish() раз в 50 кадров
   специально останавливал весь GPU-конвейер ради замера времени. Timer query
   даёт то же измерение через несколько кадров без синхронной пробки. */
const gpuTimerExt = (webglVersion >= 2) ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
let gpuTimerQuery = null;
let gpuTimerPending = false;
let qualityCooldown = 0;
let frameMsEwma = 16.7;

function setRenderScale(next){
  next = Math.max(SCALE_MIN, Math.min(SCALE_MAX, next));
  next = Math.round(next * 100) / 100;
  if(Math.abs(next - renderScale) < 0.009) return;
  renderScale = next;
  requestCanvasFit();
}
function tuneRenderScale(ms){
  if(!Number.isFinite(ms) || ms <= 0 || document.hidden) return;
  if(qualityCooldown > 0) return;
  const target = mobileDevice ? 31.0 : 16.5;
  if(ms > target*1.16 && renderScale > SCALE_MIN){
    /* Стоимость fragment shader приблизительно пропорциональна площади,
       поэтому масштаб корректируем через sqrt(target/current), а не линейно. */
    const k = Math.max(0.82, Math.min(0.96, Math.sqrt(target/ms)*0.96));
    setRenderScale(renderScale*k);
    qualityCooldown = 24;
  } else if(ms < target*0.68 && renderScale < SCALE_MAX){
    setRenderScale(renderScale*1.035);
    qualityCooldown = 40;
  }
}
function pollGpuTimer(){
  if(!gpuTimerExt || !gpuTimerPending || !gpuTimerQuery) return false;
  const available = gl.getQueryParameter(gpuTimerQuery, gl.QUERY_RESULT_AVAILABLE);
  if(!available) return false;
  const disjoint = gl.getParameter(gpuTimerExt.GPU_DISJOINT_EXT);
  if(!disjoint){
    const ns = gl.getQueryParameter(gpuTimerQuery, gl.QUERY_RESULT);
    tuneRenderScale(ns / 1e6);
  }
  gl.deleteQuery(gpuTimerQuery);
  gpuTimerQuery = null;
  gpuTimerPending = false;
  return true;
}
function beginGpuTimer(){
  if(!gpuTimerExt || gpuTimerPending) return false;
  const q = gl.createQuery();
  if(!q) return false;
  gpuTimerQuery = q;
  gpuTimerPending = true;
  gl.beginQuery(gpuTimerExt.TIME_ELAPSED_EXT, q);
  return true;
}
function endGpuTimer(){
  if(gpuTimerExt && gpuTimerPending) gl.endQuery(gpuTimerExt.TIME_ELAPSED_EXT);
}

/* ============ основной цикл ============ */
const FOCAL = 0.5/Math.tan((52*Math.PI/180)/2);
let lastNow = performance.now(), t0 = lastNow;


function drawAuroraWebGL(t, pos, camMat, magAxis, sunDir){
  if(!auroraProg || !state.auroraOn || state.aurora < 0.005 || state.magnet < 0.01 || state.atmo < 0.02) return;
  const starPhys = starPhysics(state.star, state.luminosity);
  const distInfo = distanceInfo(state.distance);
  const starFlux = starPhys.L / Math.max(distInfo.au*distInfo.au, 0.02);
  gl.useProgram(auroraProg);
  gl.uniform2f(AU.uRes, canvas.width, canvas.height);
  gl.uniform1f(AU.uTime, t);
  gl.uniform3fv(AU.uCamPos, pos);
  gl.uniformMatrix3fv(AU.uCamMat, false, camMat);
  gl.uniform1f(AU.uFocal, FOCAL);
  gl.uniform3fv(AU.uSunDir, sunDir);
  gl.uniform3fv(AU.uMagAxis, magAxis);
  gl.uniform1f(AU.uMagField, state.magnet);
  gl.uniform1f(AU.uAurora, state.aurora);
  gl.uniform1f(AU.uAtmo, state.atmo);
  gl.uniform1f(AU.uStarFlux, starFlux);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
}

function drawFrame(now){
  if(!prog) return;
  const t = (now - t0)/1000;

  /* камера */
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const pos = [cam.dist*cp*Math.sin(cam.yaw), cam.dist*sp, cam.dist*cp*Math.cos(cam.yaw)];
  const fwd = norm3([-pos[0], -pos[1], -pos[2]]);
  const rgt = norm3(cross3(fwd, [0,1,0]));
  const up  = cross3(rgt, fwd);
  const camMat = [rgt[0],rgt[1],rgt[2], up[0],up[1],up[2], fwd[0],fwd[1],fwd[2]];

  const rotS = m3axis(world.axis, -(t*SPIN + world.surfOff));
  const rotC = m3axis(world.axis, -(t*SPIN*1.35 + world.cloudOff));
  /* Ярусы движутся с разной скоростью и в разные стороны: нижний обгоняет
     поверхность, средний отстаёт (дрейф на запад), верхний уносит струйное
     течение — это и даёт ощущение конвекции. */
  const rotC2 = m3axis(world.axis, -(t*SPIN*0.72 + world.cloudOff*1.7));
  const rotC3 = m3axis(world.axis, -(t*SPIN*2.60 + world.cloudOff*2.3));
  const sunDir = norm3([Math.cos(sunEl)*Math.sin(sunAz), Math.sin(sunEl), Math.cos(sunEl)*Math.cos(sunAz)]);

  gl.uniform2f(U.uRes, canvas.width, canvas.height);
  gl.uniform1f(U.uTime, t);
  gl.uniform3fv(U.uCamPos, pos);
  gl.uniformMatrix3fv(U.uCamMat, false, camMat);
  gl.uniform1f(U.uFocal, FOCAL);
  gl.uniform1f(U.uCamDist, cam.dist);
  gl.uniform1f(U.uPixA, (52*Math.PI/180)/canvas.height);
  gl.uniformMatrix3fv(U.uRotS, false, rotS);
  gl.uniformMatrix3fv(U.uRotC, false, rotC);
  gl.uniformMatrix3fv(U.uRotCInv, false, m3t(rotC));
  gl.uniformMatrix3fv(U.uRotC2, false, rotC2);
  gl.uniformMatrix3fv(U.uRotC3, false, rotC3);
  gl.uniform3fv(U.uSunDir, sunDir);

  /* Большинство параметров неизменны между кадрами. Раньше ~25 uniform calls
     уходили в драйвер 60 раз/с даже при совершенно неподвижных слайдерах. */
  const magAxis = currentMagAxis();
  if(appliedUniformRevision !== renderUniformRevision){
    gl.uniform3fv(U.uAxis, world.axis);
    gl.uniform3fv(U.uMilky, world.milky);
    gl.uniform1f(U.uTemp, state.temp);
    gl.uniform1f(U.uCloudLow, state.cloudLow);
    gl.uniform1f(U.uCloudMid, state.cloudMid);
    gl.uniform1f(U.uCloudHigh, state.cloudHigh);
    gl.uniform1f(U.uSea, state.sea);
    gl.uniform1f(U.uCont, state.cont);
    gl.uniform1f(U.uTect, state.tect);
    gl.uniform1f(U.uIsle, state.isle);
    gl.uniform1f(U.uLake, state.lake);
    gl.uniform1f(U.uCity, state.city);
    gl.uniform1f(U.uAtmo, state.atmo);
    const starCol = starTempToColor(state.star);
    const starPhys = starPhysics(state.star, state.luminosity);
    const distInfo = distanceInfo(state.distance);
    gl.uniform3fv(U.uStarCol, starCol);
    gl.uniform1f(U.uStarRadius, Math.min(2.8, Math.max(0.45, starPhys.R)));
    gl.uniform1f(U.uStarFlux, starPhys.L / Math.max(distInfo.au*distInfo.au, 0.02));
    gl.uniform1f(U.uStarDist, distInfo.au);
    gl.uniform1f(U.uAtmoComp, state.atmoComp);
    gl.uniform1f(U.uWind, state.wind);
    gl.uniform1f(U.uConvection, state.convection);
    gl.uniform1f(U.uMagField, state.magnet);
    gl.uniform1f(U.uAurora, state.auroraOn ? state.aurora : 0);
    gl.uniform3fv(U.uMagAxis, magAxis);
    gl.uniform1f(U.uLowOn, state.lowOn ? 1 : 0);
    gl.uniform1f(U.uMidOn, state.midOn ? 1 : 0);
    gl.uniform1f(U.uHighOn, state.highOn ? 1 : 0);
    gl.uniform1f(U.uRingsOn, state.rings ? 1 : 0);
    gl.uniform1f(U.uRingInner, state.ringInner);
    gl.uniform1f(U.uRingWidth, state.ringWidth);
    gl.uniform1f(U.uRingDens, state.ringDens);
    gl.uniform1f(U.uRingCount, state.ringCount);
    gl.uniform1f(U.uRingMaterial, state.ringMat);
    gl.uniform1f(U.uDraft, state.draft ? 1 : 0);
    gl.uniform1f(U.uVoid, state.voidbg ? 1 : 0);
    gl.uniform1f(U.uPlatesOn, state.platesOn ? 1 : 0);
    gl.uniform1f(U.uVolcano, state.volcano);
    gl.uniform1f(U.uLava, state.lava);
    gl.uniform1f(U.uStorm, state.storm);
    gl.uniform1f(U.uRingGrain, state.ringGrain);
    gl.uniformMatrix3fv(U.uRingMat, false, world.ringMat);
    gl.uniform3fv(U.uSeedS, world.seedS);
    gl.uniform3fv(U.uSeedC, world.seedC);
    gl.uniform4fv(U.uCycA, world.cycA);
    gl.uniform4fv(U.uCycB, world.cycB);
    gl.uniform1i(U.uPlateN, world.plateN);
    gl.uniform4fv(U.uPlateP, world.plateP);
    gl.uniform4fv(U.uPlateW, world.plateW);
    appliedUniformRevision = renderUniformRevision;
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  drawAuroraWebGL(t, pos, camMat, magAxis, sunDir);
  drawMagnetosphereOverlay(t, pos, rgt, up, fwd, magAxis, sunDir);
}

function loop(now){
  const dt = Math.min(now - lastNow, 100);
  lastNow = now;
  frameMsEwma += (dt-frameMsEwma)*0.06;
  if(qualityCooldown > 0) qualityCooldown--;

  /* инерция */
  if(pointers.size === 0){
    cam.yaw   += cam.vyaw   * dt/1000;
    cam.pitch += cam.vpitch * dt/1000;
    cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
    const damp = Math.pow(0.0025, dt/1000);
    cam.vyaw *= damp; cam.vpitch *= damp;
  }
  cam.dist += (cam.tDist - cam.dist) * (1 - Math.pow(0.0001, dt/1000));

  fitCanvas();
  frameCount++;
  /* Полная программа линкуется в фоне; здесь только опрос готовности.
     Первые кадры пропускаем: без KHR_parallel_shader_compile опрос сводится
     к блокирующему getProgramParameter(), и он не должен случиться раньше,
     чем упрощённый рендер успеет нарисовать и показать первый кадр. */
  if(frameCount > 2) pollShaderCompile();
  if(programSwapPending){
    programSwapPending = false;
    markRenderUniformsDirty();
    /* Замеры от упрощённого рендера не должны задирать масштаб под полный. */
    frameMsEwma = 16.7;
    qualityCooldown = 45;
  }
  pollGpuTimer();

  /* Пока идёт фоновая линковка, кадры рисует упрощённая программа. Её
     время не должно управлять renderScale основного шейдера. */
  const measure = fullShaderDone && gpuTimerExt && !gpuTimerPending && frameCount > 12 && (frameCount % 45 === 17) && !document.hidden;
  if(measure) beginGpuTimer();
  drawFrame(now);
  if(measure) endGpuTimer();

  /* На браузерах без timer-query используем сглаженное фактическое время
     кадра. Это менее точно из-за VSync, зато полностью без блокировок. */
  if(fullShaderDone && !gpuTimerExt && frameCount > 40 && frameCount % 45 === 0){
    tuneRenderScale(frameMsEwma);
  }
  requestAnimationFrame(loop);
}

/* ============ старт ============ */
loadHash();
deriveWorld();
syncUI();
fitCanvas();
requestAnimationFrame(loop);
