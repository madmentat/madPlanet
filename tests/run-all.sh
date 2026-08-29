#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
bash build.sh index.html
python3 - <<'PY'
from pathlib import Path
s=Path('index.html').read_text(encoding='utf-8')
a=s.index('<script>')+len('<script>')
b=s.rindex('</script>')
Path('.built-script.js').write_text(s[a:b], encoding='utf-8')
PY
node --check .built-script.js
rm -f .built-script.js
node tests/build-integrity.test.js
node tests/performance-guards.test.js
node tests/visual-regressions.test.js
node tests/param-model.test.js
node tests/star-orbit.test.js
node tests/planet-physics.test.js
node tests/atmosphere-inventory.test.js
node tests/volcanic-atmosphere-coupling.test.js
node tests/water-budget.test.js
node tests/climate-regimes.test.js
node tests/stellar-weather-coupling.test.js
node tests/ui-random-polish.test.js
node tests/weather-core.test.js
node tests/local-energy-balance.test.js
node tests/diurnal-cycle.test.js
node tests/seasons.test.js
node tests/baric-field.test.js
node tests/wind-dynamics.test.js
node tests/h2o-advection.test.js
node tests/condensation.test.js
node tests/precipitation.test.js
node tests/orographic-lift.test.js
node tests/soil-hydrology.test.js
node tests/weather-fronts.test.js
node tests/pressure-systems.test.js
node tests/deep-convection.test.js
node tests/vertical-stability.test.js
node tests/cloud-radiative-feedback.test.js
node tests/physical-fog.test.js
node tests/lightning-weather.test.js
node tests/cloud-visual-response.test.js
node tests/weather-cloud-visual.test.js
node tests/planet-export.test.js
node tests/procedural-synoptic-retirement.test.js
node tests/touch-ux.test.js
node tests/chromium-compat.test.js
node tests/hydrology.test.js
node tests/magnetosphere.test.js
