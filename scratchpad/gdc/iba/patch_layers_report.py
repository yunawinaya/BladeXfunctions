"""patch_layers_report.py [--write]: INVENTORY_BULK_APPLY (Balance Table/INVENTORY_BULK_APPLY.json, dev / prod v13) answers, for a
SUBTRACT movement sent with report_layers true, the FIFO layers it drew (A1, asked by the consignment / subcontract PO developer;
user's yes 10-30). Opt-in per movement: callers that do not send it get the v13 answer unchanged.
- core.js: results[i].fifo_layers = [{id, sequence, quantity, cost}], oldest first; id null = a layer made earlier in the same
  operation (its sequence names it); stock no layer covers is a last {id null, sequence null, ..., uncovered: true} entry at the
  price the issue gave it. Only a FIFO issue that draws layers (isMovingInv 0) has one.
- The answer travels as results already do: the stored intent (RESUME), IBA|DONE (REPLAY) and the end node.
Only code_node_IBplan changes (plan.js includes engine/core.js); the base is saved as base/INVENTORY_BULK_APPLY.live_v13.json."""
import json
import os
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
F = R + "Balance Table/INVENTORY_BULK_APPLY.json"
BASE = R + "scratchpad/gdc/iba/base/INVENTORY_BULK_APPLY.live_v13.json"
CODE = R + "scratchpad/gdc/iba/code/"
sys.path.insert(0, R + "scratchpad/gdc")
from build_ts import body  # noqa: E402

raw = open(F, encoding="utf-8").read()
doc = json.loads(raw)
dump = lambda d: json.dumps(d, ensure_ascii=False, indent=1) + ("\n" if raw.endswith("\n") else "")
assert dump(doc) == raw, "the repo file does not round-trip"


def nodes(o, acc):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str) and o.get("type") and isinstance(o.get("data"), dict):
            acc[o["id"]] = o
        for v in o.values():
            nodes(v, acc)
    elif isinstance(o, list):
        for v in o:
            nodes(v, acc)
    return acc


before = json.loads(raw)
n = nodes(doc, {})["code_node_IBplan"]
old = n["data"]["script"]["code"]
new = body(CODE + "plan.js")
new = new if old.endswith("\n") else new.rstrip("\n")
assert new != old, "plan.js already deployed"
assert "fifo_layers" in new and "fifo_layers" not in old
n["data"]["script"]["code"] = new

# every other node exactly as in v13, and the other code bodies equal their files (no drift carried along)
a, b = nodes(before, {}), nodes(doc, {})
changed = sorted(k for k in a if json.dumps(a[k], sort_keys=True) != json.dumps(b[k], sort_keys=True))
assert changed == ["code_node_IBplan"], changed
for nid, f in [("code_node_IBguard", "guard.js"), ("code_node_IBstate", "state.js"), ("code_node_IBverify", "verify.js"),
               ("code_node_IBlkplan", "lock_plan.js"), ("code_node_IBdone", "done_row.js"), ("code_node_IBend", "end.js")]:
    if nid in b:
        code = b[nid]["data"]["script"]["code"]
        assert code.rstrip("\n") == body(CODE + f).rstrip("\n"), nid + " differs from " + f

out = dump(doc)
print("INVENTORY_BULK_APPLY: code_node_IBplan +%d chars (report_layers); every other node unchanged" % (len(out) - len(raw)))
if "--write" in sys.argv:
    if not os.path.exists(BASE):
        open(BASE, "w", encoding="utf-8").write(raw)
        print("base saved:", BASE)
    open(F, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
