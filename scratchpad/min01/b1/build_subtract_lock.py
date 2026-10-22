#!/usr/bin/env python3
"""MIN-01 RF-01: SUBTRACT_INVENTORY takes the engine's ITEM|<material>|<bin> token around its balance read-and-write.

Base: scratchpad/min01/base/SUBTRACT_INVENTORY.live_v59.json. Output: scratchpad/min01/out/SUBTRACT_INVENTORY.json.

Inserted after `Batch ID` (code_node_MQ0uNcoG): code_node_CLkey (switch CL_LOCK_ENABLED, key, operation) and
if_CLon. OFF (or a call the lock cannot take) falls through to the unchanged nodes. ON runs, inside if_CLon:
  seed the lock row if missing -> read it -> busy unless token 1 -> TAKE (atomic minus 1 + owner + claimed_at)
  -> read the lock row and the balance rows -> verify + recompute -> LOST: 400 / SHORT: release, 400
  -> re-verify the owner -> write the balance rows -> release (owner '', last owner, lock_version + 1; then plus 1)
  -> movement row and costing (copies of the unlocked tail) -> the same returns.
Protocol agreed with the engine owner (bladexfunctions-3f, 22 Oct): one ITEM key, claimed_at from SQL NOW(3), release only
a row this call still owns (token 0, owner = op), never release on BUSY / LOST. Leaked CL| keys are an admin clear.
Direct calls with trx_no starting MIN01-TEST run the locked path while the switch is OFF (DEV tests).

Usage: python3 -I build_subtract_lock.py [--on]
"""
import copy
import json
import os
import random
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.join(ROOT, "base", "SUBTRACT_INVENTORY.live_v59.json")
TOKENS = os.path.join(ROOT, "base", "INVENTORY_LOCK_TOKENS.ref.json")
OUT = os.path.join(ROOT, "out", "SUBTRACT_INVENTORY.json")

LOCK_TABLE = {"source": "Inventory Balance Lock:Table:2105132021358956546", "collectionId": "2105132021358956546"}
SEED_WF = {"source": "INVENTORY_LOCK_SEED:Workflow:2111078356478234625", "collectionId": "2111078356478234625"}

rng = random.Random(20261022)  # fixed: a rebuild produces the same ids
ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
_fid = [1795000000000]


def key8():
    return "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))


def fid():
    _fid[0] += 1
    return _fid[0]


def walk(n, fn):
    if isinstance(n, dict):
        fn(n)
        for v in n.values():
            walk(v, fn)
    elif isinstance(n, list):
        for v in n:
            walk(v, fn)


def find(doc, node_id):
    hit = []
    walk(doc, lambda x: hit.append(x) if x.get("id") == node_id else None)
    if len(hit) != 1:
        sys.exit(f"node {node_id}: found {len(hit)}")
    return hit[0]


def parent_list(doc, node_id):
    """The block list that holds node_id."""
    found = []

    def fn(x):
        for v in x.values():
            if isinstance(v, list) and any(isinstance(i, dict) and i.get("id") == node_id for i in v):
                found.append(v)

    walk(doc, fn)
    if len(found) != 1:
        sys.exit(f"parent of {node_id}: found {len(found)}")
    return found[0]


def code_node(nid, title, code, outputs):
    return {
        "id": nid,
        "type": "code-node",
        "data": {
            "language": "javascript",
            "code": "",
            "timeout": 30000,
            "title": title,
            "isValidator": True,
            "nodeName": title,
            "name": title,
            "script": {"type": "javascript", "code": code},
            "response_json": [
                {"key": key8(), "name": n, "title": n, "description": "", "bsonType": t, "isExpand": False} for n, t in outputs
            ],
        },
        "blocks": [],
    }


def sql_node(nid, title, sql, outputs):
    return {
        "id": nid,
        "type": "sql-node",
        "data": {
            "script": {"type": "sql", "code": sql},
            "response_json": [
                {"key": key8(), "name": n, "title": n, "description": "", "bsonType": t, "isExpand": False, "children": []}
                for n, t in outputs
            ],
            "params": {},
            "result_mode": "many",
            "title": title,
            "nodeName": title,
            "name": title,
            "tableId": LOCK_TABLE["collectionId"],
            "table_id": {"source": LOCK_TABLE["source"], "rules": {"collectionId": LOCK_TABLE["collectionId"], "list": []}},
        },
    }


