# madPlanet — «Иллюминатор»

Процедурный генератор фотореалистичных планет: полноэкранный рейтрейсинг сферы
в одном фрагментном шейдере WebGL2. Ни Three.js, ни готовых моделей — рельеф,
океаны, биомы, речная сеть, три яруса облаков, грозы, кольца, полярные сияния и
атмосферное рассеяние считаются на лету.

**Живая версия:** https://planet.madmentat.ru

- Мир кодируется в URL-хэше, поэтому ссылкой можно поделиться.
- Управление: ЛКМ — вращать планету, ПКМ — двигать звезду, колесо или щипок — зум.
- Приложение развёртывается одним файлом `index.html` без зависимостей и сборщиков.

## Сборка и запуск

`index.html` — сгенерированный файл; правки вносятся в `index.src.html`, `js/` и
`shaders/`, после чего он пересобирается:

```
.uild.ps1          # Windows PowerShell
bash build.sh        # Linux/macOS (нужен node для финальной проверки)
```

Локальный предпросмотр — любой статический сервер из корня проекта, например
`python -m http.server 8734`.

Тесты (нужен node):

```
bash tests/run-all.sh
```

## Структура

- `shaders/` — GLSL по модулям: шум, рельеф, облака, поверхность, атмосфера, кольца, сияния.
- `js/` — инициализация WebGL, состояние и URL-хэш, камера, интерфейс, цикл рендера, гидрология.
- `tests/` — проверки целостности сборки, защиты от известных регрессий, юнит-тесты гидрологии и магнитосферы.
- `deploy.ps1` / `deploy.sh` — публикация собранного `index.html` (специфичны для сервера автора).


## Обновление без ручной возни
1. Полностью распакуйте содержимое архива поверх старой папки `madPlanet_opencode`, согласившись на замену файлов.
2. Ничего вручную по подпапкам переносить не нужно.
3. Для публикации запустите `deploy.ps1` — он сам пересоберёт `index.html`, загрузит его и проверит SHA-256 на сервере.

`index.html` — сгенерированный deployable-файл; правки вносятся в `index.src.html`, `js/` и `shaders/`.

## Гидрология / речная сеть

В `js/hydrology.js` добавлен независимый CPU-алгоритм построения речной сети по заданным матрицам высот, океана и осадков.

```js
const hydro = generateRiverNetwork({
  Heightmap,
  OceanMask,
  RainfallMap,      // необязательно; без неё суша получает 1.0
  Threshold: 100,
  Seed: 8127344,
});

// Обязательные результаты:
hydro.RiverGraph;
hydro.StreamOrder;
hydro.RiverWidthMap;
hydro.UpdatedHeightmap;
hydro.LakeMask;
```

Дополнительно возвращаются `FlowDir`, `Accum`, `CorrectedHeightmap`, `LocalMinMask`,
`SaltFlatMask`, `StreamOrderMap`, `RiverTerminals` и сведения об озёрах. Направления
D8 детерминированы: `NE, E, SE, S, SW, W, NW, N`.

Проверка без браузера: `node tests/hydrology.test.js`.

## Магнитосфера и полярное сияние

- Авроральный овал считается в геомагнитных координатах относительно управляемой магнитной оси.
- Ползунок «Солнечная активность (Kp)» задаёт Kp≈0…9: при росте активности овал расширяется примерно от 75° к 60° магнитной широты и становится шире/ярче.
- Сияние отрисовывается на отдельной атмосферной оболочке, поэтому видно над лимбом; ночная сторона существенно ярче дневной.
- В панели «Магнитосфера» есть независимые переключатели сияния, дипольных силовых линий и точек входа. Силовые линии используют r=L·sin²θ и имеют бегущие световые импульсы.

## Release/version rule

Starting with 0.5.1, every packaged madPlanet archive gets a unique semantic version and the patch component is incremented by exactly 1 for each new archive: 0.5.1 -> 0.5.2 -> 0.5.3 -> 0.5.4. Do not reuse an old version and do not use ad-hoc suffixes such as `final`, `hotfix2`, or `performance-final`. Archive names use `madPlanet-X.Y.Z.zip`.

A release archive must not be produced if the build-integrity tests fail. In particular, `index.html` must be strict UTF-8, must contain exactly one opening `<script>` and one closing `</script>`, and the assembled JavaScript must pass syntax checking.

For Windows PowerShell 5.1 compatibility, `deploy.ps1` and `build.ps1` must remain ASCII-only source files. Cyrillic validation sentinels in `deploy.ps1` are constructed from Unicode code points rather than embedded as literal text.


## 0.5.3

- Android/mobile rendering now starts near CSS-native resolution instead of 0.55-0.72 framebuffer pixels per CSS pixel; automatic scaling is bounded to preserve spatial detail and targets roughly 30 fps on mobile.
- Aurora rendering uses broken active sectors and two displaced arcs. Curtain phases cross the oval instead of following pure magnetic longitude, removing the polar-view "eye iris" artifact.
- The `madPlanet` wordmark is larger and the running application version is shown directly below it, above the world number.


## 0.5.4
- Split aurora out of the monolithic planet fragment shader into a small additive WebGL pass.
- Added a compact procedural compatibility renderer for Chromium/ANGLE implementations that reject the full shader.
- Compatibility mode remains a real planet renderer (terrain, ocean, climate, simple clouds, atmosphere and stars), not a diagnostic striped globe.
- Deploy now rebuilds the current version by default and rejects stale index.html/version mismatches.


