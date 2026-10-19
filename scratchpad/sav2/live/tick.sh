#!/bin/sh
# SA V2 live tests - kick SA_V2_WORKER for ONE job until it is terminal. EVERY TICK IS A WRITE (the worker claims, prepares,
# commits): a RUNBOOK step the controller runs after the user's yes - never run by the kit's builder.
#   sh scratchpad/sav2/live/tick.sh <job_id> <out_dir> [max_ticks=12] [default_wait_s=4]
# Per tick: one SA_V2_WORKER {job_id} run as admin@496474 (runas.mjs), then a read-only SELECT of the job row. Waits until the
# job is due again (a 409 lock wait sets next_attempt_at 15 s x 2^n ahead; PARK above 1,000 entries leaves it due at once).
# Stops at COMPLETED / FAILED / REQUIRES_REVIEW / CANCELLED. Run from the repo root; a 2k job needs ~3-5 ticks of up to ~2 min
# each: give the shell call a long timeout (or run it in the background).
set -e
JOB="$1"
DIR="$2"
MAX="${3:-12}"
WAIT="${4:-4}"
case "$JOB" in '' | *[!0-9]*) echo "usage: tick.sh <job_id digits> <out_dir> [max_ticks] [wait_s]"; exit 2 ;; esac
[ -n "$DIR" ] || { echo "usage: tick.sh <job_id> <out_dir>"; exit 2; }
case "$DIR" in "$(pwd)"/* | scratchpad/* | ./*) echo "refusing: out_dir inside the repo"; exit 2 ;; esac
[ -f scratchpad/gdc/tools/runas.mjs ] || { echo "run from the repo root"; exit 2; }
mkdir -p "$DIR"
WORKER=2111074368689180673
REQ="$DIR/worker.$JOB.json"
printf '{"job_id":"%s"}' "$JOB" > "$REQ"
row() {
  .dbtools/db --dev --json "SELECT job_status, progress_percent, progress_message, COALESCE(error_code, '') error_code, LEFT(COALESCE(error_message, ''), 300) error_message, attempt_count, GREATEST(COALESCE(TIMESTAMPDIFF(SECOND, NOW(), next_attempt_at), 0), 0) wait_s, COALESCE(lease_owner, '') lease_owner FROM gd_async_job WHERE tenant_id = '496474' AND id = $JOB" 2>/dev/null
}
i=1
while [ "$i" -le "$MAX" ]; do
  OUT="$DIR/worker.$JOB.tick$i.out.json"
  T0=$(date +%s)
  node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id496474.json $WORKER "$REQ" "$OUT" > /dev/null
  T1=$(date +%s)
  ANS=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); x=d.get('data') or {}; print('http-answer code', d.get('code'), '| worker', x.get('worker_route'), 'processed', x.get('processed'), '| job', x.get('job_status'), x.get('result_code') or '', (x.get('result_message') or d.get('msg') or '')[:200])" "$OUT" 2>/dev/null || echo "unreadable answer: $(head -c 300 "$OUT")")
  R=$(row)
  STATE=$(printf '%s' "$R" | python3 -c "import json,sys; t=sys.stdin.read(); r=json.loads(t[t.find('['):])[0]; print(r['job_status'], str(r['progress_percent']) + '%', r['error_code'], '|', r['progress_message'][:120], '| attempts', r['attempt_count'], '| due in', r['wait_s'], 's |', r['error_message'][:200])")
  echo "tick $i ($((T1 - T0)) s): $ANS"
  echo "        job $JOB: $STATE"
  case "$STATE" in COMPLETED* | FAILED* | REQUIRES_REVIEW* | CANCELLED*) echo "terminal: $STATE"; exit 0 ;; esac
  DUE=$(printf '%s' "$R" | python3 -c "import json,sys; t=sys.stdin.read(); print(json.loads(t[t.find('['):])[0]['wait_s'])")
  S=$WAIT
  if [ "$DUE" -gt "$S" ] 2>/dev/null; then S=$((DUE + 1)); fi
  [ "$S" -gt 300 ] && S=300
  sleep "$S"
  i=$((i + 1))
done
echo "job $JOB not terminal after $MAX ticks"
exit 1
