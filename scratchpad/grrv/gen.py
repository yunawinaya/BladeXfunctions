#!/usr/bin/env python3
"""Build Goods Receiving/RevertCompletedGR/GRrevertCompletedWorkflow.json."""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "Goods Receiving", "RevertCompletedGR", "GRrevertCompletedWorkflow.json")

T = {
    "gr": "Goods Receiving:Table:1901845517592285186",
    "putaway": "Transfer Order Putaway:Table:1937714890958053378",
    "qi": "Basic Inspection Lot:Table:1930547663980482561",
    "transit": "In Transit Detail:Table:2080477944160923650",
    "batch": "Batch:Table:1902719754154655746",
    "batchbal": "Item Batch Balance:Table:1902718803880558594",
    "itembal": "Item Balance:Table:1902698977724317697",
    "fifo": "FIFO Costing History:Table:1902947165008400386",
    "wa": "Weighted Average Costing History:Table:1902948453171433474",
    "hu": "Handling Unit:Table:2036736671686529026",
    "po": "Purchase Order:Table:1902776039445217282",
    "poline": "Item Table(Purchase Order):Table:1939901372270747649",
    "onorder": "On Order Purchase Order:Table:1902627276974047233",
    "item": "Item:Table:1901546842240438273",
    "pi": "Purchase Invoice:Table:1902777443710779394",
}
W = {
    "subtract": "SUBTRACT_INVENTORY:Workflow:2012096660219564034",
    "add": "ADD_INVENTORY:Workflow:2012005532688723970",
    "hu": "HANDLING_UNIT:Workflow:2037062451509002241",
}

_fid = [1790000000000]
def fid():
    _fid[0] += 1
    return _fid[0]

_keys = set()
def rkey(name):
    base = re.sub(r"[^a-z0-9]", "", name.lower())[:8].ljust(8, "0")
    k, n = base, 0
    while k in _keys:
        n += 1
        k = (base[:6] + str(n).zfill(2))
    _keys.add(k)
    return k

def rj(entries):
    """response_json: [(name, bsonType), ...]"""
    return [
        {"key": rkey(n), "name": n, "title": n, "description": "", "bsonType": t,
         "isExpand": False, "children": []}
        for n, t in entries
    ]

def node(nid, ntype, data, blocks=None):
    return {"id": nid, "type": ntype, "data": data, "blocks": blocks or []}

def code(nid, title, script, entries):
    return node(nid, "code-node", {
        "language": "javascript", "code": "", "timeout": 30000,
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "script": {"type": "javascript", "code": script},
        "response_json": rj(entries),
    })

def sql(nid, title, script, entries):
    return node(nid, "sql-node", {
        "database_id": "", "sql": "", "params": {},
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "script": {"type": "sql", "code": script},
        "response_json": rj(entries),
    })

def leaf(prop, operator, value, vtype="field", level=2, parent=None):
    return {"id": fid(), "parentId": parent, "isTop": False, "prop": prop,
            "operator": operator, "valueType": vtype, "value": value,
            "type": "leaf", "level": level, "propLabel": prop, "valueLabel": "",
            "operatorLabel": operator}

def rules(source, leaves):
    """One branch/all wrapper so the conditions actually AND together."""
    cid = source.split(":")[-1]
    if len(leaves) == 1:
        l = dict(leaves[0])
        l["isTop"] = True
        l["level"] = 1
        l["parentId"] = fid()
        return {"source": source, "rules": {"collectionId": cid, "list": [l]}}
    top = fid()
    kids = []
    for l in leaves:
        l = dict(l)
        l["parentId"] = top
        l["level"] = 2
        kids.append(l)
    return {"source": source, "rules": {"collectionId": cid, "list": [
        {"id": top, "parentId": fid(), "isTop": True, "prop": "", "operator": "all",
         "valueType": "", "value": "", "type": "branch", "level": 1, "children": kids}
    ]}}

def get_node(nid, title, source, leaves):
    return node(nid, "get-node", {
        "table_id": rules(source, leaves), "condition": {},
        "title": title, "isValidator": True, "nodeName": title, "name": title})

def search_node(nid, title, source, leaves, limit=1000):
    return node(nid, "search-node", {
        "table_id": rules(source, leaves), "condition": {}, "limit": limit,
        "title": title, "isValidator": True, "nodeName": title, "name": title})

def props(pairs):
    """pairs: [(prop, value, valueType)]"""
    return {"modelName": "", "list": [
        {"prop": p, "valueType": vt, "value": v, "operator": "", "valueLabel": "",
         "propLabel": p} for (p, v, vt) in pairs]}

def update_node(nid, title, source, leaves, pairs):
    return node(nid, "update-node", {
        "table_id": rules(source, leaves), "fields": [], "condition": {},
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "props": props(pairs)})

