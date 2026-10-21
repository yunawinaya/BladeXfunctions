"""patch_replay_release.py [--write] [--out <file>]: INVENTORY_BULK_APPLY (Balance Table/INVENTORY_BULK_APPLY.json, dev v10) gives back
the locks a run left held when it died (found by bladexfunctions-8c, IDA V2 integration sims, 10-21). Lock rows never expire, so
before this a leaked key answered 409 to every later operation:
- a run that died after add_node_IBdone and before its release finished: the repeat call REPLAYs at if_IBreplay and returned
  before cor_IBrelease;
- a run that died between release step 1 (owner cleared, last owner = op) and step 2 (GIVE): its keys sat at token 0 with no
  owner; a repeat call claimed them as another operation's (BUSY) and release.js only collected rows it owned.
Changes:
- sql_node_IBlk2 / IBlk3 / IBrel read last_owner_operation_id;
- claim (IBclaim) and verify (IBlkv): a key is this operation's at token 0 when it owns it, or when the owner is empty and it is
  the last owner (only its own interrupted release leaves that state; TAKE needs token 1, so nobody else can hold it meanwhile);
- release (IBrelease): such half-released rows go straight to GIVE (INVENTORY_LOCK_TOKENS gives back only token 0, owner empty,
  last owner = op, so a repeat GIVE skips what is already back);
- if_IBreplay: the release block (IBrel..IBgive, copied with IBrp ids) runs before return_node_IBreplay.
Exact text edits on the repo JSON; every anchor must match once."""
import copy
import json
import re
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
F = R + "Balance Table/INVENTORY_BULK_APPLY.json"

RELEASE = """// INVENTORY_BULK_APPLY lock release plan: this operation's rows only (owner cleared first, then GIVE adds the token back); a row its
// own earlier release left between the two (owner empty, last owner = this operation) goes straight to GIVE
const s = (v) => (v === undefined || v === null ? "" : String(v));
const op = s([{{node:code_node_IBguard.data.operationKey}}][0]);
const rows = [{{node:__REL__.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
let dbNow = "";
for (const r of list) if (r && !dbNow && r.db_now) dbNow = s(r.db_now);
const clearRows = [];
const plusIds = [];
for (const r of list) {
  if (!r || !/^[0-9]{1,20}$/.test(s(r.id)) || Number(r.free_token) !== 0) continue;
  if (s(r.owner_operation_id) === op) {
    clearRows.push({ id: s(r.id), owner_operation_id: "", last_owner_operation_id: op, last_released_at: dbNow, lock_version: (Number(r.lock_version) || 0) + 1 });
    plusIds.push(s(r.id));
  } else if (s(r.owner_operation_id) === "" && s(r.last_owner_operation_id) === op) plusIds.push(s(r.id));
}
const batches = [];
for (let i = 0; i < clearRows.length; i += 250) batches.push({ from: i });
return { clearRows: clearRows, batches: batches, plusIds: plusIds, needRelease: plusIds.length ? "YES" : "NO" };"""
MINE = 'const mine = (r) => s(r.owner_operation_id) === op || (s(r.owner_operation_id) === "" && s(r.last_owner_operation_id) === op);'
OP = "const op = s([{{node:code_node_IBguard.data.operationKey}}][0]);"
LAST = {"key": "01lstown", "name": "last_owner_operation_id", "title": "last_owner_operation_id", "description": "", "bsonType": "string",
        "isExpand": False, "children": []}
COPY = {
    "sql_node_IBrel": ("sql_node_IBrpRel", "Replay: the lock rows of the keys (a run that died after IBA|DONE may still hold them)"),
    "code_node_IBrelease": ("code_node_IBrpRelease", "Replay: release plan, this operation only"),
    "cor_IBrel2": ("cor_IBrpRel2", "Replay: anything still held?"),
    "set_cache_IBrlIdx0": ("set_cache_IBrpIdx0", "Replay release slice index = 0 (per run: the key carries the run's nonce)"),
    "loop_IBrel": ("loop_IBrpRel", "Replay: clear the owner, in slices of <= 250"),
    "get_cache_IBrlIdx": ("get_cache_IBrpIdx", "Replay release slice index"),
    "code_node_IBrlSlice": ("code_node_IBrpSlice", "Replay release slice"),
    "update_node_IBrel": ("update_node_IBrpRel", "Replay release step 1: owner cleared, last owner = this operation"),
    "set_cache_IBrlIdxN": ("set_cache_IBrpIdxN", "Next replay release slice index"),
    "workflow_node_IBgive": ("workflow_node_IBrpGive", "Replay release step 2: INVENTORY_LOCK_TOKENS GIVE"),
}


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return n
        for v in n.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, nid)
            if r:
                return r
    return None


def once(text, old, new, what):
    assert text.count(old) == 1, "%s: anchor matches %d times" % (what, text.count(old))
    return text.replace(old, new)


