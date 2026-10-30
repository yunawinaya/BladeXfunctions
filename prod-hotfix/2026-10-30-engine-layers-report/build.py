"""build.py: the PROD paste of INVENTORY_BULK_APPLY v14 (report_layers, A1). Seed = prod's enabled v13 as deployed
(INVENTORY_BULK_APPLY.prod_v13.base.json, read 10-30); only code_node_IBplan's code is replaced, by dev v14's (= repo
Balance Table/INVENTORY_BULK_APPLY.json). Refuses if prod's plan code is not the v13 we pasted.
usage: python3 build.py"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", ".."))
BASE = os.path.join(HERE, "INVENTORY_BULK_APPLY.prod_v13.base.json")
OUT = os.path.join(HERE, "INVENTORY_BULK_APPLY.prod_paste.json")


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


code = lambda doc: nodes(doc, {})["code_node_IBplan"]["data"]["script"]["code"].rstrip("\n")
prod = json.load(open(BASE, encoding="utf-8"))
v13 = json.load(open(os.path.join(R, "scratchpad/gdc/iba/base/INVENTORY_BULK_APPLY.live_v13.json"), encoding="utf-8"))
v14 = json.load(open(os.path.join(R, "Balance Table/INVENTORY_BULK_APPLY.json"), encoding="utf-8"))
assert code(prod) == code(v13), "prod's plan code is not the v13 we pasted: rebuild from what is deployed"
assert "fifo_layers" in code(v14) and code(v14) != code(v13)

paste = json.loads(json.dumps(prod))
n = nodes(paste, {})["code_node_IBplan"]
old = n["data"]["script"]["code"]
n["data"]["script"]["code"] = code(v14) + ("\n" if old.endswith("\n") else "")
a, b = nodes(prod, {}), nodes(paste, {})
changed = sorted(k for k in a if json.dumps(a[k], sort_keys=True) != json.dumps(b[k], sort_keys=True))
assert changed == ["code_node_IBplan"], changed
open(OUT, "w", encoding="utf-8").write(json.dumps(paste, ensure_ascii=False, indent=1) + "\n")
print("INVENTORY_BULK_APPLY.prod_paste.json: prod v13 + code_node_IBplan from dev v14 (%+d chars of code); nothing else changed"
      % (len(code(v14)) - len(code(prod))))