## 0.5.5

- Rebuilt the separate aurora pass as a small volumetric shell raymarch with broken arcs and irregular curtain folds; removed periodic iris/grid logic.
- Rebuilt the default lower cloud layer from isotropic rounded cellular/metaball lobes instead of curl-warped streaks.
- Lower clouds cast a sharper, stronger aligned shadow.
- Middle and high cloud layers are disabled by default; they remain available through the UI.

## 0.5.6

- Fixed cloud shadows remaining on the surface after their cloud layer was disabled.
- Replaced lower-cloud cellular/Worley bubble morphology with isotropic fBm + billow detail for denser cauliflower/cotton-like cumulus silhouettes.
- Lower layer remains enabled by default; middle and upper layers remain disabled by default.

## 0.5.7
Independent lower/middle/upper cloud coverage controls, climate zoning and a rebuilt lower cumulus morphology.

## 0.5.19

- Запуск больше не блокирует вкладку: сначала показывается компактный рендер, полный шейдер линкуется в фоне (`KHR_parallel_shader_compile`) с индикатором и таймером.
- Стоимость линковки в ANGLE/D3D снижена примерно втрое, и она проходит успешно — результат попадает в кэш программ Chrome, поэтому повторные загрузки стартуют мгновенно.
- Облака над засушливыми зонами рассеиваются постепенно: пригодность усредняется вдоль наветренного следа, поэтому облако не срезается по береговой линии и не появляется снова в прежнем виде за дальним краем зоны.
- Ночная сторона больше не «подсвечивается»: рассеяние вперёд гасится освещённостью облака, серебряная кромка у терминатора сохранена.

## 0.5.20

- Ползунок «Горы» стал «Тектоникой»: планета разбита на плиты с векторами Эйлера, и рельеф растёт на швах — хребты там, где плиты сходятся, рифты там, где расходятся.
- Швы ломаные, а поле пояса непрерывно: вклад суммируется по всем парам плит, поэтому у тройных стыков не возникает прямых борозд.
- Снеговая линия следует орогенной высоте, так что шапки появляются на хребтах, а не на плоскогорьях.
- Опустынивание идёт в глубине материков и в дождевой тени хребтов, а у берегов ему противостоит увлажнение с моря.
- Модель рельефа сменилась целиком: тот же сид даёт другую планету.

## 0.5.23

- Хэш в URL теперь версионный и несёт число параметров: добавление ползунка больше не сдвигает флаги и не гасит звёзды у старых ссылок.
- Панель настроек закрывается крестиком (зона нажатия увеличена до 36x36), клавишей Escape и щелчком мимо панели.
- У колец появились число и материал: лёд, камень или пыль.
- Кромка полярной шапки неровная, с языками и отдельными пятнами льда.
- Снег на хребтах не сплошной: крутые стенки и днища каньонов остаются голыми.

## 0.5.24

- Переключатель «Плиты» показывает схему литосферных плит: ячейки, швы и знак движения на них.
- У плит появился вес, ячейки стали разного размера — стыки больше не сходятся под ровные 120°.
- Вулканизм: активность и свечение лавы, очаги садятся на швы плит и горячие точки.
- Молнии стали заметно чаще и ярче; по-прежнему только на ночной стороне.

## 0.5.25

- Плиты крайне неравны по размеру, как на Земле: две-три громады, несколько средних и горсть осколков.
- Схождение несимметрично: жёлоб на уходящей плите, вулканическая дуга и хребет на надвигающейся.
- Схема плит приглушена и не закрывает поверхность.

## 0.5.26

- Атлас текстур биомов удалён: он весил 1.1 МБ, грузился всегда и работал только при включённой вручную опции. Поверхность полностью процедурная.
- Формат ссылки — по именам параметров (v4), поэтому добавление или удаление ползунка больше ничего не сдвигает. Старые ссылки v3 и v2 читаются.
- Переключатель «Звёзды» вместо «Текстур»: у режима пустого космоса наконец есть видимое управление.

## 0.5.27

- Черновой режим включён по умолчанию; тумблер называется «Детали» и работает наоборот.
- Тумблер и его подпись не разъезжаются по строкам, а полоса и рубрикатор на телефоне прокручиваются.
- Компиляция шейдера показывается полосой с таймером и оценкой остатка по прошлому запуску.

## 0.5.29

- Молнии больше не пропадают разом: ворота стали плавными, а часы грозовой модели заворачиваются, чтобы не терять точность. Добавлен ползунок грозовой активности.
- Цвет колец считается по физике: состав (лёд, силикаты, толины, метановые льды), размер частиц с рэлеевским рассеянием и спектр звезды как осветитель. Вблизи горячей звезды лёд сублимирует.
- Рубрика «Климат» переименована в «Погоду» и собрала облака, ветры, конвекцию и грозы.

## 0.5.30

- Небо вынесено в отдельный дешёвый проход; планета накладывается поверх с предумноженной альфой, поэтому ореол атмосферы светится сквозь звёзды.
- Рубрика «Небо»: шесть пресетов и четыре ползунка — плотность звёзд, Млечный Путь, туманности, оттенок поля.
- Галактическая полоса получила пылевые прожилки, туманности — волокна и подрезающую их пыль.
