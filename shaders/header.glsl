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
uniform float uLowOn, uMidOn, uHighOn;  /* визуальная видимость ярусов; Weather Core не выключается */
uniform float uFogOn, uLightningOn, uAtmoVisualOn; /* 0.5.72 diagnostic visibility only; physics stays active */
uniform mat3  uRotC2;     /* средний ярус облаков */
uniform mat3  uRotC3;     /* верхний ярус облаков */
uniform float uDraft;     /* 1 — черновик: дорогие слои выключены */
uniform float uVoid;      /* 1 — космос заливается чёрным */
uniform mat3  uRingMat;
uniform vec3  uSeedS, uSeedC;
/* 0.5.54 temporal cloud bridge. RGB of both cubemaps are the signed inertial
   growth/dispersal influence (-1..+1 encoded around neutral 0.5); A is deep
   convection. Weather Core publishes discrete fixed-tick targets, while the
   renderer blends previous -> current continuously between ticks so those
   targets can never make clouds jump on screen. */
uniform samplerCube uWeatherCloudTex;
uniform samplerCube uWeatherCloudTexPrev;
uniform float uWeatherCloudBlend;
/* 0.5.56 / 0.5.66 shared fog + surface-state bridge. R is fog optical depth,
   G normalized fog depth, B physical soil wetness and A Weather Core surface
   temperature mapped to 180..380 K. The pair is double-buffered so both fog
   and drought/biome colour evolve smoothly between fixed weather ticks. */
uniform samplerCube uFogTex;
uniform samplerCube uFogTexPrev;
uniform float uFogBlend;
/* 0.5.60 physical cryosphere. One WebGL1-safe cubemap stores both temporal
   endpoints: R/G previous land-cryosphere / sea-ice coverage, B/A current.
   The renderer interpolates them with uCryosphereBlend. */
uniform samplerCube uCryosphereTex;
uniform float uCryosphereBlend;
/* 0.5.131 runoff-driven river bridge. R/G are previous channel/lake support,
   B/A current. The CPU owns topology/discharge; the shader only resolves the
   sub-grid visual channel inside physically permitted drainage corridors. */
uniform samplerCube uRiverTex;
uniform float uRiverBlend;
uniform float uRiverPhysicsOn;
/* 0.5.157 vector rivers (WebGL2): per-bin index and de-indexed chord list.
   Chords are unit-sphere endpoints in surface space with an angular
   half-width, so the channel is analytic at every zoom. highp is mandatory:
   a default-precision sampler yields fp16 texels on mobile GPUs. */
uniform highp sampler2D uRiverBinTex;
uniform highp sampler2D uRiverListTex;
uniform float uRiverVecOn;
uniform float uRiverBinN;
uniform float uRiverTexW;
uniform vec4  uCycA[5];   /* 0.5.52 bridge: xyz lightning centre, w stays 0 */
uniform vec4  uCycB[5];   /* x radius, y flash rate, z electrical strength, w phase */
uniform int   uPlateN;    /* число тектонических плит */
uniform vec4  uPlateP[12];/* xyz — центр плиты в системе поверхности */
uniform vec4  uPlateW[12];/* xyz — вектор Эйлера плиты (ось x скорость) */
