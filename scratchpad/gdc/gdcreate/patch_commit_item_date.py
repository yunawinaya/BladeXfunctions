"""patch_commit_item_date.py: GD_BULK_COMMIT - Item last_transaction_date for the delivery's materials (parity audit M1,
user 2026-10-23). Classic GOODS_DELIVERY writes it on every save (code_node_62FzZA2e -> update_node_6J0zCjxf); GD Created V2
never did. Only its presence is read (the Item delete guard, the Item form lock), so an item used only through V2 Created
deliveries could still be deleted.

Structure: at the end of P7E_REORDER's YES branch (this run committed the job, P7E not recorded yet, after P7E DONE), the plan
(the P7E plan's stock rows, bundle items included) and up to 12 parallel update lanes on Item. A crash here never touches the
committed delivery and P7E's marker keeps it from repeating. Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_commit_item_date.py [--write]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
P = R + "Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
ITEM = "Item:Table:1901546842240438273"
LANES = 12
PLAN = "code_node_P7Fitem0"


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def collect(o, keys, ints):
    if isinstance(o, dict):
        if isinstance(o.get("key"), str):
            keys.add(o["key"])
        for k in ("id", "parentId"):
            if isinstance(o.get(k), int):
                ints.add(o[k])
        for v in o.values():
            collect(v, keys, ints)
    elif isinstance(o, list):
        for v in o:
            collect(v, keys, ints)


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r
    return None


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert '"%s"' % PLAN not in raw, PLAN + " already present"
keys, ints = set(), set()
collect(doc, keys, ints)
K._taken |= keys
K._rng.seed(202610231)

yes = find(doc, "condition_or_node_item_P7Ecyes")
assert yes and yes["type"] == "condition-or-node-item", "P7E YES branch"
assert [b["id"] for b in yes["blocks"]] == ["add_node_P7Estrt0", "workflow_node_P7Ereor0", "sql_node_P7Eback0", "code_node_P7Echk00",
                                            "condition_or_node_P7Edone"], "not the v18 P7E branch"
ids = K.Ids(max(ints) + 1000)
body = open(os.path.join(HERE, "code", "p7f_item_dates.js"), encoding="utf-8").read().rstrip("\n")
lane_names = ["lane%d" % k for k in range(LANES)]
plan = K.code(PLAN, "P7F item dates: Item last_transaction_date for every material of the delivery (classic code_node_62FzZA2e)", body,
              ["count"] + lane_names + ["has%d" % k for k in range(LANES)], arrays=tuple(lane_names))
lanes = K.parallel("cond_all_P7Fitem", "P7F WRITE: Item last_transaction_date in %d parallel lanes" % LANES, [
    ("cai_P7Fitem%d" % k, "Lane %d" % k, [K.when_yes(ids, "cor_P7Fitem%d" % k, "Lane %d has items?" % k, "node.%s.data.has%d" % (PLAN, k), "has%d" % k, [
        K.update(ids, "update_node_P7Fitem%d" % k, "P7F WRITE: Item last_transaction_date (lane %d)" % k, ITEM, ("id", "in", "{{node:%s.data.lane%d.id}}" % (PLAN, k)),
                 [("id", "{{node:%s.data.lane%d.id}}" % (PLAN, k)), ("last_transaction_date", "{{node:%s.data.lane%d.last_transaction_date}}" % (PLAN, k))])])])
    for k in range(LANES)])
yes["blocks"].extend([plan, lanes])

new_keys, new_ints = set(), set()
collect({"n": [plan, lanes]}, new_keys, new_ints)
assert not (new_keys & keys), "a generated key collides"
assert not (new_ints & ints), "a generated filter id collides"
K.check_ids(doc)
out = render(doc)
json.loads(out)
print("GD_BULK_COMMIT + P7F item dates: %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
