#!/usr/bin/env python3
"""Build Item Assembly & BOM/RevertCompletedIA/IArevertCompletedWorkflow.json."""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "Item Assembly & BOM", "RevertCompletedIA", "IArevertCompletedWorkflow.json")

T = {
    "ia": "Item Assembly:Table:2098256587713404929",
    "batch": "Batch:Table:1902719754154655746",
    "batchbal": "Item Batch Balance:Table:1902718803880558594",
    "itembal": "Item Balance:Table:1902698977724317697",
    "fifo": "FIFO Costing History:Table:1902947165008400386",
    "wa": "Weighted Average Costing History:Table:1902948453171433474",
    "hu": "Handling Unit:Table:2036736671686529026",
    "item": "Item:Table:1901546842240438273",
}
W = {
    "subtract": "SUBTRACT_INVENTORY:Workflow:2012096660219564034",
    "add": "ADD_INVENTORY:Workflow:2012005532688723970",
    "hu": "HANDLING_UNIT:Workflow:2037062451509002241",
}

_fid = [1791000000000]
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
    # The true block must be non-empty or the compiler crashes.
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

P = "{{node:code_node_iaRvParams.data."
R = "{{node:code_node_iaRvPrep.data."
B = "{{node:code_node_iaRvBuild.data."
LS = "{{node:loop_iaRvSubtract."
LA = "{{node:loop_iaRvAdd."

# --------------------------------------------------------------------------
PARAMS = r"""
// Everything interpolated into an sql-node is guarded here: those nodes
// substitute text before parsing. A failed guard matches no row, never all rows.
const S = (v) => (v === null || v === undefined ? "" : String(v).trim());
const digits = (v) => (/^[0-9]+$/.test(S(v)) ? S(v) : "0");
const token = (v) => (/^[A-Za-z0-9\/\-_. ]{1,64}$/.test(S(v)) ? S(v) : "");

const iaId = S({{workflowparams:ia_id}});
const iaNo = S({{workflowparams:ia_no}});
const organizationId = S({{workflowparams:organization_id}});

return {
  iaId,
  iaNo,
  organizationId,
  iaIdSql: digits(iaId),
  iaNoSql: token(iaNo),
  orgSql: token(organizationId),
  hasParams: iaId && iaNo && organizationId && digits(iaId) !== "0" && token(iaNo) && token(organizationId) ? 1 : 0,
};
""".lstrip()

SQL_MOVS = """SELECT CAST(m.id AS CHAR) AS id,
       m.transaction_type,
       m.movement,
       m.trx_no,
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
       m.total_price,
       m.costing_method_id
FROM inventory_movement m
WHERE m.id > CAST('""" + P + """iaIdSql}}' AS UNSIGNED)
  AND m.organization_id = '""" + P + """orgSql}}'
  AND m.trx_no = '""" + P + """iaNoSql}}'
  AND m.transaction_type IN ('IA', 'IA-R')
  AND m.is_deleted = 0
ORDER BY m.id"""

SQL_FIFO = """SELECT CAST(f.id AS CHAR) AS id,
       CAST(f.material_id AS CHAR) AS material_id,
       CAST(f.batch_id AS CHAR) AS batch_id,
       f.fifo_cost_price,
       f.fifo_initial_quantity,
       f.fifo_available_quantity,
       f.fifo_sequence
FROM fifo_costing_history f
WHERE f.id > CAST('""" + R + """iaIdSql}}' AS UNSIGNED)
  AND f.organization_id = '""" + R + """orgSql}}'
  AND f.plant_id = CAST('""" + R + """plantIdSql}}' AS UNSIGNED)
  AND f.material_id IN (""" + R + """assembledIdsCsv}})
  AND f.is_deleted = 0"""

SQL_WA = """SELECT CAST(w.id AS CHAR) AS id,
       CAST(w.material_id AS CHAR) AS material_id,
       CAST(w.batch_id AS CHAR) AS batch_id,
       w.wa_quantity,
       w.wa_cost_price
FROM wa_costing_method w
WHERE w.organization_id = '""" + R + """orgSql}}'
  AND w.plant_id = '""" + R + """plantIdSql}}'
  AND w.material_id IN (""" + R + """assembledIdsCsv}})
  AND w.is_deleted = 0
  AND (w.batch_id IS NULL OR w.id > CAST('""" + R + """iaIdSql}}' AS UNSIGNED))"""

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

