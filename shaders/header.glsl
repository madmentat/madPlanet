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
uniform float uRingCount;  /* дробность на отдельные кольца */
uniform float uRingMaterial; /* материал: лёд - камень - пыль */
uniform float uPlatesOn;   /* схема литосферных плит */
uniform float uVolcano;    /* активность вулканизма */
uniform float uLava;       /* раскалённость лавы */
uniform float uStorm;      /* грозовая активность */
uniform float uStormRate;  /* частота вспышек */
uniform float uStormGlow;  /* яркость вспышек */
uniform float uRingGrain;  /* размер частиц колец */
uniform vec3  uStarCol;     /* спектральный цвет */
uniform float uStarRadius;  /* относительный видимый диск */
uniform float uStarFlux;    /* поток излучения */
uniform float uStarDist;    /* расстояние до звезды, AU */
uniform float uAtmoComp;    /* сводный индекс смеси 0= земля … 1= газовый гигант */
uniform float uCO2;         /* доля углекислого газа - удобрение для растительности */
uniform float uSnowAlt;     /* высота снеговой линии на хребтах */
uniform float uWind;
uniform float uConvection;
uniform float uLowOn, uMidOn, uHighOn;  /* включение/выключение ярусов облаков */
uniform mat3  uRotC2;     /* средний ярус облаков */
uniform mat3  uRotC3;     /* верхний ярус облаков */
uniform float uDraft;     /* 1 — черновик: дорогие слои выключены */
uniform float uVoid;      /* 1 — космос заливается чёрным */
uniform mat3  uRingMat;
uniform vec3  uSeedS, uSeedC;
/* 0.5.54: Weather Core owns cloud geography. RGB are physical low/mid/high
   condensate visualized from the body-fixed cubed-sphere grid; A carries
   deep-convective state for tower morphology. Updated only on weather ticks. */
uniform samplerCube uWeatherCloudTex;
uniform vec4  uCycA[5];   /* 0.5.52 bridge: xyz lightning centre, w stays 0 */
uniform vec4  uCycB[5];   /* x radius, y flash rate, z electrical strength, w phase */
uniform int   uPlateN;    /* число тектонических плит */
uniform vec4  uPlateP[12];/* xyz — центр плиты в системе поверхности */
uniform vec4  uPlateW[12];/* xyz — вектор Эйлера плиты (ось x скорость) */
