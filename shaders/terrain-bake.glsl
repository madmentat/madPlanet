/* ---------- 0.5.160 terrain bake ---------- */
/* One cubemap face of sea-relative terrain height, sampled at texel centres
   and packed as 24-bit fixed point into RGB so the readback needs no float
   render target. Face/uv conventions match riverGpuDirToFaceUV. The caller
   sets uRotS to identity (heights live in surface space), uCamDist far and
   uDraft on, so no camera-dependent detail octave is baked. */
uniform float uBakeFace;
uniform float uBakeN;
void main(){
  vec2 uv = gl_FragCoord.xy/uBakeN*2.0 - 1.0;
  float u = uv.x, v = uv.y;
  int f = int(uBakeFace + 0.5);
  vec3 d;
  if(f == 0) d = vec3(1.0, v, -u);
  else if(f == 1) d = vec3(-1.0, v, u);
  else if(f == 2) d = vec3(u, 1.0, -v);
  else if(f == 3) d = vec3(u, -1.0, v);
  else if(f == 4) d = vec3(u, v, 1.0);
  else d = vec3(-u, v, -1.0);
  d = normalize(d);
  float rock, mount, lee;
  float h = terrain(d, rock, mount, lee);
  float e = clamp((h + 2.0)/4.0, 0.0, 1.0);
  float e1 = floor(e*255.0);
  float e2 = floor(fract(e*255.0)*255.0);
  float e3 = floor(fract(e*65025.0)*255.0);
  fragColor = vec4(e1/255.0, e2/255.0, e3/255.0, 1.0);
}
