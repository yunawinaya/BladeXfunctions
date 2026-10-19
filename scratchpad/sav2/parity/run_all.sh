#!/bin/bash
# Package E - SA engine parity. Fetches every recorded classic STOCK_ADJUSTMENT run from prod (the run log starts
# 2026-09-17) and dev, read-only, with the ADD_INVENTORY / SUBTRACT_INVENTORY child calls each made (transaction_type "SA");
# refills cut costing reads; reads back the rows the calls inserted, the items' current base UOM and the tenants' number
# rules; replays them through scratchpad/gdc/engine/core.js (required read-only) per call and per SA run (the V2 COMMIT's
# single APPLY with the CONTRACT §5 movements); checks the §5 movement builder against the recorded calls; then proves the
# comparisons have teeth with deliberately broken in-memory engine copies.
#   usage: run_all.sh <out dir OUTSIDE the repo> [--replay-only] [--until YYYY-MM-DDTHH:MM (MYT)]
# Fixtures hold customer data: the out dir must be outside the repo. Read-only: SELECTs through .dbtools/db only.
# Adapted from scratchpad/sav2/tpl/smv2/parity/run_all.sh (= smv2 LOT parity, from scratchpad/grv2/parity).
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
# one upper bound for every fetch (5 minutes ago, MYT): an SA run is never kept without the calls it made
[ -n "$UNTIL" ] || UNTIL=$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone(d.timedelta(hours=8))) - d.timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M'))")

fetch() { # env name since
  local env=$1 name=$2 since=$3
  python3 "$HERE/fetch_runs_sa.py" "--$env" "$OUT/$name.raw.jsonl" --since "$since" --until "$UNTIL"
  python3 "$HERE/rebuild_cut.py" "--$env" "$OUT/$name.raw.jsonl" "$OUT/$name.jsonl"
  python3 "$HERE/fetch_db_rows.py" "--$env" "$OUT/$name.jsonl" "$OUT/$name.db.jsonl"
}
if [ "$REPLAY_ONLY" = 0 ]; then
  echo "fetching up to $UNTIL MYT" > "$OUT/WINDOW.txt"
  python3 "$HERE/fetch_rules.py" "$OUT/rules.json"
  fetch prod prod_sa 2026-09-17
  fetch dev dev_sa 2026-01-01
fi

R="node $HERE/replay_sa.js"
RULES="--rules $OUT/rules.json"
for env in prod dev; do
  F=$OUT/${env}_sa
  $R MOVES "$F.jsonl" $RULES > "$OUT/res_${env}_1_moves_v2_builder.txt"
  $R CALLS "$F.jsonl" --db "$F.db.jsonl" $RULES --detail "$OUT/det_${env}_2.json" > "$OUT/res_${env}_2_calls.txt"
  $R DOC "$F.jsonl" --db "$F.db.jsonl" $RULES --detail "$OUT/det_${env}_3.json" > "$OUT/res_${env}_3_doc_v2.txt"
  $R CALLS "$F.jsonl" $RULES --raw > "$OUT/res_${env}_2b_calls_raw.txt"
  $R DOC "$F.jsonl" $RULES --raw > "$OUT/res_${env}_3b_doc_raw.txt"
done

# self-test (prod): each deliberate engine bug must drop the identical count of the per-call or the per-run replay
F=$OUT/prod_sa
: > "$OUT/res_selftest.txt"
for mu in add-price-zero no-batch-deduct fifo-last-layer fifo-no-consume wa-no-reaverage wa-sub-no-deduct fifo-seq-plus2 no-rule-rounding; do
  line="mutation $mu:"
  for m in CALLS DOC; do
    base=$(grep '^SUMMARY' "$OUT/res_prod_$([ $m = CALLS ] && echo 2_calls || echo 3_doc_v2).txt" | sed 's/.* identical=\([0-9]*\).*/\1/')
    got=$($R $m "$F.jsonl" --db "$F.db.jsonl" $RULES --mutate $mu | grep '^SUMMARY' | sed 's/.* identical=\([0-9]*\).*/\1/')
    line="$line $m identical $got of $base -> $([ "$got" -lt "$base" ] && echo "caught ($((base - got)))" || echo "NOT CAUGHT")"
  done
  echo "$line" | tee -a "$OUT/res_selftest.txt"
done

# self-test of the MOVES check (prod): a copy of replay_sa.js + core.js in $OUT/movetest with one deliberately wrong
# v2moves.js recipe per run; each must drop the identical count (no recorded entry has sa_quantity <= 0 or a category other
# than Unrestricted, so those two mutations cannot be caught by this data)
T=$OUT/movetest
rm -rf "$T" && mkdir -p "$T/sav2/parity" "$T/gdc/engine"
cp "$HERE/../../gdc/engine/core.js" "$T/gdc/engine/" && cp "$HERE/replay_sa.js" "$T/sav2/parity/"
base=$(grep '^SUMMARY' "$OUT/res_prod_1_moves_v2_builder.txt" | sed 's/.* identical=\([0-9]*\).*/\1/')
for mu in 's/material_uom: line.uom_id || "",/material_uom: "",/' 's/unit_price: parseFloat(line.unit_price) || 0,/unit_price: 0,/' \
          's/doc_date: h.adjustment_date,/doc_date: all.adjustment_date,/' 's/trx_no: h.adjustment_no,/trx_no: all.adjustment_no,/' \
          's/m.remark = line.item_remark || null;/m.remark = line.item_remark || "";/' 's/batch_id: e.batch_id || null,/batch_id: e.batch_id || "",/' \
          's/inventory_category: e.category || "Unrestricted",/inventory_category: "Unrestricted",/' 's/entries.filter((e) => e \&\& e.sa_quantity > 0)/entries/'; do
  sed "$mu" "$HERE/v2moves.js" > "$T/sav2/parity/v2moves.js"
  got=$(node "$T/sav2/parity/replay_sa.js" MOVES "$F.jsonl" | grep '^SUMMARY' | sed 's/.* identical=\([0-9]*\).*/\1/')
  echo "moves mutation $mu: identical $got of $base -> $([ "$got" -lt "$base" ] && echo "caught ($((base - got)))" || echo "NOT CAUGHT")" | tee -a "$OUT/res_selftest.txt"
done

for f in "$OUT"/res_prod_*.txt "$OUT"/res_dev_*.txt "$OUT"/res_selftest.txt; do echo "=================== $(basename "$f")"; cat "$f"; done
