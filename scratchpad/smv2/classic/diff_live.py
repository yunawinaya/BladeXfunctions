"""Node-level diff of the built guarded classic against the LIVE dev version (read-only from su_code_workflow_history).
usage: python3 classic/diff_live.py [version]   (default: the enabled version)
Prints every node whose JSON differs and, for code nodes, the changed code lines; any non-code difference is a problem."""
import difflib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SMV2 = os.path.dirname(HERE)
sys.path.insert(0, SMV2)
sys.path.insert(0, os.path.join(SMV2, "lib"))
import build_classic as B  # noqa: E402
from dbq import q  # noqa: E402

want = sys.argv[1] if len(sys.argv) > 1 else None
where = "h.version_number = %d" % int(want) if want else "h.status = 'enabled'"
row = q("--dev", "SELECT h.version_number AS v, h.status, h.script_json AS s FROM su_code_workflow_history h WHERE h.data_id = 2013133675374927874 AND " + where
        + " ORDER BY h.id DESC LIMIT 1")[0]
live = json.loads(row["s"])
out = json.load(open(os.path.join(SMV2, "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "SM_LOCATION_TRANSFER.json"), encoding="utf-8"))
canon = lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True)
li, oi = B.index(live), B.index(out)
problems = []
for k in ("request_json", "response_json", "config", "edges"):
    if canon(live[k]) != canon(out[k]):
        problems.append("top-level %s differs" % k)
if sorted(li) != sorted(oi):
    problems.append("node ids differ: added %s removed %s" % (sorted(set(oi) - set(li)), sorted(set(li) - set(oi))))
code_changed = []
for nid in sorted(li):
    if nid not in oi:
        continue
    a, b = li[nid], oi[nid]
    if a.get("type") == "code-node":
        if a["data"]["script"]["code"] != b["data"]["script"]["code"]:
            code_changed.append(nid)
        a2 = dict(a, data=dict(a["data"], script=None))
        b2 = dict(b, data=dict(b["data"], script=None))
        if canon(a2) != canon(b2):
            problems.append(nid + ": differs outside its code")
    elif not a.get("blocks") and canon(a) != canon(b):
        problems.append(nid + ": " + a.get("type", "") + " differs")


def strip_code(n):
    if isinstance(n, dict):
        return {k: (None if k == "script" else strip_code(v)) for k, v in n.items()}
    if isinstance(n, list):
        return [strip_code(v) for v in n]
    return n


if canon(strip_code(live)) != canon(strip_code(out)):
    problems.append("the workflows differ outside code-node scripts")
print("live dev SM_LOCATION_TRANSFER v%s (%s) vs built: %d nodes each; code nodes changed: %s" % (row["v"], row["status"], len(li), ", ".join(code_changed) or "none"))
for nid in code_changed:
    print("%s:" % nid)
    for line in difflib.unified_diff(li[nid]["data"]["script"]["code"].split("\n"), oi[nid]["data"]["script"]["code"].split("\n"), "live", "built", n=0, lineterm=""):
        print("   " + line)
print("identical outside those code lines: %s" % ("YES" if not problems else "NO"))
print("PROBLEMS: %d" % len(problems) + ("" if not problems else "\n  " + "\n  ".join(problems)))
sys.exit(1 if problems else 0)
