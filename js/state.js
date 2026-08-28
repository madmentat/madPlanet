/* ============ состояние ============ */
const PARAMS = [
  {k:'temp',       label:'Средняя температура',   def:0.52, group:'Планета', derived:'temp'},
  {k:'sea',        label:'Океан',                 def:0.58, group:'Планета'},
  {k:'cont',       label:'Материки',              def:0.45, group:'Планета'},
  {k:'tect',       label:'Тектоника',             def:0.55, group:'Планета'},
  {k:'isle',       label:'Острова',                def:0.45, group:'Планета'},
  {k:'lake',       label:'Озёра',                 def:0.45, group:'Планета'},
  {k:'snowAlt',    label:'Высота снеговой линии', def:0.45, group:'Планета'},
  {k:'city',       label:'Огни городов',           def:0.55, group:'Поверхность'},
  {k:'volcano',    label:'Вулканизм',              def:0.35, group:'Поверхность', base:true},
  {k:'lava',       label:'Свечение лавы',          def:0.55, group:'Поверхность'},
  {k:'ringInner',  label:'Радиус колец',           def:0.40, group:'Кольца'},
  {k:'ringWidth',  label:'Ширина колец',           def:0.62, group:'Кольца'},
  {k:'ringDens',   label:'Плотность колец',        def:0.60, group:'Кольца'},
  {k:'ringCount',  label:'Число колец',            def:0.45, group:'Кольца'},
  {k:'ringMat',    label:'Состав колец',           def:0.20, group:'Кольца'},
  {k:'ringGrain',  label:'Размер частиц',          def:0.45, group:'Кольца'},
  {k:'cloudLow',   label:'Нижний слой',            def:0.48, group:'Погода'},
  {k:'cloudMid',   label:'Средний слой',            def:0.44, group:'Погода'},
  {k:'cloudHigh',  label:'Верхний слой',             def:0.30, group:'Погода'},
  {k:'wind',       label:'Ветры',                  def:0.55, group:'Погода'},
  {k:'convection', label:'Конвекция',              def:0.55, group:'Погода'},
  {k:'storm',      label:'Грозовая активность',    def:0.55, group:'Погода'},
  {k:'stormRate',  label:'Частота вспышек',        def:0.60, group:'Погода'},
  {k:'stormGlow',  label:'Яркость вспышек',        def:0.55, group:'Погода'},
  {k:'atmo',       label:'Плотность атмосферы',    def:0.60, group:'Атмосфера', base:true},
  /* Газы - не один ползунок на всё, а смесь: доли всегда дают в сумме 100%,
     и подъём одного газа пропорционально теснит остальные. Значения по
     умолчанию - земной воздух. Три из них помечены расчётными: их гонит
     вулканизм. */
  {k:'gasN2',      label:'Азот N₂',                def:0.780800, group:'Атмосфера', gas:true},
  {k:'gasO2',      label:'Кислород O₂',            def:0.209500, group:'Атмосфера', gas:true},
  {k:'gasH2O',     label:'Водяной пар H₂O',        def:0.004000, group:'Атмосфера', gas:true, derived:'volcano'},
  {k:'gasCO2',     label:'Углекислый газ CO₂',     def:0.000420, group:'Атмосфера', gas:true, derived:'volcano'},
  {k:'gasSO2',     label:'Диоксид серы SO₂',       def:0.000001, group:'Атмосфера', gas:true, derived:'volcano'},
  {k:'gasCH4',     label:'Метан CH₄',              def:0.000002, group:'Атмосфера', gas:true},
  {k:'gasHHe',     label:'Водород и гелий H₂/He',  def:0.000005, group:'Атмосфера', gas:true},
  {k:'magnet',     label:'Мощность магнитного поля', def:0.52, group:'Магнитосфера'},
  {k:'magTilt',    label:'Наклон магнитной оси',    def:0.50, group:'Магнитосфера'},
  {k:'magAzimuth', label:'Направление магнитной оси',def:0.50, group:'Магнитосфера'},
  {k:'aurora',     label:'Солнечная активность (Kp)', def:0.62, group:'Магнитосфера'},
  {k:'skyStars',   label:'Плотность звёзд',        def:0.55, group:'Небо'},
  {k:'skyMilky',   label:'Млечный Путь',           def:0.60, group:'Небо'},
  {k:'skyNebula',  label:'Туманности',             def:0.45, group:'Небо'},
  {k:'skyHue',     label:'Оттенок поля',           def:0.45, group:'Небо'},
  {k:'star',       label:'Спектральный класс',     def:0.38, group:'Звезда'},
  {k:'luminosity', label:'Светимость',              def:0.43, group:'Звезда'},
  {k:'distance',   label:'Расстояние',              def:0.51, group:'Звезда'},
];
/* draft по умолчанию включён: он снимает мелкую детализацию рельефа, верхний
   ярус облаков и лишние слои объёма — картинка выходит чище и вдвое дешевле.
   В интерфейсе это обратный тумблер «Детали». */
