#!/usr/bin/env python3
"""PROD paste for GOODS_DELIVERY: a Force Complete closes the delivery's open Picking rows after the GD is written.

  python3 build.py   # re-dump prod's enabled GOODS_DELIVERY and rebuild GOODS_DELIVERY.prod.json next to this file

Baseline: prod's enabled script, re-dumped on every run. The SQL omits gd_async_job (Picking V2's job table is not
on prod until the full deployment) - paste this only BEFORE that cut; afterwards prod already has dev's version.
"""
import json, re, sys, copy, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = "/Users/yunawinaya/Developer/BladeXfunctions"
PROD_OUT = os.path.join(HERE, "GOODS_DELIVERY.prod.json")
WF_ID = "2017151544868491265"

def dump(env):
    sql = ("SELECT version_number, script_json FROM su_code_workflow_history "
           f"WHERE data_id='{WF_ID}' AND status='enabled' ORDER BY version_number DESC LIMIT 1")
    r = subprocess.run([REPO_ROOT + "/.dbtools/db", f"--{env}", "--json", "--limit", "1", sql],
                       check=True, capture_output=True, text=True)
    row = json.loads(r.stdout)[0]
    print(f"{env} enabled GOODS_DELIVERY v{row['version_number']}")
    sj = row["script_json"]
    return json.loads(sj) if isinstance(sj, str) else sj

# ---------------------------------------------------------------- node code
GATE_JS = r"""// Force Complete picks nothing, so the delivery's open Picking rows are closed after the write below.
const gdId = String([{{workflowparams:allData.id}}][0] || "").trim();
const ok = /^[0-9]{1,20}$/.test(gdId);
const forced = String([{{workflowparams:isForceComplete}}][0] || "") === "Yes";
const completed = String([{{workflowparams:saveAs}}][0] || "") === "Completed";
return { closePicking: forced && completed && ok ? 1 : 0, gdIdSql: ok ? gdId : "0" };
"""

PLAN_JS = r"""// A confirm in flight holds its Picking: PICKING_LOOP's mutex (taken over after 900 s) or an open Picking V2 job.
const gdId = String([{{node:code_node_FcGate.data.gdIdSql}}][0] || "");
const raw = [{{node:sql_node_FcPick.data}}][0];
const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
const busy = (r) => {
  const age = Number(r.lock_age_sec);
  return (Number(r.is_processing) === 1 && !(isFinite(age) && age > 900)) || Number(r.open_jobs) > 0;
};
const done = (r) => r.line_status === "Completed" || r.line_status === "Cancelled";
const byPicking = {};
for (const r of rows) (byPicking[r.picking_id] = byPicking[r.picking_id] || []).push(r);

const busyNos = [];
const lineIds = [];
const pickingIds = [];
for (const pickingId of Object.keys(byPicking)) {
  const pickingRows = byPicking[pickingId];
  if (busy(pickingRows[0])) {
    busyNos.push(pickingRows[0].picking_no || pickingId);
    continue;
  }
  for (const r of pickingRows) if (r.gd_id === gdId && !done(r)) lineIds.push(r.id);
  // A Picking shared with another delivery stays open until that one's rows are done.
  if (pickingRows.every((r) => r.gd_id === gdId || done(r))) pickingIds.push(pickingId);
}

return {
  busy: busyNos.length > 0 ? 1 : 0,
  busyMessage: "Picking " + busyNos.join(", ") + " is being processed on a device right now. Try again in a moment.",
  lineIds,
  hasLineIds: lineIds.length > 0 ? 1 : 0,
  pickingIds,
  hasPickingIds: pickingIds.length > 0 ? 1 : 0,
};
"""

def pick_sql(with_jobs):
    jobs = ("""(SELECT COUNT(*) FROM gd_async_job j
         WHERE j.command = 'CONFIRM_PICKING'
           AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND j.is_deleted = 0
           AND CAST(j.picking_id AS UNSIGNED) = t.id)""" if with_jobs else "0")
    return f"""SELECT CAST(pl.id AS CHAR) AS id,
       CAST(t.id AS CHAR) AS picking_id,
       CAST(COALESCE(t.to_id, '') AS CHAR) AS picking_no,
       CAST(COALESCE(pl.gd_id, '') AS CHAR) AS gd_id,
       CAST(COALESCE(pl.line_status, '') AS CHAR) AS line_status,
       COALESCE(t.is_processing, 0) AS is_processing,
       TIMESTAMPDIFF(SECOND, t.update_time, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS lock_age_sec,
       {jobs} AS open_jobs
FROM (SELECT DISTINCT x.transfer_order_id
      FROM transfer_order_jz8m9w3h_sub x
      WHERE x.gd_id = CAST('{{{{node:code_node_FcGate.data.gdIdSql}}}}' AS UNSIGNED)
        AND x.is_deleted = 0
        AND COALESCE(x.line_status, '') NOT IN ('Completed', 'Cancelled')) o
STRAIGHT_JOIN transfer_order t ON t.id = o.transfer_order_id AND t.is_deleted = 0
  AND COALESCE(t.to_status, '') NOT IN ('Completed', 'Cancelled', 'Draft')
JOIN transfer_order_jz8m9w3h_sub pl ON pl.transfer_order_id = t.id AND pl.is_deleted = 0"""