def if_expr(nid, title, expr, true_blocks, false_blocks=None):
    if not true_blocks:
        sys.exit(f"{nid}: an if's true block must not be empty")
    return {
        "id": nid,
        "type": "if",
        "data": {
            "title": title,
            "isValidator": True,
            "nodeName": title,
            "name": title,
            "condition_type": "Expression",
            "filter": {"list": [{"id": fid(), "parentId": fid(), "isTop": True, "prop": "", "operator": "", "valueType": "",
                                 "value": "", "type": "leaf", "level": 1}]},
            "expression": {"type": "javascript", "code": expr},
        },
        "blocks": [
            {"id": "ifBlock_" + nid[3:] + "T", "type": "ifBlock", "data": {"title": "true"}, "blocks": true_blocks},
            {"id": "ifBlock_" + nid[3:] + "F", "type": "ifBlock", "data": {"title": "false"}, "blocks": false_blocks or []},
        ],
    }


def return_node(nid, items):
    return {
        "id": nid,
        "type": "return-node",
        "data": {
            "return_data": {},
            "status_code": 200,
            "title": "Return Data",
            "isValidator": True,
            "nodeName": "Return Data",
            "name": "Return Data",
            "response_value": {"list": [
                {"prop": p, "propLabel": p, "operator": "", "operatorLabel": "", "valueType": vt, "valueTypeLabel": "",
                 "value": v, "valueLabel": ""} for p, vt, v in items
            ]},
            "return_raw_data": 0,
        },
        "blocks": [],
    }


def where_id(value, label="主键ID"):
    return [{"id": fid(), "parentId": fid(), "isTop": True, "prop": "id", "operator": "in", "valueType": "field",
             "value": value, "type": "leaf", "level": 1, "propLabel": label, "valueLabel": "", "operatorLabel": "In"}]


def atomic_node(template, nid, title, id_ref, props):
    n = copy.deepcopy(template)
    n["id"] = nid
    d = n["data"]
    d["table_id"]["rules"]["list"] = where_id(id_ref)
    d["props"]["list"] = [
        {"prop": p, "propLabel": p, "operator": "", "operatorLabel": "", "valueType": vt, "valueTypeLabel": "",
         "value": v, "valueLabel": ""} for p, vt, v in props
    ]
    d["title"] = d["nodeName"] = d["name"] = title
    n["blocks"] = []
    return n


def update_node(nid, title, table_source, collection_id, id_ref, props):
    return {
        "id": nid,
        "type": "update-node",
        "data": {
            "table_id": {"source": table_source, "rules": {"collectionId": collection_id, "list": where_id(id_ref)}},
            "props": {"list": [{"prop": p, "operator": "", "valueType": "field", "value": v} for p, v in props]},
            "title": title,
            "nodeName": title,
            "name": title,
        },
        "blocks": [],
    }


def workflow_node(nid, title, wf, body):
    return {
        "id": nid,
        "type": "workflow-node",
        "data": {
            "workflow": {"rules": {"collectionId": wf["collectionId"], "list": []}, "source": wf["source"]},
            "body_params": {"list": [{"prop": p, "value": v} for p, v in body]},
            "title": title,
            "nodeName": title,
            "name": title,
        },
        "blocks": [],
    }


def clone_tree(node, suffix, extra_map):
    """Deep copy with every node / block id inside renamed (id + suffix) and references remapped."""
    n = copy.deepcopy(node)
    ids = []
    walk(n, lambda x: ids.append(x["id"]) if isinstance(x.get("id"), str) and "_" in x["id"] else None)
    mapping = {i: (i + suffix) for i in ids}
    mapping.update(extra_map)

    def fn(x):
        for k, v in list(x.items()):
            if k == "id" and isinstance(v, str) and v in mapping:
                x[k] = mapping[v]
            elif isinstance(v, str):
                for old, new in mapping.items():
                    if old in v:
                        v = re.sub(r"\b" + re.escape(old) + r"\b", new, v)
                x[k] = v
            elif isinstance(v, int) and k in ("id", "parentId") and v > 10 ** 11:
                x[k] = v + 7 * 10 ** 9  # filter leaf ids: keep them distinct from the originals

    walk(n, fn)
    return n


