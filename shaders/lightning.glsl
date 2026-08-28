/* ---------- молнии ---------- */
/* cloudA — фактическая непрозрачность нижнего яруса в этом пикселе, уже
   посчитанная в main(). Раньше каждая из шести грозовых ячеек проверялась
   по weather() и lowCover() в её собственном центре. Эти величины не
   зависят от пикселя, но цикл разворачивался, и в шейдер попадало шесть
   копий погоды и шесть полных копий рельефа — самый дорогой фрагмент всей
   программы при линковке и на каждый кадр. Гроза оценивается по обстановке
   в самой точке кадра: свечение всё равно локально (радиус ~0.1 рад), а
   main() и без того вызывает разряд только там, где есть облачная масса. */
vec3 lightningGlow(vec3 dirW, float cloudA){
  vec3 acc = vec3(0.0);
  if(uLowOn < 0.5 || uCloudLow < 0.05) return acc;
  /* Пороги были подобраны так, что разряд разрешался редко: гроза должна
     была быть сильной и облако плотным одновременно. Смягчено — вспышки
     всё ещё только на ночной стороне и только под облаком, но встречаются
     заметно чаще. */
  float storm = gWx.w;
  if(storm < 0.09) return acc;
  if(cloudA < mix(0.05, 0.20, storm)) return acc;
  for(int i=0;i<6;i++){
    float fi = float(i);
    float per = 0.72 + fi*0.41;
    float ph = uTime/per + fi*7.77;
    float cyc = floor(ph);
    float fr = fract(ph);
    /* Модель конденсатора: быстрый разряд → медленная перезарядка.
       Первый удар — яркий, второй — 70% интенсивности. */
    float capPhase = fract(uTime*per*0.7 + fi*3.14);
    float discharge = exp(-capPhase * 8.0);
    float recharge = 1.0 - exp(-capPhase * 2.0);
    float capFlick = discharge * recharge;
    float capPhase2 = fract(uTime*per*0.73 + fi*3.14 + 0.4);
    float capFlick2 = exp(-capPhase2 * 12.0) * (1.0 - exp(-capPhase2 * 3.0));
    float win = max(capFlick, capFlick2 * 0.7);
    /* Старая модель для обратной совместимости — микс с новой */
    float winLegacy = ss(0.0,0.012,fr)*(1.0-ss(0.025,0.08,fr))
              + 0.7*(ss(0.10,0.112,fr)*(1.0-ss(0.125,0.17,fr)));
    win = max(win, winLegacy * 0.5);
    if(win < 0.002) continue;
    vec3 hh = hash33(vec3(cyc*13.1+fi*71.7, cyc*7.7+3.3, fi*29.3) + uSeedC);
    vec3 fpC = normalize(hh*2.0-1.0);
    vec3 fp = uRotCInv * fpC;
    if(dot(fp, uSunDir) > -0.1) continue;      /* только ночная сторона */
    float ang = distance(dirW, fp);
    /* Трёхкомпонентное свечение: ядро + ветви + диффузия */
    float core = min(exp(-ang*ang*2500.0), 0.4) * 5.0;
    float angAtan = atan(dirW.z - fp.z, dirW.x - fp.x);
    float branch = exp(-ang*ang*400.0) * (1.0 + 0.3*sin(angAtan*7.0));
    float diffuse = exp(-ang*ang*60.0) * 0.15;
    float g = core + branch * 0.6 + diffuse;
    acc += vec3(0.72,0.80,1.0) * g * win * 4.6;
  }
  return acc;
}

