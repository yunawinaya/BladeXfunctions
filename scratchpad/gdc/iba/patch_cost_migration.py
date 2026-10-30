"""patch_cost_migration.py [--write]: INVENTORY_BULK_APPLY (Balance Table/INVENTORY_BULK_APPLY.json, dev / prod v12) migrates the
costing rows of the other method the way classic SUBTRACT_INVENTORY_NEW does, instead of refusing UNSUPPORTED_COSTING (user's
choice A, 10-30: GD Completed / Cancel V2, Picking V2 moves and IA Transfer Request refused such items; Kenhin hit it twice).
- core.js (opt-in migrateCosting): a WA item with FIFO rows gets one WA row (or its newest WA row takes them), a FIFO item with WA
  rows gets the newest WA row as its next layer; the other rows are retired (is_deleted 1); the movement is then priced and
  deducted from the migrated rows; Fixed Cost leaves them (classic does). Stored at the tenant's number rule.
- Only under the pair's COST lock: an unpriced category move takes no COST lock, so sql_node_IBprobe (APPLY, only when the
  request has such moves) finds the (material, plant) pairs whose rows need migrating and code_node_IBlkplan adds their COST keys
  to the guard's keys (one ordered take, as before). Every release reads the guard's releaseKeys (+ every probed pair's COST key).
- plan.js: PLAN migrates in memory; a retired row is written by its own loops (is_deleted 1, as classic's "Delete FIFO") and,
  on resume and in the read-back (verify.js), counts as done once it has left the is_deleted = 0 reads.
The code nodes take their bodies from scratchpad/gdc/iba/code/*.js (+ engine/core.js). Exact edits; every anchor must match once."""
import copy
import json
import random
import string
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
F = R + "Balance Table/INVENTORY_BULK_APPLY.json"
CODE = R + "scratchpad/gdc/iba/code/"
sys.path.insert(0, R + "scratchpad/gdc")
from build_ts import body  # noqa: E402

T = "{{node:code_node_IBguard.data.tenantId}}"
ORG = "{{node:code_node_IBguard.data.organizationId}}"
PAIRS = "{{node:code_node_IBguard.data.probePairsJson}}"
JT = "JSON_TABLE('" + PAIRS + "', '$[*]' COLUMNS (m BIGINT PATH '$[0]', p BIGINT PATH '$[1]')) jt"
PROBE_SQL = "\n".join([
    "SELECT CAST(k.material_id AS CHAR) AS m, CAST(k.plant_id AS CHAR) AS p",
    "  FROM (SELECT u.material_id, u.plant_id, SUM(u.src = 'F') AS f, SUM(u.src = 'W') AS w",
    "          FROM (SELECT f.material_id, CAST(f.plant_id AS CHAR) AS plant_id, f.organization_id, COALESCE(f.batch_id, 0) AS batch_id, 'F' AS src",
    "                  FROM fifo_costing_history f",
    "                 WHERE f.tenant_id = '" + T + "'",
    "                   AND f.organization_id = '" + ORG + "'",
    "                   AND f.is_deleted = 0",
    "                   AND (f.material_id, f.plant_id) IN (SELECT jt.m, jt.p FROM " + JT + ")",
    "                UNION ALL",
    "                SELECT w.material_id, CAST(w.plant_id AS CHAR), w.organization_id, COALESCE(w.batch_id, 0), 'W'",
    "                  FROM wa_costing_method w",
    "                 WHERE w.tenant_id = '" + T + "'",
    "                   AND w.organization_id = '" + ORG + "'",
    "                   AND w.is_deleted = 0",
    "                   AND (w.material_id, w.plant_id) IN (SELECT jt.m, jt.p FROM " + JT + ")) u",
    "         GROUP BY u.material_id, u.plant_id, u.organization_id, u.batch_id) k",
    "  JOIN item i",
    "    ON i.id = k.material_id",
    "   AND i.tenant_id = '" + T + "'",
    "   AND i.is_deleted = 0",
    " WHERE (i.material_costing_method = 'Weighted Average' AND k.f > 0)",
    "    OR (i.material_costing_method = 'First In First Out' AND k.w > 0)",
    " GROUP BY k.material_id, k.plant_id",
])


def dump(doc):
    return json.dumps(doc, ensure_ascii=False, indent=1)


