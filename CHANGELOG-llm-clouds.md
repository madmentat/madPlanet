# madPlanet — текущая итерация

- Рабочий архив сохраняет исходную папку `madPlanet_opencode/`: можно полностью распаковать поверх старой папки.
- `deploy.ps1` теперь ВСЕГДА пересобирает `index.html`, загружает его во временный файл, атомарно заменяет production-файл и проверяет SHA-256.
- Облака: убрана глобальная зональная растяжка, добавлены компактные 3D-подобные puff/cellular-детали, а максимум облачности переводит систему в сплошной покров.
- Молнии разрешаются только при наличии грозовой погоды и низкой облачной массы.
- Магнитосфера: сила, наклон и азимут магнитной оси; сияния стали заметнее.
- Звезда: видимый размер зависит от физического радиуса и расстояния; светимость влияет на поток/яркость.
- В интерфейсе сохранены раскрывающиеся рубрики Планета / Поверхность / Климат / Атмосфера / Магнитосфера / Звезда.
- В зоне звезды показываются светимость/радиус/масса и положение относительно зоны Златовласки.

## 0.5-clouds
- Удалено направленное растяжение облачного поля по широте/меридиану.
- Основное поле облаков теперь изотропное 3D: округлые массы, сросшиеся кластеры, кучевые выпуклости.
- Максимальная облачность даёт сплошное покрывало без «спиц».
- Перистые ограничены редкими локальными полями.
- Нижний ярус: 6 выборок по толщине с вертикальным профилем.


## 2026-08-26 — aurora / magnetosphere
- Исправлена геометрия аврорального овала: старый центр около 20° магнитной широты заменён на 75°→59.5° в зависимости от Kp.
- Сияние перенесено с поверхности на отдельную атмосферную оболочку и теперь видно на лимбе.
- Добавлены магнитные шторы, ночная модуляция, мягкая day/night-асимметрия и высотная цветовая смесь.
- Добавлена интерактивная визуализация дипольных L-оболочек с частицами и опциональными footpoint-маркерами.
- deploy.ps1 заменён на актуальную пользовательскую версию.

## 0.5.1 — build integrity + safe performance

- Added hard build guards for strict UTF-8 and exactly one `<script>` / `</script>` pair; broken assembly now fails instead of being packaged.
- Restored and labelled the compatibility renderer for drivers that reject the full procedural shader; removed the misleading green diagnostic bands.
- Removed synchronous `gl.finish()` GPU stalls from automatic quality tuning; uses asynchronous timer queries where available.
- Cached static WebGL uniforms and magnetic-axis calculations; canvas resize work now runs only when required.
- Magnetosphere overlay does no per-frame work while disabled and batches field-line drawing when `Path2D` is available.
- Reduced the expensive low-cloud volume integration from six fixed samples to three, with optical-depth compensation. No derivative terrain-normal optimization is used in this release.
- Release archives now use monotonically increasing patch versions: `madPlanet-X.Y.Z.zip`.

## 0.5.2 — PowerShell deploy compatibility

- Fixed a Windows PowerShell 5.1 parser failure caused by literal Cyrillic UTF-8 text inside `deploy.ps1`.
- `deploy.ps1` is now pure ASCII; Cyrillic UTF-8 sentinels are generated from Unicode code points at runtime.
- Deployment validates strict UTF-8, one `<script>` pair, embedded shader presence, and remote SHA-256 without rebuilding by default.
- Safe performance improvements from 0.5.1 are retained unchanged: no synchronous `gl.finish()`, async GPU timing, cached static uniforms, resize-on-change, idle magnetosphere skip/batching, and low-cloud integration reduced from 6 to 3 samples.


## 0.5.3 — mobile quality + aurora morphology + wordmark

- Fixed the Android/mobile framebuffer scale model: initial scale is now near native CSS resolution, the destructive 0.42 floor is gone, and adaptive quality targets about 30 fps on mobile.
- Reworked aurora morphology to use broken active sectors, two offset arcs and slanted curtain coordinates; removed the continuous oval contribution responsible for the green "eye" appearance from polar view.
- Enlarged the madPlanet wordmark and added visible `v0.5.3` below it, above the world number.
- Added visual regression guards for mobile scale, auroral segmentation/non-radial curtains and visible version consistency.


## 0.5.4 — Chromium compatibility + split aurora pass
- Moved aurora rendering out of the monolithic planet fragment shader into a separate small additive pass.
- Added a compact procedural compatibility renderer for desktop Chromium/ANGLE when the full shader is rejected.
- Added explicit build/version stamping so deploy cannot silently publish a stale index.html.
- Kept the 0.5.3 Android quality profile and existing safe performance optimizations.


