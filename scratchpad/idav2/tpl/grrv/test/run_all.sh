#!/bin/bash
# GR Revert Completed V2 plan core: every harness. Fixtures hold customer data -> a directory OUTSIDE the repo.
#   usage: run_all.sh <fixture dir> [--fetch]
#   --fetch: pull the recorded GR_REVERT_COMPLETED runs (prod + dev) and run every read (read-only) on their receipts and on
#            every dev receipt that is Completed / Received now
set -euo pipefail
OUT=${1:?usage: run_all.sh <fixture dir outside the repo> [--fetch]}
case "$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/" in /Users/yunawinaya/Developer/*) echo "refusing: $OUT is inside the repo" >&2; exit 1 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
PY="$HERE/../../../.dbtools/venv/bin/python"
mkdir -p "$OUT/sql" "$OUT/rec"
python3 "$HERE/../lift/lift.py" --check
python3 "$HERE/../prepare/outputs.py" --check
if [ "${2:-}" = "--fetch" ]; then
  python3 "$HERE/fetch_grrv_runs.py" --prod "$OUT/runs_prod.jsonl"
  python3 "$HERE/fetch_grrv_runs.py" --dev "$OUT/runs_dev.jsonl"
  "$PY" "$HERE/run_prepare_sql.py" --prod "$OUT/rec" --recorded "$OUT/runs_prod.jsonl" > "$OUT/rec_prod.log"
  "$PY" "$HERE/run_prepare_sql.py" --dev "$OUT/rec" --recorded "$OUT/runs_dev.jsonl" > "$OUT/rec_dev.log"
  "$PY" "$HERE/run_prepare_sql.py" --dev "$OUT/sql" --completed > "$OUT/sql_dev.log"
fi
export TZ=Asia/Kuala_Lumpur
# the synthetic receipts' template: a dev receipt with batches, a putaway, in-transit rows, FIFO layers and PO lines
BASE_GR=${BASE_GR:-2100419010241564673}
[ -f "$OUT/sql/dev_$BASE_GR.json" ] || "$PY" "$HERE/run_prepare_sql.py" --dev "$OUT/sql" "$BASE_GR" > /dev/null
echo "== node bodies (as the builder embeds them)"; node "$HERE/plan_node_check.js" "$OUT/sql/dev_$BASE_GR.json"
echo "== (a) lifted bodies vs recorded node outputs";  node "$HERE/lifted_vs_recorded.js" "$OUT/runs_prod.jsonl" "$OUT/runs_dev.jsonl"
echo "== (b) adapter vs recorded reads (prod)";         node "$HERE/adapter_vs_recorded.js" "$OUT/runs_prod.jsonl" "$OUT/rec"
echo "== (b) adapter vs recorded reads (dev)";          node "$HERE/adapter_vs_recorded.js" "$OUT/runs_dev.jsonl" "$OUT/rec"
echo "== (c) the assembled plan on live dev reads";     node "$HERE/plan_live.js" "$OUT/sql"
echo "== (d) unit cases";                               node "$HERE/plan_unit.js"
echo "== (d) synthetic receipts built from dev GR $BASE_GR"
node "$HERE/synthetic_2k.js" "$OUT/sql/dev_$BASE_GR.json" 2000
node "$HERE/synthetic_2k.js" "$OUT/sql/dev_$BASE_GR.json" 2500