S = 'const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();\n'
FIRST = "const first = (v) => (Array.isArray(v) ? v[0] : v) || {};\n"
LOCK_ROW_SQL = (
    "SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now,\n"
    "       CAST(l.id AS CHAR) AS id, l.free_token, l.owner_operation_id, l.last_owner_operation_id, l.lock_version\n"
    "  FROM (SELECT 1 AS one) d\n"
    "  LEFT JOIN inventory_balance_lock l\n"
    "    ON l.tenant_id = '{{node:code_node_CLkey.data.tenant}}'\n"
    "   AND l.organization_id = '{{node:code_node_CLkey.data.org}}'\n"
    "   AND l.lock_key = '{{node:code_node_CLkey.data.key}}'\n"
    "   AND l.is_deleted = 0"
)
LOCK_ROW_OUT = [("db_now", "string"), ("id", "string"), ("free_token", "int"), ("owner_operation_id", "string"),
                ("last_owner_operation_id", "string"), ("lock_version", "int")]
BUSY_MSG = "Stock of this item at this bin is being updated by another document. Please try again."


def release_block(tag, tok_template):
    """Re-read the lock row; give it back only if this call still owns it (token 0, owner = op)."""
    rp = f"code_node_CLrp{tag}"
    return [
        sql_node(f"sql_node_CLrl{tag}", "Classic lock: the lock row before the release", LOCK_ROW_SQL, LOCK_ROW_OUT),
        code_node(rp, "Classic lock: release only a row this call still owns",
                  "// give back only what this call holds: token 0 and owner = this call (a row it lost is never released)\n"
                  + S + FIRST +
                  "const op = s([{{node:code_node_CLkey.data.op}}][0]);\n"
                  f"const r = first([{{{{node:sql_node_CLrl{tag}.data}}}}][0]);\n"
                  "const mine = /^[0-9]{1,20}$/.test(s(r.id)) && Number(r.free_token) === 0 && s(r.owner_operation_id) === op;\n"
                  "return { needRelease: mine ? \"YES\" : \"NO\", id: s(r.id), ownerEmpty: \"\", lastOwner: op, releasedAt: s(r.db_now),\n"
                  "  lockVersion: (Number(r.lock_version) || 0) + 1, one: 1 };",
                  [("needRelease", "string"), ("id", "string"), ("ownerEmpty", "string"), ("lastOwner", "string"),
                   ("releasedAt", "string"), ("lockVersion", "int"), ("one", "int")]),
        if_expr(f"if_CLrel{tag}", "IF this call still owns the key: give it back",
                f"'{{{{node:{rp}.data.needRelease}}}}' == 'YES'",
                [
                    update_node(f"update_node_CLrel{tag}", "Classic lock release: owner cleared, last owner = this call",
                                LOCK_TABLE["source"], LOCK_TABLE["collectionId"], f"{{{{node:{rp}.data.id}}}}",
                                [("owner_operation_id", f"{{{{node:{rp}.data.ownerEmpty}}}}"),
                                 ("last_owner_operation_id", f"{{{{node:{rp}.data.lastOwner}}}}"),
                                 ("last_released_at", f"{{{{node:{rp}.data.releasedAt}}}}"),
                                 ("lock_version", f"{{{{node:{rp}.data.lockVersion}}}}")]),
                    atomic_node(tok_template, f"atomic_count_node_CLgive{tag}", "Classic lock release: give the token back (plus 1)",
                                f"{{{{node:{rp}.data.id}}}}",
                                [("free_token", "formula", f"plus({{{{node:{rp}.data.one}}}})")]),
                ]),
    ]