# ---------------------------------------------------------------- builders
def find(nodes, nid):
    for n in nodes:
        if n.get("id") == nid:
            return n
        r = find(n.get("blocks") or [], nid)
        if r:
            return r
    return None

def resp(key, name, bson):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}

class _Ids:
    def __init__(self, start): self.v = start
    def next(self):
        self.v += 1
        return self.v

def build_nodes(base, with_jobs):
    ids = _Ids(1792400000000)
    code_proto = find(base["nodes"], "code_node_8pN1MyXz")["data"]
    sql_proto = find(base["nodes"], "sql_node_ItemFlags")["data"]

    def code_node(nid, title, code, response):
        data = {}
        for k, v in code_proto.items():
            if k == "script":
                data[k] = dict(v, code=code)
            elif k == "response_json":
                data[k] = response
            elif k in ("title", "nodeName", "name"):
                data[k] = title
            else:
                data[k] = copy.deepcopy(v)
        return {"id": nid, "type": "code-node", "data": data, "blocks": []}

    def sql_node(nid, title, sql, cols):
        data = {}
        for k, v in sql_proto.items():
            if k == "script":
                data[k] = dict(v, code=sql)
            elif k == "response_json":
                data[k] = [resp(key, name, "string") for key, name in cols]
            elif k in ("title", "nodeName", "name"):
                data[k] = title
            else:
                data[k] = copy.deepcopy(v)
        return {"id": nid, "type": "sql-node", "data": data, "blocks": []}

    def if_rule(nid, title, prop, true_children):
        p = ids.next()
        return {
            "id": nid, "type": "if",
            "data": {
                "title": title, "isValidator": True, "nodeName": title, "name": title,
                "condition_type": "ConditionRule",
                "expression": {"type": "javascript", "code": ""},
                "filter": {"list": [{"id": ids.next(), "parentId": p, "isTop": True, "prop": prop,
                                     "operator": "numberEqual", "valueType": "value", "value": 1, "type": "leaf",
                                     "level": 1, "propLabel": prop.split(".")[-1], "valueLabel": "", "operatorLabel": "Equal"}]},
            },
            "blocks": [
                {"id": nid.replace("if_", "if_block_") + "T", "type": "ifBlock", "data": {"title": "true"}, "blocks": true_children},
                {"id": nid.replace("if_", "if_block_") + "F", "type": "ifBlock", "data": {"title": "false"}, "blocks": []},
            ],
        }

    def if_expr(nid, title, flag, true_children):
        p = ids.next()
        return {
            "id": nid, "type": "if",
            "data": {
                "title": title, "isValidator": True, "nodeName": title, "name": title,
                "condition_type": "Expression",
                "filter": {"list": [{"id": ids.next(), "parentId": p, "isTop": True, "prop": "", "operator": "",
                                     "valueType": "", "value": "", "type": "leaf", "level": 1}]},
                "expression": {"type": "javascript", "code": "'{{node:code_node_FcPlan.data.%s}}' == '1'" % flag},
            },
            "blocks": [
                {"id": nid.replace("if_", "if_block_") + "T", "type": "ifBlock", "data": {"title": "true"}, "blocks": true_children},
                {"id": nid.replace("if_", "if_block_") + "F", "type": "ifBlock", "data": {"title": "false"}, "blocks": []},
            ],
        }

    def update(nid, title, source, coll, ids_ref, props):
        p = ids.next()
        return {
            "id": nid, "type": "update-node",
            "data": {
                "table_id": {"source": source, "rules": {"collectionId": coll, "list": [
                    {"id": ids.next(), "parentId": p, "isTop": True, "prop": "id", "operator": "in", "valueType": "field",
                     "value": ids_ref, "type": "leaf", "level": 1, "propLabel": "主键ID", "valueLabel": "", "operatorLabel": "In"}]}},
                "fields": [], "condition": {}, "title": title, "isValidator": True, "nodeName": title, "name": title,
                "props": {"modelName": "", "list": [
                    {"prop": k, "valueType": "value", "value": v, "operator": "", "valueLabel": "", "propLabel": label}
                    for k, v, label in props]},
            },
            "blocks": [],
        }

    gate = code_node("code_node_FcGate", "Force Complete: Close Picking?", GATE_JS,
                     [resp("fcg1clos", "closePicking", "int"), resp("fcg2gdid", "gdIdSql", "string")])
    sql = sql_node("sql_node_FcPick", "Force Complete: Open Pickings Of This Delivery", pick_sql(with_jobs), [
        ("fcp1id00", "id"), ("fcp2pkid", "picking_id"), ("fcp3pkno", "picking_no"), ("fcp4gdid", "gd_id"),
        ("fcp5lnst", "line_status"), ("fcp6proc", "is_processing"), ("fcp7lage", "lock_age_sec"), ("fcp8jobs", "open_jobs")])
    plan = code_node("code_node_FcPlan", "Force Complete: Picking Close Plan", PLAN_JS, [
        resp("fcn1busy", "busy", "int"), resp("fcn2bmsg", "busyMessage", "string"),
        resp("fcn3line", "lineIds", "array"), resp("fcn4hasl", "hasLineIds", "int"),
        resp("fcn5pick", "pickingIds", "array"), resp("fcn6hasp", "hasPickingIds", "int")])
    busy_return = {
        "id": "return_node_FcBusy", "type": "return-node",
        "data": {
            "return_data": {}, "status_code": 200, "title": "Return Picking Busy", "isValidator": True,
            "nodeName": "Return Picking Busy", "name": "Return Picking Busy",
            "response_value": {"list": [
                {"prop": "code", "propLabel": "code", "operator": "", "operatorLabel": "", "valueType": "value",
                 "valueTypeLabel": "", "value": "400", "valueLabel": ""},
                {"prop": "message", "operator": "", "valueType": "field", "value": "{{node:code_node_FcPlan.data.busyMessage}}",
                 "valueLabel": "", "propLabel": "message"}]},
            "return_raw_data": 0,
        },
        "blocks": [],
    }
    gate_if = if_rule("if_FcGate", "IF Force Complete Closes Picking", "node.code_node_FcGate.data.closePicking", [
        sql, plan, if_expr("if_FcBusy", "IF Picking Being Confirmed", "busy", [busy_return])])
    apply_if = if_rule("if_FcApply", "IF Force Complete Closes Picking (after write)", "node.code_node_FcGate.data.closePicking", [
        if_expr("if_FcLines", "IF Picking Rows To Close", "hasLineIds", [update(
            "update_node_FcLines", "Close Picking Rows", "transfer_order_jz8m9w3h_sub:Table:1939915130724524033",
            "1939915130724524033", "{{node:code_node_FcPlan.data.lineIds}}",
            [("line_status", "Completed", "Line Status"), ("pending_process_qty", 0, "Pending Process Quantity")])]),
        if_expr("if_FcPickings", "IF Pickings To Close", "hasPickingIds", [update(
            "update_node_FcPickings", "Close Pickings", "Transfer Order Picking:Table:1935556443668959233",
            "1935556443668959233", "{{node:code_node_FcPlan.data.pickingIds}}",
            [("to_status", "Completed", "Transfer Order Status")])]),
    ])
    return [gate, gate_if], [apply_if]

