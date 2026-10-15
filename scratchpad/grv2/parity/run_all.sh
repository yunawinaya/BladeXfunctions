#!/bin/bash
# Phase 0a engine parity: fetch every recorded OLD ADD_INVENTORY / SUBTRACT_INVENTORY run of GR (GRN), Putaway (TO - PA) and
# GR revert (GRN-R) from prod + dev (read-only), refill cut costing reads, read back the rows each run inserted, and replay
# them through core.js's planBulk.
#   usage: run_all.sh <out dir OUTSIDE the repo> [--replay-only]   (fixtures hold customer data)
# Window A = since 2026-10-02 (the plan's window); window B = 2026-09-18 15:51 -> 2026-10-02 (rest of v65 / v58; prod ran
# the previous code until 2026-09-22 18:12 - those runs are skipped by the replay).
set -euo pipefail
OUT=${1:?usage: run_all.sh <out dir outside the repo> [--replay-only]}
case "$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/" in /Users/yunawinaya/Developer/*) echo "refusing: $OUT is inside the repo" >&2; exit 1 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
fetch() { # env kind type name since [until]
  local env=$1 kind=$2 type=$3 name=$4 since=$5 until=${6:-}
  python3 "$HERE/fetch_runs_old.py" "--$env" "$kind" "$type" "$OUT/$name.raw.jsonl" --since "$since" ${until:+--until "$until"}
  python3 "$HERE/rebuild_cut.py" "--$env" "$OUT/$name.raw.jsonl" "$OUT/$name.jsonl"
  python3 "$HERE/fetch_db_rows.py" "--$env" "$OUT/$name.jsonl" "$OUT/$name.db.jsonl"
}
if [ "${2:-}" != "--replay-only" ]; then
  python3 "$HERE/fetch_rules.py" "$OUT/rules.json"
  for env in prod dev; do
    fetch $env ADD GRN ${env}_A_add_grn 2026-10-02
    fetch $env ADD GRN ${env}_B_add_grn 2026-09-18T15:51 2026-10-02
    fetch $env SUBTRACT "TO - PA" ${env}_A_sub_topa 2026-10-02
    fetch $env SUBTRACT "TO - PA" ${env}_B_sub_topa 2026-09-18T15:51 2026-10-02
    fetch $env ADD "TO - PA" ${env}_A_add_topa 2026-10-02
    fetch $env ADD "TO - PA" ${env}_B_add_topa 2026-09-18T15:51 2026-10-02
    fetch $env SUBTRACT GRN-R ${env}_AB_sub_grnr 2026-09-18T15:51
  done
fi
R="node $HERE/replay_old.js"
for env in prod dev; do
  for w in A B; do
    g=$OUT/${env}_${w}_add_grn s=$OUT/${env}_${w}_sub_topa a=$OUT/${env}_${w}_add_topa
    $R ADD $g.jsonl --db $g.db.jsonl --detail "$OUT/det_${env}_${w}_grn.json" > "$OUT/res_${env}_${w}_1_grn_per_call.txt"
    $R CHAIN $g.jsonl > "$OUT/res_${env}_${w}_2_grn_per_document.txt"
    $R SUBTRACT $s.jsonl --db $s.db.jsonl --detail "$OUT/det_${env}_${w}_sub_topa.json" > "$OUT/res_${env}_${w}_3_putaway_subtract.txt"
    $R SUBTRACT $s.jsonl --engine-change > "$OUT/res_${env}_${w}_3b_putaway_subtract_engine_change.txt"
    $R ADD $a.jsonl --db $a.db.jsonl --detail "$OUT/det_${env}_${w}_add_topa.json" > "$OUT/res_${env}_${w}_4_putaway_add.txt"
    $R PAIRS $s.jsonl $a.jsonl --detail "$OUT/det_${env}_${w}_pairs.json" > "$OUT/res_${env}_${w}_5_putaway_pairs.txt"
    $R CHAIN $s.jsonl $a.jsonl > "$OUT/res_${env}_${w}_6_putaway_per_confirmation.txt"
    $R CHAIN $s.jsonl $a.jsonl --engine-change > "$OUT/res_${env}_${w}_6b_putaway_per_confirmation_engine_change.txt"
  done
  r=$OUT/${env}_AB_sub_grnr
  $R SUBTRACT $r.jsonl --db $r.db.jsonl --show 20 > "$OUT/res_${env}_AB_7_grn_revert.txt"
  $R SUBTRACT $r.jsonl --engine-change > "$OUT/res_${env}_AB_7b_grn_revert_engine_change.txt"
done
# the engine's own read-back against the tenants' number rules: one plan per document, and per call
if [ -f "$OUT/rules.json" ]; then
  for env in prod dev; do
    for w in A B; do
      $R READBACK "$OUT/${env}_${w}_add_grn.jsonl" --rules "$OUT/rules.json" > "$OUT/res_${env}_${w}_8_grn_readback_per_document.txt"
      $R READBACK "$OUT/${env}_${w}_add_grn.jsonl" --rules "$OUT/rules.json" --per-call > "$OUT/res_${env}_${w}_8b_grn_readback_per_call.txt"
      $R READBACK "$OUT/${env}_${w}_sub_topa.jsonl" "$OUT/${env}_${w}_add_topa.jsonl" --rules "$OUT/rules.json" > "$OUT/res_${env}_${w}_9_putaway_readback_per_confirmation.txt"
    done
    $R READBACK "$OUT/${env}_AB_sub_grnr.jsonl" --rules "$OUT/rules.json" > "$OUT/res_${env}_AB_9b_grn_revert_readback.txt"
  done
fi
for f in "$OUT"/res_*.txt; do echo "=================== $(basename "$f")"; cat "$f"; done
