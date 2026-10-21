#!/bin/bash
# Package E - IA twins by replay (verification item 3, CONTRACT section 13 "E's verification method"). Read-only: the recorded
# classic IA_SAVE runs (dev from 2026-09-11, prod from 2026-09-26) with the SUBTRACT / ADD child calls each made (transaction_type
# "IA"), the rows those calls inserted and the tenants' number rules, replayed through scratchpad/gdc/engine/core.js (required
# read-only) per call (CALLS) and per IA run as V2's op 1 + op 2 with V2's receipt price (DOC); the CONTRACT section 5 builder
# checked against the recorded calls (MOVES); then the comparisons' teeth proven with deliberately broken in-memory engine copies.
# Run it again after the live classic twin A (its run is then in the dev fixture).
#   usage: run_replay.sh <dev out dir OUTSIDE the repo> [--replay-only] [--until YYYY-MM-DDTHH:MM (MYT)]
# PROD fixtures AND the prod results live only under ialib.PROD_FIXTURES (pull_prod_fixtures.sh re-pulls them); dev ones in the
# out dir. Adapted from scratchpad/sav2/parity/run_all.sh.
set -euo pipefail
OUT=${1:?usage: run_replay.sh <dev out dir outside the repo> [--replay-only] [--until YYYY-MM-DDTHH:MM]}
mkdir -p "$OUT"
case "$(cd "$OUT" && pwd -P)/" in /Users/yunawinaya/Developer/*) echo "refusing: $OUT is inside the repo" >&2; exit 1 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
PF=$(python3 -c "import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]); import ialib; print(ialib.PROD_FIXTURES)" "$HERE")
PR=$PF/results
mkdir -p "$PR"
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
[ -n "$UNTIL" ] || UNTIL=$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone(d.timedelta(hours=8))) - d.timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M'))")
if [ "$REPLAY_ONLY" = 0 ]; then
  bash "$HERE/pull_prod_fixtures.sh" --until "$UNTIL"
  echo "dev fetched up to $UNTIL MYT" > "$OUT/WINDOW.txt"
  python3 "$HERE/fetch_runs_ia.py" --dev "$OUT/dev_ia.jsonl" --since 2026-09-11 --until "$UNTIL"
  python3 "$HERE/fetch_db_rows_ia.py" --dev "$OUT/dev_ia.jsonl" "$OUT/dev_ia.db.jsonl"
fi

R="node $HERE/replay_ia.js"
RULES="--rules $PF/rules.json"
for env in prod dev; do
  if [ "$env" = prod ]; then F=$PF/prod_ia; D=$PR; else F=$OUT/dev_ia; D=$OUT; fi
  $R MOVES "$F.jsonl" $RULES > "$D/res_${env}_1_moves.txt"
  $R CALLS "$F.jsonl" --db "$F.db.jsonl" $RULES --detail "$D/det_${env}_2.json" > "$D/res_${env}_2_calls.txt"
  $R DOC "$F.jsonl" --db "$F.db.jsonl" $RULES --detail "$D/det_${env}_3.json" > "$D/res_${env}_3_doc_v2.txt"
done

# self-test (prod): each deliberate engine bug must drop the identical count of the per-call or the per-run replay
F=$PF/prod_ia
: > "$PR/res_selftest.txt"
for mu in add-price-zero no-batch-deduct fifo-last-layer fifo-no-consume wa-no-reaverage wa-sub-no-deduct fifo-seq-plus2 no-rule-rounding; do
  line="mutation $mu:"
  for m in CALLS DOC; do
    base=$(grep '^SUMMARY' "$PR/res_prod_$([ $m = CALLS ] && echo 2_calls || echo 3_doc_v2).txt" | sed 's/.* identical=\([0-9]*\).*/\1/')
    got=$($R $m "$F.jsonl" --db "$F.db.jsonl" $RULES --mutate $mu | grep '^SUMMARY' | sed 's/.* identical=\([0-9]*\).*/\1/')
    line="$line $m identical $got of $base -> $([ "$got" -lt "$base" ] && echo "caught ($((base - got)))" || echo "NOT CAUGHT")"
  done
  echo "$line" | tee -a "$PR/res_selftest.txt"
done

# self-test of the MOVES check (prod): a copy of the code (no data) in $OUT/movetest with one deliberately wrong ia_moves.js recipe
T=$OUT/movetest
rm -rf "$T" && mkdir -p "$T/iav2/live" "$T/iav2/code/shared" "$T/gdc/engine"
cp "$HERE/../../gdc/engine/core.js" "$T/gdc/engine/" && cp "$HERE/replay_ia.js" "$T/iav2/live/" && cp "$HERE/../code/shared/price.js" "$T/iav2/code/shared/"
base=$(grep '^SUMMARY' "$PR/res_prod_1_moves.txt" | sed 's/.* identical=\([0-9]*\).*/\1/')
for mu in 's/quantity: q8(p.sm_quantity),/quantity: q8(p.sm_quantity) + 1,/' 's/material_uom: digitsOrNull(l.quantity_uom) || "",/material_uom: "",/' \
          's/location_id: s(p.location_id),/location_id: s(l.balance_id),/' 's/batch_id: digitsOrNull(p.batch_id),/batch_id: null,/' \
          's/inventory_category: s(p.category) || "Unrestricted",/inventory_category: "Blocked",/' 's/doc_date: docDate, isMovingInv: 0, handling_unit_id: null,/doc_date: null, isMovingInv: 0, handling_unit_id: null,/' \
          's/material_id: s(h.item_id), quantity: q8(h.item_qty),/material_id: s(h.item_id), quantity: q8(h.item_qty) * 2,/' \
          's/location_id: s(h.location_id), batch_id: o.batchId/location_id: s(h.issuing_operation_faci), batch_id: o.batchId/' \
          's/remark: raw(h.remarks),/remark: "x",/'; do
  sed "$mu" "$HERE/ia_moves.js" > "$T/iav2/live/ia_moves.js"
  if cmp -s "$HERE/ia_moves.js" "$T/iav2/live/ia_moves.js"; then echo "moves mutation $mu: PATTERN NOT FOUND" | tee -a "$PR/res_selftest.txt"; continue; fi
  got=$(node "$T/iav2/live/replay_ia.js" MOVES "$F.jsonl" | grep '^SUMMARY' | sed 's/.* identical=\([0-9]*\).*/\1/')
  echo "moves mutation $mu: identical $got of $base -> $([ "$got" -lt "$base" ] && echo "caught ($((base - got)))" || echo "NOT CAUGHT")" | tee -a "$PR/res_selftest.txt"
done

for f in "$PR"/res_prod_*.txt "$OUT"/res_dev_*.txt "$PR"/res_selftest.txt; do echo "=================== $(basename "$f")"; grep -v '^    [0-9]\{19\}' "$f"; done