## 0.5.5 — cumulus + aurora rebuild
- Lower deck now uses isotropic rounded Worley/metaball lobes at two scales; removed curl-based shape warping from the default cumulus path.
- Sharper aligned lower-cloud shadows; middle/high layers default off.
- Aurora is now a thin volumetric atmospheric shell with broken noisy arcs and irregular folds instead of periodic radial/grid patterns.

## 0.5.6 — cauliflower cumulus + shadow toggle fix

- Cloud shadows are now gated by the same low/mid layer toggles as the visible clouds.
- Lightning is also gated by the lower-cloud toggle.
- Removed Worley/cellular geometry from the lower cloud macro-shape; the new shape uses isotropic multi-scale fBm and billow/turbulence detail to avoid both spokes and microscope-like bubbles.

## 0.5.7 — independent cloud layers + climate zoning
- Added independent lower/middle/upper cloud amount sliders.
- Added v2 URL hash format with migration from the old shared cloud amount.
- Lower and middle clouds now use surface climate suitability; hot dry continental zones strongly suppress dense low cloud.
- Rebuilt lower cumulus morphology around coherent cloud banks with scalloped edges instead of cellular/billow blobs.
- Aurora, build/deploy and Chromium fallback architecture left unchanged.

## 0.5.19 — независающий запуск, плавное рассеивание облаков, тёмная ночная сторона

(Собрано от ветки 0.5.7 из `C:\Codex_workshop\madPlanet`. Правки 0.5.9-0.5.18 из
`madPlanet_opencode` в эту сборку не входят.)

**Загрузка.** Основной фрагментный шейдер линковался в ANGLE/D3D минутами и на
части драйверов не собирался вовсе. Пока это происходило, `getProgramParameter(LINK_STATUS)`
держал главный поток, поэтому вкладка стояла белой. Хуже того: неудачная линковка
не попадает в дисковый кэш программ Chrome, и попытка повторялась при каждой
загрузке — отсюда «десять минут каждый раз».

- Компактный совместимый рендер собирается первым и рисует планету сразу;
  основная программа линкуется в фоне через `KHR_parallel_shader_compile`, а
  готовность опрашивается по кадрам. Ни одного блокирующего вызова до первого кадра.
- Пока идёт сборка, в углу висит надпись с таймером; по готовности рендер
  переключается сам. Если полный шейдер отвергнут, остаётся подписанный
  совместимый рендер, как и раньше.
- Стоимость линковки снижена примерно втрое, и теперь она проходит успешно —
  значит, попадает в кэш программ: повторные заходы стартуют мгновенно.
  Основные источники были: шесть развёрнутых грозовых ячеек, каждая со своим
  прогоном погоды и полного рельефа, и по копии `lowCloudClimate()` на каждый
  ярус облаков и каждую карту теней.
- Молнии оценивают грозу по обстановке в самой точке кадра; климат ярусов
  считается один раз на пиксель; `lightningGlow()` и объём нижнего яруса
  инлайнятся по разу, а не по четыре-шесть.

**Облака над засушливыми зонами.** Пригодность бралась в точке под облаком и
резала облачную массу по береговой линии как по линейке, а на дальнем краю зоны
облако возникало снова в прежней конфигурации — оно словно ныряло под материк и
выныривало из-под него.

- Пригодность усредняется вдоль наветренного следа длиной ~1000 км: воздух
  теряет влагу постепенно, пока идёт над сушей, и так же постепенно насыщается
  снова. За засушливой зоной остаётся подветренный сухой шлейф.
- Фаза отсчётов сдвигается низкочастотным шумом облачной системы, поэтому
  дискретные отсчёты не читаются как «гребёнка» на косой границе.
- Переход океан→суша растянут по высоте, спад над пустыней плавный и с
  остатком, а граница зоны размывается отдельным облачным полем.
- Тени на поверхности берут ровно то же поле, что и видимое облако.

**Ночная подсветка облаков.** Рассеяние вперёд добавлялось без учёта
освещённости, а его множитель максимален как раз тогда, когда камера смотрит в
сторону звезды, то есть на ночную сторону. Теперь вклад гасится освещённостью:
серебряная кромка на просвет у терминатора и на лимбе осталась, ночная сторона
стала тёмной.

**Цена.** Кадр в конфигурации по умолчанию стал примерно на 9 % дороже из-за
выборки климата по следу (1280x800, RTX 3060: 25.2 -> 27.5 мс). Там, где раньше
работали молнии или средний ярус, стало заметно дешевле.

