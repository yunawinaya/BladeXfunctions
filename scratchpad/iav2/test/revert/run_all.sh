#!/bin/sh
# Package F checks (Revert V2 + the classic IA_REVERT v5). usage: sh scratchpad/iav2/test/revert/run_all.sh [--db]
# --db adds the READ-ONLY database checks: F's pinned bases vs dev, lib/sqlcheck.py on dev, test/revert/sql_live.py (dev + prod).
set -e
export PYTHONDONTWRITEBYTECODE=1
IAV2="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="$(cd "$IAV2/../.." && pwd)"
OUT="$REPO/Item Assembly & BOM/AsyncV2"
cd "$IAV2"
run() {
  o="$("$@" 2>&1)" || { printf '%s\n' "$o" | tail -40; echo "FAIL: $*"; exit 1; }
  printf '%s\n' "$o" | tail -1
}
md5s() {
  python3 -c 'import hashlib, sys; print(" ".join(hashlib.md5(open(p, "rb").read()).hexdigest() for p in sys.argv[1:]))' \
    "$OUT/IA_REVERT_V2_PREPARE.json" "$OUT/IA_REVERT_V2_COMMIT.json" "$OUT/IA_REVERT_V2_WORKER.json" "$OUT/IA_REVERT_V2_SUBMIT.json" "$OUT/IA_REVERT.json"
}
if [ "$1" = "--db" ]; then
  snap="$(python3 base/snapshot.py --check 2>&1 || true)"
  for b in IA_REVERT.v5.json INVENTORY_BULK_APPLY.v10.json INVENTORY_LOCK_TOKENS.v5.json; do
    printf '%s\n' "$snap" | grep -qE "^same +$b\$" || { printf '%s\n' "$snap" | tail -25; echo "FAIL: base $b is not what dev runs"; exit 1; }
  done
  echo "bases: IA_REVERT v5 (published 10-19), INVENTORY_BULK_APPLY v10, INVENTORY_LOCK_TOKENS v5 = dev"
fi
run python3 revert/lift/lift_revert.py --check
run python3 build_revert.py --write
BUILT="$(md5s)"
run python3 build_revert.py --write
[ "$BUILT" = "$(md5s)" ] || { echo "FAIL: two builds differ"; exit 1; }
echo "build: two builds byte-identical"
run python3 "$REPO/scratchpad/validate.py" "$OUT/IA_REVERT_V2_PREPARE.json" "$OUT/IA_REVERT_V2_COMMIT.json" "$OUT/IA_REVERT_V2_WORKER.json" \
  "$OUT/IA_REVERT_V2_SUBMIT.json" "$OUT/IA_REVERT.json"
python3 "$REPO/scratchpad/validate.py" "$OUT/IA_REVERT_V2_PREPARE.json" "$OUT/IA_REVERT_V2_COMMIT.json" "$OUT/IA_REVERT_V2_WORKER.json" \
  "$OUT/IA_REVERT_V2_SUBMIT.json" "$OUT/IA_REVERT.json" | grep -E "MISSING|FORWARD|DIVERGENT|UNDECLARED|UNUSED" && { echo "FAIL: validate.py findings"; exit 1; }
echo "validate.py: no MISSING / FORWARD / DIVERGENT / UNDECLARED / UNUSED (CONDITIONAL only, informational)"
run python3 "$REPO/scratchpad/check_wf_js.py" "$OUT/IA_REVERT_V2_PREPARE.json" "$OUT/IA_REVERT_V2_COMMIT.json" "$OUT/IA_REVERT_V2_WORKER.json" \
  "$OUT/IA_REVERT_V2_SUBMIT.json" "$OUT/IA_REVERT.json"
run python3 test/revert/diff_v4.py
run node test/revert/lifted_vs_recorded.js
run node test/revert/adapter_vs_recorded.js
run node test/revert/prepare_unit.js
run node test/revert/nodes_unit.js
run node test/revert/commit_unit.js
run node test/revert/commit_sim.js
run node test/revert/worker_sim.js
run node test/revert/classic_sim.js
if [ "$1" = "--db" ]; then
  run python3 lib/sqlcheck.py "$OUT" test/revert/sql_values.json IA_REVERT_V2_PREPARE IA_REVERT_V2_COMMIT IA_REVERT_V2_WORKER IA_REVERT_V2_SUBMIT IA_REVERT
  run python3 test/revert/sql_live.py
fi
echo "package F: all checks passed"