const state = {seed: 8127344, rings: false, draft: true, voidbg: false, platesOn: false,
               lowOn: true, midOn: false, highOn: false,
               auroraOn: true, fieldLinesOn: false, auroraFootpoints: false,
               /* Расчётный ползунок можно взять рукой - тогда он закрепляется
                  и перестаёт следовать за базой, пока метку не снимут. */
               pinTemp: false, pinH2O: false, pinCO2: false, pinSO2: false,
               atmoComp: 0.0};
PARAMS.forEach(p => state[p.k] = p.def);

/* ---------- смесь газов ----------
   Доли нормированы: сумма ровно единица, поэтому подъём одного газа
   пропорционально ужимает все прочие. Ползунок логарифмический - газы
   расходятся на семь порядков, и на линейной шкале следовые (CO₂ в 0.04%)
   были бы неотличимы от нуля. */
const GAS_KEYS = PARAMS.filter(p => p.gas).map(p => p.k);
const GAS_MIN = 1e-7;
function gasSliderToVal(x){
  if(x <= 0.004) return 0.0;
  return GAS_MIN * Math.pow(1/GAS_MIN, Math.max(0, Math.min(1, x)));
}
function gasValToSlider(f){
  if(!(f > GAS_MIN)) return 0.0;
  return Math.max(0, Math.min(1, Math.log(f/GAS_MIN)/Math.log(1/GAS_MIN)));
}
function gasFractions(){
  const g = {}; let sum = 0;
  GAS_KEYS.forEach(k => { const v = Math.max(0, state[k]||0); g[k] = v; sum += v; });
  if(sum > 1e-12) GAS_KEYS.forEach(k => g[k] /= sum);
  else g[GAS_KEYS[0]] = 1.0;
  return g;
}
function normalizeGases(){
  const g = gasFractions();
  GAS_KEYS.forEach(k => state[k] = g[k]);
}
/* Конкуренция: заданный газ получает свою долю, остальные делят остаток в
   прежней пропорции между собой. */
function setGasFraction(key, f){
  f = Math.max(0, Math.min(0.999999, f));
  const rest = GAS_KEYS.filter(k => k !== key);
  let sum = 0; rest.forEach(k => sum += Math.max(0, state[k]||0));
  const room = 1 - f;
  if(sum > 1e-12) rest.forEach(k => state[k] = Math.max(0, state[k]||0) * room/sum);
  else rest.forEach(k => state[k] = room/rest.length);
  state[key] = f;
}
function gasLabel(f){
  const pc = f*100;
  if(pc >= 10)    return pc.toFixed(1)+'%';
  if(pc >= 1)     return pc.toFixed(2)+'%';
  if(pc >= 0.01)  return pc.toFixed(3)+'%';
  if(pc >= 1e-5)  return pc.toPrecision(2)+'%';
  return 'следы';
}

/* Значения по умолчанию берутся из состава земного воздуха и в сумме дают
   99.47%: остальное - аргон, который отдельным ползунком не нужен. Смесь
   приводится к единице сразу, чтобы проценты в панели сходились. */
normalizeGases();

/* ---------- вулканизм как база ----------
   Извержение выбрасывает прежде всего водяной пар (до 70-90% массы), затем
   диоксид серы и лишь малую долю углекислого газа. Времена жизни у них
   разные, и это важнее состава: сульфатный аэрозоль вымывается из
   стратосферы за годы, поэтому SO₂ идёт почти вплотную за текущей
   активностью, а CO₂ копится геологическими эпохами - его постоянная
   времени на порядок больше. Отсюда и обещанное поведение: опущенный в ноль
   CO₂ при работающих вулканах медленно восстанавливается сам.
   Порог 0.32 - это земной уровень вулканизма: ниже него добавки нет и
   состав возвращается к фоновому. */
