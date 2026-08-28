/* ============ состояние ============ */
const PARAMS = [
  {k:'temp',       label:'Температура',           def:0.52, group:'Планета'},
  {k:'sea',        label:'Океан',                 def:0.58, group:'Планета'},
  {k:'cont',       label:'Материки',              def:0.45, group:'Планета'},
  {k:'tect',       label:'Тектоника',             def:0.55, group:'Планета'},
  {k:'isle',       label:'Острова',                def:0.45, group:'Планета'},
  {k:'lake',       label:'Озёра',                 def:0.45, group:'Планета'},
  {k:'city',       label:'Огни городов',           def:0.55, group:'Поверхность'},
  {k:'volcano',    label:'Вулканизм',              def:0.35, group:'Поверхность'},
  {k:'lava',       label:'Свечение лавы',          def:0.55, group:'Поверхность'},
  {k:'ringInner',  label:'Радиус колец',           def:0.40, group:'Кольца'},
  {k:'ringWidth',  label:'Ширина колец',           def:0.62, group:'Кольца'},
  {k:'ringDens',   label:'Плотность колец',        def:0.60, group:'Кольца'},
  {k:'ringCount',  label:'Число колец',            def:0.45, group:'Кольца'},
  {k:'ringMat',    label:'Материал колец',         def:0.35, group:'Кольца'},
  {k:'cloudLow',   label:'Нижний слой',            def:0.48, group:'Климат'},
  {k:'cloudMid',   label:'Средний слой',            def:0.44, group:'Климат'},
  {k:'cloudHigh',  label:'Верхний слой',             def:0.30, group:'Климат'},
  {k:'wind',       label:'Ветры',                  def:0.55, group:'Климат'},
  {k:'convection', label:'Конвекция',              def:0.55, group:'Климат'},
  {k:'atmo',       label:'Плотность атмосферы',    def:0.60, group:'Атмосфера'},
  {k:'atmoComp',   label:'Состав атмосферы',       def:0.00, group:'Атмосфера'},
  {k:'magnet',     label:'Мощность магнитного поля', def:0.52, group:'Магнитосфера'},
  {k:'magTilt',    label:'Наклон магнитной оси',    def:0.50, group:'Магнитосфера'},
  {k:'magAzimuth', label:'Направление магнитной оси',def:0.50, group:'Магнитосфера'},
  {k:'aurora',     label:'Солнечная активность (Kp)', def:0.62, group:'Магнитосфера'},
  {k:'star',       label:'Спектральный класс',     def:0.38, group:'Звезда'},
  {k:'luminosity', label:'Светимость',              def:0.43, group:'Звезда'},
  {k:'distance',   label:'Расстояние',              def:0.51, group:'Звезда'},
];
const state = {seed: 8127344, rings: false, draft: false, voidbg: false, platesOn: false,
               texShow: false, lowOn: true, midOn: false, highOn: false,
               auroraOn: true, fieldLinesOn: false, auroraFootpoints: false};
PARAMS.forEach(p => state[p.k] = p.def);

/* Спектральный класс звезды → цвет RGB.
   Класс: M(0) K(0.17) G(0.43) F(0.57) A(0.71) B(0.86) O(1.0).
   Аппроксимация по цветовой температуре чёрного тела. */
const STAR_LABELS = ['M','K','G','F','A','B','O'];
function starPhysics(t, lumT=0.52){
  const T = 3000 * Math.pow(40000/3000, Math.max(0, Math.min(1, t)));
  const L = 0.12 * Math.pow(24.0/0.12, Math.max(0, Math.min(1, lumT)));
  /* Условная масса по главной последовательности и радиус из L=4πR²T⁴. */
  const M = Math.pow(L, 1/3.8);
  const R = Math.sqrt(L) * Math.pow(5772/T, 2);
  const hz = Math.sqrt(L);
  return {T,L,M,R,hz};
}
function starTempToColor(t){
  const T = starPhysics(t).T;
  let r,g,b;
  if(T < 6600){
    r=1.0; g=Math.max(0,Math.min(1,0.3912*Math.log(T/100)-0.6298));
    b=T<=1900?0.0:Math.max(0,Math.min(1,0.5432*Math.log(T/100-10)-1.1418));
  }else{
    r=Math.max(0,Math.min(1,1.292*Math.pow(T/100-60,-0.1332)));
    g=Math.max(0,Math.min(1,1.129*Math.pow(T/100-60,-0.0755)));
    b=1.0;
  }
  const mx=Math.max(r,g,b)||1; return [r/mx,g/mx,b/mx];
}
function starLabel(t){
  const idx = Math.min(6, Math.floor(t * 7));
  return STAR_LABELS[idx];
}