def walk(o, fn):
    if isinstance(o, dict):
        fn(o)
        for v in o.values():
            walk(v, fn)
    elif isinstance(o, list):
        for v in o:
            walk(v, fn)


def find(doc, nid):
    hit = []
    walk(doc, lambda o: hit.append(o) if o.get("id") == nid else None)
    assert len(hit) == 1, (nid, len(hit))
    return hit[0]


def parent_list(doc, nid):
    hit = []

    def fn(o):
        for v in o.values():
            if isinstance(v, list) and any(isinstance(x, dict) and x.get("id") == nid for x in v):
                hit.append(v)
    walk(doc, fn)
    assert len(hit) == 1, (nid, len(hit))
    return hit[0]


raw = open(F, encoding="utf-8").read()
doc = json.loads(raw)
assert dump(doc) + ("\n" if raw.endswith("\n") else "") == raw, "the repo file does not round-trip"
keys_used = set()
walk(doc, lambda o: keys_used.add(o["key"]) if isinstance(o.get("key"), str) else None)


def field_keys(d):
    out = []
    walk(d, lambda o: out.append(o["key"]) if isinstance(o.get("key"), str) and "bsonType" in o else None)
    return out


before_dup = sorted(k for k in set(field_keys(doc)) if field_keys(doc).count(k) > 1)


def new_key():
    while True:
        k = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in keys_used:
            keys_used.add(k)
            return k