const GAS_TAU = {gasSO2: 1.2, gasH2O: 1.8, gasCO2: 11.0};
const GAS_PIN = {gasSO2: 'pinSO2', gasH2O: 'pinH2O', gasCO2: 'pinCO2'};
function volcanicTargets(){
  const v = Math.max(0, Math.min(1, state.volcano));
  const q = Math.pow(Math.max(0, v-0.32)/0.68, 1.6);
  return {
    gasH2O: 0.004000 + 0.052*q,
    gasSO2: 0.000001 + 0.013*q,
    gasCO2: 0.000420 + 0.078*q,
  };
}

/* ---------- средняя температура планеты ----------
   Считается по-настоящему, а не берётся с ползунка: светимость звезды и
   расстояние дают приток, облака, океан, лёд и сульфатный аэрозоль - альбедо,
   а парниковые газы - добавку сверху. Ледовая обратная связь нелинейна
   (похолодание растит лёд, лёд растит альбедо), поэтому баланс ищется
   несколькими итерациями.
   Калибровка: земные значения дают 254 K равновесных и +33 K парниковых. */
function climateModel(){
  const st = starPhysics(state.star, state.luminosity);
  const au = 0.22*Math.pow(4.8/0.22, Math.max(0,Math.min(1,state.distance)));
  const S  = st.L/(au*au);
  /* Масса столба в земных единицах. */
  const dens = 0.10 + 1.55*Math.max(0,Math.min(1,state.atmo));
  const g = gasFractions();
  /* Парниковая эффективность на единицу доли. Метан на порядок сильнее
     углекислого газа, водяной пар - основной парниковый газ Земли. */
  const tau = dens*(g.gasCO2*180 + g.gasCH4*1400 + g.gasH2O*70
                  + g.gasSO2*40  + g.gasHHe*4);
  /* Сульфатный аэрозоль работает зеркалом, а не одеялом: SO₂ окисляется в
     стратосфере до серной кислоты и отражает свет обратно в космос.
     Пинатубо (18 Мт SO₂) охладил планету примерно на 0.5 °C. */
  const aer = Math.min(0.42, 3.4*Math.sqrt(Math.max(0,g.gasSO2)*dens));
  const cloudCov = Math.max(0, Math.min(1,
      0.55*state.cloudLow + 0.30*state.cloudMid + 0.15*state.cloudHigh));
  let T = 288, A = 0.3;
  for(let i=0;i<6;i++){
    const iceFrac = Math.max(0, Math.min(1, (273.15-T)/55));
    A = Math.max(0.03, Math.min(0.88,
        0.055 + 0.16*(1-state.sea) + 0.30*cloudCov + 0.40*iceFrac + aer));
    T = 278.6*Math.pow(Math.max(S,1e-4)*(1-A), 0.25) + 108*Math.log(1+tau);
  }
  return {T, C: T-273.15, S, au, A, aer, tau, dens};
}
/* Средняя температура <-> положение ползунка. Шкала -78..+97 °C покрывает всё
   от промёрзшего шарика до венерианской печи, а земные +15 °C ложатся
   примерно на середину. */
function tempToSlider(C){ return Math.max(0, Math.min(1, (C+78)/175)); }
function sliderToTemp(v){ return v*175 - 78; }
function tempLabel(){
  const C = state.pinTemp ? sliderToTemp(state.temp) : climateModel().C;
  const a = Math.abs(C);
  const d = a < 10 ? 1 : 0;
  return (C >= 0 ? '+' : '\u2212') + a.toFixed(d) + ' °C';
}

/* Состав для окраски дымки выводится из смеси, а не задаётся отдельно:
   ползунок состава был единственным на все газы сразу. */
function atmoCompFromGases(){
  const g = gasFractions();
  const cl = x => Math.max(0, Math.min(1, x));
  let c = 0.25*cl(g.gasCO2/0.30);
  c = Math.max(c, 0.50*cl((g.gasCO2-0.25)/0.60 + g.gasSO2*8.0));
  c = Math.max(c, 0.75*cl(g.gasCH4/0.06));
  c = Math.max(c, 1.00*cl(g.gasHHe/0.50));
  return cl(c);
}

