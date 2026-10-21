# IA V2 live-check kit - shell names for RUNBOOK.md's READ-ONLY commands (source it from the repo root):
#   export IA_LIVE_OUT=<your session scratchpad>/iav2-live ; . scratchpad/iav2/live/env.sh
# WRITE commands are never built from these variables: `python3 $K/cmds.py ...` prints each one fully expanded (the runas allow rule
# matches only a literal `node scratchpad/gdc/tools/runas.mjs ...` command run on its own).
K=scratchpad/iav2/live
: "${IA_LIVE_OUT:?set IA_LIVE_OUT to a directory OUTSIDE the repo (your session scratchpad), e.g. .../scratchpad/iav2-live}"
case "$IA_LIVE_OUT" in /Users/yunawinaya/Developer/*) echo "refusing: IA_LIVE_OUT is inside the repo"; return 1 2>/dev/null || exit 1 ;; esac
F=$IA_LIVE_OUT
S=$F/snaps
RP=$F/replay
mkdir -p "$S" "$RP"
T711=711077
T000=000000