## 0.5.20 — тектонические плиты вместо шумовых бугров

Ползунок «Горы» переименован в **«Тектонику»**: он больше не задаёт силу
ridged-шума, размазанного широкими поясами по всей суше, а управляет
активностью плит.

- Планета разбита на 9-13 плит — мозаика Вороного на сфере. У каждой свой
  вектор Эйлера, поэтому скорость её точки равна `w x r`.
- Рельеф рождается на швах: относительная скорость соседей вдоль нормали к шву
  решает, вырастет там **хребет** (сжатие) или просядет **рифт** (растяжение).
  Отсюда протяжённые цепи с осью и подветренной стороной вместо «блямб».
- Швы намеренно **ломаные**: точка, по которой ищутся плиты, коробится шумом
  в нескольких октавах. Ровные дуги Вороного читались как искусственные.
- Поле непрерывно по построению. Вклад считается **по всем парам плит сразу**:
  любой выбор «ближайший + второй сосед» рвётся там, где меняется личность
  выбранного, и у тройных стыков от этого по рельефу шли прямые борозды.
  Смещение варпа задаётся тремя компонентами, а не в касательной рамке —
  рамка от фиксированной оси вырождается на её полюсах, и оттуда разрывы
  расходились веером.
- **Снеговая линия** привязана к орогенной высоте, а не к общей: плоскогорья
  снега не получают, хребты получают, и тем выше по склону, чем теплее у
  подножия.
- **Опустынивание**: сухо там, где жарко, далеко от моря и наветренный хребет
  уже отжал влагу. Дождевая тень достаётся даром — тектоника знает и
  направление на ближайший шов, и расстояние до него, так что отдельные пробы
  вверх по ветру не нужны. Пустыня упирается в хребет и за ним обрывается, а у
  берега ей противостоит увлажнение с моря.

**Цена.** Линковка выросла примерно на треть (RTX 3060, ANGLE/D3D11: ~190 ->
~250 с холодного старта); кэш программ Chrome по-прежнему делает повторные
загрузки мгновенными, а до готовности полного шейдера работает упрощённый
рендер.

**Совместимость.** Модель рельефа сменилась целиком, поэтому один и тот же сид
даёт другую планету: старые ссылки показывают новые миры. Это осознанный выбор
— держать в шейдере две модели рельефа дорого именно там, где мы боролись за
время компиляции.

## 0.5.23 — починка ссылок и панелей, материал колец, кромка шапки, снег на хребтах

**Исправлено: у старых ссылок пропадали звёзды и солнце.** Формат хэша
позиционный, и добавление трёх ползунков колец в 0.5.22 сдвинуло все флаги:
в старой ссылке «средний ярус облаков» попадал на место «пустого космоса», а
«нижний ярус» — на место «черновика». Теперь хэш несёт версию и число
параметров (`v3,N,...`), поэтому читатель знает, где кончаются ползунки и
начинаются флаги. Ссылки формата `v2` мигрируются по именам параметров, а не
по позициям, — с учётом того, что «Горы» стали «Тектоникой».

**Исправлено: панель настроек трудно закрыть.** Крестик был областью 18x18 px
— попасть в него пальцем почти невозможно. Зона нажатия увеличена до 36x36 при
той же иконке, и добавлены два запасных способа: Escape и щелчок мимо панели.

**Кольца.** Добавлены «Число колец» (система расслаивается резонансами на
отдельные полосы с промежутками) и «Материал»: лёд — камень — пыль. Материал
меняет и цвет, и то, насколько кольцо светится на просвет: ледяные частицы
рассеивают вперёд заметно охотнее пыли.

**Полярная шапка.** Кромка больше не окружность. Температура падает по широте
ровно, и граница ложилась правильным кругом; теперь у самой кромки добавлено
крупномасштабное возмущение, поэтому лёд где-то спускается языком далеко к
экватору, где-то отступает, и встречаются отдельные пятна.

**Снег на хребтах.** Раньше он ложился сплошным одеялом. Теперь с крутых стенок
его сдувает, днища каньонов остаются голыми, а сплошная шапка держится ближе к
гребням — появился контраст между белым верхом и камнем рядом.

**Замечание о масштабе.** Рельеф у нас нигде не смещает геометрию: луч всегда
пересекает сферу радиуса 1, а высота работает только через цвет и нормаль.
Так что стокилометровых гор на планете нет — есть карта высот в условных
единицах, которой рисуется светотень.
