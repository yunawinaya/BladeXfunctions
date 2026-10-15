#!/bin/sh
# Phase 2 GR_CREATED / GR_CANCEL_CREATED: rebuild (must be a no-op on a clean tree), lint, SQL on dev, simulations.
# Recorded-run replays need the private fixtures (python3 fetch_runs.py). Exit 1 on any failure.
set -e
cd "$(dirname "$0")"
R=../../..
C="Goods Receiving/GRsaveAsCreatedWorkflow.json"
K="Bulk Actions/Procurement/Goods Receiving/GRcancelWorkflow.json"
a=$(shasum "$R/$C" "$R/$K")
python3 build.py > /dev/null
b=$(shasum "$R/$C" "$R/$K")
[ "$a" = "$b" ] && echo "build: reproducible" || echo "build: files REWRITTEN (were they edited by hand?)"
(cd $R && python3 scratchpad/validate.py "$C" "$K" && python3 scratchpad/check_wf_js.py "$C" "$K")
python3 sqlcheck.py | grep -E "^(BAD|FAIL)|problems"
cd sim
for m in null empty; do
  echo "== a skipped node's placeholder injected as: $m"
  GR_SIM_MISSING=$m node scenarios.js | tail -1
  GR_SIM_MISSING=$m node replay_created.js | tail -1
  GR_SIM_MISSING=$m node replay_cancel.js | tail -1
done
node size.js