def fail_msg(nid, wf_id, label_ref, what):
    return code(nid, "Build Failure Message", r"""
const S = (v) => (v === null || v === undefined ? "" : String(v));
const label = S(""" + label_ref + r"""failLabel}});
const detail = S({{node:""" + wf_id + r""".data.errorMessage}}) ||
  S({{node:""" + wf_id + r""".data.message}}) || """ + json.dumps(what) + r""";
return {
  message: "Revert stopped part way through: " + label + " - " + detail +
    ". Earlier lines have already been reversed. Do not edit or complete this Item Assembly; run Revert again to finish it.",
};
""".lstrip(), [("message", "string")])

# --------------------------------------------------------------------------
def build():
    nodes = [node("start", "start-node", {"isValidator": True, "title": "Start Node"})]

    nodes.append(code("code_node_iaRvParams", "Normalize Params", PARAMS, [
        ("iaId", "string"), ("iaNo", "string"), ("organizationId", "string"),
        ("iaIdSql", "string"), ("iaNoSql", "string"), ("orgSql", "string"),
        ("hasParams", "int")]))

    nodes.append(if_expr("if_iaRvNoParams", "IF Missing Params",
        "'" + P + "hasParams}}' != '1'",
        [ret("return_node_iaRvNoParams", "Return Missing Params", [
            ("code", "400", "value"),
            ("message", "ia_id, ia_no and organization_id are required.", "value"),
            ("conflicts", "[]", "value")])]))

    nodes.append(parallel("condition_all_iaRvFetch1", [
        ("condition_all_node_item_iaRvIa", "Item Assembly", [
            get_node("get_node_iaRvIa", "Get Item Assembly", T["ia"], [
                leaf("id", "in", P + "iaId}}"),
                leaf("organization_id", "equal", P + "organizationId}}")])]),
        ("condition_all_node_item_iaRvMovs", "Stock Movements", [
            sql("sql_node_iaRvMovs", "Get This Assembly's Stock Movements", SQL_MOVS, [
                ("id", "string"), ("transaction_type", "string"), ("movement", "string"),
                ("trx_no", "string"), ("item_id", "string"), ("plant_id", "string"),
                ("bin_location_id", "string"), ("batch_number_id", "string"),
                ("handling_unit_id", "string"), ("inventory_category", "string"),
                ("quantity", "string"), ("base_qty", "string"), ("uom_id", "string"),
                ("base_uom_id", "string"), ("unit_price", "string"),
                ("total_price", "string"), ("costing_method_id", "string")])]),
        ("condition_all_node_item_iaRvBatch", "Batches", [
            search_node("search_node_iaRvBatch", "Get Batches Minted Here", T["batch"], [
                leaf("transaction_no", "equal", P + "iaNo}}"),
                leaf("organization_id", "equal", P + "organizationId}}")], 100)]),
    ]))

    nodes.append(code("code_node_iaRvPrep", "Prep + Header Refusals", body("prep.js"), [
        ("refuse", "int"), ("refuseMessage", "string"), ("headerOnly", "int"),
        ("iaId", "string"), ("iaNo", "string"), ("organizationId", "string"),
        ("plantId", "string"), ("plantIdSql", "string"), ("iaIdSql", "string"),
        ("orgSql", "string"), ("assembledItemId", "string"), ("itemIdsCsv", "string"),
        ("assembledIdsCsv", "string"), ("liveOut", "array"), ("liveIn", "array"),
        ("partialRow", "int"), ("itemIds", "array"), ("assembledIds", "array"),
        ("batchIds", "array"), ("huIds", "array")]))

    nodes.append(if_expr("if_iaRvRefuse", "IF Refused By Document State",
        "'" + R + "refuse}}' == '1'",
        [ret("return_node_iaRvRefuse", "Return Refused", [
            ("code", "400", "value"),
            ("message", R + "refuseMessage}}", "field"),
            ("conflicts", "[]", "value")])]))

    nodes.append(parallel("condition_all_iaRvFetch2", [
        ("condition_all_node_item_iaRvFifo", "FIFO Layers", [
            sql("sql_node_iaRvFifo", "Get FIFO Layers Of The Assembled Item", SQL_FIFO, [
                ("id", "string"), ("material_id", "string"), ("batch_id", "string"),
                ("fifo_cost_price", "string"), ("fifo_initial_quantity", "string"),
                ("fifo_available_quantity", "string"), ("fifo_sequence", "string")])]),
        ("condition_all_node_item_iaRvWa", "Weighted Average Rows", [
            sql("sql_node_iaRvWa", "Get Weighted Average Rows", SQL_WA, [
                ("id", "string"), ("material_id", "string"), ("batch_id", "string"),
                ("wa_quantity", "string"), ("wa_cost_price", "string")])]),
        ("condition_all_node_item_iaRvCost", "Costing Row Counts", [
            sql("sql_node_iaRvCostCounts", "Count Costing Rows Per Item", SQL_COST, [
                ("t", "string"), ("material_id", "string"), ("cnt", "int")])]),
        ("condition_all_node_item_iaRvItemBal", "Item Balances", [
            search_node("search_node_iaRvItemBal", "Get Item Balances", T["itembal"], [
                leaf("material_id", "equalAny", R + "assembledIds}}"),
                leaf("plant_id", "numberEqual", R + "plantId}}"),
                leaf("organization_id", "equal", R + "organizationId}}")], 1000)]),
        ("condition_all_node_item_iaRvBatchBal", "Batch Balances", [
            search_node("search_node_iaRvBatchBal", "Get Batch Balances", T["batchbal"], [
                leaf("batch_id", "equalAny", R + "batchIds}}"),
                leaf("plant_id", "numberEqual", R + "plantId}}"),
                leaf("organization_id", "equal", R + "organizationId}}")], 1000)]),
        ("condition_all_node_item_iaRvHu", "Handling Units", [
            search_node("search_node_iaRvHu", "Get Handling Units", T["hu"], [
                leaf("id", "equalAny", R + "huIds}}"),
                leaf("organization_id", "equal", R + "organizationId}}")], 100)]),
        ("condition_all_node_item_iaRvItems", "Item Masters", [
            search_node("search_node_iaRvItems", "Get Item Masters", T["item"], [
                leaf("id", "equalAny", R + "itemIds}}")], 1000)]),
    ]))

    nodes.append(code("code_node_iaRvBuild", "Conflict Detect + Build Reverses",
                      body("build.js"), [
        ("hasConflicts", "int"), ("conflictCount", "int"), ("conflicts", "array"),
        ("subtracts", "array"), ("hasSubtracts", "int"),
        ("adds", "array"), ("hasAdds", "int"),
        ("batchDeletes", "array"), ("hasBatchDeletes", "int")]))

    nodes.append(if_expr("if_iaRvConflicts", "IF Has Conflicts",
        "'" + B + "hasConflicts}}' == '1'",
        [ret("return_node_iaRvConflicts", "Return Conflicts", [
            ("code", "409", "value"),
            ("message", "Revert blocked: the assembled item has been used or its stock has moved on.", "value"),
            ("conflicts", B + "conflicts}}", "field")])]))

    # ---- writes -------------------------------------------------------------
    # The assembled item comes out first: it is the only leg that can refuse for
    # lack of stock, and nothing else has been touched if it does.
    subtract_body = [
        wf_node("workflow_node_iaRvSubtract", "Subtract Assembled Item", W["subtract"], [
            ("plant_id", R + "plantId}}", "field"),
            ("organization_id", R + "organizationId}}", "field"),
            ("material_id", LS + "material_id}}", "field"),
            ("quantity", LS + "quantity}}", "field"),
            ("material_uom", LS + "material_uom}}", "field"),
            ("unit_price", LS + "unit_price}}", "field"),
            ("transaction_type", "IA-R", "value"),
            ("trx_no", R + "iaNo}}", "field"),
            ("inventory_category", LS + "inventory_category}}", "field"),
            ("location_id", LS + "location_id}}", "field"),
            ("batch_id", LS + "batch_id}}", "field"),
            ("index", LS + "index}}", "field"),
            ("itemData", LS + "itemData}}", "field"),
            ("doc_date", LS + "doc_date}}", "field"),
            # The balance moves but the costing row is removed below, so the
            # sub-workflow must not consume FIFO or weighted average itself.
            ("isMovingInv", 1, "value"),
        ]),
        if_expr("if_iaRvSubtractFail", "IF Subtract Failed",
            "'{{node:workflow_node_iaRvSubtract.data.code}}' != '200'",
            [fail_msg("code_node_iaRvSubFailMsg", "workflow_node_iaRvSubtract", LS,
                      "the assembled item could not be taken back out"),
             ret("return_node_iaRvSubtractFail", "Return Partial Revert", [
                ("code", "500", "value"),
                ("message", "{{node:code_node_iaRvSubFailMsg.data.message}}", "field"),
                ("conflicts", "[]", "value")])]),
        if_expr("if_iaRvFifoDel", "IF Has FIFO Layer", "'" + LS + "hasFifoDelete}}' == '1'", [
            update_node("update_node_iaRvFifoDel", "Remove FIFO Layer", T["fifo"], [
                leaf("id", "in", LS + "fifoDeleteId}}")], [
                ("id", LS + "fifoDeleteId}}", "field"), ("is_deleted", 1, "value")])]),
        if_expr("if_iaRvWaDel", "IF Has Weighted Average Row", "'" + LS + "hasWaDelete}}' == '1'", [
            update_node("update_node_iaRvWaDel", "Remove Weighted Average Row", T["wa"], [
                leaf("id", "in", LS + "waDeleteId}}")], [
                ("id", LS + "waDeleteId}}", "field"), ("is_deleted", 1, "value")])]),
        if_expr("if_iaRvWaUpd", "IF Has Weighted Average To Restate", "'" + LS + "hasWaUpdate}}' == '1'", [
            update_node("update_node_iaRvWaUpd", "Restate Weighted Average", T["wa"], [
                leaf("id", "in", LS + "waUpdateId}}")], [
                ("id", LS + "waUpdateId}}", "field"),
                ("wa_quantity", LS + "waQuantity}}", "field"),
                ("wa_cost_price", LS + "waCostPrice}}", "field")])]),
    ]
    nodes.append(if_expr("if_iaRvHasSubtracts", "IF Has Assembled Item To Reverse",
        "'" + B + "hasSubtracts}}' == '1'",
        [loop("loop_iaRvSubtract", "Loop Assembled Item Movements", B + "subtracts}}", subtract_body)]))

    add_body = [
        wf_node("workflow_node_iaRvAdd", "Return Component", W["add"], [
            ("plant_id", R + "plantId}}", "field"),
            ("organization_id", R + "organizationId}}", "field"),
            ("material_id", LA + "material_id}}", "field"),
            ("quantity", LA + "quantity}}", "field"),
            ("material_uom", LA + "material_uom}}", "field"),
            ("unit_price", LA + "unit_price}}", "field"),
            ("transaction_type", "IA-R", "value"),
            ("trx_no", R + "iaNo}}", "field"),
            ("inventory_category", LA + "inventory_category}}", "field"),
            ("location_id", LA + "location_id}}", "field"),
            ("batch_id", LA + "batch_id}}", "field"),
            # "-" stops ADD minting a Batch row; an existing batch_id is used as is.
            ("batch_number", "-", "value"),
            ("handling_unit_id", LA + "handling_unit_id}}", "field"),
            ("index", LA + "index}}", "field"),
            ("itemData", LA + "itemData}}", "field"),
            ("doc_date", LA + "doc_date}}", "field"),
            ("isMovingInv", 0, "value"),
        ]),
        if_expr("if_iaRvAddFail", "IF Add Failed",
            "'{{node:workflow_node_iaRvAdd.data.code}}' != '200'",
            [fail_msg("code_node_iaRvAddFailMsg", "workflow_node_iaRvAdd", LA,
                      "the component could not be put back"),
             ret("return_node_iaRvAddFail", "Return Partial Revert", [
                ("code", "500", "value"),
                ("message", "{{node:code_node_iaRvAddFailMsg.data.message}}", "field"),
                ("conflicts", "[]", "value")])]),
        if_expr("if_iaRvHuLoad", "IF Picked From A Handling Unit", "'" + LA + "hasHuLoad}}' == '1'", [
            wf_node("workflow_node_iaRvHuLoad", "Load Handling Unit", W["hu"], [
                ("handling_unit_id", LA + "huId}}", "field"),
                ("organization_id", R + "organizationId}}", "field"),
                ("process_type", "load", "value"),
                # The update writes plant, storage location and bin from these
                # parameters, so the handling unit's own values are echoed back.
                ("plant_id", LA + "huPlantId}}", "field"),
                ("storage_location_id", LA + "huStorageLocationId}}", "field"),
                ("location_id", LA + "huLocationId}}", "field"),
                ("table_hu_items", LA + "huItems}}", "field"),
                ("parent_trx_no", R + "iaNo}}", "field"),
            ]),
            if_expr("if_iaRvHuLoadFail", "IF Handling Unit Load Failed",
                "'{{node:workflow_node_iaRvHuLoad.data.code}}' != '200'",
                [ret("return_node_iaRvHuLoadFail", "Return Load Failed", [
                    ("code", "500", "value"),
                    ("message", "Revert stopped part way through: a component could not be put back into its handling unit. Do not edit or complete this Item Assembly; run Revert again to finish it.", "value"),
                    ("conflicts", "[]", "value")])]),
        ]),
    ]
    nodes.append(if_expr("if_iaRvHasAdds", "IF Has Components To Return",
        "'" + B + "hasAdds}}' == '1'",
        [loop("loop_iaRvAdd", "Loop Component Movements", B + "adds}}", add_body)]))

    nodes.append(if_expr("if_iaRvHasBatch", "IF Has Batches To Remove",
        "'" + B + "hasBatchDeletes}}' == '1'",
        [update_node("update_node_iaRvBatchDel", "Remove Batches Minted Here", T["batch"], [
            leaf("id", "in", B + "batchDeletes.id}}")], [
            ("id", B + "batchDeletes.id}}", "field"), ("is_deleted", 1, "value")])]))

    # Last, so a partial run leaves the document Completed and a retry finishes it.
    # The number is left alone: completing the Draft again issues a fresh one.
    nodes.append(update_node("update_node_iaRvIa", "Set Item Assembly To Draft", T["ia"], [
        leaf("id", "in", R + "iaId}}")], [
        ("item_assembly_status", "Draft", "value"),
        ("posted_status", "", "value")]))

    nodes.append(ret("return_node_iaRvSuccess", "Return Revert Success", [
        ("code", "200", "value"),
        ("message", "Item Assembly reverted to Draft successfully.", "value"),
        ("conflicts", "[]", "value")]))
    nodes.append(node("end", "end-node", {"isValidator": True, "title": "End Node"}))

    return {
        "request_json": [
            {"key": "iarvp001", "name": "ia_id", "title": "ia_id", "description": "",
             "bsonType": "string", "isExpand": False},
            {"key": "iarvp002", "name": "ia_no", "title": "ia_no", "description": "",
             "bsonType": "string", "isExpand": False},
            {"key": "iarvp003", "name": "organization_id", "title": "organization_id",
             "description": "", "bsonType": "string", "isExpand": False},
        ],
        "response_json": [
            {"key": "iarvr001", "name": "code", "title": "code", "description": "",
             "bsonType": "string", "isExpand": False},
            {"key": "iarvr002", "name": "message", "title": "message", "description": "",
             "bsonType": "string", "isExpand": False},
            {"key": "iarvr003", "name": "conflicts", "title": "conflicts", "description": "",
             "bsonType": "array", "isExpand": True, "children": [
                {"key": "iarvr004", "name": "items", "title": "", "description": "",
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