def code_of(n):
    return n["data"]["script"]["code"]


def set_code(n, c):
    n["data"]["script"]["code"] = c


def add_last(n):
    rj = n["data"]["response_json"]
    assert not any(r["name"] == "last_owner_operation_id" for r in rj), n["id"] + " already reads last_owner_operation_id"
    at = [r["name"] for r in rj].index("owner_operation_id") + 1
    rj.insert(at, dict(LAST))


raw = open(F, encoding="utf-8").read()
doc = json.loads(raw)
assert find(doc, "sql_node_IBrpRel") is None, "already patched"

lk2 = find(doc, "sql_node_IBlk2")
set_code(lk2, once(code_of(lk2), "free_token, owner_operation_id,\n", "free_token, owner_operation_id, last_owner_operation_id,\n", "IBlk2"))
add_last(lk2)
lk3 = find(doc, "sql_node_IBlk3")
set_code(lk3, once(code_of(lk3), "free_token, owner_operation_id\n", "free_token, owner_operation_id, last_owner_operation_id\n", "IBlk3"))
add_last(lk3)
rel = find(doc, "sql_node_IBrel")
set_code(rel, once(code_of(rel), "owner_operation_id, lock_version,", "owner_operation_id, last_owner_operation_id, lock_version,", "IBrel"))
add_last(rel)

claim = find(doc, "code_node_IBclaim")
c = once(code_of(claim), OP + "\n", OP + "\n// held by it, or left by its own release between clearing the owner and GIVE (a run that died there)\n" + MINE + "\n", "IBclaim op")
set_code(claim, once(c, "  else if (t === 0 && s(r.owner_operation_id) === op) continue;", "  else if (t === 0 && mine(r)) continue;", "IBclaim held"))
lkv = find(doc, "code_node_IBlkv")
c = once(code_of(lkv), "every key reads token 0 with this operation as owner, else LOST", "every key reads token 0 held by this operation (as claimed), else LOST", "IBlkv title")
c = once(c, OP + "\n", OP + "\n" + MINE + "\n", "IBlkv op")
set_code(lkv, once(c, "Number(r.free_token) !== 0 || s(r.owner_operation_id) !== op) lost.push(k);", "Number(r.free_token) !== 0 || !mine(r)) lost.push(k);", "IBlkv lost"))
relc = find(doc, "code_node_IBrelease")
assert "plusIds: clearRows.map((r) => r.id)" in code_of(relc), "IBrelease is not v10's"
set_code(relc, RELEASE.replace("__REL__", "sql_node_IBrel"))

# the replay release: copies of the release block, every id and reference renamed, before return_node_IBreplay
cor = find(doc, "cor_IBrelease")
yes = cor["blocks"][0]
assert yes["data"]["filter"]["list"][0]["prop"] == "node.code_node_IBend.data.release"
block = [copy.deepcopy(find(yes, i)) for i in ("sql_node_IBrel", "code_node_IBrelease", "cor_IBrel2")]
text = json.dumps(block, ensure_ascii=False)
# an id also prefixes its branch items' ids (cor_IBrel2_condition-or-node-item_1)
named = lambda old: r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9])" % re.escape(old)
for old, (new, _) in COPY.items():
    text = re.sub(named(old), new, text)
text = text.replace("iba_rl_", "iba_rp_")
block = json.loads(text)
for old, (new, title) in COPY.items():
    n = find(block, new)
    assert n is not None, new
    for k in ("title", "nodeName", "name"):
        n["data"][k] = title
leftover = [o for o in COPY if re.search(named(o), json.dumps(block))]
assert not leftover, "copy still names " + str(leftover)
rp = find(doc, "if_IBreplay")
for k in ("title", "nodeName", "name"):
    rp["data"][k] = "IF this operation is DONE: give back any key it still holds, return its stored answer"
tb = rp["blocks"][0]
assert [b["id"] for b in tb["blocks"]] == ["return_node_IBreplay"], [b["id"] for b in tb["blocks"]]
tb["blocks"] = block + tb["blocks"]

ids = []


def node_ids(n):
    if isinstance(n, dict):
        if isinstance(n.get("id"), str):
            ids.append(n["id"])
        for v in n.values():
            node_ids(v)
    elif isinstance(n, list):
        for v in n:
            node_ids(v)


node_ids(doc)
dup = sorted({i for i in ids if ids.count(i) > 1})
assert not dup, "duplicate node ids: " + str(dup)
print("INVENTORY_BULK_APPLY: last_owner_operation_id read in IBlk2 / IBlk3 / IBrel; claim + verify + release accept the half-released state;"
      " replay releases (%d nodes copied)" % len(COPY))
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else (F if "--write" in sys.argv else None)
if out:
    open(out, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1) + ("\n" if raw.endswith("\n") else ""))
    print("wrote", out)