function luminosityLabel(v){ const x=starPhysics(state?.star ?? 0.38,v); return x.L.toFixed(2)+'L · '+x.R.toFixed(2)+'R · '+x.M.toFixed(2)+'M'; }
function distanceInfo(v){
  const au = 0.22 * Math.pow(4.8/0.22, Math.max(0,Math.min(1,v)));
  const hz = starPhysics(state?.star ?? 0.43, state?.luminosity ?? 0.52).hz;
  const q = au/hz;
  return {au, hz, q, label:au.toFixed(2)+' AU · '+(q<0.78?'холодная зона':q>1.45?'горячая зона':'зона Златовласки')};
}
/* Подпись материала колец: лёд - камень - пыль. */
function ringMatLabel(t){
  if(t < 0.28) return 'лёд';
  if(t < 0.45) return 'лёд/камень';
  if(t < 0.62) return 'камень';
  if(t < 0.80) return 'камень/пыль';
  return 'пыль';
}
function atmoLabel(t){
  if(t < 0.12) return 'N₂/O₂';
  if(t < 0.37) return 'CO₂';
  if(t < 0.62) return 'CO₂+H₂SO₄';
  if(t < 0.87) return 'N₂+CH₄';
  return 'H₂/He';
}

function auroraKpLabel(v){ return 'Kp '+(Math.max(0,Math.min(1,v))*9).toFixed(1); }
function auroraLatitudeRad(v=state.aurora){
  const a=Math.max(0,Math.min(1,v));
  return (75.0 - 15.5*a) * Math.PI/180;
}

let world = null;
function deriveWorld(){
  const r = mulberry32(Math.imul(state.seed ^ 0x9E3779B9, 0x85EBCA6B) >>> 0);
  const rv = () => r()*2-1;
  const tilt = (r()*0.5-0.25) + 0.18;                  // наклон оси ~ -4°…+25°
  const axis = norm3([Math.sin(tilt), Math.cos(tilt), r()*0.12-0.06]);
  /* Магнитная ось теперь управляется параметрами, а не случайным вектором.
     magTilt: -40..+40° относительно оси вращения; magAzimuth: 0..360°. */
  const magTilt = (state.magTilt - 0.5) * 1.3962634;
  const magAzimuth = state.magAzimuth * 6.2831853;
  const tMag = norm3(Math.abs(axis[1]) < 0.92 ? cross3(axis,[0,1,0]) : cross3(axis,[1,0,0]));
  const bMag = cross3(axis, tMag);
  const radialMag = norm3([tMag[0]*Math.cos(magAzimuth)+bMag[0]*Math.sin(magAzimuth),
                            tMag[1]*Math.cos(magAzimuth)+bMag[1]*Math.sin(magAzimuth),
                            tMag[2]*Math.cos(magAzimuth)+bMag[2]*Math.sin(magAzimuth)]);
  const magAxis = norm3([axis[0]*Math.cos(magTilt)+radialMag[0]*Math.sin(magTilt),
                         axis[1]*Math.cos(magTilt)+radialMag[1]*Math.sin(magTilt),
                         axis[2]*Math.cos(magTilt)+radialMag[2]*Math.sin(magTilt)]);
  /* Циклоны: тропические вихри со спиральными рукавами в низких широтах и
     внетропические «запятые» в умеренных. Положение задаётся относительно
     оси планеты, направление вращения — по полушарию. */
  const tA = norm3(Math.abs(axis[1]) < 0.9 ? cross3(axis,[0,1,0]) : cross3(axis,[1,0,0]));
  const tB = cross3(axis, tA);
  const cycA = [], cycB = [];
  for(let i=0;i<5;i++){
    const tropical = r() < 0.35;
    const hemi = r() < 0.5 ? 1 : -1;
    const latM = tropical ? 0.10 + r()*0.24 : 0.44 + r()*0.36;
    const lat = latM*hemi;
    const az = r()*Math.PI*2;
    const k = Math.sqrt(Math.max(0, 1 - lat*lat));
    const ca = Math.cos(az), sa = Math.sin(az);
    const p = norm3([
      axis[0]*lat + (tA[0]*ca + tB[0]*sa)*k,
      axis[1]*lat + (tA[1]*ca + tB[1]*sa)*k,
      axis[2]*lat + (tA[2]*ca + tB[2]*sa)*k,
    ]);
    const strength = (i === 0) ? 0.75 + r()*0.25
                              : (r() < 0.7 ? 0.40 + r()*0.50 : 0);
    cycA.push(p[0], p[1], p[2], strength);
    cycB.push(tropical ? 0.26 + r()*0.16 : 0.52 + r()*0.34,   // радиус
              hemi,                                            // знак вращения
              tropical ? 1.5 + r()*1.0 : 0.6 + r()*0.7,        // закрутка
              r()*Math.PI*2 - Math.PI);                        // азимут фронта
  }
  /* ---- тектонические плиты ----
     Мозаика Вороного на сфере: точки раскладываются по спирали Фибоначчи,
     чтобы плиты вышли сопоставимого размера, затем сбиваются джиттером и
     поворачиваются целиком — иначе у всех миров швы легли бы одинаково.
     Каждой плите даётся вектор Эйлера: скорость её точки равна w x r, а
     знак сближения соседей на шве решает, вырастет там хребет или рифт. */
  const plateN = 9 + Math.floor(r()*5);
  const plateP = [], plateW = [];
  const golden = Math.PI*(3-Math.sqrt(5));
  const plateRot = m3axis(norm3([rv(), rv(), rv()]), r()*6.2831853);
  for(let i=0;i<plateN;i++){
    const y = 1 - 2*(i+0.5)/plateN;
    const ring = Math.sqrt(Math.max(0, 1-y*y));
    const th = golden*i;
    let p = norm3([Math.cos(th)*ring + rv()*0.30,
                   y             + rv()*0.30,
                   Math.sin(th)*ring + rv()*0.30]);
    p = m3v(plateRot, p);
    /* Вес плиты: с ним мозаика становится степенной, и ячейки выходят очень
       разного размера — от океанической громады до осколка между хребтами.
       При равных весах стыки сходились по три под ровные 120°, и хребты
       складывались в правильные звёзды и треугольники. */
    const bias = (Math.pow(r(), 1.7) - 0.32) * 0.28;
    plateP.push(p[0], p[1], p[2], bias);
    const w = norm3([rv(), rv(), rv()]);
    const rate = 0.30 + r()*0.95;
    plateW.push(w[0]*rate, w[1]*rate, w[2]*rate, 0);
  }
  while(plateP.length < 48){ plateP.push(0,0,1,0); plateW.push(0,0,0,0); }

  /* кольца лежат в экваториальной плоскости (нормаль ~ ось планеты) */
  const rn = norm3([axis[0]+rv()*0.10, axis[1], axis[2]+rv()*0.10]);
  const rt = norm3(cross3(rn, [0,0,1]));
  const rb = cross3(rn, rt);
  world = {
    seedS: [rv()*19, rv()*19, rv()*19],
    seedC: [rv()*19, rv()*19, rv()*19],
    axis,
    magAxis,
    cycA, cycB,
    plateN, plateP, plateW,
    milky: norm3([rv(), rv(), rv()]),
    ringMat: [rt[0],rt[1],rt[2], rn[0],rn[1],rn[2], rb[0],rb[1],rb[2]],
    surfOff: r()*6.28,
    cloudOff: r()*6.28,
  };
  document.getElementById('seedLabel').textContent = '№ ' + state.seed;
  document.getElementById('seed').value = state.seed;
}

