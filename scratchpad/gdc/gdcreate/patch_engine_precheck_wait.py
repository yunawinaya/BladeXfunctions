"""patch_engine_precheck_wait.py: INVENTORY_APPLY_OPERATION - a balance key another operation holds at the lock precheck (P7)
no longer crashes the run (user 2026-10-23, prod incident LSH 128671: five GD V2 creates stuck Processing).

Before: code_node_J6YxjhQw threw INV_LOCK_TAKEN_PRECHECK. A crashed child crashes GD_BULK_COMMIT P3 and the worker, so the
job stayed under the dead worker's 30-minute lease; only then did a kick find the stale LOCKING operation, which the engine's
RECOVER route rejected as LOCK_CONFLICT and the caller retried.
After: the claim list answers busy YES (+ takenKeys) instead of throwing, and a new branch right after the BEFORE_TAKE lease
renewal (if_LKbusy00) - before any claim - sets this run's operation lease to the DB time just read (expired) and returns
OPERATION_IN_PROGRESS (contract: caller_may_retry SAME_OPERATION_LATER). GD_BULK_COMMIT maps it to WAIT (job released, due
in seconds); its next call finds the LOCKING operation stale and calls again, and the existing RECOVER route rejects it
(REJECTED / LOCK_CONFLICT, gate protocol unchanged) - the caller then retries with a new operation id, as before, without the
30-minute lease. PACKING_BULK_COMMIT maps OPERATION_IN_PROGRESS to WAIT too. Nothing else changes: no lock is claimed on
this path, and the lease is expired only when the BEFORE_TAKE renewal found it this run's.
Not covered (rarer): a key taken between the precheck and the TAKE still fails at the lock verify (P12, INV_LOCK_VERIFY).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_engine_precheck_wait.py [--write]
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


def sub(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert "if_LKbusy00" not in raw, "already patched"
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610234)
nums = set(int(x) for x in re.findall(r'"(?:id|parentId)": (\d{9,})', raw))
fresh_nums = (n for n in range(2113600000001, 2113600009999) if n not in nums)


def titled(node, title):
    for k in ("title", "nodeName", "name"):
        node["data"][k] = title


def renumber(filt):
    for leaf in filt["list"]:
        leaf["id"], leaf["parentId"] = next(fresh_nums), next(fresh_nums)


def field(name, bson="string"):
    return {"key": K.key(), "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


# 1. the claim list: busy instead of a throw
claim = find(doc, "code_node_J6YxjhQw")
c = claim["data"]["script"]["code"]
c = sub(c, "// INVENTORY_APPLY_OPERATION - claim list (lock-protocol P7): sorted keys; a visibly taken key fails the run before the first claim",
        "// INVENTORY_APPLY_OPERATION - claim list (lock-protocol P7): sorted keys; a visibly taken key answers busy before the first claim (if_LKbusy00 returns OPERATION_IN_PROGRESS, never a crash)",
        "claim header")
c = sub(c, '  if (precheck && taken.length) throw new Error("INV_LOCK_TAKEN_PRECHECK: " + taken.join(","));\n', "", "precheck throw")
c = sub(c, "    claimedAt: dbNow,\n  };", '    claimedAt: dbNow,\n    busy: precheck && taken.length ? "YES" : "NO",\n    takenKeys: taken.join(","),\n  };', "claim result")
c = sub(c, 'console.log("claim list", JSON.stringify({ count: res.count, precheck: precheck }));',
        'console.log("claim list", JSON.stringify({ count: res.count, precheck: precheck, busy: res.busy, taken: res.takenKeys.slice(0, 300) }));', "claim log")
claim["data"]["script"]["code"] = c
names = [r["name"] for r in claim["data"]["response_json"]]
assert names == ["items", "ids", "count", "firstId", "idListSql", "claimedAt"], names
claim["data"]["response_json"] += [field("busy"), field("takenKeys")]

# 2. the busy branch, cloned from the engine's own nodes
BUSY = r"""// INVENTORY_APPLY_OPERATION - a balance key another operation holds at the precheck (P7): no crash (a thrown run strands the
// caller's job under its lease). Nothing is claimed; this run's lease is set to the DB time just read, so the caller's next
// call finds the LOCKING operation stale and the RECOVER route rejects it (LOCK_CONFLICT); the answer now is OPERATION_IN_PROGRESS.
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const lease = [{{node:code_node_AbCxKTsM.data.leaseRows}}][0];
const ours = (Array.isArray(lease) ? lease : lease ? [lease] : []).filter((r) => r && s(r.id));
const dbNow = s([{{node:code_node_AbCxKTsM.data.dbNow}}][0]);
const taken = s([{{node:code_node_J6YxjhQw.data.takenKeys}}][0]).split(",").filter((k) => k);
const expire = ours.length > 0 && dbNow !== "";
const evidence = { v: 2, workflow: "INVENTORY_APPLY_OPERATION", path: "LOCK_TAKEN_PRECHECK", steps: { claim: { taken: taken.slice(0, 50), taken_count: taken.length, lease_expired: expire ? "YES" : "NO" } } };
console.log("lock taken at the precheck", JSON.stringify({ taken: taken.slice(0, 20), expire: expire }));
return {
  expire: expire ? "YES" : "NO",
  expireRows: expire ? [{ id: s(ours[0].id), lease_expires_at: dbNow }] : [],
  operation_id: s([{{node:code_node_cW0Exw93.data.operationId}}][0]),
  operation_status: "REJECTED",
  result_code: "OPERATION_IN_PROGRESS",
  result_message: "A balance key is held by another operation (" + taken.slice(0, 5).join(", ") + (taken.length > 5 ? ", ..." : "") + "): nothing claimed; call again later",
  effect_summary: JSON.stringify({ effect_count: 0, lock_count: 0, by_status: {}, effects: [] }),
  review_reference: "",
  evidence: JSON.stringify(evidence),
};"""

code = copy.deepcopy(find(doc, "code_node_AbCxKTsM"))
code["id"] = "code_node_LKbusy00"
titled(code, "Lock taken at the precheck (P7): expire this run's lease, answer OPERATION_IN_PROGRESS")
code["data"]["script"]["code"] = BUSY
lease_rj = copy.deepcopy([r for r in code["data"]["response_json"] if r["name"] == "leaseRows"][0])
lease_rj.update({"key": K.key(), "name": "expireRows", "title": "expireRows"})
for ch in lease_rj["children"]:
    ch["key"] = K.key()
code["data"]["response_json"] = [field("expire"), lease_rj] + [field(n) for n in ("operation_id", "operation_status", "result_code", "result_message", "effect_summary", "review_reference", "evidence")]

cor = copy.deepcopy(find(doc, "condition_or_node_UCoVWAiR"))
cor["id"] = "condition_or_node_LKexp00"
cor["data"]["title"] = "Expire this run's lease (lock taken at the precheck)?"
yes, no = cor["blocks"]
assert yes["data"]["title"] == "YES" and no["data"]["title"] == "NO" and [b["id"] for b in yes["blocks"]] == ["update_node_dQRVPsCY"] and no["blocks"] == []
yes["id"], no["id"] = "condition_or_node_item_LKexpY0", "condition_or_node_item_LKexpN0"
leaf = yes["data"]["filter"]["list"][0]
assert leaf["prop"] == "node.code_node_AbCxKTsM.data.renew"
leaf.update({"prop": "node.code_node_LKbusy00.data.expire", "propLabel": "expire"})
renumber(yes["data"]["filter"])
upd = yes["blocks"][0]
upd["id"] = "update_node_LKexp00"
titled(upd, "Operation lease expired (lock taken at the precheck): lease_expires_at by id, nothing else")
r = upd["data"]["table_id"]["rules"]["list"][0]
assert r["value"] == "{{node:code_node_AbCxKTsM.data.leaseRows.id}}"
r["value"] = "{{node:code_node_LKbusy00.data.expireRows.id}}"
renumber(upd["data"]["table_id"]["rules"])
props = upd["data"]["props"]["list"]
assert [p["prop"] for p in props] == ["id", "lease_expires_at"]
props[0]["value"] = "{{node:code_node_LKbusy00.data.expireRows.id}}"
props[1]["value"] = "{{node:code_node_LKbusy00.data.expireRows.lease_expires_at}}"

ret = copy.deepcopy(find(doc, "return_node_Yx4PaBeI"))
ret["id"] = "return_node_LKbusy00"
titled(ret, "Return OPERATION_IN_PROGRESS (lock taken at the precheck)")
for item in ret["data"]["response_value"]["list"]:
    assert item["value"] == "{{node:code_node_U7Mn9SIm.data.%s}}" % item["prop"], item
    item["value"] = "{{node:code_node_LKbusy00.data.%s}}" % item["prop"]

iff = copy.deepcopy(find(doc, "if_4EcUNagb"))
iff["id"] = "if_LKbusy00"
titled(iff, "IF a balance key is taken at the precheck (P7)")
iff["data"]["expression"]["code"] = "'{{node:code_node_J6YxjhQw.data.busy}}' == 'YES'"
renumber(iff["data"]["filter"])
tb, fb = iff["blocks"]
assert tb["data"]["title"] == "true" and fb["data"]["title"] == "false" and fb["blocks"] == []
tb["id"], fb["id"] = "ifBlock_TLKbusy00", "ifBlock_FLKbusy00"
tb["blocks"] = [code, cor, ret]

top = doc["nodes"]
ids = [n["id"] for n in top]
at = ids.index("condition_or_node_UCoVWAiR")
assert ids[at - 3:at + 2] == ["code_node_J6YxjhQw", "sql_node_Otky4Lzb", "code_node_AbCxKTsM", "condition_or_node_UCoVWAiR", "code_node_LNtake"], ids[at - 3:at + 2]
top.insert(at + 1, iff)

out = render(doc)
d2 = json.loads(out)
all_ids = re.findall(r'"id": "([A-Za-z0-9_\-]+)"', out)
assert len(all_ids) == len(set(all_ids)), "duplicate node ids"
order = [n["id"] for n in d2["nodes"]]
print("INVENTORY_APPLY_OPERATION + precheck busy branch: %d chars (was %d); order %s" % (len(out), len(raw), order[at - 1:at + 3]))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
