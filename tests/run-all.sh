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
node tests/chromium-compat.test.js
node tests/hydrology.test.js
node tests/magnetosphere.test.js
