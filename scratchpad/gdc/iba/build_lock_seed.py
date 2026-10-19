"""INVENTORY_LOCK_SEED (new) + the engine's seed through it.

A twin insert of a lock row (two operations seeding the same new key at once) fails the add-node and with it the run that
holds it. Moved into a child workflow, that failure stays in the child (a child error does not abort the caller): the
engine's claim then re-reads the rows and answers 409 for any row still missing (code/lock_claim.js).

usage: python3 build_lock_seed.py <INVENTORY_LOCK_SEED workflow id> [--write]
"""
import copy
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
ENGINE = R + "Balance Table/INVENTORY_BULK_APPLY.json"
CHILD = R + "Balance Table/INVENTORY_LOCK_SEED.json"
seed_id = sys.argv[1] if len(sys.argv) > 1 else ""
assert re.fullmatch(r"[0-9]{1,20}", seed_id), "give the INVENTORY_LOCK_SEED workflow id"
WRITE = "--write" in sys.argv


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


def dump(doc):
    return json.dumps(doc, indent=1, ensure_ascii=False)


engine = json.loads(open(ENGINE, encoding="utf-8").read())
yes = find(engine, "cor_IBseed_condition-or-node-item_0")
# the proven inline seed loop: the engine's own before v9, else the v8 backup (v9 replaced it by the INVENTORY_LOCK_SEED call)
V8 = os.path.expanduser("~/Documents/ASC-dev/workflow-backups/dev/INVENTORY_BULK_APPLY/v8_20261016-205649.enabled.json")
src = yes if find(yes, "loop_IBseed") else find(json.loads(open(V8, encoding="utf-8").read()), "cor_IBseed_condition-or-node-item_0")
seed_blocks = [b for b in src["blocks"] if b.get("type") != "leaf"]
assert [b["id"] for b in seed_blocks] == ["set_cache_IBsdIdx0", "loop_IBseed"], [b["id"] for b in seed_blocks]

# ---- INVENTORY_LOCK_SEED: the engine's own seed loop, fed by its request
text = json.dumps(copy.deepcopy(seed_blocks), ensure_ascii=False)
for old, new in [("code_node_IBguard", "code_node_LSplan"), ("code_node_IBseed", "code_node_LSplan"), ("add_node_IBseed", "add_node_LSseed"),
                 ("loop_IBseed", "loop_LSseed"), ("IBsd", "LSsd")]:
    text = text.replace(old, new)
assert not re.search(r"(code_node|get_cache|set_cache|add_node|loop|sql_node)_IB", text), "an engine reference survived"
child_loop = json.loads(text)
# a callWorkflow child's failure aborts its caller (a3, 2026-10-16), so the child itself catches a twin insert: the slice is
# skipped and the caller's claim re-reads (try/catch shape as the live "Monthly Credit Reset Due", catch-all Filter)
loop_body = child_loop[1]["blocks"]
at = [i for i, b in enumerate(loop_body) if b.get("id") == "add_node_LSseed"]
assert len(at) == 1, [b.get("id") for b in loop_body]
fail_js = """console.log("lock seed: a slice insert failed (a twin insert by another operation); the caller's claim re-reads the rows");
return { sliceFailed: "YES" };"""
loop_body[at[0]] = {
    "id": "try_catch_LSseed", "type": "tryCatch", "data": {"title": "try-catch: a twin insert must not fail the caller"},
    "blocks": [
        {"type": "tryBlock", "key": "try", "data": {}, "blocks": [loop_body[at[0]]], "id": "try_catch_LSseed_tryBlock_0"},
        {"type": "catchBlock", "key": "catch",
         "data": {"title": "Twin insert", "trycatch_type": "Filter", "filter": {"list": []}, "expression": {"type": "javascript", "code": ""},
                  "displayContent": "sdk.form.setCondition"},
         "blocks": [K.code("code_node_LSfail", "Slice not inserted: the caller's claim re-reads the rows", fail_js, ["sliceFailed"])],
         "id": "try_catch_LSseed_catchBlock_1"},
    ]}
# advance the slice index BEFORE the guarded insert: after a caught failure the slice node's output reads back NULL
# (live 2026-10-16, instance 2111081214820913153: "redis key ... 设置值不能为NULL" at the index node after the catch)
nxt = [i for i, b in enumerate(loop_body) if b.get("id") == "set_cache_LSsdIdxN"]
assert len(nxt) == 1 and nxt[0] == at[0] + 1, [b.get("id") for b in loop_body]
loop_body.insert(at[0], loop_body.pop(nxt[0]))

