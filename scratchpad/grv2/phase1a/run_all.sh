#!/bin/zsh
# Phase 1a (PO_SAVE at 2,000 lines): re-apply both patches from their bases and run every check.
#   ./run_all.sh <cache dir>     the cache dir holds the recorded runs (runs/), the dev v847 form and prod v22 PO_SAVE
#                                 (customer data: kept outside the repo). runs.py / fetch_prod_sample.py fill it.
set -e
HERE=${0:A:h}
ROOT=${HERE:h:h:h}
C=${1:?usage: run_all.sh <cache dir>}
TPL=$C/runs/dev_2110202664854880257.json
WF="$ROOT/Purchase Order/POsaveWorkflow.json"
cd $HERE
echo "== patch workflow (base: dev v39)";       python3 patch_po_save.py
# the PO form is no longer patched here: scratchpad/po_import/build_form.py builds it on the live version (v847 is stale)
echo "== lint";                                 (cd $ROOT && python3 scratchpad/validate.py "Purchase Order/POsaveWorkflow.json" | grep -v CONDITIONAL)
echo "== js syntax";                            (cd $ROOT && python3 scratchpad/check_wf_js.py "Purchase Order/POsaveWorkflow.json" | tail -1)
echo "== sql nodes on dev (as embedded)";       python3 sqlcheck_po.py | tail -1
echo "== sql vs recorded reads (dev)";          python3 test_sql.py 40 | tail -1
echo "== replay recorded runs";                 node replay.js $C/runs "$WF" $C/prod_PO_SAVE_enabled.json | grep -E "^runs|fail +[1-9]|FAIL|ERROR" || true
echo "== scenarios OLD vs NEW";                 node scenarios.js $TPL base/PO_SAVE.v39.json "$WF" | tail -1
echo "== slim vs full payload";                 node slim_vs_full.js $TPL "$WF" client/slim_payload.js | grep -c "^ok"
echo "== client handlers";                      node client_test.js $C/PO_form_dev_v847.json "$ROOT/Purchase Order/POfullJSON.json" $TPL | grep -E "^FAIL|failures"
echo "== node data";                            node sizes.js $TPL base/PO_SAVE.v39.json "$WF" client/slim_payload.js | head -7
