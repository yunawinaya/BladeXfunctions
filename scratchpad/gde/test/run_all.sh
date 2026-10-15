#!/bin/bash
# every offline suite of GD Edit V2; fixtures = the recorded runs in the session scratchpad (FX, or the first argument)
FX="${1:-$FX}"
[ -d "$FX" ] || { echo "usage: run_all.sh <fixture dir>"; exit 2; }
cd "$(dirname "$0")/.." || exit 2
fail=0
run() { local name="$1"; shift; local out; out=$("$@" 2>&1); local rc=$?; echo "$name: $(echo "$out" | tail -1) (exit $rc)"; [ $rc -eq 0 ] || fail=1; }
run lift node test/test_lift.js
run parity node test/edit_parity.js "$FX"/*.json
run alloc node test/test_alloc.js "$FX"/*.json
run alloc_parity node test/edit_parity.js --alloc "$FX"/*.json
run delta node test/test_delta.js "$FX"/*.json
run plan node test/test_plan.js "$FX"/*.json
run commit node test/test_commit.js
run submit node test/test_submit.js "$FX"/*.json
run prepare_glue node test/test_prepare_glue.js
run worker node test/test_worker.js
run client node test/test_client.js
run mounted node test/test_mounted.js
run edit_open node test/test_edit_open.js
run picking_guards node test/test_picking_guards.js
run so_save node test/test_so_save_v2.js
run so_form node test/test_so_form.js
# SO_CASCADE on the interpreter: live READ-ONLY dev reads of 711077 SO/20261015-033 + GD/20261015/018
run cascade node test/cascade_v2_sim.js 711077 2110639355872194561 2110639610487418882
# the built workflows on the interpreter (needs the live read dumps next to the fixtures; build_gde.py --write first)
SP="$(dirname "$FX")"
# the allocation reads as SQL vs the platform's recorded rows (python3 test/alloc_rows.py "$FX"/*.json first: read-only dev)
[ -d "$SP/gde-allocrows" ] && run alloc_shape node test/test_alloc_shape.js "$FX"/*.json
[ -f "$SP/live056.json" ] && run sim056 node test/commit_sim.js "$SP/live056.json" 496474
[ -f "$SP/live006.json" ] && run sim006 node test/commit_sim.js "$SP/live006.json" 711077 REMOVE ADD CRASH STALE BUSY WORKER
run scope python3 test/test_sql_scope.py
run refs python3 test/check_refs.py "../../Goods Delivery/EditV2/GD_EDIT_PREPARE.json" "../../Goods Delivery/EditV2/GD_EDIT_COMMIT.json" "../../Goods Delivery/EditV2/GD_EDIT_WORKER.json" "../../Goods Delivery/EditV2/GD_EDIT_SUBMIT.json"
exit $fail
