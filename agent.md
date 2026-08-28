# madPlanet Audit & Improvement Roadmap

**Date:** 2026-08-26
**Auditor:** OpenCode orchestrator (big-pickle)
**Project:** Procedural planet generator ("ILLUMINATOR")
**URL:** https://planet.madmentat.ru
**Deploy:** `deploy.ps1` → SCP into the Proxmox container that serves the site

---

## 1. Project Structure Assessment

**Modular architecture** — implemented 2026-08-26. Source split into GLSL/JS modules; build script concatenates into single HTML for zero-dependency deployment.

```
madPlanet/
├── index.html              # Built output: single-file deployment (2093 lines, ~105KB)
├── index.src.html          # HTML shell: canvas, UI, <script> tag (no code)
├── shaders/                # Pure GLSL — no JS wrappers
│   ├── header.glsl         # #version, precision, uniforms (34 lines)
│   ├── noise.glsl          # hash33, noise3, fbm, ridged, ss (49 lines)
│   ├── terrain.glsl        # contFreq, seaLvl, terrain (40 lines)
│   ├── clouds.glsl         # vortexWarp, synoptic, weather, low/mid/highDeck, shadeDeck (521 lines)
│   ├── atmosphere.glsl     # atmoColor — Rayleigh/scattering by composition (33 lines)
│   ├── rings.glsl          # ringPattern, ringShadow, ringColor (49 lines)
│   ├── fog.glsl            # fogLayer — inversion belt, coastal, terminator (22 lines)
│   ├── lightning.glsl      # lightningGlow — capacitor model, 6 cells (41 lines)
│   ├── surface.glsl        # shadeSurface — biomes, ocean, rivers, cities (326 lines)
│   ├── stars.glsl          # star field, Milky Way, sun disc (32 lines)
│   ├── sphere.glsl         # iSphere ray-sphere intersection (9 lines)
│   └── main.glsl           # void main() — raymarching, compositing, tonemap (136 lines)
├── js/                     # Browser JS — concatenated in order
│   ├── gl-init.js          # WebGL2 bootstrap, compile, uniforms (36 lines)
│   ├── math.js             # m3axis, m3t, m3mul, norm3, cross3, mulberry32 (26 lines)
│   ├── state.js            # PARAMS, deriveWorld, starTempToColor, URL hash (103 lines)
│   ├── camera.js           # Orbit camera, pointer/wheel handling (56 lines)
│   ├── ui.js               # syncUI, slider creation, toggle handlers (123 lines)
│   ├── screenshot.js       # takeShot, PNG export (48 lines)
│   └── render.js           # fitCanvas, drawFrame, loop, texture loader (177 lines)
├── deploy.ps1              # SCP -> Proxmox container serving the site
├── build.sh                # Linux: concatenate → index.html
├── build.ps1               # Windows: concatenate → index.html
├── .claude/launch.json
└── agent.md                # This file
```

**Build workflow:** `bash build.sh` (or `.\build.ps1` on Windows) concatenates GLSL modules in dependency order → wraps in JS template literals → appends JS modules → outputs single `index.html`. Deploy unchanged: `deploy.ps1` SCPs index.html to nginx.

---

## 2. Current Cloud System — Deep Analysis

### Architecture (3 Layers + Cyclones)

| Layer | Radius | Speed | Cloud Types | Shader Function |
|-------|--------|-------|-------------|-----------------|
| Low (R_LOW=1.010) | +10km | 1.35× spin | St, Sc, Cu, Ns, Cb towers | `lowDeck()` |
| Mid (R_MID=1.021) | +21km | 0.72× spin | Ac, As, breaks | `midDeck()` |
| High (R_HIGH=1.034) | +34km | 2.60× spin | Ci, Cc, Cs, anvil tops | `highDeck()` |

### What's Already Implemented (Credit Where Due)

The codebase already has sophisticated cloud modeling:

1. **Cyclonic systems** — 5 procedurally-placed cyclones with spiral arms, head/front structure (`synoptic()`)
2. **Vortex warping** — noise field twisted around cyclone centers (`vortexWarp()`)
3. **Zonal weather bands** — ITCZ convection, subtropical suppression, mid-latitude fronts (`weather()`)
4. **Convective cells** — honeycomb patterns for altocumulus (`cellNoise()`)
5. **Anvil overshoot** — cumulonimbus towers extending to high deck
6. **Bouguer opacity** — proper exponential optical depth, not linear blending
7. **Three independent rotation speeds** — simulating wind shear between layers
8. **Cloud shadows on surface** — low and mid deck cast shadows

### What's Missing — Gap Analysis

#### A. Cloud Types Not Represented

| Missing Type | Real-World Behavior | Priority |
|-------------|---------------------|----------|
| **Peristые (Cirrus fibratus)** | Thin, wispy filaments stretched by jet stream. Currently just "fib" noise — needs directional stretching, translucent ice-crystal halos | HIGH |
| **Кучевые (Cumulus humilis/mediocris)** | Flat-bottomed, cauliflower-topped fair-weather clouds. Current Cu is just fbm threshold — no flat bases, no vertical development | HIGH |
| **Перисто-кучевые (Cirrocumulus)** | "Mackerel sky" — small ripples at high altitude. Mentioned in comments but not distinctly generated | MEDIUM |
| **Шкваловые (Arcus/Shelf clouds)** | Low, horizontal wedge at storm front edge. Zero representation | MEDIUM |
| **Туман (Fog/Stratus nebulosus)** | Surface-hugging layer. Currently absent — would dramatically improve terminator and polar regions | HIGH |
| **Перисто-слоистые (Cirrostratus)** | Thin veil causing 22° halo. The "veil" in highDeck is close but lacks the halo光学 effect | LOW |

#### B. Physical Accuracy Issues

1. **No diurnal cloud cycle** — Real planets have convective buildup in afternoon. The clouds are static relative to the weather field; there's no thermal-driven vertical development cycle.

2. **No orographic clouds** — Mountains force air upward creating cap clouds, lenticular clouds, and Foehn walls. The terrain function exists but doesn't influence cloud formation.

3. **Missing cloud microphysics** — All clouds are the same white. Real clouds vary: cumulus tops are brilliant white, bases are dark grey, cirrus is translucent blue-white, storm clouds have greenish tint from hail.

4. **No cloud-top temperature** — The IR signature visible in satellite imagery. Not critical for visual quality but would enable thermal imaging mode.

5. **Lightning is ambient glow only** — The current `lightningGlow()` produces diffuse illumination but no visible bolts, branching, or flash patterns.

6. **No precipitation shafts** — Virga (rain that evaporates before reaching ground) and rain shafts are absent.

#### C. Performance Concerns

- `synoptic()` iterates 5 cyclones per pixel with trigonometric operations
- `cellNoise()` uses 2 noise samples — cheap but could be cached
- Shader compiler rejects unrolled Voronoi (27 samples) — already worked around with dual-octave ridge
- `lowDeck()` inlines 3 texture samples for edge detail — consider LOD

---

## 3. Improvement Roadmap

### Phase 1: Cloud Realism (Week 1-2)

#### 3.1 Distinct Cloud Generators

Each cloud type needs its own structural generator, not just fbm threshold variations:

**Peristые (Cirrus fibratus):**
```glsl
// Directional stretching along jet stream vector
vec3 jetDir = normalize(cross(uAxis, uSunDir)); // approximate jet stream
float fiber = fbm(sd*8.0 + jetDir*dot(sd,jetDir)*20.0 + uSeedC, 4);
float streak = pow(1.0 - abs(fbm(ps*vec3(1.0,0.3,1.0), 3)), 4.0); // anisotropic
```

**Кучевые (Cumulus humilis):**
```glsl
// Flat base at condensation level, cauliflower tops
float base = smoothstep(R_LOW, R_LOW+0.002, radius); // sharp flat bottom
float top = fbm(sd*40.0 + uSeedC, 4); // bumpy top
float development = max(0.0, temp - 0.3) * moisture; // thermal convection
```

**Туман (Fog):**
```glsl
// Temperature inversions create fog in low-lying areas
float inv = exp(-pow((lat-0.42)*5.5, 2.0)); // subtropical inversion
float fog = inv * (1.0 - step(seaLevel+0.01, terrain));
```