def wf_node(nid, title, source, pairs):
    cid = source.split(":")[-1]
    return node(nid, "workflow-node", {
        "workflow_id": "", "workflow_name": "", "input_params": {},
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "workflow": {"source": source, "rules": {"collectionId": cid, "list": [
            {"id": fid(), "parentId": fid(), "isTop": True, "prop": "", "operator": "",
             "valueType": "", "value": "", "type": "leaf", "level": 1}]}},
        "remote": True, "remoteType": "innerdatasource",
        "body_params": {"list": [
            {"prop": p, "operator": "", "valueType": vt, "value": v,
             "valueLabel": "", "propLabel": p} for (p, v, vt) in pairs]}})

def ret(nid, title, pairs):
    return node(nid, "return-node", {
        "return_data": {}, "status_code": 200,
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "response_value": {"list": [
            {"prop": p, "operator": "", "valueType": vt, "value": v,
             "valueLabel": "", "propLabel": p} for (p, v, vt) in pairs]},
        "return_raw_data": 0})

def if_expr(nid, title, expr, true_blocks, false_blocks=None):
    # The true block must be non-empty or the compiler crashes, so callers
    # always phrase the condition so the populated branch is the true one.
    assert true_blocks, "empty true block in " + nid
    stem = nid[3:] if nid.startswith("if_") else nid
    return node(nid, "if", {
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "condition_type": "Expression",
        "filter": {"list": [{"id": fid(), "parentId": fid(), "isTop": True, "prop": "",
                             "operator": "", "valueType": "", "value": "", "type": "leaf",
                             "level": 1}]},
        "expression": {"type": "javascript", "code": expr},
    }, [
        node("if_block_" + stem + "True", "ifBlock", {"title": "true"}, true_blocks),
        node("if_block_" + stem + "False", "ifBlock", {"title": "false"}, false_blocks or []),
    ])

def if_rule(nid, title, prop, operator, value, true_blocks, vtype="value"):
    assert true_blocks, "empty true block in " + nid
    stem = nid[3:] if nid.startswith("if_") else nid
    return node(nid, "if", {
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "condition_type": "ConditionRule",
        "filter": {"list": [{"id": fid(), "parentId": fid(), "isTop": True, "prop": prop,
                             "operator": operator, "valueType": vtype, "value": value,
                             "type": "leaf", "level": 1, "propLabel": prop,
                             "valueLabel": "", "operatorLabel": operator}]},
    }, [
        node("if_block_" + stem + "True", "ifBlock", {"title": "true"}, true_blocks),
        node("if_block_" + stem + "False", "ifBlock", {"title": "false"}, []),
    ])

def loop(nid, title, var_code, blocks):
    return node(nid, "loop", {
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "loopType": "Var",
        "loopSeletVar": {"type": "markdown", "code": var_code},
    }, blocks)

def parallel(nid, items):
    """items: [(item_id, title, [nodes])] -> fork/join block"""
    blocks = [node(iid, "condition-all-node-item",
                   {"title": t, "filter": {"list": []}, "expression": {"code": ""}}, ns)
              for (iid, t, ns) in items]
    return node(nid, "condition-all-node", {
        "title": "Parallel Branch", "filter": {"list": []},
        "expression": {"code": ""}, "displayContent": "sdk.form.setCondition"}, blocks)

