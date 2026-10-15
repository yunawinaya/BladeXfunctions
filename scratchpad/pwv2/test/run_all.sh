#!/bin/bash
# Putaway Completion V2 plan core: every harness. Fixtures hold customer data -> a directory OUTSIDE the repo.
#   usage: run_all.sh <fixture dir> [--fetch]
#   --fetch: pull the recorded PUTAWAY runs (prod + dev, since PUTAWAY v33) and run every PREPARE / SUBMIT read on their TOs
#            (read-only; prod skips the dev-only gd_publish_step read)
set -euo pipefail
OUT=${1:?usage: run_all.sh <fixture dir outside the repo> [--fetch]}
case "$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/" in /Users/yunawinaya/Developer/*) echo "refusing: $OUT is inside the repo" >&2; exit 1 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT/sql"
python3 "$HERE/../lift/lift.py" --check
if [ "${2:-}" = "--fetch" ]; then
  python3 "$HERE/fetch_pw_runs.py" --prod "$OUT/runs_prod.jsonl"
  python3 "$HERE/fetch_pw_runs.py" --dev "$OUT/runs_dev.jsonl"
  for env in prod dev; do
    ids=$(python3 -c "import json,sys; print(' '.join(sorted({str((json.loads(l)['params'].get('allData') or {}).get('id') or '') for l in open(sys.argv[1]) if l.strip()} - {''})))" "$OUT/runs_$env.jsonl")
    python3 "$HERE/run_prepare_sql.py" "--$env" "$OUT/sql" $ids
  done
fi
export TZ=Asia/Kuala_Lumpur
R="$OUT/runs_prod.jsonl $OUT/runs_dev.jsonl"
echo "== (a) lifted bodies vs recorded node outputs";      node "$HERE/lifted_vs_recorded.js" $R
echo "== adapter vs recorded reads";                       node "$HERE/adapter_vs_recorded.js" "$OUT/runs_prod.jsonl" "$OUT/sql"; node "$HERE/adapter_vs_recorded.js" "$OUT/runs_dev.jsonl" "$OUT/sql"
echo "== rebuild + chain + (b) movements + gates";         node "$HERE/chain_parity.js" $R --sql "$OUT/sql"
echo "== (c) manifest parts vs what the runs wrote";       node "$HERE/writes_vs_db.js" $R --sql "$OUT/sql"
echo "== unit cases";                                      node "$HERE/plan_unit.js"
# (d) template: a dev TO (tenant 000000) with batch lines and open in-transit rows; BASE_TO=<id> to use another
BASE_TO=${BASE_TO:-2105558352827682817}
[ -f "$OUT/sql/dev_$BASE_TO.json" ] || python3 "$HERE/run_prepare_sql.py" --dev "$OUT/sql" "$BASE_TO"
echo "== (d) synthetic confirmations on dev TO $BASE_TO"
node "$HERE/synthetic_2k.js" "$OUT/sql/dev_$BASE_TO.json" 2000 2000
node "$HERE/synthetic_2k.js" "$OUT/sql/dev_$BASE_TO.json" 2500 2500
