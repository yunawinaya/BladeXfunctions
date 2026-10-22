#!/usr/bin/env python3
"""MIN-01 RF-01: the classic GD children SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW take the engine's ITEM|<material>|<bin> token.

Same protocol, switch and MIN01-TEST hook as build_subtract_lock.py / build_add_lock.py (engine owner 3f agreed, 22 Oct).
The _NEW copies write in one parallel block; the locked path splits it in two clones:
  write block (balance + batch balance branches, under the key) -> release -> post block (movement + costing branches) -> return.
SUBTRACT_NEW inserts after `calculatedUnitPrice & Quantities` (code_node_mQnskse9) and recomputes under the key exactly as
SUBTRACT_INVENTORY's locked path does; ADD_NEW inserts after `Balance Data` (code_node_aFO7peip), whose balance branches read
their own rows, so they run unchanged under the key.

Usage: python3 -I build_new_lock.py sub|add [--on]
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_subtract_lock as L  # noqa: E402

CFG = {
    "sub": {"base": "SUBTRACT_INVENTORY_NEW.live.json", "out": "SUBTRACT_INVENTORY_NEW.json", "after": "code_node_mQnskse9",
            "par": "condition_all_oAcIgfd5", "write": ["condition_all_node_item_szHLq6dt", "condition_all_item_DYwW5pTm"],
            "post": ["condition_all_node_item_uE200yRc", "condition_all_item_tBMCzgiK"], "ret": "return_node_V7eq9lyR"},
    "add": {"base": "ADD_INVENTORY_NEW.live.json", "out": "ADD_INVENTORY_NEW.json", "after": "code_node_aFO7peip",
            "par": "condition_all_fYtpuqRQ", "write": ["condition_all_node_item_twtdrF9p", "condition_all_node_item_ZoiHXRYH"],
            "post": ["condition_all_item_rrMgHTjc", "condition_all_item_qPjWUusT"], "ret": "return_node_ealaqKXT"},
}


def key_node(on):
    return L.code_node(
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


def busy_ret(nid):
    return L.return_node(nid, [("code", "value", "400"), ("errorMessage", "value", L.BUSY_MSG)])


def acquire(take_tpl):
    """Seed if missing, read, refuse busy, take. Same nodes as the SUBTRACT_INVENTORY / ADD_INVENTORY locked paths."""
    return [
        L.sql_node("sql_node_CLlk0", "Classic lock: the key's lock row (seed check)", L.LOCK_ROW_SQL, L.LOCK_ROW_OUT),
        L.code_node("code_node_CLseed", "Classic lock: does the key have a lock row?",
                    L.S + L.FIRST + "const r = first([{{node:sql_node_CLlk0.data}}][0]);\n"
                    "return { needSeed: /^[0-9]{1,20}$/.test(s(r.id)) ? \"NO\" : \"YES\" };",
                    [("needSeed", "string")]),
        L.if_expr("if_CLseed", "IF the key has no lock row: seed it (INVENTORY_LOCK_SEED)",
                  "'{{node:code_node_CLseed.data.needSeed}}' == 'YES'",
                  [L.workflow_node("workflow_node_CLseed", "Classic lock: INVENTORY_LOCK_SEED (free_token 1)", L.SEED_WF,
                                   [("organization_id", "{{node:code_node_CLkey.data.org}}"),
                                    ("rows", "{{node:code_node_CLkey.data.seedRows}}")])]),
        L.sql_node("sql_node_CLlk1", "Classic lock: the key's lock row", L.LOCK_ROW_SQL, L.LOCK_ROW_OUT),
        L.code_node("code_node_CLclaim", "Classic lock: take, or busy",
                    "// token 1 = free; token 0 = held by an engine run or another classic call (or half released); no row = busy (the seed lost)\n"
                    + L.S + L.FIRST + "const r = first([{{node:sql_node_CLlk1.data}}][0]);\n"
                    "let route = \"TAKE\";\n"
                    "if (!/^[0-9]{1,20}$/.test(s(r.id)) || Number(r.free_token) !== 1) route = \"BUSY\";\n"
                    "return { route: route, id: s(r.id), claimedAt: s(r.db_now) };",
                    [("route", "string"), ("id", "string"), ("claimedAt", "string")]),
        L.if_expr("if_CLbusy", "IF the key is held: answer 400 busy, take nothing",
                  "'{{node:code_node_CLclaim.data.route}}' != 'TAKE'", [busy_ret("return_node_CLbusy")]),
        L.atomic_node(take_tpl, "atomic_count_node_CLtake", "Classic lock: take the token AND record the owner (one atomic node)",
                      "{{node:code_node_CLclaim.data.id}}",
                      [("free_token", "formula", "minus({{node:code_node_CLkey.data.one}})"),
                       ("owner_operation_id", "field", "{{node:code_node_CLkey.data.op}}"),
                       ("claimed_at", "field", "{{node:code_node_CLclaim.data.claimedAt}}")]),
    ]


def split_block(doc, cfg, keep, suffix, new_id, extra_map):
    par = copy.deepcopy(L.find(doc, cfg["par"]))
    par["blocks"] = [b for b in par["blocks"] if b["id"] in keep]
    if [b["id"] for b in par["blocks"]] != keep:
        sys.exit(f"{cfg['par']}: expected items {keep}")
    par = L.clone_tree(par, suffix, dict(extra_map, **{cfg["par"]: new_id}))
    return par


def owner_check(nid_sql, nid_code, title):
    return [
        L.sql_node(nid_sql, "Classic lock: the lock row (owner check)", L.LOCK_ROW_SQL, L.LOCK_ROW_OUT),
        L.code_node(nid_code, title,
                    L.S + L.FIRST + "const op = s([{{node:code_node_CLkey.data.op}}][0]);\n"
                    f"const lk = first([{{{{node:{nid_sql}.data}}}}][0]);\n"
                    "return { route: Number(lk.free_token) === 0 && s(lk.owner_operation_id) === op ? \"OK\" : \"LOST\" };",
                    [("route", "string")]),
    ]


def build_sub(doc, cfg, take_tpl, on):
    par_tpl = L.find(doc, "condition_all_5ak80NEZ")
    bal_get = L.clone_tree(L.find(doc, "get_node_uaq6Z1ej"), "", {"get_node_uaq6Z1ej": "get_node_CLbal"})
    bb_get = L.clone_tree(L.find(doc, "get_node_GjRiq3dT"), "", {"get_node_GjRiq3dT": "get_node_CLbb"})
    par = copy.deepcopy(par_tpl)
    par["id"] = "condition_all_CLread"
    par["data"]["title"] = "Under the key: the lock row and the balance rows"
    item_bal, item_bb = copy.deepcopy(par["blocks"][0]), copy.deepcopy(par["blocks"][1])
    item_lk = copy.deepcopy(item_bal)
    for it, nid, title, blocks in (
        (item_lk, "condition_all_node_item_CLrLk", "Lock row", [L.sql_node("sql_node_CLvf1", "Classic lock: the lock row after the take", L.LOCK_ROW_SQL, L.LOCK_ROW_OUT)]),
        (item_bal, "condition_all_node_item_CLrIb", "Item Balance", [bal_get]),
        (item_bb, "condition_all_node_item_CLrBb", "Item Batch Balance", [bb_get]),
    ):
        it["id"] = nid
        it["data"]["title"] = it["data"]["nodeName"] = it["data"]["name"] = title
        for leaf in it["data"]["filter"]["list"]:
            leaf["id"], leaf["parentId"] = L.fid(), L.fid()
        it["blocks"] = blocks
    par["blocks"] = [item_lk, item_bal, item_bb]

    # recompute under the key: the code of SUBTRACT_INVENTORY's locked path (built there, reused verbatim)
    calc_src = L.find(L.build(False), "code_node_CLcalc")
    calc = copy.deepcopy(calc_src)
    for r in calc["data"]["response_json"]:
        r["key"] = L.key8()

    write = split_block(doc, cfg, cfg["write"], "CLw", "condition_all_CLwrite",
                        {"code_node_mQnskse9": "code_node_CLcalc", "get_node_uaq6Z1ej": "get_node_CLbal", "get_node_GjRiq3dT": "get_node_CLbb"})
    post = split_block(doc, cfg, cfg["post"], "CLp", "condition_all_CLpost", {})
    ret = L.clone_tree(L.find(doc, cfg["ret"]), "CLp", {})
    return acquire(take_tpl) + [
        par,
        calc,
        L.if_expr("if_CLlost", "IF the take did not land (another owner): answer 400 busy, release nothing",
                  "'{{node:code_node_CLcalc.data.route}}' == 'LOST'", [busy_ret("return_node_CLlost")]),
        L.if_expr("if_CLshort", "IF the bucket is short under the key: release, answer 400",
                  "'{{node:code_node_CLcalc.data.route}}' == 'SHORT'",
                  L.release_block("S", take_tpl) + [L.return_node("return_node_CLshort", [("code", "value", "400"),
                                                                                      ("errorMessage", "value", "Insufficient quantity")])]),
    ] + owner_check("sql_node_CLvf2", "code_node_CLvf2c", "Classic lock: still the owner?") + [
        L.if_expr("if_CLlost2", "IF the owner changed after the take: answer 400 busy, write and release nothing",
                  "'{{node:code_node_CLvf2c.data.route}}' != 'OK'", [busy_ret("return_node_CLlost2")]),
        write,
    ] + L.release_block("W", take_tpl) + [post, ret]


def build_add(doc, cfg, take_tpl, on):
    write = split_block(doc, cfg, cfg["write"], "CLw", "condition_all_CLwrite", {})
    post = split_block(doc, cfg, cfg["post"], "CLp", "condition_all_CLpost", {})
    ret = L.clone_tree(L.find(doc, cfg["ret"]), "CLp", {})
    return acquire(take_tpl) + owner_check("sql_node_CLvf1", "code_node_CLvf1c", "Classic lock: did the take land?") + [
        L.if_expr("if_CLlost", "IF the take did not land (another owner): answer 400 busy, release nothing",
                  "'{{node:code_node_CLvf1c.data.route}}' != 'OK'", [busy_ret("return_node_CLlost")]),
        write,
    ] + L.release_block("W", take_tpl) + [post, ret]


def build(which, on):
    cfg = CFG[which]
    doc = json.load(open(os.path.join(L.ROOT, "base", cfg["base"]), encoding="utf-8"))
    tok = json.load(open(L.TOKENS, encoding="utf-8"))
    take_tpl = L.find(tok, "atomic_count_node_EBncppM3")
    locked = (build_sub if which == "sub" else build_add)(doc, cfg, take_tpl, on)
    holder = L.parent_list(doc, cfg["after"])
    at = [i for i, x in enumerate(holder) if x.get("id") == cfg["after"]][0]
    if holder[at + 1].get("id") != cfg["par"]:
        sys.exit(f"{cfg['after']} is no longer followed by {cfg['par']}: the base changed")
    if_on = L.if_expr("if_CLon", "IF the classic lock is on: the locked path (it returns; OFF falls through below)",
                      "'{{node:code_node_CLkey.data.on}}' == 'YES'", locked)
    holder[at + 1:at + 1] = [key_node(on), if_on]
    return doc


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which not in CFG:
        sys.exit("usage: build_new_lock.py sub|add [--on]")
    on = "--on" in sys.argv
    doc = build(which, on)
    L.check(doc)
    out = os.path.join(L.ROOT, "out", CFG[which]["out"])
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print(("ON" if on else "OFF") + " build -> " + os.path.relpath(out, os.getcwd()))
