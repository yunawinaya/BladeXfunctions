#!/bin/bash
# Package E - IDA twins by replay (verification 3, CONTRACT section 13 "E's method"). Read-only: the recorded classic IDA_SAVE runs on dev
# (IDA is not on prod) with the SUBTRACT / ADD child calls each made (transaction_type "IDA"), the rows those calls inserted and the
# tenants' number rules (each applied from its creation on), replayed through scratchpad/gdc/engine/core.js (required read-only) per call
# (CALLS) and per IDA run as V2's op 1 + op 2 with V2's prices (DOC); the CONTRACT section 5 builder checked against the recorded calls
# (MOVES); idaAllocate against the classic v6 / v7 code_cost_alloc (test_alloc.js); then the comparisons' teeth proven with deliberately
# broken in-memory engine copies and builder copies. Run it again after the live classic twin A (its run is then in the fixture).
#   usage: run_replay.sh <out dir OUTSIDE the repo> [--replay-only] [--until YYYY-MM-DDTHH:MM (MYT)]
# Adapted from tpl/iav2/live/run_replay.sh (no prod part).
set -euo pipefail
OUT=${1:?usage: run_replay.sh <out dir outside the repo> [--replay-only] [--until YYYY-MM-DDTHH:MM]}
mkdir -p "$OUT"
case "$(cd "$OUT" && pwd -P)/" in /Users/yunawinaya/Developer/*) echo "refusing: $OUT is inside the repo" >&2; exit 1 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
IDAV2=$(cd "$HERE/../.." && pwd)
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
[ -n "$UNTIL" ] || UNTIL=$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone(d.timedelta(hours=8))) - d.timedelta(minutes=2)).strftime('%Y-%m-%dT%H:%M'))")
if [ "$REPLAY_ONLY" = 0 ]; then
  echo "dev fetched up to $UNTIL MYT on $(date '+%Y-%m-%d %H:%M')" > "$OUT/WINDOW.txt"
  python3 "$HERE/fetch_rules_ida.py" "$OUT/rules.json"
  python3 "$HERE/fetch_runs_ida.py" "$OUT/dev_ida.jsonl" --since 2026-10-06 --until "$UNTIL"
  python3 "$HERE/fetch_db_rows_ida.py" "$OUT/dev_ida.jsonl" "$OUT/dev_ida.db.jsonl"
fi

R="node $HERE/replay_ida.js"
F=$OUT/dev_ida
RULES="--rules $OUT/rules.json"
$R MOVES "$F.jsonl" $RULES > "$OUT/res_1_moves.txt"
$R CALLS "$F.jsonl" --db "$F.db.jsonl" $RULES --detail "$OUT/det_2.json" > "$OUT/res_2_calls.txt"
$R DOC "$F.jsonl" --db "$F.db.jsonl" $RULES --detail "$OUT/det_3.json" > "$OUT/res_3_doc_v2.txt"
node "$HERE/test_alloc.js" > "$OUT/res_4_alloc.txt" || true

# self-test: each deliberate engine bug must drop the identical count of the per-call or the per-run replay (a bug the corpus cannot
# show - no WA item, no number rule at the runs' time - is reported NOT CAUGHT, never hidden)
: > "$OUT/res_selftest.txt"
for mu in add-price-zero no-batch-deduct fifo-last-layer fifo-no-consume wa-no-reaverage wa-sub-no-deduct fifo-seq-plus2 no-rule-rounding; do
  line="mutation $mu:"
  for m in CALLS DOC; do
    base=$(grep '^SUMMARY' "$OUT/res_$([ $m = CALLS ] && echo 2_calls || echo 3_doc_v2).txt" | sed 's/.* identical=\([0-9]*\).*/\1/')
    got=$($R $m "$F.jsonl" --db "$F.db.jsonl" $RULES --mutate $mu | grep '^SUMMARY' | sed 's/.* identical=\([0-9]*\).*/\1/')
    line="$line $m identical $got of $base -> $([ "$got" -lt "$base" ] && echo "caught ($((base - got)))" || echo "NOT CAUGHT")"
  done
  echo "$line" | tee -a "$OUT/res_selftest.txt"
done

# self-test of the MOVES check: a copy of the code (no data) in $OUT/movetest with one deliberately wrong live/ida_moves.js recipe
T=$OUT/movetest
rm -rf "$T" && mkdir -p "$T/idav2/test/twins" "$T/idav2/live" "$T/idav2/code/shared" "$T/gdc/engine"
cp "$IDAV2/../gdc/engine/core.js" "$T/gdc/engine/" && cp "$HERE/replay_ida.js" "$T/idav2/test/twins/" && cp "$IDAV2"/code/shared/*.js "$T/idav2/code/shared/"
base=$(grep '^SUMMARY' "$OUT/res_1_moves.txt" | sed 's/.* identical=\([0-9]*\).*/\1/')
for mu in 's/quantity: q8(p.sm_quantity),/quantity: q8(p.sm_quantity) + 1,/' 's/material_uom: digitsOrNull(h.item_uom) || "",/material_uom: "",/' \
          's/location_id: s(p.location_id),/location_id: s(p.balance_id),/' 's/inventory_category: C.idaCategory(p.category),/inventory_category: "Blocked",/' \
          's/doc_date: docDate, isMovingInv: 0, handling_unit_id: null,/doc_date: null, isMovingInv: 0, handling_unit_id: null,/' \
          's/material_id: s(l.item_selection), quantity: share,/material_id: s(l.item_selection), quantity: share * 2,/' \
          's/location_id: s(l.location_id), batch_id: null, unit_price: 0,/location_id: lplant, batch_id: null, unit_price: 0,/' \
          's/remark: raw(l.item_remark) || "",/remark: "x",/' 's/const share = q8(l.total_quantity);/const share = q8(l.total_quantity) + 1;/' \
          's/if (x !== y) return x - y;/if (x !== y) return y - x;/'; do
  sed "$mu" "$IDAV2/live/ida_moves.js" > "$T/idav2/live/ida_moves.js"
  if cmp -s "$IDAV2/live/ida_moves.js" "$T/idav2/live/ida_moves.js"; then echo "moves mutation $mu: PATTERN NOT FOUND" | tee -a "$OUT/res_selftest.txt"; continue; fi
  got=$(node "$T/idav2/test/twins/replay_ida.js" MOVES "$F.jsonl" | grep '^SUMMARY' | sed 's/.* identical=\([0-9]*\).*/\1/')
  echo "moves mutation $mu: identical $got of $base -> $([ "$got" -lt "$base" ] && echo "caught ($((base - got)))" || echo "NOT CAUGHT")" | tee -a "$OUT/res_selftest.txt"
done

for f in "$OUT"/res_*.txt; do echo "=================== $(basename "$f")"; grep -v '^    [0-9]\{19\}' "$f"; done