def structural(base, with_jobs):
    pre, post = build_nodes(base, with_jobs)
    target = copy.deepcopy(base)
    block = find(target["nodes"], "ifBlock_BqSSrIXL")["blocks"]
    ids = [n["id"] for n in block]
    i = ids.index("if_PreflightFail01")
    assert ids[i + 1] == "if_6NBus87x", ids[i + 1]
    block[i + 1:i + 1] = pre
    ids = [n["id"] for n in block]
    j = ids.index("if_fLWMe4c5")
    block[j + 1:j + 1] = post
    return target, pre, post

def render(obj, pad):
    s = json.dumps(obj, indent=2, ensure_ascii=False)
    s = re.sub(r'"data": \{\n\s*"title": "(true|false)"\n\s*\}', r'"data": { "title": "\1" }', s)
    return "\n".join(pad + ln for ln in s.split("\n"))

def insert_before(text, nid, nodes, pad):
    anchor = f'{pad}{{\n{pad}  "id": "{nid}",'
    assert text.count(anchor) == 1, nid
    k = text.index(anchor)
    return text[:k] + "".join(render(n, pad) + ",\n" for n in nodes) + text[k:]

# ---------------------------------------------------------------- prod: enabled prod + same nodes, no job table
prod_base = dump("prod")
prod_target, pre, post = structural(prod_base, with_jobs=False)
prod_text = json.dumps(prod_target, indent=2, ensure_ascii=False) + "\n"
open(PROD_OUT, "w", encoding="utf-8").write(prod_text)
print("wrote", PROD_OUT)

