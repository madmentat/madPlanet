/* ============ 0.5.54: retire procedural cloud geography ============ */
/*
   Keep the legacy cloud implementations compiled under private names so the
   patch can replace only the public visual entry points without risky surgery
   inside the large historical clouds.glsl file. New main/surface calls resolve
   to the physical Weather Core versions defined in weather-cloud-visual.glsl.
*/
#define lowCover  legacyLowCover
#define midCover  legacyMidCover
#define lowDeck   legacyLowDeck
#define midDeck   legacyMidDeck
#define highDeck  legacyHighDeck
#define volumeLow legacyVolumeLow
