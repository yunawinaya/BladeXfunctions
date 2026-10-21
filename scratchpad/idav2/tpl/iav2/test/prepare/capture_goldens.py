"""Record the golden classic IA_SAVE v11 runs PREPARE is tested against (read-only: .dbtools/db SELECTs only).

usage: python3 scratchpad/iav2/test/prepare/capture_goldens.py [NAME ...]     -> dev: test/prepare/fixtures/<NAME>.json, prod: PROD_FIXTURES

Per run: the parent's request (allData minus the HTML status keys, saveAs, pageStatus) and node outputs; the child SUBTRACT_INVENTORY /
ADD_INVENTORY runs it made (their request params = what the classic sent; in id order = its loop order); the IA's rows as PREPARE's
own SQL reads them now (prepare/sql.py FP_HEADER / FP_LINES / ITEMS / bins; ia_v2_job_id -> NULL until the form publish); and the
movement rows the classic wrote (stored dates: value parity of the date texts). Ids of 16+ digits are kept as text.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(IAV2, "lib"))
from dbq import q  # noqa: E402
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("ia_prepare_sql", os.path.join(IAV2, "prepare", "sql.py"))
PSQL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PSQL)

# prod-derived captures are written outside every git repo (prod business data never enters the working tree)
PROD_FIXTURES = "/Users/yunawinaya/Documents/ASC-dev/iav2-fixtures/a"
SUBTRACT = "2012096660219564034"
ADD = "2012005532688723970"
GOLDENS = {
    "dev_fixedcost_manualbatch": ("--dev", "2110283306516287490", "Fixed Cost parent, Manual batch, Blocked receipt (Add, manual number)"),
    "dev_fifo_nonbatch": ("--dev", "2110283309582323714", "TES500 FIFO non-batch (Add)"),
    "prod_edit_genbatch": ("--prod", "2110996652046290946", "Edit, generated batch, 4 picks"),
    "prod_add_fifo_nonbatch": ("--prod", "2110902320375140354", "Add, FIFO non-batch"),
    "prod_multilayer_fifo": ("--prod", "2110643927261515777", "Add, multi-layer FIFO"),
}
BIG = re.compile(r'"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))')
NODES = ["code_fillback", "search_items", "code_batch_decide", "code_batch_number", "code_persisted", "code_receipt_prep", "code_item_txn", "search_movements",
         "add_ia", "get_ia", "wf_add"]


def jl(t):
    if t is None:
        return None
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(2) is None else m.group(1) + '"' + m.group(2) + '"', t))


def slim(o):
    if isinstance(o, dict):
        return {k: slim(v) for k, v in o.items() if not (isinstance(v, str) and v.lstrip().startswith("<!DOCTYPE"))}
    if isinstance(o, list):
        return [slim(v) for v in o]
    return o


def fill(sql, vals):
    sql = re.sub(r"\{\{node:[^}]*\.data\.([A-Za-z]+)\}\}", lambda m: vals[m.group(1)], sql)
    return sql.replace("h.ia_v2_job_id", "NULL").replace("g.ia_v2_job_id", "NULL")


def capture(name):
    env, run, note = GOLDENS[name]
    r = q(env, "SELECT CAST(id AS CHAR) AS id, workflow_name, status, run_time, tenant_id, request_json_data, nodes_data FROM su_code_workflow_inst WHERE id = %s" % run)[0]
    assert r["workflow_name"] == "IA_SAVE" and r["status"] == "Complete", (name, r["workflow_name"], r["status"])
    req = jl(r["request_json_data"])["request_json"]
    nodes = {}
    for n in jl(r["nodes_data"]) or []:
        if n.get("node_id") in NODES:
            resp = jl(n.get("response_json_data")) if n.get("response_json_data") else None
            nodes[n["node_id"]] = {"response": resp.get("data", resp) if isinstance(resp, dict) else resp}
            if n["node_id"] == "wf_add":
                nodes[n["node_id"]]["request"] = jl(n.get("request_json_data"))
    tenant = r["tenant_id"]
    persisted = nodes["code_persisted"]["response"]
    ia_id, trx = persisted["docId"], persisted["stock_movement_no"]
    hi = int(run) + ((int(r["run_time"] or 0) + 15000) << 22)
    kids = q(env, "SELECT CAST(id AS CHAR) AS id, CAST(workflow_id AS CHAR) AS wf, status, request_json_data, response_json_data FROM su_code_workflow_inst "
                  "WHERE id BETWEEN %s AND %d AND workflow_id IN (%s, %s) AND tenant_id = '%s' ORDER BY id" % (run, hi, SUBTRACT, ADD, tenant))
    subs, adds = [], []
    for k in kids:
        p = (jl(k["request_json_data"]) or {}).get("request_json") or {}
        if p.get("trx_no") != trx or p.get("transaction_type") != "IA":
            continue
        p.pop("itemData", None)
        out = {"id": k["id"], "status": k["status"], "params": p, "response": jl(k["response_json_data"])}
        (subs if k["wf"] == SUBTRACT else adds).append(out)
    vals = {"tenantId": tenant, "jobId": "0", "iaId": ia_id}
    db = {k: q(env, fill(PSQL.READS[k][0], vals)) for k in ("hdr", "lines", "items", "bins")}
    esc = trx.replace("'", "''")
    db["movements"] = q(env, "SELECT CAST(m.id AS CHAR) AS id, m.movement, CAST(m.item_id AS CHAR) AS item_id, CAST(m.bin_location_id AS CHAR) AS bin, "
                             "CAST(m.batch_number_id AS CHAR) AS batch, m.inventory_category, m.quantity, m.base_qty, m.unit_price, m.total_price, "
                             "DATE_FORMAT(m.doc_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS doc_date, DATE_FORMAT(m.manufacturing_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS mfg, "
                             "DATE_FORMAT(m.expired_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS exp, m.parent_trx_no FROM inventory_movement m "
                             "WHERE m.tenant_id = '%s' AND m.id > %s AND m.trx_no = '%s' AND m.transaction_type = 'IA' AND m.is_deleted = 0 ORDER BY m.id" % (tenant, ia_id, esc))
    db["state"] = q(env, "SELECT item_assembly_status, posted_status, DATE_FORMAT(update_time, '%%Y-%%m-%%d %%H:%%i:%%s') AS update_time FROM sm_item_assembly "
                         "WHERE tenant_id = '%s' AND id = %s" % (tenant, ia_id))
    # the Batch row ADD_INVENTORY's add_node_F9KqZLfd inserted for the receipt (BATCH's golden; a reverted IA's row is soft-deleted)
    bids = [str(((a["response"] or {}).get("data") or {}).get("batchId") or "") for a in adds]
    bids = [b for b in bids if b.isdigit()]
    db["batch"] = q(env, "SELECT CAST(b.id AS CHAR) AS id, b.batch_number, CAST(b.material_id AS CHAR) AS material_id, b.initial_quantity, b.transaction_no, "
                         "CAST(b.plant_id AS CHAR) AS plant_id, b.organization_id, b.remark, b.remark2, b.remark3, "
                         "DATE_FORMAT(b.manufacturing_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS manufacturing_date, DATE_FORMAT(b.expired_date, '%%Y-%%m-%%d %%H:%%i:%%s') AS expired_date, "
                         "b.parent_transaction_no, b.is_deleted FROM batch b WHERE b.tenant_id = '%s' AND b.id IN (%s)" % (tenant, ",".join(["0"] + bids)))
    fx = {"name": name, "env": env, "run": run, "note": note, "tenant": tenant, "ia_id": ia_id, "trx_no": trx,
          "parent": {"saveAs": req.get("saveAs"), "pageStatus": req.get("pageStatus"), "allData": slim(req.get("allData")), "nodes": slim(nodes)},
          "children": {"subtract": subs, "add": adds}, "db": db}
    folder = PROD_FIXTURES if env == "--prod" else os.path.join(HERE, "fixtures")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(fx, f, ensure_ascii=False, indent=1)
    print("%-28s %s %s  %s  subtract %d  add %d  lines %d  items %d  bins %d  movements %d  state %s" % (
        name, env, run, trx, len(subs), len(adds), len(db["lines"]), len(db["items"]), len(db["bins"]), len(db["movements"]), db["state"]))


if __name__ == "__main__":
    for n in (sys.argv[1:] or list(GOLDENS)):
        capture(n)