plan_js = r"""// INVENTORY_LOCK_SEED - the lock rows to insert (free_token 1), as INVENTORY_BULK_APPLY's seed builds them; a twin insert
// fails this run only: the caller re-reads the rows and treats a row still missing as busy
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const org = s([{{workflowparams:organization_id}}][0]);
const input = [{{workflowparams:rows}}][0];
if (!/^[0-9]{1,19}$/.test(org)) throw new Error("INV_LOCK_SEED_INPUT: organization_id is not 1-19 digits");
const seen = {};
const rowsToAdd = [];
for (const r of Array.isArray(input) ? input : input ? [input] : []) {
  const k = s(r && r.lock_key);
  if (!/^(ITEM|BATCH|COST)\|[0-9|]{1,120}$/.test(k)) throw new Error("INV_LOCK_SEED_INPUT: lock_key " + k.slice(0, 60) + " is not ITEM|, BATCH| or COST| digits");
  if (seen[k.toUpperCase()]) continue;
  seen[k.toUpperCase()] = true;
  rowsToAdd.push({ organization_id: org, lock_key: k, balance_type: k.split("|")[0], free_token: 1, lock_version: 0, owner_operation_id: "", last_owner_operation_id: "" });
}
const batches = [];
for (let i = 0; i < rowsToAdd.length; i += 250) batches.push({ from: i });
const nonce = (s([{{system:uuid}}][0]).replace(/[^0-9a-fA-F]/g, "") + "000000000000").slice(0, 12);
return { organizationId: org, nonce: nonce, rowsToAdd: rowsToAdd, batches: batches, needSeed: rowsToAdd.length ? "YES" : "NO", count: String(rowsToAdd.length) };"""
done_js = """const n = [{{node:code_node_LSplan.data.count}}][0];
return { code: "200", count: String(n || 0), message: (n || 0) + " lock row(s) requested; a twin insert is skipped and the caller re-reads the rows" };"""

ids = K.Ids(1798200000000)
child = K.workflow(
    [("organization_id", "string", "the organization (digits) of the lock rows"),
     ("rows", "any", "lock rows to insert: [{lock_key: 'ITEM|mat|loc' | 'BATCH|mat|loc|batch' | 'COST|mat|plant', ...}]")],
    ["code", "count", "message"],
    [K.code("code_node_LSplan", "Plan: the rows to insert (keys checked, repeats dropped), slices of <= 250", plan_js,
            ["organizationId", "nonce", "rowsToAdd", "batches", "needSeed", "count"], arrays=("rowsToAdd", "batches")),
     K.when_yes(ids, "cor_LSseed", "Lock rows to seed?", "node.code_node_LSplan.data.needSeed", "needSeed", child_loop),
     K.code("code_node_LSdone", "Result", done_js, ["code", "count", "message"]),
     K.ret("return_node_LSdone", "Return", [(f, "{{node:code_node_LSdone.data.%s}}" % f) for f in ["code", "count", "message"]])])

# ---- the engine: seed through the child, then the claim (lock_claim.js) answers BUSY for a row still missing
call = copy.deepcopy(find(engine, "workflow_node_IBtake"))
title = "Lock seed: INVENTORY_LOCK_SEED (a twin insert fails only the child; the claim re-reads)"
call["id"] = "workflow_node_IBseed"
call["data"].update({"title": title, "nodeName": title, "name": title})
call["data"]["workflow"] = {"rules": {"collectionId": seed_id, "list": []}, "source": "INVENTORY_LOCK_SEED:Workflow:%s" % seed_id}
call["data"]["body_params"] = {"list": [{"prop": "organization_id", "value": "{{node:code_node_IBguard.data.organizationId}}"},
                                        {"prop": "rows", "value": "{{node:code_node_IBseed.data.rowsToAdd}}"}]}
# the caller side too: the run API reports a child's caught error as a failure, so the engine also catches around the call
# (the live "Monthly Credit Reset Due" wraps its workflow-node the same way); the claim then re-reads the rows either way
seed_fail_js = """console.log("lock seed: INVENTORY_LOCK_SEED answered with an error; the claim re-reads the rows (missing = busy)");
return { seedFailed: "YES" };"""
guarded = {
    "id": "try_catch_IBseed", "type": "tryCatch", "data": {"title": "try-catch: a failed seed answers busy, not a failed run"},
    "blocks": [
        {"type": "tryBlock", "key": "try", "data": {}, "blocks": [call], "id": "try_catch_IBseed_tryBlock_0"},
        {"type": "catchBlock", "key": "catch",
         "data": {"title": "Seed failed", "trycatch_type": "Filter", "filter": {"list": []}, "expression": {"type": "javascript", "code": ""},
                  "displayContent": "sdk.form.setCondition"},
         "blocks": [K.code("code_node_IBseedFail", "Seed failed: the claim re-reads the rows", seed_fail_js, ["seedFailed"])],
         "id": "try_catch_IBseed_catchBlock_1"},
    ]}
yes["blocks"] = [b for b in yes["blocks"] if b.get("type") == "leaf"] + [guarded]
claim = find(engine, "code_node_IBclaim")
claim["data"]["script"]["code"] = open(os.path.join(HERE, "code", "lock_claim.js"), encoding="utf-8").read().rstrip("\n")

print("INVENTORY_LOCK_SEED: %d chars; engine: %d chars" % (len(dump(child)), len(dump(engine))))
if WRITE:
    open(CHILD, "w", encoding="utf-8").write(dump(child))
    open(ENGINE, "w", encoding="utf-8").write(dump(engine))
    print("wrote", CHILD, "and", ENGINE)
