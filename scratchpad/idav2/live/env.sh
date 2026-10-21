# IDA V2 live-check kit - shell names for RUNBOOK.md's READ-ONLY commands (source it from the repo root):
#   export IDA_LIVE_OUT=/Users/yunawinaya/Documents/ASC-dev/idav2-live ; . scratchpad/idav2/live/env.sh
# WRITE commands are never built from these variables: `python3 $K/cmds.py ...` prints each one fully expanded (the runas allow rule
# matches only a literal `node scratchpad/gdc/tools/runas.mjs ...` command run on its own).
K=scratchpad/idav2/live
TW=scratchpad/idav2/test/twins
: "${IDA_LIVE_OUT:?set IDA_LIVE_OUT to a durable directory OUTSIDE the repo, e.g. /Users/yunawinaya/Documents/ASC-dev/idav2-live}"
case "$IDA_LIVE_OUT" in /Users/yunawinaya/Developer/*) echo "refusing: IDA_LIVE_OUT is inside the repo"; return 1 2>/dev/null || exit 1 ;; esac
F=$IDA_LIVE_OUT
S=$F/snaps
RP=$F/replay
mkdir -p "$S" "$RP"
T711=711077
T000=000000
