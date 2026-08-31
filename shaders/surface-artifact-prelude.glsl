/* 0.5.80 surface-artifact guard.
   surface.glsl used the exact tectonic seam distance as a pigment mask for
   volcanic vents. On a smooth hot barren world that became a one-pixel dotted
   arc drawn across the globe. During surface shading only, replace the seam
   read with a broad orographic support derived from mount. terrain.glsl itself
   was already parsed before this macro and keeps the real tectonic geometry. */
#define gSeamNear mix(0.145,0.052,ss(0.010,0.095,mount))
