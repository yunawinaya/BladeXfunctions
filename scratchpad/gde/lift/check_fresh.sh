#!/bin/zsh
# The lifted snapshot is valid only while dev still runs each pinned version of lift/nodes.json.
cd /Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gde || exit 1
python3 - <<'PY'
import json, sys
sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q
bad = 0
for s in json.load(open("lift/nodes.json"))["sources"]:
    v = q("--dev", "SELECT MAX(version_number) v FROM su_code_workflow_history WHERE data_id = %s AND status = 'enabled'" % s["workflow_id"])[0]["v"]
    ok = int(v) == s["version"]
    bad += not ok
    print("%-18s pinned v%-4d dev enabled v%-4s %s" % (s["name"], s["version"], v, "OK" if ok else "STALE: re-pin, re-lift, re-run parity"))
print("check_fresh: " + ("all pinned versions are live" if not bad else "%d stale" % bad))
sys.exit(1 if bad else 0)
PY
