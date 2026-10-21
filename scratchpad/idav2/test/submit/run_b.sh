#!/bin/sh
# Package B (IDA_V2_SUBMIT + IDA_SAVE v7): rebuild in order, lint, prove, test. Read-only against the DB (SELECT only).
# usage: sh scratchpad/idav2/test/submit/run_b.sh [--no-db] [--no-mutants]
set -e
cd "$(dirname "$0")/../../../.."
B=scratchpad/idav2
OUT="Item Disassembly/AsyncV2"
export TZ=Asia/Kuala_Lumpur
if [ "$1" != "--no-db" ]; then python3 $B/base/snapshot.py --check | tail -1; fi
python3 $B/build_classic.py --write
python3 $B/lib/lift/lift.py $B/classic/lift_v6.json
python3 $B/lib/lift/lift.py $B/classic/lift_v7.json
python3 $B/lib/lift/lift.py $B/classic/lift_add.json
python3 $B/lib/lift/lift.py $B/submit/lift.json --check || python3 $B/lib/lift/lift.py $B/submit/lift.json
python3 $B/build_submit.py --write
python3 scratchpad/validate.py "$OUT/IDA_SAVE.json" "$OUT/IDA_V2_SUBMIT.json"
python3 $B/classic/diff_v6.py | tail -2
node $B/classic/test_v7.js
node $B/classic/test_guard_sim.js
node $B/test/submit/test_submit.js
node $B/test/submit/sim_submit.js
if [ "$1" != "--no-mutants" ] && [ "$2" != "--no-mutants" ]; then
  python3 $B/classic/mutants_v7.py | tail -1
  python3 $B/test/submit/mutants.py | tail -1
fi
if [ "$1" != "--no-db" ]; then python3 $B/test/submit/sql_live_submit.py | tail -1; fi