#### 3.2 Lightning Overhaul

Replace ambient glow with visible bolt rendering:

```glsl
// Fractal L-system bolt generation
vec3 boltPath(vec3 origin, vec3 dir, float time) {
    // Main channel with Perlin-displaced branching
    // Branch probability increases with distance from origin
    // Color: blue-white core → orange-red periphery
    // Flash timing: capacitor model with recharge period
}
```

Key elements:
- **Leader propagation** — stepped leader creates ionization path
- **Return stroke** — bright flash along completed path
- **Branching** — fractal tree with random angles
- **Color gradient** — blue core (50000K) → orange edges (3000K)
- **Inter-cloud vs cloud-ground** — different bolt geometries

#### 3.3 Diurnal Cycle

Add time-of-day dependency to weather function:

```glsl
float localTime = fract(dot(dir, sunDir) * 0.5 + 0.5); // local solar time
float convBoost = exp(-pow((localTime - 0.7) * 4.0, 2.0)); // afternoon peak
gWx.x *= 1.0 + 0.3 * convBoost; // enhance cumulus in afternoon
```

#### 3.4 Orographic Clouds

Use terrain normals to force cloud formation on windward slopes:

```glsl
float slope = dot(normalize(terrainGrad), windDir);
float forced = max(0.0, slope) * updraftStrength;
cover += forced * exp(-pow(distance - R_LOW, 2.0) / 0.01);
```

### Phase 2: Visual Polish (Week 3-4)

#### 3.5 Cloud Coloring

Replace uniform white with physically-based coloring:

| Cloud Type | Base Color | Shadow Color | Highlight |
|-----------|-----------|--------------|-----------|
| Cumulus top | rgb(0.98, 0.99, 1.0) | rgb(0.35, 0.38, 0.45) | Warm sunset tint |
| Cumulus base | rgb(0.55, 0.58, 0.65) | rgb(0.15, 0.18, 0.25) | — |
| Cirrus | rgb(0.85, 0.88, 0.95) | — | Rainbow halo |
| Storm | rgb(0.45, 0.50, 0.55) | rgb(0.08, 0.12, 0.18) | Green tint (hail) |
| Fog | rgb(0.70, 0.75, 0.80) | — | Warm at sunset |

#### 3.6 Cloud Shadow Enhancement

Current shadows are binary (cover/no-cover). Add:
- **Penumbra** — partial shadow at cloud edges
- **Multiple scattering** — light bouncing between layers
- **Color bleeding** — warm light reflected from sunlit clouds onto shadowed surface

#### 3.7 Virga and Precipitation

```glsl
// Rain shafts visible from side
float precip = cloudCover * instability;
float shaft = fbm(sd*200.0 + vec3(0, time*0.5, 0), 2);
shaft = smoothstep(0.3, 0.7, shaft) * precip;
// Fades below cloud base (evaporation)
shaft *= exp(-max(0.0, R_LOW - radius) * 50.0);
```

### Phase 3: Interaction & Performance (Week 5+)

#### 3.8 Weather Controls

Add granular cloud-type sliders beyond single "cloud amount":

- **Cumulus amount** — convective activity
- **Cirrus amount** — upper-level moisture
- **Fog probability** — temperature inversion strength
- **Storm intensity** — instability index
- **Jet stream strength** — cirrus streakiness

#### 3.9 Snapshot Improvements

- Higher resolution (currently capped at 4096px)
- HDR capture mode (linear color space before tonemap)
- Panoramic/equirectangular export
- Animated GIF/WebM export of weather evolution

#### 3.10 Performance Optimization

- **Temporal reprojection** — reuse previous frame's cloud data
- **Adaptive quality** — reduce octaves on mobile GPUs
- **Cloud texture caching** — precompute low-frequency noise
- **Instanced cyclone rendering** — batch cyclone calculations

---

## 4. Specific Bug/Issue Notes

1. **Encoding issue** — Cyrillic text in HTML renders as mojibake when read via WinRM (encoding mismatch between UTF-8 file and cp1251 PowerShell). The file itself is correct; this is a read artifact.

