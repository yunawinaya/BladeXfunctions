#!/bin/bash
# gde_gate.sh <fixture dir> [--record]: GD Edit V2's offline suite as a regression gate for Picking 1d.
# Four suites are red from live-data drift (2026-10-20: parity 8 fixtures recorded 10-15, alloc's fixture lacks `alloc`,
# plan GD/20261015/017 now unallocated, cascade docs changed). --record saves every suite's summary line and every FAIL
# line as the baseline; without it the run must reproduce the baseline exactly (exit 1 on any difference).
FX="$1"; [ -d "$FX" ] || { echo "usage: gde_gate.sh <fixture dir> [--record]"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"; GDE="$HERE/../../gde"; BASE="$HERE/gde_baseline.txt"; NOW="$(mktemp)"
{
  bash "$GDE/test/run_all.sh" "$FX" 2>&1 | sed -E 's/[0-9]+ ms|[0-9.]+ s\b//g'
  (cd "$GDE" && node test/edit_parity.js "$FX"/*.json 2>&1 | grep "^FAIL" | sed 's/^/parity /')
  (cd "$GDE" && node test/test_alloc.js "$FX"/*.json 2>&1 | grep "^FAIL" | sed 's/^/alloc /')
  (cd "$GDE" && node test/test_plan.js "$FX"/*.json 2>&1 | grep -E "^FAIL|THREW" | sed -E 's/\|.*//; s/^/plan /')
  (cd "$GDE" && node test/cascade_v2_sim.js 711077 2110639355872194561 2110639610487418882 2>&1 | grep -i -E "^FAIL|failed" | sed 's/^/cascade /')
} > "$NOW"
if [ "$2" = "--record" ]; then cp "$NOW" "$BASE"; echo "recorded $(wc -l < "$BASE") lines -> $BASE"; exit 0; fi
if diff "$BASE" "$NOW" > "$NOW.diff"; then echo "gate: identical to the baseline ($(wc -l < "$BASE") lines)"; exit 0; fi
echo "gate: DIFFERS from the baseline:"; cat "$NOW.diff"; exit 1