/* Расчётные ползунки подтягиваются к цели, а не прыгают: постоянные времени
   и есть физика процесса. Незакреплённые следуют за базой, закреплённые
   стоят там, где их поставили. */
function relaxDerived(dtSec){
  const dt = Math.max(0, Math.min(0.5, dtSec));
  let moved = false;
  const tg = volcanicTargets();
  const auto = GAS_KEYS.filter(k => tg[k] !== undefined && !state[GAS_PIN[k]]);
  if(auto.length){
    let sumA = 0;
    const next = {};
    auto.forEach(k => {
      const a = 1 - Math.exp(-dt/GAS_TAU[k]);
      const v = state[k] + (tg[k]-state[k])*a;
      next[k] = Math.max(0, v); sumA += next[k];
      if(Math.abs(v-state[k]) > 1e-9) moved = true;
    });
    if(sumA > 0.97){ const sc = 0.97/sumA; auto.forEach(k => next[k] *= sc); sumA = 0.97; }
    const rest = GAS_KEYS.filter(k => next[k] === undefined);
    let sumR = 0; rest.forEach(k => sumR += Math.max(0, state[k]||0));
    const room = 1 - sumA;
    if(sumR > 1e-12) rest.forEach(k => state[k] = Math.max(0,state[k]||0)*room/sumR);
    else if(rest.length) rest.forEach(k => state[k] = room/rest.length);
    auto.forEach(k => state[k] = next[k]);
  }
  state.atmoComp = atmoCompFromGases();
  if(!state.pinTemp){
    const target = tempToSlider(climateModel().C);
    const a = 1 - Math.exp(-dt/2.2);
    const v = state.temp + (target-state.temp)*a;
    if(Math.abs(v-state.temp) > 1e-5) moved = true;
    state.temp = v;
  }
  return moved;
}

/* Спектральный класс звезды → цвет RGB.
   Класс: M(0) K(0.17) G(0.43) F(0.57) A(0.71) B(0.86) O(1.0).
   Аппроксимация по цветовой температуре чёрного тела. */
/* Пресеты неба. Ползунки остаются доступны: пресет только расставляет их,
   дальше можно крутить руками. */
const SKY_PRESETS = [
  {name:'Тихий космос',        skyStars:0.35, skyMilky:0.25, skyNebula:0.05, skyHue:0.50},
  {name:'Млечный Путь',        skyStars:0.70, skyMilky:0.92, skyNebula:0.28, skyHue:0.45},
  {name:'Туманность',          skyStars:0.50, skyMilky:0.40, skyNebula:0.95, skyHue:0.32},
  {name:'Ядро галактики',      skyStars:0.95, skyMilky:1.00, skyNebula:0.70, skyHue:0.62},
  {name:'Холодная туманность', skyStars:0.45, skyMilky:0.35, skyNebula:0.85, skyHue:0.08},
  {name:'Межгалактическая пустота', skyStars:0.10, skyMilky:0.03, skyNebula:0.02, skyHue:0.50},
];
function applySkyPreset(i){
  const p = SKY_PRESETS[i];
  if(!p) return;
  ['skyStars','skyMilky','skyNebula','skyHue'].forEach(k => { state[k] = p[k]; });
}

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
  if(t < 0.17) return 'водяной лёд';
  if(t < 0.33) return 'лёд + силикаты';
  if(t < 0.50) return 'силикаты';
  if(t < 0.66) return 'силикаты + толины';
  if(t < 0.83) return 'органика (толины)';
  return 'метановый лёд';
}
function ringGrainLabel(t){
  if(t < 0.22) return 'пыль ~1 мкм';
  if(t < 0.45) return 'мелкий песок';
  if(t < 0.70) return 'гравий';
  return 'глыбы';
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
  const plateN = 9 + Math.floor(r()*4);
  const bigPlates = 2 + Math.floor(r()*2);   /* сколько плит-громад */
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
       разного размера. Иерархия взята с земной: две-три громады вроде
       Тихоокеанской и Антарктической, несколько средних и горсть осколков
       уровня Хуана-де-Фука, Кокос и Скотия. При равных весах стыки сходились
       по три под ровные 120°, и хребты складывались в правильные фигуры. */
    const t = (i < bigPlates) ? (0.62 + 0.38*r()) : Math.pow(r(), 2.3);
    const bias = (t - 0.40) * 0.58;
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