2. **No error recovery** — If WebGL2 context is lost, the app shows a static error div with no retry mechanism.

3. **Mobile touch handling** — Two-finger pinch works but single-finger orbit has no momentum/inertia on some mobile browsers.

4. **Screenshot quality** — The readPixels → canvas flip → toBlob pipeline works but loses GPU-accelerated compositing. Consider using `preserveDrawingBuffer: true` only during capture.

---

## 5. Architecture Recommendations

### Immediate (Non-Breaking)

1. **Extract shader strings to template literals in separate .glsl files**
2. **Add biome texture as external PNG** (currently ~800KB base64 inlined)
3. **Create `build.ps1`** that concatenates into single HTML
4. **Add `.gitignore`** and initialize git repo
5. **Add README.md** with project description, controls, deployment

### Medium-Term

1. **Implement hot-reload** for shader development (WebSocket + auto-recompile)
2. **Add debug visualization modes** — show weather field, cyclone structure, cloud layers individually
3. **Create preset gallery** — "Earth-like", "Mars-like", "Gas giant", "Ice world", "Storm world"
4. **Add atmosphere scattering** — proper Rayleigh/Mie for realistic limb darkening

### Long-Term

1. **Procedural audio** — wind noise based on cloud density and altitude
2. **Multi-planet system** — orbital mechanics, tidal effects on weather
3. **Time-lapse mode** — accelerated weather evolution for artistic renders
4. **VR support** — WebXR for immersive planet viewing

---

## 6. What Claude Did Well

- **Single-file deployment** is genuinely clever for this use case
- **Three-layer cloud architecture** with independent rotation is physically motivated
- **Cyclone modeling** with spiral arms and synoptic structure goes beyond typical shader art
- **Bouguer opacity** for cloud shading is correct physical modeling
- **Weather bands** with ITCZ/subtropical/mid-latitude zones show understanding of atmospheric circulation
- **Performance awareness** — inlining decisions, LOD system, draft mode
- **URL hash state** for shareable planet configurations
- **Mobile support** with responsive panel layout

## 7. What Needs Fresh Eyes

- The cloud system is sophisticated but lacks **visual distinctiveness** between types
- Lightning is the weakest element — needs fundamental rethinking, not just tweaking
- No fog/stratus layer means terminator and polar regions look empty
- The project would benefit from **reference photos** — NASA Worldview, ISS imagery
- Consider **real satellite data** as texture input for validation

## Mandatory release discipline (madPlanet)

- Current release is `0.5.7`; continue with `0.5.8`, `0.5.9`, ... .
- Every newly packaged archive increments only the patch component by `+0.0.1`: `0.5.1`, `0.5.2`, `0.5.3`, `0.5.4`, ... . Never reuse a version.
- Archive filename is exactly `madPlanet-X.Y.Z.zip`; do not invent suffix chains such as `-hotfix-final2`.
- Before packaging, rebuild `index.html` and run all tests. A failed integrity/build test means **no archive**.
- `index.html` must be strict UTF-8 and contain exactly one `<script>` and one `</script>`.
- `deploy.ps1` and `build.ps1` must remain ASCII-only so Windows PowerShell 5.1 cannot reinterpret UTF-8 source text as the legacy ANSI code page.
- Keep the PC/older-driver compatibility renderer in `js/gl-init.js`. If the full shader fails, the compatibility renderer must be visibly labelled; never hide a fallback behind a planet-like diagnostic effect.
- Performance work must be introduced in isolated, testable changes. Do not replace the known-good terrain normal shader with screen-derivative normals unless it has been separately validated on target GPUs.


## Mobile render quality rule

- `renderScale` is framebuffer pixels per CSS pixel, not a fraction of devicePixelRatio. Never restore the old Android 0.42-0.72 range.
- Prefer approximately 30 fps with readable spatial detail on phones; do not trade the planet into a blurred upscaled image merely to chase desktop-like frame cadence.
- Aurora must remain segmented into active arcs. Avoid a continuous oval background and avoid curtain phase depending only on magnetic longitude, which creates the polar "eye iris" artifact.
