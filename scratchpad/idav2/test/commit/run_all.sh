#!/bin/sh
# Package C checks: build IDA_V2_COMMIT + IDA_V2_WORKER (--write), the step unit tests, the interpreter runs of the built COMMIT, WORKER and
# WORKER -> COMMIT chain, the linter and the JS syntax check of both outputs; `--sql` adds lib/sqlcheck.py (every SQL node, READ-ONLY on dev).
# The tests re-run themselves in UTC+8 (batchnum), as the platform runs the bodies.
set -e
IDAV2="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="$(cd "$IDAV2/../.." && pwd)"
OUT="$REPO/Item Disassembly/AsyncV2"
cd "$IDAV2"
python3 build_commit.py --write
python3 build_worker.py --write
node test/commit/test_steps.js
node test/commit/commit_sim.js
node test/commit/worker_sim.js
node test/commit/e2e_sim.js
python3 "$REPO/scratchpad/validate.py" "$OUT/IDA_V2_COMMIT.json" "$OUT/IDA_V2_WORKER.json" | grep -v CONDITIONAL
python3 "$REPO/scratchpad/validate.py" "$OUT/IDA_V2_COMMIT.json" "$OUT/IDA_V2_WORKER.json" > /dev/null
python3 "$REPO/scratchpad/check_wf_js.py" "$OUT/IDA_V2_COMMIT.json" "$OUT/IDA_V2_WORKER.json"
if [ "$1" = "--sql" ]; then python3 lib/sqlcheck.py "$OUT" test/commit/sql_values.json IDA_V2_COMMIT IDA_V2_WORKER; fi
echo "package C: all checks passed"
