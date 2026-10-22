#!/usr/bin/env python3
"""MIN-01 RF-01: ADD_INVENTORY takes the engine's ITEM|<material>|<bin> token around its balance read-and-write.

Base: scratchpad/min01/base/ADD_INVENTORY.live_v65.json. Output: scratchpad/min01/out/ADD_INVENTORY.json.
Same protocol, switch and MIN01-TEST hook as build_subtract_lock.py. Inserted after `Batch Id` (code_node_GMSJTmJr);
the locked path clones the unlocked tail (suffix CL) in this order: take -> verify -> balance block (batch + item, read,
then update or create) -> release -> movement row -> costing -> Data ID -> return. Adding cannot run short, so there is no
bucket check; a missing balance row is created under the key, so two concurrent first receipts no longer both insert one.

Usage: python3 -I build_add_lock.py [--on]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_subtract_lock as L  # noqa: E402

BASE = os.path.join(L.ROOT, "base", "ADD_INVENTORY.live_v65.json")
OUT = os.path.join(L.ROOT, "out", "ADD_INVENTORY.json")
TAIL = ["add_node_3wRWQCyv", "code_node_aFO7peip", "if_yGhliCKm", "get_node_c4YkI6sb", "if_Cdh5Wv1o", "if_8DGvRrbY",
        "code_node_4y6n6tGm", "return_node_ealaqKXT"]


def build(on):
    doc = json.load(open(BASE, encoding="utf-8"))
    tok = json.load(open(L.TOKENS, encoding="utf-8"))
    take_tpl = L.find(tok, "atomic_count_node_EBncppM3")

    holder = L.parent_list(doc, "code_node_GMSJTmJr")
    at = [i for i, x in enumerate(holder) if x.get("id") == "code_node_GMSJTmJr"][0]
    if [x.get("id") for x in holder[at + 1:]] != TAIL:
        sys.exit("ADD_INVENTORY tail changed since the base: " + ", ".join(x.get("id") for x in holder[at + 1:]))

    # one clone of the whole tail, so references between its nodes stay consistent
    wrapper = {"id": "tmp_wrapper", "type": "tmp", "blocks": [L.copy.deepcopy(x) for x in holder[at + 1:]]}
    wrapper = L.clone_tree(wrapper, "CL", {})
    c = {x["id"][:-2]: x for x in wrapper["blocks"]}

    key = L.code_node(
        "code_node_CLkey", "Classic lock: switch, key and operation",
        "// MIN-01: take the engine's ITEM|<material>|<bin> token around the balance read-and-write (the engine takes ITEM for every\n"
        "// movement of that material + bin). OFF, or ids the lock cannot use: the unlocked path below, as before.\n"
        f"const CL_LOCK_ENABLED = {'true' if on else 'false'};\n"
        + L.S +
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
    seed_plan = L.code_node(
        "code_node_CLseed", "Classic lock: does the key have a lock row?",
        L.S + L.FIRST + "const r = first([{{node:sql_node_CLlk0.data}}][0]);\n"
        "return { needSeed: /^[0-9]{1,20}$/.test(s(r.id)) ? \"NO\" : \"YES\" };",
        [("needSeed", "string")])
    claim = L.code_node(
        "code_node_CLclaim", "Classic lock: take, or busy",
        "// token 1 = free; token 0 = held by an engine run or another classic call (or half released); no row = busy (the seed lost)\n"
        + L.S + L.FIRST + "const r = first([{{node:sql_node_CLlk1.data}}][0]);\n"
        "let route = \"TAKE\";\n"
        "if (!/^[0-9]{1,20}$/.test(s(r.id)) || Number(r.free_token) !== 1) route = \"BUSY\";\n"
        "return { route: route, id: s(r.id), claimedAt: s(r.db_now) };",
        [("route", "string"), ("id", "string"), ("claimedAt", "string")])
    take = L.atomic_node(take_tpl, "atomic_count_node_CLtake", "Classic lock: take the token AND record the owner (one atomic node)",
                         "{{node:code_node_CLclaim.data.id}}",
                         [("free_token", "formula", "minus({{node:code_node_CLkey.data.one}})"),
                          ("owner_operation_id", "field", "{{node:code_node_CLkey.data.op}}"),
                          ("claimed_at", "field", "{{node:code_node_CLclaim.data.claimedAt}}")])
    vf1 = L.sql_node("sql_node_CLvf1", "Classic lock: the lock row after the take", L.LOCK_ROW_SQL, L.LOCK_ROW_OUT)
    vf1c = L.code_node(
        "code_node_CLvf1c", "Classic lock: did the take land?",
        "// the take must read token 0 owned by this call; otherwise another owner holds the key and nothing is written or released\n"
        + L.S + L.FIRST + "const op = s([{{node:code_node_CLkey.data.op}}][0]);\n"
        "const lk = first([{{node:sql_node_CLvf1.data}}][0]);\n"
        "return { route: Number(lk.free_token) === 0 && s(lk.owner_operation_id) === op ? \"OK\" : \"LOST\" };",
        [("route", "string")])
    busy_ret = lambda nid: L.return_node(nid, [("code", "value", "400"), ("errorMessage", "value", L.BUSY_MSG)])

    locked = [
        L.sql_node("sql_node_CLlk0", "Classic lock: the key's lock row (seed check)", L.LOCK_ROW_SQL, L.LOCK_ROW_OUT),
        seed_plan,
        L.if_expr("if_CLseed", "IF the key has no lock row: seed it (INVENTORY_LOCK_SEED)",
                  "'{{node:code_node_CLseed.data.needSeed}}' == 'YES'",
                  [L.workflow_node("workflow_node_CLseed", "Classic lock: INVENTORY_LOCK_SEED (free_token 1)", L.SEED_WF,
                                   [("organization_id", "{{node:code_node_CLkey.data.org}}"),
                                    ("rows", "{{node:code_node_CLkey.data.seedRows}}")])]),
        L.sql_node("sql_node_CLlk1", "Classic lock: the key's lock row", L.LOCK_ROW_SQL, L.LOCK_ROW_OUT),
        claim,
        L.if_expr("if_CLbusy", "IF the key is held: answer 400 busy, take nothing",
                  "'{{node:code_node_CLclaim.data.route}}' != 'TAKE'", [busy_ret("return_node_CLbusy")]),
        take,
        vf1,
        vf1c,
        L.if_expr("if_CLlost", "IF the take did not land (another owner): answer 400 busy, release nothing",
                  "'{{node:code_node_CLvf1c.data.route}}' != 'OK'", [busy_ret("return_node_CLlost")]),
        c["code_node_aFO7peip"],
        c["if_yGhliCKm"],
        c["get_node_c4YkI6sb"],
        c["if_Cdh5Wv1o"],
    ] + L.release_block("W", take_tpl) + [
        c["add_node_3wRWQCyv"],
        c["if_8DGvRrbY"],
        c["code_node_4y6n6tGm"],
        c["return_node_ealaqKXT"],
    ]
    if_on = L.if_expr("if_CLon", "IF the classic lock is on: the locked path (it returns; OFF falls through below)",
                      "'{{node:code_node_CLkey.data.on}}' == 'YES'", locked)
    holder[at + 1:at + 1] = [key, if_on]
    return doc


if __name__ == "__main__":
    on = "--on" in sys.argv
    doc = build(on)
    L.check(doc)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print(("ON" if on else "OFF") + " build -> " + os.path.relpath(OUT, os.getcwd()))
