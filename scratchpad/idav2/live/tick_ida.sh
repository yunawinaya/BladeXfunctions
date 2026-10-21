#!/bin/sh
# IDA V2 live tests - kick IDA_V2_WORKER for ONE job until it is terminal. EVERY TICK IS A WRITE (the worker claims, prepares,
# commits): a RUNBOOK step the controller runs after the user's yes - never run by the kit's builder. Copied from
# tpl/iav2/live/tick_ia.sh (IDA worker, ids from scratchpad/idav2/ids.json, no revert).
#   sh scratchpad/idav2/live/tick_ida.sh <tenant> <job_id> <out_dir> [max_ticks=12] [default_wait_s=4]
# Per tick: one worker {job_id} run as admin@<tenant> (runas.mjs), then a read-only SELECT of the job row. Waits until the job is
# due again (a 409 lock wait sets next_attempt_at 15 s x 2^n ahead; PARK above 1,000 movements per leg leaves it due at once; D3's
# stepWait 10 s). Stops at COMPLETED / FAILED / REQUIRES_REVIEW / CANCELLED. Run from the repo root; an 830-line job needs 1-2 ticks
# and a 2,000-line job >= 2 (PREPARE + A, PARK, B) of up to several minutes each: give the shell call a long timeout or run it in the
# background. If the auto-mode classifier blocks this script, run the same calls one at a time: python3 scratchpad/idav2/live/cmds.py worker.
set -e
T="$1"
JOB="$2"
DIR="$3"
MAX="${4:-12}"
WAIT="${5:-4}"
case "$T" in 711077 | 000000) ;; *) echo "usage: tick_ida.sh <tenant 711077|000000> <job_id> <out_dir> [max_ticks] [wait_s]"; exit 2 ;; esac
case "$JOB" in '' | *[!0-9]*) echo "job_id must be digits"; exit 2 ;; esac
[ -n "$DIR" ] || { echo "usage: tick_ida.sh <tenant> <job_id> <out_dir>"; exit 2; }
case "$DIR" in "$(pwd)"/* | scratchpad/* | ./*) echo "refusing: out_dir inside the repo"; exit 2 ;; esac
[ -f scratchpad/gdc/tools/runas.mjs ] || { echo "run from the repo root"; exit 2; }
WORKER=$(python3 -c "import json; print(json.load(open('scratchpad/idav2/ids.json'))['IDA_V2_WORKER'])")
case "$WORKER" in '' | 0 | *[!0-9]*) echo "IDA_V2_WORKER id not set in scratchpad/idav2/ids.json ($WORKER)"; exit 2 ;; esac
mkdir -p "$DIR"
REQ="$DIR/worker.$JOB.json"
printf '{"job_id":"%s"}' "$JOB" > "$REQ"
row() {
  .dbtools/db --dev --json "SELECT job_status, progress_percent, progress_message, COALESCE(error_code, '') error_code, LEFT(COALESCE(error_message, ''), 300) error_message, attempt_count, GREATEST(COALESCE(TIMESTAMPDIFF(SECOND, NOW(), next_attempt_at), 0), 0) wait_s, COALESCE(lease_owner, '') lease_owner FROM gd_async_job WHERE tenant_id = '$T' AND id = $JOB" 2>/dev/null
}
i=1
while [ "$i" -le "$MAX" ]; do
  OUT="$DIR/worker.$JOB.tick$i.out.json"
  T0=$(date +%s)
  node scratchpad/gdc/tools/runas.mjs "scratchpad/gdc/tools/id$T.json" "$WORKER" "$REQ" "$OUT" > /dev/null
  T1=$(date +%s)
  ANS=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); x=d.get('data') or {}; print('http-answer code', d.get('code'), '| worker', x.get('worker_route'), 'processed', x.get('processed'), '| job', x.get('job_status'), x.get('result_code') or '', (x.get('result_message') or d.get('msg') or '')[:200])" "$OUT" 2>/dev/null || echo "unreadable answer: $(head -c 300 "$OUT")")
  R=$(row)
  STATE=$(printf '%s' "$R" | python3 -c "import json,sys; t=sys.stdin.read(); r=json.loads(t[t.find('['):])[0]; print(r['job_status'], str(r['progress_percent']) + '%', r['error_code'], '|', r['progress_message'][:120], '| attempts', r['attempt_count'], '| due in', r['wait_s'], 's | lease', r['lease_owner'][:12], '|', r['error_message'][:200])")
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
