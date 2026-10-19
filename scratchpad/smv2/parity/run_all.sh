#!/bin/bash
# Package E - LOT engine parity. Fetches every recorded classic SUBTRACT_INVENTORY / ADD_INVENTORY call that
# SM_LOCATION_TRANSFER made (transaction_type "LOT") from prod (the run log starts 2026-09-17) and dev, read-only; reads back
# the rows they inserted and the tenants' number rules; replays them through scratchpad/gdc/engine/core.js (required
# read-only); then proves the comparisons have teeth by replaying with deliberately broken in-memory engine copies.
#   usage: run_all.sh <out dir OUTSIDE the repo> [--replay-only] [--until YYYY-MM-DDTHH:MM (MYT)]
# Fixtures hold customer data: the out dir must be outside the repo. Read-only: SELECTs through .dbtools/db only.
set -euo pipefail
OUT=${1:?usage: run_all.sh <out dir outside the repo> [--replay-only] [--until YYYY-MM-DDTHH:MM]}
mkdir -p "$OUT"
case "$(cd "$OUT" && pwd -P)/" in /Users/yunawinaya/Developer/*) echo "refusing: $OUT is inside the repo" >&2; exit 1 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
REPLAY_ONLY=0
UNTIL=""
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --replay-only) REPLAY_ONLY=1 ;;
    --until) UNTIL=$2; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
# one upper bound for every fetch (5 minutes ago, MYT): an ADD is never kept without the SUBTRACT its run made just before it
[ -n "$UNTIL" ] || UNTIL=$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone(d.timedelta(hours=8))) - d.timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M'))")

fetch() { # env kind name since
  local env=$1 kind=$2 name=$3 since=$4
  python3 "$HERE/fetch_runs_old.py" "--$env" "$kind" LOT "$OUT/$name.raw.jsonl" --since "$since" --until "$UNTIL"
  python3 "$HERE/rebuild_cut.py" "--$env" "$OUT/$name.raw.jsonl" "$OUT/$name.jsonl"
  python3 "$HERE/fetch_db_rows.py" "--$env" "$OUT/$name.jsonl" "$OUT/$name.db.jsonl"
}
if [ "$REPLAY_ONLY" = 0 ]; then
  echo "fetching up to $UNTIL MYT" > "$OUT/WINDOW.txt"
  python3 "$HERE/fetch_rules.py" "$OUT/rules.json"
  fetch prod SUBTRACT prod_sub_lot 2026-09-17
  fetch prod ADD prod_add_lot 2026-09-17
  fetch dev SUBTRACT dev_sub_lot 2026-07-01
  fetch dev ADD dev_add_lot 2026-07-01
fi

R="node $HERE/replay_old.js"
RULES="--rules $OUT/rules.json"
for env in prod dev; do
  S=$OUT/${env}_sub_lot A=$OUT/${env}_add_lot
  DB="--db $S.db.jsonl,$A.db.jsonl"
  $R SUBTRACT "$S.jsonl" --db "$S.db.jsonl" $RULES --detail "$OUT/det_${env}_1.json" > "$OUT/res_${env}_1_subtract_per_call.txt"
  $R ADD "$A.jsonl" --db "$A.db.jsonl" $RULES --detail "$OUT/det_${env}_2.json" > "$OUT/res_${env}_2_add_per_call.txt"
  $R PAIRS "$S.jsonl" "$A.jsonl" $DB $RULES --detail "$OUT/det_${env}_3.json" > "$OUT/res_${env}_3_pairs_v2.txt"
  $R DOC "$S.jsonl" "$A.jsonl" $DB $RULES --detail "$OUT/det_${env}_4.json" > "$OUT/res_${env}_4_doc_v2.txt"
  $R PAIRS "$S.jsonl" "$A.jsonl" $RULES --raw > "$OUT/res_${env}_3b_pairs_raw.txt"
  $R DOC "$S.jsonl" "$A.jsonl" $RULES --raw > "$OUT/res_${env}_4b_doc_raw.txt"
  $R PAIRS "$S.jsonl" "$A.jsonl" $RULES --synthetic-sc0 > "$OUT/res_${env}_5_synthetic_stock_control_0.txt"
done

# self-test (prod pairs): each deliberate engine bug must drop the identical count; no-date-copy must change nothing
S=$OUT/prod_sub_lot A=$OUT/prod_add_lot
base=$(grep '^SUMMARY' "$OUT/res_prod_3_pairs_v2.txt" | sed 's/.* identical=\([0-9]*\).*/\1/')
: > "$OUT/res_selftest.txt"
for mu in add-price-zero no-batch-deduct add-unrestricted-only in-movement-no-dates fifo-last-layer no-date-copy; do
  $R PAIRS "$S.jsonl" "$A.jsonl" $RULES --mutate $mu > "$OUT/res_selftest_$mu.txt"
  got=$(grep '^SUMMARY' "$OUT/res_selftest_$mu.txt" | sed 's/.* identical=\([0-9]*\).*/\1/')
  if [ "$mu" = no-date-copy ]; then verdict=$([ "$got" = "$base" ] && echo "ok (unchanged: the date copy is not visible in the recorded data)" || echo "CHANGED"); else verdict=$([ "$got" -lt "$base" ] && echo "caught ($((base - got)) pairs)" || echo "NOT CAUGHT"); fi
  echo "mutation $mu: identical $got of baseline $base -> $verdict" | tee -a "$OUT/res_selftest.txt"
done

for f in "$OUT"/res_prod_*.txt "$OUT"/res_dev_*.txt "$OUT"/res_selftest.txt; do echo "=================== $(basename "$f")"; cat "$f"; done
