"""Record the golden classic IDA_SAVE v6 runs PREPARE is tested against (read-only: .dbtools/db SELECTs only).

usage: python3 scratchpad/idav2/test/prepare/capture_goldens.py [NAME ...]     -> test/prepare/fixtures/<NAME>.json (dev data)

Per run: the parent's request (allData minus the HTML widget values, saveAs, pageStatus) and the node outputs PREPARE's lifted bodies
mirror (itemData dropped); the child SUBTRACT_INVENTORY / ADD_INVENTORY runs it made (their request params = what the classic sent, in
id order = its loop order); the IDA's rows as PREPARE's own SQL reads them now (prepare/sql.py READS; ida_v2_job_id -> NULL until the
form publish); the movement rows and Batch rows the classic wrote. Ids of 16+ digits are kept as text.
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(IDAV2, "lib"))
from dbq import q  # noqa: E402
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("ida_prepare_sql", os.path.join(IDAV2, "prepare", "sql.py"))
PSQL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PSQL)

SUBTRACT = "2012096660219564034"
ADD = "2012005532688723970"
GOLDENS = {
    "dev_ida_2610_003": ("--dev", "2110985743831793666", "IDA-2610-003: 4 lines (NONE, AUTO, TYPED manual, NONE in another UOM / bin), 1 pick"),
    "dev_ida_2610_002": ("--dev", "2110936708288786433", "IDA-2610-002: 2 NONE lines, 1 pick, zero-cost source"),
    "dev_ida_2610_001": ("--dev", "2107733122596405250", "IDA-2610-001 (10-07): 3 lines (NONE, AUTO, TYPED manual), 1 pick, the 0.83333333 split"),
}
BIG = re.compile(r'"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))')
NODES = ["code_fillback", "search_items", "code_batch_plan", "get_batches_final", "code_apply_batches", "code_persisted", "code_issue_prep", "search_movements",
         "code_cost_alloc", "code_item_txn"]
ITEM_KEYS = ["id", "material_code", "material_name", "stock_control", "serial_number_management", "item_batch_management", "batch_number_genaration",
             "material_costing_method", "based_uom", "item_category", "item_group_id", "table_uom_conversion"]


def jl(t):
    if t is None:
        return None
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(2) is None else m.group(1) + '"' + m.group(2) + '"', t))


def slim(o):
    if isinstance(o, dict):
        return {k: slim(v) for k, v in o.items() if not (isinstance(v, str) and v.lstrip().startswith("<!DOCTYPE")) and k != "itemData"}
    if isinstance(o, list):
        return [slim(v) for v in o]
    return o


def slim_item(it):
    o = {k: it.get(k) for k in ITEM_KEYS if k in it}
    o["table_uom_conversion"] = [{"alt_uom_id": c.get("alt_uom_id"), "base_qty": c.get("base_qty")} for c in it.get("table_uom_conversion") or []]
    return o


def fill(sql, vals):
    sql = re.sub(r"\{\{node:[^}]*\.data\.([A-Za-z]+)\}\}", lambda m: vals[m.group(1)], sql)
    return sql.replace("h.ida_v2_job_id", "NULL").replace("g.ida_v2_job_id", "NULL")


def capture(name):
    env, run, note = GOLDENS[name]
    r = q(env, "SELECT CAST(id AS CHAR) AS id, workflow_name, status, run_time, tenant_id, request_json_data, nodes_data FROM su_code_workflow_inst WHERE id = %s" % run)[0]
    assert r["workflow_name"] == "IDA_SAVE" and r["status"] == "Complete", (name, r["workflow_name"], r["status"])
    req = jl(r["request_json_data"])["request_json"]
    nodes = {}
    for n in jl(r["nodes_data"]) or []:
        if n.get("node_id") in NODES:
            resp = jl(n.get("response_json_data")) if n.get("response_json_data") else None
            data = resp.get("data", resp) if isinstance(resp, dict) else resp
            if n["node_id"] == "search_items":
                data = dict(data, data=[slim_item(it) for it in data.get("data") or []])
            nodes[n["node_id"]] = {"response": slim(data)}
    tenant = r["tenant_id"]
    persisted = nodes["code_persisted"]["response"]
    ida_id, trx = persisted["docId"], persisted["stock_movement_no"]
    hi = int(run) + ((int(r["run_time"] or 0) + 15000) << 22)
    kids = q(env, "SELECT CAST(id AS CHAR) AS id, CAST(workflow_id AS CHAR) AS wf, status, request_json_data, response_json_data FROM su_code_workflow_inst "
                  "WHERE id BETWEEN %s AND %d AND workflow_id IN (%s, %s) AND tenant_id = '%s' ORDER BY id" % (run, hi, SUBTRACT, ADD, tenant))
    subs, adds = [], []
    for k in kids:
        p = (jl(k["request_json_data"]) or {}).get("request_json") or {}
        if p.get("trx_no") != trx or p.get("transaction_type") != "IDA":
            continue
        p.pop("itemData", None)
        out = {"id": k["id"], "status": k["status"], "params": p, "response": jl(k["response_json_data"])}
        (subs if k["wf"] == SUBTRACT else adds).append(out)
    vals = {"tenantId": tenant, "idaId": ida_id}
    db = {k: q(env, fill(PSQL.READS[k][0], vals)) for k in ("hdr", "lines", "items", "bins", "typed", "storage")}
    esc = trx.replace("'", "''")
    db["movements"] = q(env, "SELECT CAST(m.id AS CHAR) AS id, m.movement, CAST(m.item_id AS CHAR) AS item_id, CAST(m.bin_location_id AS CHAR) AS bin, "
                             "CAST(m.batch_number_id AS CHAR) AS batch, m.inventory_category, m.quantity, m.base_qty, m.unit_price, m.total_price, "
                             "DATE_FORMAT(m.doc_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS doc_date, DATE_FORMAT(m.manufacturing_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS mfg, "
                             "DATE_FORMAT(m.expired_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS exp, m.parent_trx_no, CAST(m.uom_id AS CHAR) AS uom_id "
                             "FROM inventory_movement m WHERE m.tenant_id = '%s' AND m.id > %s AND m.trx_no = '%s' AND m.transaction_type = 'IDA' AND m.is_deleted = 0 "
                             "ORDER BY m.id" % (tenant, run, esc))
    db["batches"] = q(env, "SELECT CAST(b.id AS CHAR) AS id, b.batch_number, CAST(b.material_id AS CHAR) AS material_id, b.initial_quantity, b.transaction_no, "
                           "CAST(b.plant_id AS CHAR) AS plant_id, b.organization_id, b.remark, b.remark2, b.remark3, "
                           "DATE_FORMAT(b.manufacturing_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS manufacturing_date, DATE_FORMAT(b.expired_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS expired_date, "
                           "b.parent_transaction_no, b.is_deleted FROM batch b WHERE b.tenant_id = '%s' AND b.id > %s AND b.transaction_no = '%s' ORDER BY b.id" % (tenant, run, esc))
    db["state"] = q(env, "SELECT item_disassembly_status, posted_status FROM sm_item_disassembly WHERE tenant_id = '%s' AND id = %s" % (tenant, ida_id))
    fx = {"name": name, "env": env, "run": run, "note": note, "tenant": tenant, "ida_id": ida_id, "trx_no": trx,
          "parent": {"saveAs": req.get("saveAs"), "pageStatus": req.get("pageStatus"), "allData": slim(req.get("allData")), "nodes": nodes},
          "children": {"subtract": subs, "add": adds}, "db": db}
    folder = os.path.join(HERE, "fixtures")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(fx, f, ensure_ascii=False, indent=1)
    print("%-18s %s %s  %s  subtract %d  add %d  lines %d  items %d  bins %d  typed %d  movements %d  batches %d  state %s" % (
        name, env, run, trx, len(subs), len(adds), len(db["lines"]), len(db["items"]), len(db["bins"]), len(db["typed"]), len(db["movements"]), len(db["batches"]),
        db["state"]))


if __name__ == "__main__":
    for n in (sys.argv[1:] or list(GOLDENS)):
        capture(n)