let magAxisCacheWorld=null, magAxisCacheTilt=NaN, magAxisCacheAz=NaN;
let magAxisCacheValue=[0,1,0];
function currentMagAxis(){
  /* Ось меняется только при новом world или движении двух магнитных слайдеров;
     не пересчитываем sin/cos/cross + пачку временных массивов 60 раз/с. */
  if(magAxisCacheWorld===world && magAxisCacheTilt===state.magTilt && magAxisCacheAz===state.magAzimuth)
    return magAxisCacheValue;
  const a = world?.axis || [0,1,0];
  const mt = (state.magTilt - 0.5) * 1.3962634;
  const ma = state.magAzimuth * Math.PI * 2;
  const tv = Math.abs(a[1]) < 0.92 ? cross3(a,[0,1,0]) : cross3(a,[1,0,0]);
  const tmag = norm3(tv);
  const bmag = cross3(a,tmag);
  const radial = norm3([
    tmag[0]*Math.cos(ma)+bmag[0]*Math.sin(ma),
    tmag[1]*Math.cos(ma)+bmag[1]*Math.sin(ma),
    tmag[2]*Math.cos(ma)+bmag[2]*Math.sin(ma)
  ]);
  magAxisCacheValue = norm3([
    a[0]*Math.cos(mt)+radial[0]*Math.sin(mt),
    a[1]*Math.cos(mt)+radial[1]*Math.sin(mt),
    a[2]*Math.cos(mt)+radial[2]*Math.sin(mt)
  ]);
  magAxisCacheWorld=world;
  magAxisCacheTilt=state.magTilt;
  magAxisCacheAz=state.magAzimuth;
  return magAxisCacheValue;
}