def field(name, bson="string"):
    return {"key": new_key(), "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def rekey(o):
    walk(o, lambda x: x.__setitem__("key", new_key()) if isinstance(x.get("key"), str) and "bsonType" in x else None)
    return o


def set_code(nid, f):
    n = find(doc, nid)
    old = n["data"]["script"]["code"]
    new = body(CODE + f)
    n["data"]["script"]["code"] = new if old.endswith("\n") else new.rstrip("\n")


def once(text, old, new, what):
    assert text.count(old) == 1, (what, text.count(old))
    return text.replace(old, new)


# 1. code bodies from the files
for nid, f in [("code_node_IBguard", "guard.js"), ("code_node_IBplan", "plan.js"), ("code_node_IBverify", "verify.js"),
               ("code_node_IBclaim", "lock_claim.js"), ("code_node_IBseed", "lock_seed.js"), ("code_node_IBlkv", "lock_verify.js")]:
    set_code(nid, f)

# 2. declared outputs (undeclared keys are dropped)
g = find(doc, "code_node_IBguard")["data"]["response_json"]
assert not [x for x in g if x["name"] in ("probePairsJson", "needProbe", "releaseKeysJson")]
g += [field("probePairsJson"), field("needProbe"), field("releaseKeysJson")]
pj = find(doc, "code_node_IBplan")["data"]["response_json"]
byname = {x["name"]: x for x in pj}
for src, dst in [("ff", "ffDel"), ("ffSlices", "ffDelSlices"), ("wa", "waDel"), ("waSlices", "waDelSlices")]:
    assert dst not in byname, dst
    c = rekey(copy.deepcopy(byname[src]))
    c["name"] = c["title"] = dst
    pj.append(c)

# 3. the lock reads take the lock plan's keys, every release the guard's release keys
OLD = "{{node:code_node_IBguard.data.lockKeysJson}}"
for nid in ("sql_node_IBlk1", "sql_node_IBlk2", "sql_node_IBlk3"):
    s = find(doc, nid)["data"]["script"]
    s["code"] = once(s["code"], OLD, "{{node:code_node_IBlkplan.data.lockKeysJson}}", nid)
for nid in ("sql_node_IBrpRel", "sql_node_IBrel", "sql_node_IBfzRel"):
    s = find(doc, nid)["data"]["script"]
    s["code"] = once(s["code"], OLD, "{{node:code_node_IBguard.data.releaseKeysJson}}", nid)

# 4. probe + lock plan, before the lock block (the replay release before them reads the guard's release keys)
top = doc["nodes"]
at = [n["id"] for n in top].index("if_IBlock")
probe = copy.deepcopy(find(doc, "sql_node_IBwa"))
probe["id"] = "sql_node_IBprobe"
title = "Costing probe: (material, plant) of the unpriced category moves whose costing rows need migrating (APPLY)"
probe["data"].update({"title": title, "nodeName": title, "name": title})
probe["data"]["script"]["code"] = PROBE_SQL
probe["data"]["response_json"] = [field("m"), field("p")]
cor = copy.deepcopy(find(doc, "cor_IBtake"))
cor["id"] = "cor_IBprobe"
title = "Costing probe needed (APPLY with unpriced category moves)?"
cor["data"].update({"title": title, "nodeName": title, "name": title})
yes, no = cor["blocks"]
yes["id"], no["id"] = "cor_IBprobe_condition-or-node-item_0", "cor_IBprobe_condition-or-node-item_1"
yes["data"]["filter"]["list"][0].update({"prop": "node.code_node_IBguard.data.needProbe", "value": "YES"})
yes["blocks"] = [probe]
assert no["blocks"] == [] and set(no["data"]) == {"title", "nodeName", "name", "isDefault"}
lkplan = copy.deepcopy(find(doc, "code_node_IBlkv"))
lkplan["id"] = "code_node_IBlkplan"
title = "Lock plan: the guard's keys + the COST key of each pair the probe found, in lock order"
lkplan["data"].update({"title": title, "nodeName": title, "name": title})
lkplan["data"]["script"]["code"] = body(CODE + "lock_plan.js").rstrip("\n")
lk_arr = copy.deepcopy([x for x in g if x["name"] == "lockKeys"][0])
lkplan["data"]["response_json"] = [rekey(lk_arr), field("lockKeysJson"), field("costAdded")]
top[at:at] = [cor, lkplan]

# 5. the retire loops (is_deleted 1, as classic's "Delete FIFO"), after the WA updates
w = parent_list(doc, "loop_IBwWa")
ids = [n["id"] for n in w]


def retire_loop(tag, new, lst, what):
    block = copy.deepcopy(w[ids.index("set_cache_IBw" + tag + "0"): ids.index("loop_IBw" + tag) + 1])
    text = json.dumps(block, ensure_ascii=False)
    for a, b in [("IBw" + tag, "IBw" + new), ("iba_" + lst + "_", "iba_" + lst + "d_"),
                 ("code_node_IBplan.data." + lst + "Slices}}", "code_node_IBplan.data." + lst + "DelSlices}}"),
                 ("code_node_IBplan.data." + lst + "}}", "code_node_IBplan.data." + lst + "Del}}"),
                 ("slice of " + lst + ":", "slice of " + lst + "Del:"),
                 ('"' + lst + " slice", '"' + lst + "Del slice"), ("Next " + lst + " slice", "Next " + lst + "Del slice"),
                 ("Write " + lst + " in slices", "Write " + lst + "Del in slices")]:
        assert a in text, (tag, a)
        text = text.replace(a, b)
    block = rekey(json.loads(text))
    upd = [x for x in block[1]["blocks"] if x["type"] == "update-node"][0]
    title = "WRITE " + what + ": is_deleted 1, the rows a costing migration retired (<= 250 per call)"
    upd["data"].update({"title": title, "nodeName": title, "name": title})
    idprop = [p for p in upd["data"]["props"]["list"] if p["prop"] == "id"][0]
    upd["data"]["props"]["list"] = [idprop, {"prop": "is_deleted", "operator": "", "valueType": "value", "value": 1}]
    return block


at = ids.index("loop_IBwWa") + 1
w[at:at] = retire_loop("Ff", "Fd", "ff", "FIFO layers") + retire_loop("Wa", "Wd", "wa", "Weighted Average rows")

# 6. checks: unique node ids and field keys
all_ids = []
walk(doc, lambda o: all_ids.append(o["id"]) if isinstance(o.get("id"), str) and o.get("type") else None)
dupes = sorted({i for i in all_ids if all_ids.count(i) > 1})
assert not dupes, dupes
# field keys repeat across nodes in the original (55 of them); the patch adds none of its own
after_keys = field_keys(doc)
after_dup = sorted(k for k in set(after_keys) if after_keys.count(k) > 1)
assert after_dup == before_dup, sorted(set(after_dup) - set(before_dup))

out = dump(doc) + ("\n" if raw.endswith("\n") else "")
print("INVENTORY_BULK_APPLY: +%d chars; new nodes cor_IBprobe / sql_node_IBprobe / code_node_IBlkplan + retire loops IBwFd / IBwWd"
      % (len(out) - len(raw)))
if "--write" in sys.argv:
    open(F, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
