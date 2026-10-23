"""patch_consumer_no_push.py: GD_PICKING_OUTBOX_CONSUMER - no picker pushes when it updates an existing Picking (parity
audit D1, user 2026-10-23: match classic). Classic GOODS_DELIVERY builds "New Picking Assignment" / "Picking Assignment
Cancelled" but its two loops are gated on saveAs == "Removed", which no save sends. The consumer already skips them on a
CREATE (notify_on_create false); this adds notify_on_update false for the UPDATE path. No NOTIFY rows are planned, so
nothing is dispatched. Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_consumer_no_push.py [--write]
"""
import json
import os
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
P = R + "Goods Delivery/AsyncV2/GD_PICKING_OUTBOX_CONSUMER.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
NODE = "code_node_dQwH6dcp"


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


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
node = find(doc, NODE)
code = node["data"]["script"]["code"]
assert "notify_on_update" not in code, "already patched"
SUBS = [
    ('"notify_on_create":false,', '"notify_on_create":false,"notify_on_update":false,'),
    ('recipients = gpcRecipients("UPDATE", assigned, P.assigned_to, P.assigned_to !== undefined && P.assigned_to !== null && P.assigned_to !== "");',
     'recipients = GPC.notify_on_update ? gpcRecipients("UPDATE", assigned, P.assigned_to, P.assigned_to !== undefined && P.assigned_to !== null && P.assigned_to !== "") : { added: [], removed: [] };'),
]
for old, new in SUBS:
    assert code.count(old) == 1, "%d matches for %r" % (code.count(old), old[:70])
    code = code.replace(old, new)
assert "GPC.notify_on_create" in code, "GPC is the config the create path reads"
node["data"]["script"]["code"] = code
out = render(doc)
json.loads(out)
print("GD_PICKING_OUTBOX_CONSUMER: no pushes on UPDATE, %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
