#!/bin/sh
# Package B (IA_V2_SUBMIT + IA_SAVE v12): rebuild in order, lint, prove, test. Read-only against the DB (SELECT only).
# usage: sh scratchpad/iav2/test/submit/run_b.sh [--no-db]
set -e
cd "$(dirname "$0")/../../../.."
B=scratchpad/iav2
OUT="Item Assembly & BOM/AsyncV2"
python3 $B/base/snapshot.py --check | tail -1
python3 $B/build_classic.py --write
python3 $B/lib/lift/lift.py $B/classic/lift_v11.json
python3 $B/lib/lift/lift.py $B/classic/lift_v12.json
python3 $B/lib/lift/lift.py $B/submit/lift.json --check || python3 $B/lib/lift/lift.py $B/submit/lift.json
python3 $B/build_submit.py --write
python3 scratchpad/validate.py "$OUT/IA_SAVE.json" "$OUT/IA_V2_SUBMIT.json"
python3 $B/classic/diff_v11.py | tail -2
node $B/classic/test_v12.js
node $B/classic/test_guard_sim.js
node $B/test/submit/test_submit.js
node $B/test/submit/sim_submit.js
if [ "$1" != "--no-db" ]; then python3 $B/test/submit/sql_live_submit.py | tail -1; fi
