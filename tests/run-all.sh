#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# A broken build or invalid generated JavaScript makes every downstream test
# meaningless, so these two gates intentionally remain fail-fast.
bash build.sh index.html || exit $?
python3 - <<'PY' || exit $?
from pathlib import Path
s=Path('index.html').read_text(encoding='utf-8')
a=s.index('<script>')+len('<script>')
b=s.rindex('</script>')
Path('.built-script.js').write_text(s[a:b], encoding='utf-8')
PY
node --check .built-script.js
syntax_status=$?
rm -f .built-script.js
(( syntax_status == 0 )) || exit "$syntax_status"

# Regression tests are independent enough that stopping on the first failure
# hides useful information. Run the complete suite and report all failures at
# once; CI still exits non-zero if anything failed.
tests=(
  tests/build-integrity.test.js
  tests/performance-guards.test.js
  tests/smooth-motion-ui.test.js
  tests/input-frame-pacing.test.js
  tests/frame-pacing-polish.test.js
  tests/climate-consistency.test.js
  tests/runtime-settings.test.js
  tests/rubric-orbit-ui.test.js
  tests/mobile-portrait-layout.test.js
  tests/thermal-celsius.test.js
  tests/thermal-probe-ui.test.js
  tests/visual-regressions.test.js
  tests/tectonic-morphology.test.js
  tests/tectonic-cell-seams.test.js
  tests/tectonic-surface-seam-routing.test.js
  tests/tectonic-interior-artifacts.test.js
  tests/terrain-classic-look.test.js
  tests/param-model.test.js
  tests/star-orbit.test.js
  tests/orbit-eccentricity.test.js
  tests/planet-physics.test.js
  tests/atmosphere-inventory.test.js
  tests/volcanic-atmosphere-coupling.test.js
  tests/water-budget.test.js
  tests/climate-regimes.test.js
  tests/extreme-orbit-regressions.test.js
  tests/stellar-weather-coupling.test.js
  tests/ui-random-polish.test.js
  tests/cloud-visibility-controls.test.js
  tests/weather-core.test.js
  tests/local-energy-balance.test.js
  tests/diurnal-cycle.test.js
  tests/seasons.test.js
  tests/baric-field.test.js
  tests/wind-dynamics.test.js
  tests/h2o-advection.test.js
  tests/condensation.test.js
  tests/precipitation.test.js
  tests/orographic-lift.test.js
  tests/soil-hydrology.test.js
  tests/river-physics.test.js
  tests/river-visual-tributaries.test.js
  tests/weather-fronts.test.js
  tests/pressure-systems.test.js
  tests/deep-convection.test.js
  tests/vertical-stability.test.js
  tests/cloud-radiative-feedback.test.js
  tests/ocean-thermal.test.js
  tests/cryosphere.test.js
  tests/cryosphere-phase-consistency.test.js
  tests/ocean-circulation.test.js
  tests/ocean-heat-transport.test.js
  tests/atmospheric-heat-transport.test.js
  tests/polar-surface-thermodynamics.test.js
  tests/polar-continentality.test.js
  tests/cryosphere-seams.test.js
  tests/cryosphere-hard-edge.test.js
  tests/physical-fog.test.js
  tests/biome-state.test.js
  tests/extreme-surface-phase.test.js
  tests/weather-stabilization.test.js
  tests/weather-audit-diagnostics.test.js
  tests/lightning-weather.test.js
  tests/lightning-abundance.test.js
  tests/screenshot-trigger.test.js
  tests/cloud-visual-response.test.js
  tests/resolved-lift-clouds.test.js
  tests/weather-cloud-visual.test.js
  tests/planet-export.test.js
  tests/procedural-synoptic-retirement.test.js
  tests/touch-ux.test.js
  tests/chromium-compat.test.js
  tests/hydrology.test.js
  tests/magnetosphere.test.js
)

failures=()
for test_file in "${tests[@]}"; do
  if ! node "$test_file"; then
    failures+=("$test_file")
  fi
done

if ((${#failures[@]})); then
  printf '\nFAILED (%d):\n' "${#failures[@]}" >&2
  printf '  %s\n' "${failures[@]}" >&2
  exit 1
fi

echo "All ${#tests[@]} regression tests passed."
