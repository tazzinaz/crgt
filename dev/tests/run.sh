#!/bin/sh
# Runs the tests against a preview page and the offline page.
#   sh dev/tests/run.sh WORKDIR [vNN]
# WORKDIR gets preview.html, crgt-dsp.js and off/ (the offline page with its manifest and icons); serve WORKDIR on
# port 8765 and WORKDIR/off on 8766 (python3 -m http.server) before running.
set -e
REPO=$(cd "$(dirname "$0")/../.." && pwd); WD=${1:?work dir}; V=${2:-v0}
python3 "$REPO/dev/build.py" --preview "$WD/preview.html"
python3 "$REPO/dev/build.py" --dsp "$WD/crgt-dsp.js"
mkdir -p "$WD/off"; python3 "$REPO/dev/build.py" --offline "$V" "$WD/off/index.html"
cp "$REPO/manifest.webmanifest" "$REPO"/icon-*.png "$REPO/sw.js" "$WD/off/"
for t in t_smoke t_wf44 t_lat46 t_gest47; do
  out=$(node "$REPO/dev/tests/$t.js" 2>&1 || true); p=$(printf '%s\n' "$out" | grep -c '^PASS' || true); f=$(printf '%s\n' "$out" | grep -c '^FAIL' || true)
  echo "$t: PASS=$p FAIL=$f"; printf '%s\n' "$out" | grep '^FAIL' | head -5
done
out=$(node "$REPO/dev/tests/t_smoke.js" http://localhost:8766/index.html "$V" 2>&1 || true); p=$(printf '%s\n' "$out" | grep -c '^PASS' || true); f=$(printf '%s\n' "$out" | grep -c '^FAIL' || true)
echo "t_smoke (offline $V): PASS=$p FAIL=$f"; printf '%s\n' "$out" | grep '^FAIL' | head -5
