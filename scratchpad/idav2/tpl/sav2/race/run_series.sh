#!/bin/bash
# SA V2 cost-row race (CONTRACT §15): one scenario, runs <first>..<last>, each = read-only snapshot -> fire A + B -> read-only
# reconcile (+ the timeline for R0). DRY by default: fire.mjs only prints / saves the requests and nothing else runs.
#   usage: run_series.sh <R0|R1|R2|R3> <first> <last> [--batch] [--live] [--config race/config.json]
#   e.g.   run_series.sh R1 1 10            (dry)        run_series.sh R1 1 10 --live   (WRITES on dev, after the user's yes)
# --live writes per run what fire.mjs prints (two INVENTORY_BULK_APPLY APPLY calls: movements, balance / cost rows, IBA step
# rows, lock rows). Prerequisites: race/config.json filled + seed_plan.py --check passing (seed steps 1-2 done).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
SC=${1:?usage: run_series.sh <R0|R1|R2|R3> <first> <last> [--batch] [--live]}
FIRST=${2:?first run number}
LAST=${3:?last run number}
shift 3
LIVE=""
BATCH=""
CFG="$HERE/config.json"
while [ $# -gt 0 ]; do
  case "$1" in
    --live) LIVE=--live ;;
    --batch) BATCH=--batch ;;
    --config) CFG=$2; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -f "$CFG" ] || CFG="$HERE/config.example.json"
OUT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['out_dir'])" "$CFG")
mkdir -p "$OUT"
cd "$REPO"
for i in $(seq "$FIRST" "$LAST"); do
  RUN=$(printf '%s-%02d%s' "$SC" "$i" "${BATCH:+b}")
  if [ -z "$LIVE" ]; then
    node "$HERE/fire.mjs" --config "$CFG" --scenario "$SC" --run "$RUN" $BATCH | head -6
    continue
  fi
  python3 "$HERE/reconcile.py" snapshot --config "$CFG" --out "$OUT/$RUN.before.json"
  node "$HERE/fire.mjs" --config "$CFG" --scenario "$SC" --run "$RUN" $BATCH --live
  python3 "$HERE/reconcile.py" check --config "$CFG" --run "$RUN" --before "$OUT/$RUN.before.json" > "$OUT/$RUN.verdict.txt" 2>&1 || true
  python3 "$HERE/reconcile.py" timeline --config "$CFG" --run "$RUN" >> "$OUT/$RUN.verdict.txt" 2>&1 || true
  grep -E "^(VERDICT|INTERLEAVING|run )" "$OUT/$RUN.verdict.txt" | sed "s/^/$RUN  /"
  sleep 3
done
[ -n "$LIVE" ] && grep -h "^VERDICT" "$OUT"/"$SC"-*.verdict.txt 2>/dev/null | sort | uniq -c || true
