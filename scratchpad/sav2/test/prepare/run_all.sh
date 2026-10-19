#!/bin/sh
# Package A (SA_V2_PREPARE + the shared review chain): every check, read-only. Fixtures: fetch_sc_runs.py / fetch_sa_runs.py /
# fetch_sa_rows.py (tenant data: fixtures/ is git-ignored). Exit 1 on the first failure.
set -e
cd "$(dirname "$0")/../.."
python3 lift/sync_review_chain.py --check
python3 lib/lift/lift.py lift/prepare_lift.json --check
python3 build_prepare.py --write
node test/prepare/test_review_golden.js | tail -1
python3 test/prepare/test_review_shape.py | tail -1
node test/prepare/test_sa_golden.js | tail -1
node test/prepare/test_prepare_flow.js | tail -1
(cd ../.. && python3 scratchpad/validate.py "Stock Adjustment/AsyncV2/SA_V2_PREPARE.json" | grep -v CONDITIONAL && python3 scratchpad/check_wf_js.py "Stock Adjustment/AsyncV2/SA_V2_PREPARE.json")
python3 lib/sqlcheck.py "../../Stock Adjustment/AsyncV2" test/prepare/sqlcheck_values.json SA_V2_PREPARE | tail -1
