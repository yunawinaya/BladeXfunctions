"""patch_engine_recover_release.py: INVENTORY_APPLY_OPERATION - the RECOVER route leaves its REJECTED operation's lease expired
(user 2026-10-23, after the LSH lock incident: the retry waited ~10 minutes).

GD_ASYNC_WORKER's poll treats a COMMITTING_GD job as not due while any inventory operation of the job holds a live lease,
REJECTED included, and the RECOVER route takes a fresh 10-minute lease before it rejects a stale operation. So after a
LOCK_CONFLICT / STALE_BEFORE_MUTATION rejection (the only codes the caller retries with a new operation id) the job waited out
that lease. Now, as the route's last write before its return, the operation's lease is set to the DB time read before the
release - only when the lease is this run's (code_node_ojWiBEFP), the read-back shows the operation REJECTED and the release
check (P21) finds no lock it still owns. Nothing else changes; a terminal REJECTED operation is never resumed (the caller's
next attempt has a new operation id). Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_engine_recover_release.py [--write]
"""
import copy
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/INVENTORY_APPLY_OPERATION.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")


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
assert "if_LKbusy00" in raw, "patch_engine_precheck_wait.py first"
assert "code_node_LKrel00" not in raw, "already patched"
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610235)
nums = set(int(x) for x in re.findall(r'"(?:id|parentId)": (\d{9,})', raw))
fresh_nums = (n for n in range(2113700000001, 2113700009999) if n not in nums)


def titled(node, title):
    for k in ("title", "nodeName", "name"):
        node["data"][k] = title


def renumber(filt):
    for leaf in filt["list"]:
        leaf["id"], leaf["parentId"] = next(fresh_nums), next(fresh_nums)


def field(name, bson="string"):
    return {"key": K.key(), "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


REL = r"""// INVENTORY_APPLY_OPERATION - RECOVER done: the operation is REJECTED and owns no lock, so its lease is set to the DB time read
// before the release - the caller's worker waits while any operation of the job holds a live lease, and retries with a new one
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r && typeof r === "object");
const ours = list([{{node:code_node_ojWiBEFP.data.leaseRows}}][0]).filter((r) => s(r.id));
const dbNow = s([{{node:code_node_ojWiBEFP.data.dbNow}}][0]);
const op = list([{{node:sql_node_pIDMqTob.data}}][0]).find((r) => s(r.kind) === "OP") || {};
const owned = list([{{node:sql_node_Wy0KIuXT.data}}][0]).filter((r) => s(r.id));
const expire = ours.length > 0 && dbNow !== "" && s(op.k) === "REJECTED" && owned.length === 0;
console.log("recovered lease", JSON.stringify({ expire: expire, status: s(op.k), owned: owned.length, ours: ours.length }));
return { expire: expire ? "YES" : "NO", expireRows: expire ? [{ id: s(ours[0].id), lease_expires_at: dbNow }] : [] };"""

busy = find(doc, "code_node_LKbusy00")
code = copy.deepcopy(busy)
code["id"] = "code_node_LKrel00"
titled(code, "RECOVER done: REJECTED, no lock owned -> expire this run's lease (the caller retries now)")
code["data"]["script"]["code"] = REL
exp_rj = copy.deepcopy([r for r in busy["data"]["response_json"] if r["name"] == "expireRows"][0])
exp_rj["key"] = K.key()
for ch in exp_rj["children"]:
    ch["key"] = K.key()
code["data"]["response_json"] = [field("expire"), exp_rj]

cor = copy.deepcopy(find(doc, "condition_or_node_LKexp00"))
cor["id"] = "condition_or_node_LKrel00"
cor["data"]["title"] = "Expire the recovered operation's lease?"
yes, no = cor["blocks"]
yes["id"], no["id"] = "condition_or_node_item_LKrelY0", "condition_or_node_item_LKrelN0"
leaf = yes["data"]["filter"]["list"][0]
assert leaf["prop"] == "node.code_node_LKbusy00.data.expire"
leaf["prop"] = "node.code_node_LKrel00.data.expire"
renumber(yes["data"]["filter"])
upd = yes["blocks"][0]
assert upd["id"] == "update_node_LKexp00"
upd["id"] = "update_node_LKrel00"
titled(upd, "Recovered operation lease expired: lease_expires_at by id, nothing else")
r = upd["data"]["table_id"]["rules"]["list"][0]
r["value"] = "{{node:code_node_LKrel00.data.expireRows.id}}"
renumber(upd["data"]["table_id"]["rules"])
props = upd["data"]["props"]["list"]
props[0]["value"] = "{{node:code_node_LKrel00.data.expireRows.id}}"
props[1]["value"] = "{{node:code_node_LKrel00.data.expireRows.lease_expires_at}}"

blk = find(doc, "ifBlock_CkZq9z21")
ids = [b["id"] for b in blk["blocks"]]
assert ids[-4:] == ["sql_node_Wy0KIuXT", "sql_node_pIDMqTob", "code_node_t8dYHnZj", "return_node_DjF3eZka"], ids[-4:]
blk["blocks"][-1:-1] = [code, cor]

out = render(doc)
json.loads(out)
all_ids = re.findall(r'"id": "([A-Za-z0-9_\-]+)"', out)
assert len(all_ids) == len(set(all_ids)), "duplicate node ids"
print("INVENTORY_APPLY_OPERATION + recovered lease expiry: %d chars (was %d); recovery tail %s" % (len(out), len(raw), [b["id"] for b in blk["blocks"]][-4:]))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
