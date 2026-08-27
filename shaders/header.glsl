precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform mat3  uCamMat;
uniform float uFocal;
uniform float uCamDist;
uniform float uPixA;      /* радиан на пиксель */
uniform mat3  uRotS;      /* мир -> пространство выборки поверхности */
uniform mat3  uRotC;      /* мир -> пространство облаков */
uniform mat3  uRotCInv;
uniform vec3  uSunDir;
uniform vec3  uAxis;
uniform vec3  uMilky;

uniform float uTemp, uCloudLow, uCloudMid, uCloudHigh, uSea, uCont, uTect, uIsle, uLake, uCity, uAtmo;
uniform float uRingsOn;
uniform float uRingInner;  /* внутренний радиус */
uniform float uRingWidth;  /* ширина системы */
uniform float uRingDens;   /* плотность вещества */
uniform vec3  uStarCol;     /* спектральный цвет */
uniform float uStarRadius;  /* относительный видимый диск */
uniform float uStarFlux;    /* поток излучения */
uniform float uStarDist;    /* расстояние до звезды, AU */
uniform float uAtmoComp;    /* состав атмосферы 0= земля … 1= газовый гигант */
uniform float uWind;
uniform float uConvection;
uniform float uLowOn, uMidOn, uHighOn;  /* включение/выключение ярусов облаков */
uniform mat3  uRotC2;     /* средний ярус облаков */
uniform mat3  uRotC3;     /* верхний ярус облаков */
uniform mediump sampler2DArray uTex;
uniform float uTexOn;
uniform float uDraft;     /* 1 — черновик: дорогие слои выключены */
uniform float uVoid;      /* 1 — космос заливается чёрным */
uniform vec3  uTexMean[20];   /* средний цвет каждого тайла */
uniform mat3  uRingMat;
uniform vec3  uSeedS, uSeedC;
uniform vec4  uCycA[5];   /* xyz — центр циклона, w — сила */
uniform vec4  uCycB[5];   /* x — радиус, y — знак вращения, z — закрутка, w — азимут фронта */
uniform int   uPlateN;    /* число тектонических плит */
uniform vec4  uPlateP[12];/* xyz — центр плиты в системе поверхности */
uniform vec4  uPlateW[12];/* xyz — вектор Эйлера плиты (ось x скорость) */

