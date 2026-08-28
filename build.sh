#!/usr/bin/env bash
# Build single index.html from modular source files.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$DIR/index.html}"
VERSION="$(sed -nE 's/^VERSION[[:space:]]+([0-9]+\.[0-9]+\.[0-9]+)[[:space:]]*$/\1/p' "$DIR/VERSION.txt" | head -1)"
[ -n "$VERSION" ] || { echo 'VERSION.txt invalid' >&2; exit 1; }

# An empty source module concatenates in silence: the program still links and
# every existing check passes, but the planet comes out with no clouds and no
# surface. That is how a 0-byte clouds.glsl reached develop and built "OK".
# The smallest real module is sphere.glsl at 237 bytes.
assert_not_empty() {
  local f="$1" n
  n=$(wc -c < "$DIR/$f" | tr -d ' ')
  if [ "$n" -lt 120 ]; then
    echo "source module looks empty or truncated: $f ($n bytes)" >&2
    exit 1
  fi
}
for f in shaders/*.glsl js/*.js; do assert_not_empty "$f"; done
VERT='#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
FRAG="#version 300 es
$(cat "$DIR/shaders/header.glsl")
$(cat "$DIR/shaders/noise.glsl")
$(cat "$DIR/shaders/terrain.glsl")
$(cat "$DIR/shaders/clouds.glsl")
$(cat "$DIR/shaders/atmosphere.glsl")
$(cat "$DIR/shaders/rings.glsl")
$(cat "$DIR/shaders/fog.glsl")
$(cat "$DIR/shaders/lightning.glsl")
$(cat "$DIR/shaders/surface.glsl")
$(cat "$DIR/shaders/sphere.glsl")
$(cat "$DIR/shaders/main.glsl")"
COMPAT_FRAG="#version 300 es
$(cat "$DIR/shaders/compat.glsl")"
AURORA_FRAG="#version 300 es
$(cat "$DIR/shaders/aurora-pass.glsl")"
SKY_FRAG="#version 300 es
$(cat "$DIR/shaders/sky-pass.glsl")"
# The version number lives in VERSION.txt and nowhere else; the visible
# stamp is filled in here rather than duplicated in the source shell.
{
  sed -E "s#<div class=\"ver\">[^<]*</div>#<div class=\"ver\">v${VERSION}</div>#" "$DIR/index.src.html"
  printf '\nconst APP_VERSION = %q;\n' "$VERSION" | sed "s/^const APP_VERSION = /const APP_VERSION = '/; s/;$/';/"
  printf '\nconst VERT = `%s`;\n' "$VERT"
  printf '\nconst FRAG = `%s`;\n' "$FRAG"
  printf '\nconst COMPAT_FRAG = `%s`;\n' "$COMPAT_FRAG"
  printf '\nconst AURORA_FRAG = `%s`;\n' "$AURORA_FRAG"
  printf '\nconst SKY_FRAG = `%s`;\n' "$SKY_FRAG"
  for f in js/gl-init.js js/math.js js/hydrology.js js/state.js js/camera.js js/magnetosphere.js js/touch-ux.js js/ui.js js/planet-physics.js js/star-orbit.js js/param-model.js js/screenshot.js js/atmosphere-inventory.js js/water-budget.js js/climate-regimes.js js/stellar-weather-coupling.js js/render.js; do cat "$DIR/$f"; printf '\n'; done
  printf '</script>\n</body>\n</html>\n'
} > "$OUT"
node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');if((s.match(/<script(?:\\s|>)/gi)||[]).length!==1||(s.match(/<\\/script>/gi)||[]).length!==1)process.exit(2);if(!s.includes(\"const APP_VERSION = '$VERSION'\"))process.exit(3);" "$OUT"
echo "Built $OUT ($(wc -c < "$OUT") bytes), version $VERSION"