def body(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read().rstrip() + "\n"

P = "{{node:code_node_grRvParams.data."
R = "{{node:code_node_grRvPrep.data."
B = "{{node:code_node_grRvBuild.data."
L = "{{node:loop_grRvSubtract."

# --------------------------------------------------------------------------
PARAMS = r"""
// Guard everything that is interpolated into an sql-node here, in the code, not
// in the SQL: those nodes substitute text before parsing, so an unguarded value
// is a live injection surface. A guard failure substitutes a value that matches
// no row rather than one that matches everything.
const S = (v) => (v === null || v === undefined ? "" : String(v).trim());
const digits = (v) => (/^[0-9]+$/.test(S(v)) ? S(v) : "0");
const token = (v) => (/^[A-Za-z0-9\/\-_. ]{1,64}$/.test(S(v)) ? S(v) : "");

const grId = S({{workflowparams:gr_id}});
const grNo = S({{workflowparams:gr_no}});
const organizationId = S({{workflowparams:organization_id}});

return {
  grId,
  grNo,
  organizationId,
  grIdSql: digits(grId),
  grNoSql: token(grNo),
  orgSql: token(organizationId),
  hasParams: grId && grNo && organizationId && digits(grId) !== "0" && token(grNo) && token(organizationId) ? 1 : 0,
};
""".lstrip()

SQL_MOVS = """SELECT CAST(m.id AS CHAR) AS id,
       m.transaction_type,
       m.movement,
       m.trx_no,
       m.parent_trx_no,
       CAST(m.item_id AS CHAR) AS item_id,
       CAST(m.plant_id AS CHAR) AS plant_id,
       CAST(m.bin_location_id AS CHAR) AS bin_location_id,
       CAST(m.batch_number_id AS CHAR) AS batch_number_id,
       CAST(m.handling_unit_id AS CHAR) AS handling_unit_id,
       m.inventory_category,
       m.quantity,
       m.base_qty,
       CAST(m.uom_id AS CHAR) AS uom_id,
       CAST(m.base_uom_id AS CHAR) AS base_uom_id,
       m.unit_price,
       m.costing_method_id
FROM inventory_movement m
WHERE m.id > CAST('""" + P + """grIdSql}}' AS UNSIGNED)
  AND m.organization_id = '""" + P + """orgSql}}'
  AND (m.trx_no = '""" + P + """grNoSql}}'
       OR COALESCE(m.parent_trx_no, '') = '""" + P + """grNoSql}}')
  AND m.is_deleted = 0
ORDER BY m.id"""

SQL_LATER = """SELECT CAST(m.item_id AS CHAR) AS item_id,
       CAST(m.batch_number_id AS CHAR) AS batch_id,
       CAST(MAX(m.id) AS CHAR) AS max_id,
       SUBSTRING_INDEX(
           GROUP_CONCAT(CONCAT(m.transaction_type, ' ', COALESCE(m.trx_no, ''))
                        ORDER BY m.id DESC SEPARATOR '|'), '|', 1) AS latest
FROM inventory_movement m
WHERE m.id > CAST('""" + R + """minLiveIdSql}}' AS UNSIGNED)
  AND m.organization_id = '""" + R + """orgSql}}'
  AND m.plant_id = CAST('""" + R + """plantIdSql}}' AS UNSIGNED)
  AND m.item_id IN (""" + R + """itemIdsCsv}})
  AND NOT (m.transaction_type IN ('GRN', 'GRN-R') AND m.trx_no = '""" + R + """grNoSql}}')
  AND NOT (m.transaction_type IN ('HU', 'HU-R') AND COALESCE(m.parent_trx_no, '') = '""" + R + """grNoSql}}')
  AND m.is_deleted = 0
GROUP BY m.item_id, m.batch_number_id"""

SQL_FIFO = """SELECT CAST(f.id AS CHAR) AS id,
       CAST(f.material_id AS CHAR) AS material_id,
       CAST(f.batch_id AS CHAR) AS batch_id,
       f.fifo_cost_price,
       f.fifo_initial_quantity,
       f.fifo_available_quantity,
       f.fifo_sequence
FROM fifo_costing_history f
WHERE f.id > CAST('""" + R + """grIdSql}}' AS UNSIGNED)
  AND f.organization_id = '""" + R + """orgSql}}'
  AND f.plant_id = CAST('""" + R + """plantIdSql}}' AS UNSIGNED)
  AND f.material_id IN (""" + R + """itemIdsCsv}})
  AND f.is_deleted = 0"""

SQL_WA = """SELECT CAST(w.id AS CHAR) AS id,
       CAST(w.material_id AS CHAR) AS material_id,
       CAST(w.batch_id AS CHAR) AS batch_id,
       w.wa_quantity,
       w.wa_cost_price
FROM wa_costing_method w
WHERE w.organization_id = '""" + R + """orgSql}}'
  AND w.plant_id = '""" + R + """plantIdSql}}'
  AND w.material_id IN (""" + R + """itemIdsCsv}})
  AND w.is_deleted = 0
  AND (w.batch_id IS NULL OR w.id > CAST('""" + R + """grIdSql}}' AS UNSIGNED))"""

SQL_COST = """SELECT 'FIFO' AS t, CAST(f.material_id AS CHAR) AS material_id, COUNT(*) AS cnt
FROM fifo_costing_history f
WHERE f.organization_id = '""" + R + """orgSql}}'
  AND f.plant_id = CAST('""" + R + """plantIdSql}}' AS UNSIGNED)
  AND f.material_id IN (""" + R + """itemIdsCsv}})
  AND f.is_deleted = 0
GROUP BY f.material_id
UNION ALL
SELECT 'WA' AS t, CAST(w.material_id AS CHAR) AS material_id, COUNT(*) AS cnt
FROM wa_costing_method w
WHERE w.organization_id = '""" + R + """orgSql}}'
  AND w.plant_id = '""" + R + """plantIdSql}}'
  AND w.material_id IN (""" + R + """itemIdsCsv}})
  AND w.is_deleted = 0
GROUP BY w.material_id"""

# --------------------------------------------------------------------------
def build():
    nodes = [node("start", "start-node", {"isValidator": True, "title": "Start Node"})]

    nodes.append(code("code_node_grRvParams", "Normalize Params", PARAMS, [
        ("grId", "string"), ("grNo", "string"), ("organizationId", "string"),
        ("grIdSql", "string"), ("grNoSql", "string"), ("orgSql", "string"),
        ("hasParams", "int")]))

    nodes.append(if_expr("if_grRvNoParams", "IF Missing Params",
        "'" + P + "hasParams}}' != '1'",
        [ret("return_node_grRvNoParams", "Return Missing Params", [
            ("code", "400", "value"),
            ("message", "gr_id, gr_no and organization_id are required.", "value"),
            ("conflicts", "[]", "value")])]))

    # ---- round one: everything reachable from the request parameters -------
    nodes.append(parallel("condition_all_grRvFetch1", [
        ("condition_all_node_item_grRvGr", "Goods Receiving", [
            get_node("get_node_grRvGr", "Get Goods Receiving", T["gr"], [
                leaf("id", "in", P + "grId}}"),
                leaf("organization_id", "equal", P + "organizationId}}")])]),
        ("condition_all_node_item_grRvMovs", "Stock Movements", [
            sql("sql_node_grRvMovs", "Get This Receipt's Stock Movements", SQL_MOVS, [
                ("id", "string"), ("transaction_type", "string"), ("movement", "string"),
                ("trx_no", "string"), ("parent_trx_no", "string"), ("item_id", "string"),
                ("plant_id", "string"), ("bin_location_id", "string"),
                ("batch_number_id", "string"), ("handling_unit_id", "string"),
                ("inventory_category", "string"), ("quantity", "string"),
                ("base_qty", "string"), ("uom_id", "string"), ("base_uom_id", "string"),
                ("unit_price", "string"), ("costing_method_id", "string")])]),
        ("condition_all_node_item_grRvPutaway", "Putaway", [
            search_node("search_node_grRvPutaway", "Get Putaway Documents", T["putaway"], [
                leaf("gr_no", "equal", P + "grId}}"),
                leaf("organization_id", "equal", P + "organizationId}}")], 100)]),
        ("condition_all_node_item_grRvQi", "Inspection Lots", [
            search_node("search_node_grRvQi", "Get Inspection Lots", T["qi"], [
                leaf("goods_receiving_no", "equal", P + "grId}}"),
                leaf("organization_id", "equal", P + "organizationId}}")], 100)]),
        ("condition_all_node_item_grRvTransit", "In Transit", [
            search_node("search_node_grRvTransit", "Get In Transit Rows", T["transit"], [
                leaf("doc_id", "equal", P + "grId}}"),
                leaf("doc_type", "equal", "Goods Receiving", "value"),
                leaf("organization_id", "equal", P + "organizationId}}")], 1000)]),
        ("condition_all_node_item_grRvBatch", "Batches", [
            search_node("search_node_grRvBatch", "Get Batches Minted Here", T["batch"], [
                leaf("transaction_no", "equal", P + "grNo}}"),
                leaf("organization_id", "equal", P + "organizationId}}")], 100)]),
    ]))

    nodes.append(code("code_node_grRvPrep", "Prep + Header Refusals", body("prep.js"), [
        ("refuse", "int"), ("refuseMessage", "string"), ("grId", "string"),
        ("grIdList", "array"),
        ("grNo", "string"), ("organizationId", "string"), ("plantId", "string"),
        ("plantIdSql", "string"), ("minLiveIdSql", "string"), ("grIdSql", "string"),
        ("grNoSql", "string"), ("orgSql", "string"), ("itemIdsCsv", "string"),
        ("previousStatus", "string"), ("lines", "array"), ("liveRows", "array"),
        ("cycleRows", "array"),
        ("huOutRows", "array"), ("tupleAnchors", "any"), ("itemIds", "array"),
        ("batchIds", "array"), ("huIds", "array"), ("poIds", "array"),
        ("poLineIds", "array")]))

    nodes.append(if_expr("if_grRvRefuse", "IF Refused By Document State",
        "'" + R + "refuse}}' == '1'",
        [ret("return_node_grRvRefuse", "Return Refused", [
            ("code", "400", "value"),
            ("message", R + "refuseMessage}}", "field"),
            ("conflicts", "[]", "value")])]))

    # ---- round two: everything that needed the first round -----------------
    nodes.append(parallel("condition_all_grRvFetch2", [
        ("condition_all_node_item_grRvLater", "Later Movements", [
            sql("sql_node_grRvLater", "Get Later Movements On This Stock", SQL_LATER, [
                ("item_id", "string"), ("batch_id", "string"), ("max_id", "string"),
                ("latest", "string")])]),
        ("condition_all_node_item_grRvFifo", "FIFO Layers", [
            sql("sql_node_grRvFifo", "Get FIFO Layers From This Receipt", SQL_FIFO, [
                ("id", "string"), ("material_id", "string"), ("batch_id", "string"),
                ("fifo_cost_price", "string"), ("fifo_initial_quantity", "string"),
                ("fifo_available_quantity", "string"), ("fifo_sequence", "string")])]),
        ("condition_all_node_item_grRvWa", "Weighted Average Rows", [
            sql("sql_node_grRvWa", "Get Weighted Average Rows", SQL_WA, [
                ("id", "string"), ("material_id", "string"), ("batch_id", "string"),
                ("wa_quantity", "string"), ("wa_cost_price", "string")])]),
        ("condition_all_node_item_grRvCost", "Costing Row Counts", [
            sql("sql_node_grRvCostCounts", "Count Costing Rows Per Item", SQL_COST, [
                ("t", "string"), ("material_id", "string"), ("cnt", "int")])]),
        ("condition_all_node_item_grRvPi", "Purchase Invoices", [
            search_node("search_node_grRvPi", "Get Purchase Invoices", T["pi"], [
                leaf("gr_id", "in", R + "grIdList}}"),
                leaf("organization_id", "equal", R + "organizationId}}")], 100)]),
        ("condition_all_node_item_grRvBatchBal", "Batch Balances", [
            search_node("search_node_grRvBatchBal", "Get Batch Balances", T["batchbal"], [
                leaf("batch_id", "equalAny", R + "batchIds}}"),
                leaf("plant_id", "numberEqual", R + "plantId}}"),
                leaf("organization_id", "equal", R + "organizationId}}")], 1000)]),
        ("condition_all_node_item_grRvItemBal", "Item Balances", [
            search_node("search_node_grRvItemBal", "Get Item Balances", T["itembal"], [
                leaf("material_id", "equalAny", R + "itemIds}}"),
                leaf("plant_id", "numberEqual", R + "plantId}}"),
                leaf("organization_id", "equal", R + "organizationId}}")], 1000)]),
        ("condition_all_node_item_grRvHu", "Handling Units", [
            search_node("search_node_grRvHu", "Get Handling Units", T["hu"], [
                leaf("id", "equalAny", R + "huIds}}"),
                leaf("organization_id", "equal", R + "organizationId}}")], 100)]),
        ("condition_all_node_item_grRvPo", "Purchase Orders", [
            search_node("search_node_grRvPo", "Get Purchase Orders", T["po"], [
                leaf("id", "equalAny", R + "poIds}}")], 100)]),
        ("condition_all_node_item_grRvOnOrder", "On Order Rows", [
            search_node("search_node_grRvOnOrder", "Get On Order Rows", T["onorder"], [
                leaf("po_line_id", "equalAny", R + "poLineIds}}"),
                leaf("organization_id", "equal", R + "organizationId}}")], 1000)]),
        ("condition_all_node_item_grRvItems", "Item Masters", [
            search_node("search_node_grRvItems", "Get Item Masters", T["item"], [
                leaf("id", "equalAny", R + "itemIds}}")], 1000)]),
    ]))

    nodes.append(code("code_node_grRvBuild", "Conflict Detect + Build Reverses",
                      body("build.js"), [
        ("hasConflicts", "int"), ("conflictCount", "int"), ("conflicts", "array"),
        ("subtracts", "array"), ("hasSubtracts", "int"),
        ("poLineUpdates", "array"), ("hasPoLineUpdates", "int"),
        ("onOrderUpdates", "array"), ("hasOnOrderUpdates", "int"),
        ("poHeaderUpdates", "array"), ("hasPoHeaderUpdates", "int"),
        ("putawayDeletes", "array"), ("hasPutawayDeletes", "int"),
        ("transitUpdates", "array"), ("hasTransitUpdates", "int"),
        ("qiDeletes", "array"), ("hasQiDeletes", "int"),
        ("batchDeletes", "array"), ("hasBatchDeletes", "int")]))

    nodes.append(if_expr("if_grRvConflicts", "IF Has Conflicts",
        "'" + B + "hasConflicts}}' == '1'",
        [ret("return_node_grRvConflicts", "Return Conflicts", [
            ("code", "409", "value"),
            ("message", "Revert blocked: this receipt's stock has been used or its documents have moved on.", "value"),
            ("conflicts", B + "conflicts}}", "field")])]))

    # ---- writes -------------------------------------------------------------
    # The putaway is deleted first and conditionally: a mobile picker takes the
    # is_processing lock on it, so claiming the document is what stops a putaway
    # starting midway through the reversal. If the row survives, someone else
    # holds it and nothing else has been written yet.
    nodes.append(if_expr("if_grRvHasPutaway", "IF Has Putaway To Remove",
        "'" + B + "hasPutawayDeletes}}' == '1'", [
        update_node("update_node_grRvPutawayDel", "Remove Putaway", T["putaway"], [
            leaf("id", "in", B + "putawayDeletes.id}}"),
            leaf("is_processing", "numberEqual", 0, "value")],
            [("id", B + "putawayDeletes.id}}", "field"), ("is_deleted", 1, "value")]),
        search_node("search_node_grRvPutawayCheck", "Confirm Putaway Removed", T["putaway"], [
            leaf("id", "equalAny", B + "putawayDeletes.id}}")], 100),
        if_rule("if_grRvPutawayLocked", "IF Putaway Still There",
            "node.search_node_grRvPutawayCheck.data.total", "greaterThan", 0,
            [ret("return_node_grRvPutawayLocked", "Return Putaway Locked", [
                ("code", "409", "value"),
                ("message", "The putaway for this receipt is being processed right now. Try again in a moment.", "value"),
                ("conflicts", "[]", "value")])]),
    ]))

    # One iteration per movement row, and each iteration finishes that row
    # completely: stock, costing layer, handling unit. A failure part way
    # through therefore leaves whole rows done and whole rows untouched, which
    # is what lets a second run pick up exactly where this one stopped.
    subtract_fail = if_expr("if_grRvSubtractFail", "IF Subtract Failed",
        "'{{node:workflow_node_grRvSubtract.data.code}}' != '200'",
        [code("code_node_grRvSubFailMsg", "Build Subtract Failure Message", r"""
const S = (v) => (v === null || v === undefined ? "" : String(v));
const label = S(""" + L + r"""failLabel}});
const detail = S({{node:workflow_node_grRvSubtract.data.errorMessage}}) ||
  S({{node:workflow_node_grRvSubtract.data.message}}) || "stock could not be taken back out";
return {
  message: "Revert stopped part way through: " + label + " - " + detail +
    ". Earlier lines have already been reversed. Do not edit or complete this Goods Receiving; run Revert again to finish it.",
};
""".lstrip(), [("message", "string")]),
         ret("return_node_grRvSubtractFail", "Return Partial Revert", [
            ("code", "500", "value"),
            ("message", "{{node:code_node_grRvSubFailMsg.data.message}}", "field"),
            ("conflicts", "[]", "value")])])

    hu_readd_fail = if_expr("if_grRvHuReaddFail", "IF Packaging Re-add Failed",
        "'{{node:workflow_node_grRvHuReadd.data.code}}' == '400'",
        [ret("return_node_grRvHuReaddFail", "Return Packaging Re-add Failed", [
            ("code", "500", "value"),
            ("message", "Revert stopped part way through: the handling unit packaging could not be put back. Do not edit or complete this Goods Receiving; run Revert again to finish it.", "value"),
            ("conflicts", "[]", "value")])])

    hu_unload_fail = if_expr("if_grRvHuUnloadFail", "IF Handling Unit Unload Failed",
        "'{{node:workflow_node_grRvHuUnload.data.code}}' != '200'",
        [ret("return_node_grRvHuUnloadFail", "Return Unload Failed", [
            ("code", "500", "value"),
            ("message", "Revert stopped part way through: the stock could not be taken back out of its handling unit. Do not edit or complete this Goods Receiving; run Revert again to finish it.", "value"),
            ("conflicts", "[]", "value")])])

    loop_body = [
        wf_node("workflow_node_grRvSubtract", "Subtract Inventory", W["subtract"], [
            ("plant_id", R + "plantId}}", "field"),
            ("organization_id", R + "organizationId}}", "field"),
            ("material_id", L + "material_id}}", "field"),
            ("quantity", L + "quantity}}", "field"),
            ("material_uom", L + "material_uom}}", "field"),
            ("unit_price", L + "unit_price}}", "field"),
            ("transaction_type", "GRN-R", "value"),
            ("trx_no", R + "grNo}}", "field"),
            ("parent_trx_no", L + "parent_trx_no}}", "field"),
            ("inventory_category", L + "inventory_category}}", "field"),
            ("location_id", L + "location_id}}", "field"),
            ("batch_id", L + "batch_id}}", "field"),
            ("handling_unit_id", L + "handling_unit_id}}", "field"),
            ("index", L + "index}}", "field"),
            ("itemData", L + "itemData}}", "field"),
            ("doc_date", L + "doc_date}}", "field"),
            # The balances move but the costing rows are handled here, row by
            # row, so the sub-workflow must not consume FIFO or weighted average.
            ("isMovingInv", 1, "value"),
        ]),
        subtract_fail,
        if_expr("if_grRvFifoDel", "IF Has FIFO Layer", "'" + L + "hasFifoDelete}}' == '1'", [
            update_node("update_node_grRvFifoDel", "Remove FIFO Layer", T["fifo"], [
                leaf("id", "in", L + "fifoDeleteId}}")], [
                ("id", L + "fifoDeleteId}}", "field"), ("is_deleted", 1, "value")])]),
        if_expr("if_grRvWaDel", "IF Has Weighted Average Row", "'" + L + "hasWaDelete}}' == '1'", [
            update_node("update_node_grRvWaDel", "Remove Weighted Average Row", T["wa"], [
                leaf("id", "in", L + "waDeleteId}}")], [
                ("id", L + "waDeleteId}}", "field"), ("is_deleted", 1, "value")])]),
        if_expr("if_grRvWaUpd", "IF Has Weighted Average To Restate", "'" + L + "hasWaUpdate}}' == '1'", [
            update_node("update_node_grRvWaUpd", "Restate Weighted Average", T["wa"], [
                leaf("id", "in", L + "waUpdateId}}")], [
                ("id", L + "waUpdateId}}", "field"),
                ("wa_quantity", L + "waQuantity}}", "field"),
                ("wa_cost_price", L + "waCostPrice}}", "field")])]),
        if_expr("if_grRvHuDelete", "IF Handling Unit Created Here", "'" + L + "huIsDelete}}' == '1'", [
            update_node("update_node_grRvHuDel", "Remove Handling Unit", T["hu"], [
                leaf("id", "in", L + "huId}}")], [
                ("id", L + "huId}}", "field"), ("is_deleted", 1, "value")]),
            if_expr("if_grRvHuReadd", "IF Packaging Was Consumed", "'" + L + "hasHuReadd}}' == '1'", [
                wf_node("workflow_node_grRvHuReadd", "Put Packaging Back", W["add"], [
                    ("plant_id", R + "plantId}}", "field"),
                    ("organization_id", R + "organizationId}}", "field"),
                    ("material_id", L + "readdMaterialId}}", "field"),
                    ("quantity", L + "readdQuantity}}", "field"),
                    ("material_uom", L + "readdUom}}", "field"),
                    ("unit_price", L + "readdUnitPrice}}", "field"),
                    ("transaction_type", "HU-R", "value"),
                    ("trx_no", L + "readdTrxNo}}", "field"),
                    ("parent_trx_no", R + "grNo}}", "field"),
                    ("inventory_category", "Unrestricted", "value"),
                    ("location_id", L + "readdLocationId}}", "field"),
                    ("batch_id", "", "value"),
                    # "-" is the sentinel for "this item is not batch managed",
                    # so no batch record is created for the packaging.
                    ("batch_number", "-", "value"),
                    ("itemData", L + "readdItemData}}", "field"),
                    ("doc_date", L + "doc_date}}", "field"),
                    ("isMovingInv", 0, "value"),
                ]),
                hu_readd_fail]),
        ]),
        if_expr("if_grRvHuUnload", "IF Loaded Into An Existing Handling Unit",
            "'" + L + "huIsUnload}}' == '1'", [
            wf_node("workflow_node_grRvHuUnload", "Unload Handling Unit", W["hu"], [
                ("handling_unit_id", L + "huId}}", "field"),
                ("handling_no", L + "huHandlingNo}}", "field"),
                ("process_type", "unload", "value"),
                # The handling unit update writes plant, storage location and bin
                # straight from these parameters on every path, so its current
                # values have to be echoed back or they are wiped.
                ("plant_id", L + "huPlantId}}", "field"),
                ("storage_location_id", L + "huStorageLocationId}}", "field"),
                ("location_id", L + "huLocationId}}", "field"),
                ("table_hu_items", L + "huItems}}", "field"),
                ("parent_trx_no", R + "grNo}}", "field"),
            ]),
            hu_unload_fail]),
    ]

    nodes.append(if_expr("if_grRvHasSubtracts", "IF Has Stock To Reverse",
        "'" + B + "hasSubtracts}}' == '1'",
        [loop("loop_grRvSubtract", "Loop Stock Movements", B + "subtracts}}", loop_body)]))

    nodes.append(if_expr("if_grRvHasTransit", "IF Has In Transit Rows",
        "'" + B + "hasTransitUpdates}}' == '1'",
        [update_node("update_node_grRvTransit", "Close In Transit Rows", T["transit"], [
            leaf("id", "in", B + "transitUpdates.id}}")], [
            ("id", B + "transitUpdates.id}}", "field"),
            ("status", B + "transitUpdates.status}}", "field"),
            ("open_qty", B + "transitUpdates.open_qty}}", "field")])]))

    nodes.append(if_expr("if_grRvHasQi", "IF Has Inspection Lots",
        "'" + B + "hasQiDeletes}}' == '1'",
        [update_node("update_node_grRvQiDel", "Remove Inspection Lots", T["qi"], [
            leaf("id", "in", B + "qiDeletes.id}}")], [
            ("id", B + "qiDeletes.id}}", "field"), ("is_deleted", 1, "value")])]))

    nodes.append(if_expr("if_grRvHasBatch", "IF Has Split Batches",
        "'" + B + "hasBatchDeletes}}' == '1'",
        [update_node("update_node_grRvBatchDel", "Remove Split Batches", T["batch"], [
            leaf("id", "in", B + "batchDeletes.id}}")], [
            ("id", B + "batchDeletes.id}}", "field"), ("is_deleted", 1, "value")])]))

    # The header goes back to Created before the purchase order is touched. If a
    # purchase order write then fails, a second run refuses on the status rather
    # than subtracting the same quantities twice.
    nodes.append(update_node("update_node_grRvGr", "Set Goods Receiving To Created", T["gr"], [
        leaf("id", "in", R + "grId}}")], [
        ("gr_status", "Created", "value"),
        # A receipt completed straight from Draft still carries "Draft" here,
        # and that value makes the save workflow issue a fresh number the next
        # time it is completed, which would break the pairing this revert relies
        # on. It is deliberately overwritten.
        ("previous_status", "Created", "value"),
        ("putaway_status", "", "value")]))

    nodes.append(if_expr("if_grRvHasPoLines", "IF Has Purchase Order Lines",
        "'" + B + "hasPoLineUpdates}}' == '1'",
        [update_node("update_node_grRvPoLines", "Restore Purchase Order Lines", T["poline"], [
            leaf("id", "in", B + "poLineUpdates.id}}")], [
            ("id", B + "poLineUpdates.id}}", "field"),
            ("received_qty", B + "poLineUpdates.received_qty}}", "field"),
            ("outstanding_quantity", B + "poLineUpdates.outstanding_quantity}}", "field"),
            ("line_status", B + "poLineUpdates.line_status}}", "field"),
            ("created_received_qty", B + "poLineUpdates.created_received_qty}}", "field")])]))

    nodes.append(if_expr("if_grRvHasOnOrder", "IF Has On Order Rows",
        "'" + B + "hasOnOrderUpdates}}' == '1'",
        [update_node("update_node_grRvOnOrder", "Restore On Order Rows", T["onorder"], [
            leaf("id", "in", B + "onOrderUpdates.id}}")], [
            ("id", B + "onOrderUpdates.id}}", "field"),
            ("received_qty", B + "onOrderUpdates.received_qty}}", "field"),
            ("open_qty", B + "onOrderUpdates.open_qty}}", "field")])]))

    nodes.append(if_expr("if_grRvHasPoHeaders", "IF Has Purchase Orders",
        "'" + B + "hasPoHeaderUpdates}}' == '1'",
        [update_node("update_node_grRvPoHdr", "Restore Purchase Orders", T["po"], [
            leaf("id", "in", B + "poHeaderUpdates.id}}")], [
            ("id", B + "poHeaderUpdates.id}}", "field"),
            ("po_status", B + "poHeaderUpdates.po_status}}", "field"),
            ("gr_status", B + "poHeaderUpdates.gr_status}}", "field"),
            ("partially_received", B + "poHeaderUpdates.partially_received}}", "field"),
            ("fully_received", B + "poHeaderUpdates.fully_received}}", "field")])]))

    nodes.append(ret("return_node_grRvSuccess", "Return Revert Success", [
        ("code", "200", "value"),
        ("message", "Goods Receiving reverted to Created successfully.", "value"),
        ("conflicts", "[]", "value")]))
    nodes.append(node("end", "end-node", {"isValidator": True, "title": "End Node"}))

    return {
        "request_json": [
            {"key": "grrvp001", "name": "gr_id", "title": "gr_id", "description": "",
             "bsonType": "string", "isExpand": False},
            {"key": "grrvp002", "name": "gr_no", "title": "gr_no", "description": "",
             "bsonType": "string", "isExpand": False},
            {"key": "grrvp003", "name": "organization_id", "title": "organization_id",
             "description": "", "bsonType": "string", "isExpand": False},
        ],
        "response_json": [
            {"key": "grrvr001", "name": "code", "title": "code", "description": "",
             "bsonType": "string", "isExpand": False},
            {"key": "grrvr002", "name": "message", "title": "message", "description": "",
             "bsonType": "string", "isExpand": False},
            {"key": "grrvr003", "name": "conflicts", "title": "conflicts", "description": "",
             "bsonType": "array", "isExpand": True, "children": [
                {"key": "grrvr004", "name": "items", "title": "", "description": "",
                 "bsonType": "any", "isExpand": False, "isArrayItem": True, "children": []}]},
        ],
        "config": {},
        "nodes": nodes,
        "edges": [],
    }

if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(build(), f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote", OUT)