def build(on):
    doc = json.load(open(BASE, encoding="utf-8"))
    tok = json.load(open(TOKENS, encoding="utf-8"))
    take_tpl = find(tok, "atomic_count_node_EBncppM3")

    key = code_node(
        "code_node_CLkey", "Classic lock: switch, key and operation",
        "// MIN-01: take the engine's ITEM|<material>|<bin> token around the balance read-and-write (the engine takes ITEM for every\n"
        "// movement of that material + bin). OFF, or ids the lock cannot use: the unlocked path below, as before.\n"
        f"const CL_LOCK_ENABLED = {'true' if on else 'false'};\n"
        + S +
        "const mat = s([{{workflowparams:material_id}}][0]);\n"
        "const bin = s([{{workflowparams:location_id}}][0]);\n"
        "const org = s([{{workflowparams:organization_id}}][0]);\n"
        "const tenant = s([{{system:tenantId}}][0]);\n"
        "const trx = s([{{workflowparams:trx_no}}][0]);\n"
        "// DEV tests: a direct call with trx_no MIN01-TEST... runs the locked path while the switch is OFF\n"
        "const wanted = CL_LOCK_ENABLED || trx.indexOf(\"MIN01-TEST\") === 0;\n"
        "const ok = /^[0-9]{1,20}$/.test(mat) && /^[0-9]{1,20}$/.test(bin) && /^[0-9]{1,19}$/.test(org) && /^[0-9]{1,20}$/.test(tenant);\n"
        "if (wanted && !ok) console.log(\"classic lock skipped: ids are not digits\", mat, bin, org);\n"
        "const nonce = (s([{{system:uuid}}][0]).replace(/[^0-9a-fA-F]/g, \"\") + \"0000000000000000\").slice(0, 16);\n"
        "const key = \"ITEM|\" + mat + \"|\" + bin;\n"
        "return { on: wanted && ok ? \"YES\" : \"NO\", key: key, op: \"CL|\" + nonce, org: org, tenant: tenant, one: 1, seedRows: [{ lock_key: key }] };",
        [("on", "string"), ("key", "string"), ("op", "string"), ("org", "string"), ("tenant", "string"), ("one", "int"),
         ("seedRows", "array")])

    seed_plan = code_node(
        "code_node_CLseed", "Classic lock: does the key have a lock row?",
        S + FIRST + "const r = first([{{node:sql_node_CLlk0.data}}][0]);\n"
        "return { needSeed: /^[0-9]{1,20}$/.test(s(r.id)) ? \"NO\" : \"YES\" };",
        [("needSeed", "string")])
    claim = code_node(
        "code_node_CLclaim", "Classic lock: take, or busy",
        "// token 1 = free; token 0 = held by an engine run or another classic call (or half released); no row = busy (the seed lost)\n"
        + S + FIRST + "const r = first([{{node:sql_node_CLlk1.data}}][0]);\n"
        "let route = \"TAKE\";\n"
        "if (!/^[0-9]{1,20}$/.test(s(r.id)) || Number(r.free_token) !== 1) route = \"BUSY\";\n"
        "return { route: route, id: s(r.id), claimedAt: s(r.db_now) };",
        [("route", "string"), ("id", "string"), ("claimedAt", "string")])

    take = atomic_node(take_tpl, "atomic_count_node_CLtake", "Classic lock: take the token AND record the owner (one atomic node)",
                       "{{node:code_node_CLclaim.data.id}}",
                       [("free_token", "formula", "minus({{node:code_node_CLkey.data.one}})"),
                        ("owner_operation_id", "field", "{{node:code_node_CLkey.data.op}}"),
                        ("claimed_at", "field", "{{node:code_node_CLclaim.data.claimedAt}}")])

    par_tpl = find(doc, "condition_all_5ak80NEZ")
    bal_get = clone_tree(find(doc, "get_node_uaq6Z1ej"), "", {"get_node_uaq6Z1ej": "get_node_CLbal"})
    bb_get = clone_tree(find(doc, "get_node_GjRiq3dT"), "", {"get_node_GjRiq3dT": "get_node_CLbb"})
    par = copy.deepcopy(par_tpl)
    par["id"] = "condition_all_CLread"
    par["data"]["title"] = "Under the key: the lock row and the balance rows"
    item_bal, item_bb = copy.deepcopy(par["blocks"][0]), copy.deepcopy(par["blocks"][1])
    item_lk = copy.deepcopy(item_bal)
    for it, nid, title, blocks in (
        (item_lk, "condition_all_node_item_CLrLk", "Lock row", [sql_node("sql_node_CLvf1", "Classic lock: the lock row after the take", LOCK_ROW_SQL, LOCK_ROW_OUT)]),
        (item_bal, "condition_all_node_item_CLrIb", "Item Balance", [bal_get]),
        (item_bb, "condition_all_node_item_CLrBb", "Item Batch Balance", [bb_get]),
    ):
        it["id"] = nid
        it["data"]["title"] = it["data"]["nodeName"] = it["data"]["name"] = title
        for leaf in it["data"]["filter"]["list"]:
            leaf["id"], leaf["parentId"] = fid(), fid()
        it["blocks"] = blocks
    par["blocks"] = [item_lk, item_bal, item_bb]

    qty_out = ["unrestrictedQty", "reservedQty", "blockedQty", "qualityInspectionQty", "inTransitQty", "balanceQty",
               "batchUnrestrictedQty", "batchReservedQty", "batchBlockedQty", "batchQualityInspectionQty", "batchInTransitQty",
               "batchBalanceQty"]
    calc = code_node(
        "code_node_CLcalc", "Classic lock: verify the take, recompute under the key",
        "// under the key: the take must read token 0 owned by this call; the six quantities are recomputed from the rows read\n"
        "// now with the arithmetic of code_node_mQnskse9; the bucket check is code_node_DUBS9GZF's (batch row when batched)\n"
        "const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));\n"
        + S + FIRST +
        "const one = (v) => (Array.isArray(v) ? (v.length === 1 ? v[0] : null) : v || null);\n"
        "const op = s([{{node:code_node_CLkey.data.op}}][0]);\n"
        "const lk = first([{{node:sql_node_CLvf1.data}}][0]);\n"
        "const held = Number(lk.free_token) === 0 && s(lk.owner_operation_id) === op;\n"
        "const deductQty = q8({{node:code_node_wBfvXM2G.data.baseQty}});\n"
        "const categoryField = {{node:code_node_TC1cqaOy.data.categoryField}};\n"
        "const hasBatch = s([{{workflowparams:batch_id}}][0]) !== \"\";\n"
        "const bal = one([{{node:get_node_CLbal.data.data}}][0]);\n"
        "const bb = hasBatch ? one([{{node:get_node_CLbb.data.data}}][0]) : null;\n"
        "const after = (row, field) => q8(q8((row || {})[field] || 0) - (field === categoryField ? deductQty : 0));\n"
        "const total = (row) => q8(q8((row || {}).balance_quantity || 0) - deductQty);\n"
        "const check = hasBatch ? bb : bal;\n"
        "let route = \"OK\";\n"
        "if (!held) route = \"LOST\";\n"
        "else if (!categoryField || !bal || !bal.id || (hasBatch && (!bb || !bb.id)) || q8((check || {})[categoryField] || 0) < deductQty) route = \"SHORT\";\n"
        "return {\n  route: route,\n"
        "  unrestrictedQty: after(bal, \"unrestricted_qty\"), reservedQty: after(bal, \"reserved_qty\"), blockedQty: after(bal, \"block_qty\"),\n"
        "  qualityInspectionQty: after(bal, \"qualityinsp_qty\"), inTransitQty: after(bal, \"intransit_qty\"), balanceQty: total(bal),\n"
        "  batchUnrestrictedQty: hasBatch ? after(bb, \"unrestricted_qty\") : 0, batchReservedQty: hasBatch ? after(bb, \"reserved_qty\") : 0,\n"
        "  batchBlockedQty: hasBatch ? after(bb, \"block_qty\") : 0, batchQualityInspectionQty: hasBatch ? after(bb, \"qualityinsp_qty\") : 0,\n"
        "  batchInTransitQty: hasBatch ? after(bb, \"intransit_qty\") : 0, batchBalanceQty: hasBatch ? total(bb) : 0,\n"
        "  balId: s((bal || {}).id), bbId: s((bb || {}).id),\n};",
        [("route", "string")] + [(q, "number") for q in qty_out] + [("balId", "string"), ("bbId", "string")])

    vf2 = sql_node("sql_node_CLvf2", "Classic lock: the lock row right before the balance write", LOCK_ROW_SQL, LOCK_ROW_OUT)
    vf2c = code_node(
        "code_node_CLvf2c", "Classic lock: still the owner?",
        "// the owner is read again right before the write: a stale second take could have overwritten it after the first check\n"
        + S + FIRST + "const op = s([{{node:code_node_CLkey.data.op}}][0]);\n"
        "const lk = first([{{node:sql_node_CLvf2.data}}][0]);\n"
        "return { route: Number(lk.free_token) === 0 && s(lk.owner_operation_id) === op ? \"OK\" : \"LOST\" };",
        [("route", "string")])

    upd_bb_old = find(doc, "update_node_1ggwRzMs")
    upd_b_old = find(doc, "update_node_q6uzhWpP")
    calc_map = {"code_node_mQnskse9": "code_node_CLcalc", "get_node_GjRiq3dT": "get_node_CLbb", "get_node_uaq6Z1ej": "get_node_CLbal"}
    upd_bb = clone_tree(upd_bb_old, "", dict(calc_map, update_node_1ggwRzMs="update_node_CLwbb"))
    upd_b = clone_tree(upd_b_old, "", dict(calc_map, update_node_q6uzhWpP="update_node_CLwb"))
    if_batch_old = find(doc, "if_0FIiDnWC")
    if_batch = copy.deepcopy(if_batch_old)
    if_batch["id"] = "if_CLbatch"
    for b, sfx in zip(if_batch["blocks"], ("T", "F")):
        b["id"] = "ifBlock_CLbatch" + sfx
    for leaf in if_batch["data"].get("filter", {}).get("list", []):
        leaf["id"], leaf["parentId"] = fid(), fid()
    if_batch["blocks"][0]["blocks"] = [upd_bb]
    if_batch["blocks"][1]["blocks"] = []

    mv = clone_tree(find(doc, "add_node_y4X550kY"), "", {"add_node_y4X550kY": "add_node_CLmv"})
    tail = clone_tree(find(doc, "if_kagiTOhx"), "CL", {"add_node_y4X550kY": "add_node_CLmv"})

    busy_ret = lambda nid: return_node(nid, [("code", "value", "400"), ("errorMessage", "value", BUSY_MSG)])
    locked = [
        sql_node("sql_node_CLlk0", "Classic lock: the key's lock row (seed check)", LOCK_ROW_SQL, LOCK_ROW_OUT),
        seed_plan,
        if_expr("if_CLseed", "IF the key has no lock row: seed it (INVENTORY_LOCK_SEED)",
                "'{{node:code_node_CLseed.data.needSeed}}' == 'YES'",
                [workflow_node("workflow_node_CLseed", "Classic lock: INVENTORY_LOCK_SEED (free_token 1)", SEED_WF,
                               [("organization_id", "{{node:code_node_CLkey.data.org}}"),
                                ("rows", "{{node:code_node_CLkey.data.seedRows}}")])]),
        sql_node("sql_node_CLlk1", "Classic lock: the key's lock row", LOCK_ROW_SQL, LOCK_ROW_OUT),
        claim,
        if_expr("if_CLbusy", "IF the key is held: answer 400 busy, take nothing",
                "'{{node:code_node_CLclaim.data.route}}' != 'TAKE'", [busy_ret("return_node_CLbusy")]),
        take,
        par,
        calc,
        if_expr("if_CLlost", "IF the take did not land (another owner): answer 400 busy, release nothing",
                "'{{node:code_node_CLcalc.data.route}}' == 'LOST'", [busy_ret("return_node_CLlost")]),
        if_expr("if_CLshort", "IF the bucket is short under the key: release, answer 400",
                "'{{node:code_node_CLcalc.data.route}}' == 'SHORT'",
                release_block("S", take_tpl) + [return_node("return_node_CLshort", [("code", "value", "400"),
                                                                                    ("errorMessage", "value", "Insufficient quantity")])]),
        vf2,
        vf2c,
        if_expr("if_CLlost2", "IF the owner changed after the take: answer 400 busy, write and release nothing",
                "'{{node:code_node_CLvf2c.data.route}}' != 'OK'", [busy_ret("return_node_CLlost2")]),
        if_batch,
        upd_b,
    ] + release_block("W", take_tpl) + [mv, tail]

    if_on = if_expr("if_CLon", "IF the classic lock is on: the locked path (it returns; OFF falls through below)",
                    "'{{node:code_node_CLkey.data.on}}' == 'YES'", locked)
    holder = parent_list(doc, "code_node_MQ0uNcoG")
    at = [i for i, x in enumerate(holder) if x.get("id") == "code_node_MQ0uNcoG"][0]
    holder[at + 1:at + 1] = [key, if_on]
    return doc


def check(doc):
    ids = []
    walk(doc, lambda x: ids.append(x["id"]) if isinstance(x.get("id"), str) else None)
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        sys.exit("duplicate ids: " + ", ".join(dup))
    # every new JS body must parse once its placeholders are filled
    bodies = []
    walk(doc, lambda x: bodies.append((x["id"], x["data"]["script"]["code"]))
         if x.get("type") == "code-node" and "CL" in x.get("id", "") else None)
    for nid, code in bodies:
        js = re.sub(r"\{\{[^}]+\}\}", "null", code)
        r = subprocess.run(["node", "-e", "new Function(process.argv[1])", js], capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"{nid}: JS does not parse\n{r.stderr[:600]}")
    print(f"ok: {len(ids)} ids unique, {len(bodies)} new code nodes parse")


if __name__ == "__main__":
    on = "--on" in sys.argv
    doc = build(on)
    check(doc)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print(("ON" if on else "OFF") + " build -> " + os.path.relpath(OUT, os.getcwd()))
