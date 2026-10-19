#!/bin/sh
# SA_V2_SUBMIT checks (package B2): lift + build (dry, then --write), the linters, every SQL node read-only on dev (two value
# sets), the interpreter matrix. usage: sh scratchpad/sav2/test/submit/run_all.sh [--no-db]
set -e
SAV2="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="$(cd "$SAV2/../.." && pwd)"
OUT="$REPO/Stock Adjustment/AsyncV2/SA_V2_SUBMIT.json"
cd "$SAV2"
python3 lib/lift/lift.py submit/lift.json --check
python3 build_submit.py --write
cd "$REPO"
python3 scratchpad/validate.py "$OUT"
python3 scratchpad/check_wf_js.py "$OUT"
cd "$SAV2"
if [ "$1" != "--no-db" ]; then
  python3 lib/sqlcheck.py "$REPO/Stock Adjustment/AsyncV2" test/submit/sql_values.json SA_V2_SUBMIT
  python3 lib/sqlcheck.py "$REPO/Stock Adjustment/AsyncV2" test/submit/sql_values_add.json SA_V2_SUBMIT
fi
node test/submit/test_submit.js
