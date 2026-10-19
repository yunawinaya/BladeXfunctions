#!/bin/bash
# Package B1 - every check of the guarded classics. Read-only: the SQL steps run SELECT / EXPLAIN on dev only.
#   bash scratchpad/sav2/test/classic/run_all.sh
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
R=$(cd "$(dirname "$0")/../../../.." && pwd)
S=$R/scratchpad/sav2
cd "$R"
echo "## build (dry; the diff below also proves the files on disk are exactly this build)"; python3 "$S/build_classic.py"
echo "## (a) node diff vs the pinned bases"; python3 "$S/test/classic/diff_base.py"
echo "## (b) interpreter runs"; node "$S/test/classic/test_guard_flow.js" | grep -v '^ok ' || true
node "$S/test/classic/test_guard_flow.js" > /dev/null
echo "## (c) validate.py / check_wf_js.py / platform rules"; python3 "$S/test/classic/lint_check.py" | grep -v '^ok ' || true
python3 "$S/test/classic/lint_check.py" > /dev/null
python3 scratchpad/validate.py "Stock Adjustment/AsyncV2/STOCK_ADJUSTMENT.json" "Stock Count/AsyncV2/STOCK_COUNT.json" > /dev/null
echo "## (d) sqlcheck + live semantics on dev (read-only)"
python3 "$S/lib/sqlcheck.py" "Stock Adjustment/AsyncV2" "$S/test/classic/sql_values.json" STOCK_ADJUSTMENT
python3 "$S/lib/sqlcheck.py" "Stock Count/AsyncV2" "$S/test/classic/sql_values.json" STOCK_COUNT
python3 "$S/test/classic/sql_live.py"
echo "## ALL PASSED"
