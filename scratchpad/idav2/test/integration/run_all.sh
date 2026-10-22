#!/bin/sh
# E phase 2: the integration run (read-only; nothing touches a database). usage: sh scratchpad/idav2/test/integration/run_all.sh [outdir]
set -e
D=$(cd "$(dirname "$0")" && pwd)
OUTD=${1:-${TMPDIR:-/tmp}}
echo "-- interfaces.py"
python3 -I "$D/interfaces.py" --json "$OUTD/ida_interfaces.json" | grep -E "^(ok|FAIL)|interface checks"
echo "-- e2e.js (scenarios a a2 b c d1 d2 d3 e f g h i i2)"
TZ=Asia/Kuala_Lumpur node --max-old-space-size=12288 "$D/e2e.js" --json "$OUTD/ida_e2e.json"
echo "-- mutants.js"
TZ=Asia/Kuala_Lumpur node "$D/mutants.js" --json "$OUTD/ida_mutants.json"
echo "integration: all passed (reports in $OUTD)"
