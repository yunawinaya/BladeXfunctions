#!/usr/bin/env python3
"""MIN-01 ON blocker 1, the pair entry: one SUBTRACT_INVENTORY call does a move (SUBTRACT here, ADD there) holding both ITEM keys.

  add  : ADD_INVENTORY v67 (out/q_ADD_INVENTORY.json) -> out/p_ADD_INVENTORY.json. New optional input cl_hold_op: when the key is
         token 0 owned by that operation (the parent pair), the claim routes HELD, the take is skipped, the owner checks use the
         parent's operation, and the release is skipped (the parent releases).
  sub  : SUBTRACT_INVENTORY v62 (out/q_SUBTRACT_INVENTORY.json) -> out/p_SUBTRACT_INVENTORY.json. New optional input pair_add
         (the ADD half: location_id, inventory_category, batch_id, plant_id, handling_unit_id, batch_number, dates, remarks,
         transaction_type). Locked path: both keys taken in key order (two pair calls cannot deadlock); busy on either answers 400
         before any write; after the balance write, ADD_INVENTORY runs nested with cl_hold_op; both keys released (owner-checked);
         then the movement row and costing as before. OFF path: the unlocked subtract, then ADD_INVENTORY unlocked, so a caller can
         adopt pair_add before the switch is ON.
Nested-child test (22 Oct 16:46): a child ADD writing the same item_balance row inside the parent's locked run neither blocks nor
reads stale (update nodes commit per node). Without HELD, the child would queue its take behind its own parent (deadlock).

Usage: python3 -I build_pair.py add|sub
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_subtract_lock as L  # noqa: E402

ADD_WF = {"source": "ADD_INVENTORY:Workflow:2012005532688723970", "collectionId": "2012005532688723970"}


def patch(node, old, new):
    code = node["data"]["script"]["code"]
    if code.count(old) != 1:
        sys.exit(f"{node['id']}: expected text not found: {old[:70]!r}")
    node["data"]["script"]["code"] = code.replace(old, new)


def add_output(node, name, bson="string"):
    node["data"]["response_json"].append({"key": L.key8(), "name": name, "title": name, "description": "", "bsonType": bson,
                                          "isExpand": False})


def add_request(doc, name, title, bson):
    if any(r["name"] == name for r in doc["request_json"]):
        sys.exit(f"request {name} exists already")
    doc["request_json"].append({"key": L.key8(), "name": name, "title": title, "description": "", "bsonType": bson, "isExpand": False})


def wrap_take(doc, take_id, wrapper_id, claim_id):
    """Run the take only when the claim routed TAKE (a HELD pair half takes nothing)."""
    holder = L.parent_list(doc, take_id)
    at = [i for i, x in enumerate(holder) if x.get("id") == take_id][0]
    take = holder[at]
    holder[at] = L.if_expr(wrapper_id, "IF the claim routed TAKE (a pair's held half takes nothing)",
                           f"'{{{{node:{claim_id}.data.route}}}}' == 'TAKE'", [take])


HELD_RULE = (
    '// a pair\'s second half (cl_hold_op): the parent call holds this key under its own operation; take and release nothing\n'
    'if ([{{node:code_node_CLkey.data.held}}][0] === "YES") route = Number(r.free_token) === 0 && s(r.owner_operation_id) === s([{{node:code_node_CLkey.data.op}}][0]) ? "HELD" : "BUSY";\n'
    "return { route: route, id: s(r.id), claimedAt: s(r.db_now) };")


def build_add():
    doc = json.load(open(os.path.join(L.ROOT, "out", "q_ADD_INVENTORY.json"), encoding="utf-8"))
    add_request(doc, "cl_hold_op", "Classic lock: held by (pair)", "string")
    key = L.find(doc, "code_node_CLkey")
    patch(key, 'const trx = s([{{workflowparams:trx_no}}][0]);\n',
          'const trx = s([{{workflowparams:trx_no}}][0]);\n'
          '// a pair (SUBTRACT_INVENTORY pair_add) already holds this key under its operation: write under it\n'
          'const holdOp = s([{{workflowparams:cl_hold_op}}][0]);\n'
          'const held = /^CL\\|[0-9a-fA-F]{16}$/.test(holdOp);\n')
    patch(key, 'const wanted = CL_LOCK_ENABLED || trx.indexOf("MIN01-TEST") === 0;',
          'const wanted = CL_LOCK_ENABLED || held || trx.indexOf("MIN01-TEST") === 0;')
    patch(key, 'op: "CL|" + nonce,', 'op: held ? holdOp : "CL|" + nonce, held: held ? "YES" : "NO",')
    add_output(key, "held")
    claim = L.find(doc, "code_node_CLclaim")
    patch(claim, "return { route: route, id: s(r.id), claimedAt: s(r.db_now) };", HELD_RULE)
    busy = L.find(doc, "if_CLbusy")
    busy["data"]["expression"]["code"] = ("'{{node:code_node_CLclaim.data.route}}' != 'TAKE' && "
                                          "'{{node:code_node_CLclaim.data.route}}' != 'HELD'")
    busy["data"]["title"] = busy["data"]["nodeName"] = busy["data"]["name"] = "IF the key is held by someone else: answer 400 busy, take nothing"
    wrap_take(doc, "atomic_count_node_CLtake", "if_CLtakeIf", "code_node_CLclaim")
    rp = L.find(doc, "code_node_CLrpW")
    patch(rp, 'return { needRelease: mine ? "YES" : "NO",',
          '// a pair\'s held half leaves the release to the parent\n'
          'const held = [{{node:code_node_CLkey.data.held}}][0] === "YES";\n'
          'return { needRelease: mine && !held ? "YES" : "NO",')
    return doc


PAIR_IN_OUT = [("plant_id", "string"), ("location_id", "string"), ("inventory_category", "string"), ("batch_id", "string"),
               ("handling_unit_id", "string"), ("batch_number", "string"), ("manufacturing_date", "string"),
               ("expired_date", "string"), ("transaction_type", "string"), ("remark", "string"), ("remark2", "string"),
               ("remark3", "string")]


def pair_call(nid, title, hold_op):
    body = [("plant_id", "{{node:code_node_CLpairIn.data.plant_id}}"), ("organization_id", "{{workflowparams:organization_id}}"),
            ("material_id", "{{workflowparams:material_id}}"), ("quantity", "{{workflowparams:quantity}}"),
            ("material_uom", "{{workflowparams:material_uom}}"),
            ("unit_price", "{{node:code_node_mQnskse9.data.calculatedUnitPrice}}"),
            ("transaction_type", "{{node:code_node_CLpairIn.data.transaction_type}}"), ("trx_no", "{{workflowparams:trx_no}}"),
            ("parent_trx_no", "{{workflowparams:parent_trx_no}}"),
            ("inventory_category", "{{node:code_node_CLpairIn.data.inventory_category}}"),
            ("location_id", "{{node:code_node_CLpairIn.data.location_id}}"), ("batch_id", "{{node:code_node_CLpairIn.data.batch_id}}"),
            ("doc_date", "{{workflowparams:doc_date}}"),
            ("manufacturing_date", "{{node:code_node_CLpairIn.data.manufacturing_date}}"),
            ("expired_date", "{{node:code_node_CLpairIn.data.expired_date}}"), ("index", "{{workflowparams:index}}"),
            ("po_quantity", "0"), ("po_amount", "0"), ("exchange_rate", "1"),
            ("itemData", "{{node:code_node_TC1cqaOy.data.itemData}}"),
            ("batch_number", "{{node:code_node_CLpairIn.data.batch_number}}"), ("remark", "{{node:code_node_CLpairIn.data.remark}}"),
            ("remark2", "{{node:code_node_CLpairIn.data.remark2}}"), ("remark3", "{{node:code_node_CLpairIn.data.remark3}}"),
            ("isMovingInv", "{{workflowparams:isMovingInv}}"),
            ("handling_unit_id", "{{node:code_node_CLpairIn.data.handling_unit_id}}"), ("cl_hold_op", hold_op)]
    return L.workflow_node(nid, title, ADD_WF, body)


def pair_fail(nid, call_id, release):
    ret = L.return_node(nid + "R", [("code", "value", "400"), ("errorMessage", "field", f"{{{{node:{call_id}.data.errorMessage}}}}")])
    return L.if_expr(nid, "IF the ADD half failed: answer 400 with its message", f"'{{{{node:{call_id}.data.code}}}}' != '200'",
                     release + [ret])


def key2_sql(tag):
    return L.LOCK_ROW_SQL.replace("{{node:code_node_CLkey.data.key}}", "{{node:code_node_CLkey.data.key2}}")


def release_both(tag, take_tpl):
    """Release key 1, and key 2 when the call is a pair over two keys; each release only gives back a row this call owns."""
    second = []
    for n in L.release_block(tag + "2", take_tpl):
        second.append(n)
    second[0]["data"]["script"]["code"] = key2_sql(tag)
    return L.release_block(tag, take_tpl) + [
        L.if_expr(f"if_CLk2r{tag}", "IF a pair over two keys: give the second key back too",
                  "'{{node:code_node_CLkey.data.key2}}' != ''", second)]


def build_sub():
    doc = json.load(open(os.path.join(L.ROOT, "out", "q_SUBTRACT_INVENTORY.json"), encoding="utf-8"))
    tok = json.load(open(L.TOKENS, encoding="utf-8"))
    take_tpl = L.find(tok, "atomic_count_node_EBncppM3")
    add_request(doc, "pair_add", "Pair: the ADD half (a move)", "any")

    key = L.find(doc, "code_node_CLkey")
    patch(key, 'const trx = s([{{workflowparams:trx_no}}][0]);\n',
          'const trx = s([{{workflowparams:trx_no}}][0]);\n'
          '// pair_add (a move): both ITEM keys are taken in key order and ADD_INVENTORY runs under them (cl_hold_op)\n'
          'let pair = [{{workflowparams:pair_add}}][0];\n'
          'if (typeof pair === "string") { try { pair = JSON.parse(pair); } catch (e) { pair = null; } }\n'
          'const isPair = !!pair && typeof pair === "object" && !Array.isArray(pair);\n'
          'const pairBin = isPair ? s(pair.location_id) || s([{{workflowparams:location_id}}][0]) : "";\n')
    patch(key, '/^[0-9]{1,20}$/.test(tenant);\n', '/^[0-9]{1,20}$/.test(tenant) && (!isPair || /^[0-9]{1,20}$/.test(pairBin));\n')
    patch(key, 'const key = "ITEM|" + mat + "|" + bin;\n'
               'return { on: wanted && ok ? "YES" : "NO", key: key, op: "CL|" + nonce, org: org, tenant: tenant, one: 1, seedRows: [{ lock_key: key }] };',
          'const own = "ITEM|" + mat + "|" + bin;\n'
          'const other = isPair ? "ITEM|" + mat + "|" + pairBin : "";\n'
          'const keys = [own].concat(other && other !== own ? [other] : []).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));\n'
          'return { on: wanted && ok ? "YES" : "NO", key: keys[0], key2: keys[1] || "", pair: isPair ? "YES" : "NO", op: "CL|" + nonce,\n'
          '  org: org, tenant: tenant, one: 1, seedRows: [{ lock_key: keys[0] }], seedRows2: keys[1] ? [{ lock_key: keys[1] }] : [] };')
    for n, t in (("key2", "string"), ("pair", "string"), ("seedRows2", "array")):
        add_output(key, n, t)

    pair_in = L.code_node(
        "code_node_CLpairIn", "Pair: the ADD half's inputs",
        "// the ADD half of a move: pair_add's fields over this call's own (same material, quantity and unit; unit price = this subtract's)\n"
        + L.S +
        "let pair = [{{workflowparams:pair_add}}][0];\n"
        "if (typeof pair === \"string\") { try { pair = JSON.parse(pair); } catch (e) { pair = null; } }\n"
        "const p = pair && typeof pair === \"object\" && !Array.isArray(pair) ? pair : {};\n"
        "const own = (k, v) => (p[k] !== undefined && p[k] !== null && s(p[k]) !== \"\" ? s(p[k]) : s(v));\n"
        "const has = (k) => Object.prototype.hasOwnProperty.call(p, k);\n"
        "return {\n"
        "  plant_id: own(\"plant_id\", [{{workflowparams:plant_id}}][0]),\n"
        "  location_id: own(\"location_id\", [{{workflowparams:location_id}}][0]),\n"
        "  inventory_category: own(\"inventory_category\", [{{workflowparams:inventory_category}}][0]),\n"
        "  batch_id: has(\"batch_id\") ? s(p.batch_id) : s([{{workflowparams:batch_id}}][0]),\n"
        "  handling_unit_id: has(\"handling_unit_id\") ? s(p.handling_unit_id) : s([{{workflowparams:handling_unit_id}}][0]),\n"
        "  batch_number: s(p.batch_number),\n"
        "  manufacturing_date: own(\"manufacturing_date\", [{{node:code_node_DUBS9GZF.data.manufacturingDate}}][0]),\n"
        "  expired_date: own(\"expired_date\", [{{node:code_node_DUBS9GZF.data.expiredDate}}][0]),\n"
        "  transaction_type: own(\"transaction_type\", [{{workflowparams:transaction_type}}][0]),\n"
        "  remark: s(p.remark), remark2: s(p.remark2), remark3: s(p.remark3),\n};",
        PAIR_IN_OUT)
    holder = L.parent_list(doc, "code_node_CLkey")
    at = [i for i, x in enumerate(holder) if x.get("id") == "code_node_CLkey"][0]
    holder[at + 1:at + 1] = [pair_in]

    # second key: seed, claim, take (key order: code_node_CLkey sorted them), right after the first take
    claim2 = L.code_node(
        "code_node_CLclaimb", "Pair: take the second key, or busy",
        "// the second key of a pair: the same rule as the first (classic CL| holders are queued behind, anything else is busy)\n"
        + L.S + L.FIRST + "const r = first([{{node:sql_node_CLlk1b.data}}][0]);\n"
        "let route = \"TAKE\";\n"
        "const classic = Number(r.free_token) === 0 && s(r.owner_operation_id).indexOf(\"CL|\") === 0;\n"
        "if (!/^[0-9]{1,20}$/.test(s(r.id)) || (Number(r.free_token) !== 1 && !classic)) route = \"BUSY\";\n"
        "return { route: route, id: s(r.id), claimedAt: s(r.db_now) };",
        [("route", "string"), ("id", "string"), ("claimedAt", "string")])
    seed2 = L.code_node("code_node_CLseedb", "Pair: does the second key have a lock row?",
                        L.S + L.FIRST + "const r = first([{{node:sql_node_CLlk0b.data}}][0]);\n"
                        "return { needSeed: /^[0-9]{1,20}$/.test(s(r.id)) ? \"NO\" : \"YES\" };", [("needSeed", "string")])
    busy_ret = lambda nid: L.return_node(nid, [("code", "value", "400"), ("errorMessage", "value", L.BUSY_MSG)])
    second = L.if_expr("if_CLk2", "IF a pair over two keys: take the second key too",
                       "'{{node:code_node_CLkey.data.key2}}' != ''", [
                           L.sql_node("sql_node_CLlk0b", "Pair: the second key's lock row (seed check)", key2_sql(""), L.LOCK_ROW_OUT),
                           seed2,
                           L.if_expr("if_CLseedb", "IF the second key has no lock row: seed it",
                                     "'{{node:code_node_CLseedb.data.needSeed}}' == 'YES'",
                                     [L.workflow_node("workflow_node_CLseedb", "Pair: INVENTORY_LOCK_SEED (second key)", L.SEED_WF,
                                                      [("organization_id", "{{node:code_node_CLkey.data.org}}"),
                                                       ("rows", "{{node:code_node_CLkey.data.seedRows2}}")])]),
                           L.sql_node("sql_node_CLlk1b", "Pair: the second key's lock row", key2_sql(""), L.LOCK_ROW_OUT),
                           claim2,
                           L.if_expr("if_CLbusyb", "IF the second key is held by an engine run: give the first back, answer 400 busy",
                                     "'{{node:code_node_CLclaimb.data.route}}' != 'TAKE'",
                                     L.release_block("B", take_tpl) + [busy_ret("return_node_CLbusyb")]),
                           L.atomic_node(take_tpl, "atomic_count_node_CLtakeb", "Pair: take the second key AND record the owner",
                                         "{{node:code_node_CLclaimb.data.id}}",
                                         [("free_token", "formula", "minus({{node:code_node_CLkey.data.one}})"),
                                          ("owner_operation_id", "field", "{{node:code_node_CLkey.data.op}}"),
                                          ("claimed_at", "field", "{{node:code_node_CLclaimb.data.claimedAt}}")]),
                       ])
    holder = L.parent_list(doc, "atomic_count_node_CLtake")
    at = [i for i, x in enumerate(holder) if x.get("id") == "atomic_count_node_CLtake"][0]
    holder[at + 1:at + 1] = [second]

    # the reads under the keys: the second key's lock row too; every owner check covers both keys
    par = L.find(doc, "condition_all_CLread")
    lk_item = copy.deepcopy(par["blocks"][0])
    lk_item["id"] = "condition_all_node_item_CLrLk2"
    lk_item["data"]["title"] = lk_item["data"]["nodeName"] = lk_item["data"]["name"] = "Second lock row"
    for leaf in lk_item["data"]["filter"]["list"]:
        leaf["id"], leaf["parentId"] = L.fid(), L.fid()
    lk_item["blocks"] = [L.sql_node("sql_node_CLvf1b", "Pair: the second key's lock row after the take", key2_sql(""), L.LOCK_ROW_OUT)]
    par["blocks"].append(lk_item)
    both = ('const k2 = s([{{node:code_node_CLkey.data.key2}}][0]);\n'
            'const own2 = (raw) => { const r = first(raw); return Number(r.free_token) === 0 && s(r.owner_operation_id) === op; };\n')
    calc = L.find(doc, "code_node_CLcalc")
    patch(calc, 'const held = Number(lk.free_token) === 0 && s(lk.owner_operation_id) === op;\n',
          both + 'const held = Number(lk.free_token) === 0 && s(lk.owner_operation_id) === op && (!k2 || own2([{{node:sql_node_CLvf1b.data}}][0]));\n')
    vf2b = L.sql_node("sql_node_CLvf2b", "Pair: the second key's lock row right before the balance write", key2_sql(""), L.LOCK_ROW_OUT)
    holder = L.parent_list(doc, "sql_node_CLvf2")
    at = [i for i, x in enumerate(holder) if x.get("id") == "sql_node_CLvf2"][0]
    holder[at + 1:at + 1] = [vf2b]
    vf2c = L.find(doc, "code_node_CLvf2c")
    patch(vf2c, 'return { route: Number(lk.free_token) === 0 && s(lk.owner_operation_id) === op ? "OK" : "LOST" };',
          both + 'return { route: Number(lk.free_token) === 0 && s(lk.owner_operation_id) === op && (!k2 || own2([{{node:sql_node_CLvf2b.data}}][0])) ? "OK" : "LOST" };')

    # LOST answers release what this call does own (owner-checked); SHORT and the normal path release both keys
    for if_id, tag in (("if_CLlost", "L1"), ("if_CLlost2", "L2")):
        n = L.find(doc, if_id)
        n["blocks"][0]["blocks"] = release_both(tag, take_tpl) + n["blocks"][0]["blocks"]
    short = L.find(doc, "if_CLshort")
    blocks = short["blocks"][0]["blocks"]
    ret_short = [b for b in blocks if b["id"] == "return_node_CLshort"]
    # the short path already gives key 1 back (release block S); add key 2 before its return
    short["blocks"][0]["blocks"] = [b for b in blocks if b["id"] != "return_node_CLshort"] + [
        L.if_expr("if_CLk2rS", "IF a pair over two keys: give the second key back too", "'{{node:code_node_CLkey.data.key2}}' != ''",
                  [n for n in L.release_block("S2", take_tpl)])] + ret_short
    L.find(doc, "sql_node_CLrlS2")["data"]["script"]["code"] = key2_sql("S2")

    # the ADD half under both keys, then release both (the existing W release gives back key 1)
    holder = L.parent_list(doc, "update_node_CLwb")
    at = [i for i, x in enumerate(holder) if x.get("id") == "update_node_CLwb"][0]
    holder[at + 1:at + 1] = [L.if_expr("if_CLpair", "IF a pair: the ADD half, under both keys (cl_hold_op)",
                                        "'{{node:code_node_CLkey.data.pair}}' == 'YES'", [
                                            pair_call("workflow_node_CLpairAdd", "Pair: ADD_INVENTORY under this call's keys",
                                                      "{{node:code_node_CLkey.data.op}}"),
                                            pair_fail("if_CLpairFail", "workflow_node_CLpairAdd", release_both("P", take_tpl)),
                                        ])]
    rel_w = L.find(doc, "if_CLrelW")
    holder = L.parent_list(doc, "if_CLrelW")
    at = [i for i, x in enumerate(holder) if x.get("id") == "if_CLrelW"][0]
    second_w = L.release_block("W2", take_tpl)
    second_w[0]["data"]["script"]["code"] = key2_sql("W2")
    holder[at + 1:at + 1] = [L.if_expr("if_CLk2rW", "IF a pair over two keys: give the second key back too",
                                        "'{{node:code_node_CLkey.data.key2}}' != ''", second_w)]

    # OFF path: the unlocked subtract, then the ADD half unlocked
    holder = L.parent_list(doc, "update_node_q6uzhWpP")
    at = [i for i, x in enumerate(holder) if x.get("id") == "update_node_q6uzhWpP"][0]
    holder[at + 1:at + 1] = [L.if_expr("if_CLpairOff", "IF a pair (lock off): the ADD half, unlocked",
                                        "'{{node:code_node_CLkey.data.pair}}' == 'YES'", [
                                            pair_call("workflow_node_CLpairAddOff", "Pair: ADD_INVENTORY (unlocked)", ""),
                                            pair_fail("if_CLpairFailOff", "workflow_node_CLpairAddOff", []),
                                        ])]
    return doc


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which not in ("add", "sub"):
        sys.exit("usage: build_pair.py add|sub")
    doc = build_add() if which == "add" else build_sub()
    L.check(doc)
    name = "ADD_INVENTORY" if which == "add" else "SUBTRACT_INVENTORY"
    out = os.path.join(L.ROOT, "out", "p_" + name + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print("-> out/p_" + name + ".json")
