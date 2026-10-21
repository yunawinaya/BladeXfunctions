"""live_fc.py: Picking 1d live runs on DEV 496474 (Task 18 step 3 / Task 19). Reads only; requests and answers go to the
git-ignored workspace (tenant data never enters the repo).
  req <picking_id> classic <out>   PICKING_LOOP's classic force complete, as the list sends it (ForceCompleteWorkflow.js:
                                   the stored record with its items and records, saveAs Completed, pageStatus Edit,
                                   isForceComplete 1)
  req <picking_id> v2 <out>        PICKING_ASYNC_SUBMIT FORCE_COMPLETE, as the list sends it (payload "{}")
  fcon <out>                       the repo PICKING_ASYNC_SUBMIT with STAGE.FORCE_COMPLETE true (run with runas.mjs --test:
                                   nothing published)
  mark                             the newest run id of the tenant (su_code_workflow_inst)
  runs <after_id>                  every run of the tenant after that id: workflow, status, run time, node data size"""
import json
import sys
import time

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("g", "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/prepare/sql.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

TENANT = "496474"
T = f"tenant_id = '{TENANT}'"
REPO = "/Users/yunawinaya/Developer/BladeXfunctions/"
SYS = {"create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "sub_tenant_id", "sub_tenant_id_d_xxjld"}
NAMES = {"2109531449614647297": "PICKING_ASYNC_SUBMIT", "2109531412499251201": "PICKING_ASYNC_WORKER", "2112471278794440706": "PICKING_FC_DRIVE",
         "2110618789356687361": "GD_EDIT_WORKER", "2021065804251615233": "PICKING_LOOP", "2020683258347081730": "PICKING",
         "2017151544868491265": "GOODS_DELIVERY"}


def obj(row):
    def fix(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, int) and len(str(abs(v))) >= 16:
            return str(v)
        if isinstance(v, dict):
            return {k: fix(x) for k, x in v.items()}
        if isinstance(v, list):
            return [fix(x) for x in v]
        return v
    return {k: v for k, v in fix(json.loads(row["j"])).items() if k not in SYS}


def req(pick, mode, out):
    assert pick.isdigit() and mode in ("classic", "v2")
    rows = [obj(r) for r in q("--dev", f"SELECT {g.jobj('t', 'transfer_order')} AS j FROM transfer_order t WHERE t.{T} AND t.id = {pick} AND t.is_deleted = 0")]
    assert len(rows) == 1, "Picking not found"
    p = rows[0]
    assert p["to_status"] == "In Progress", p["to_status"]
    if mode == "v2":
        body = {"picking_id": str(p["id"]), "organization_id": str(p["organization_id"]), "operation": "FORCE_COMPLETE",
                "idempotency_key": f"PK1D-{pick}-{int(time.time())}", "payload": "{}", "confirmed_by": "admin"}
    else:
        items = [obj(r) for r in q("--dev", f"SELECT {g.jobj('i', 'transfer_order_jz8m9w3h_sub')} AS j FROM transfer_order_jz8m9w3h_sub i WHERE i.{T} "
                                             f"AND i.transfer_order_id = {pick} AND i.is_deleted = 0 ORDER BY i.id")]
        recs = [obj(r) for r in q("--dev", f"SELECT {g.jobj('r', 'transfer_order_vrqs3cmr_sub')} AS j FROM transfer_order_vrqs3cmr_sub r WHERE r.{T} "
                                            f"AND r.transfer_order_id = {pick} AND r.is_deleted = 0 ORDER BY r.id")]
        for k in ("table_picking_items", "table_picking_records", "gd_no", "customer_id", "to_no", "assigned_to"):
            if isinstance(p.get(k), str):
                try:
                    p[k] = json.loads(p[k])
                except ValueError:
                    pass
        p.update({"table_picking_items": items, "table_picking_records": recs})
        body = {"arrayData": [p], "saveAs": "Completed", "pageStatus": "Edit", "isForceComplete": 1}
    json.dump(body, open(out, "w"))
    print(f"{mode} {p['to_id']} ({p['to_status']}) -> {out}")


def fcon(out):
    text = open(REPO + "Picking/AsyncV2/PICKING_ASYNC_SUBMIT.json", encoding="utf-8").read()
    assert text.count("FORCE_COMPLETE: false }") + text.count("FORCE_COMPLETE: true }") == 1
    open(out, "w", encoding="utf-8").write(text.replace("FORCE_COMPLETE: false }", "FORCE_COMPLETE: true }"))
    print("SUBMIT with STAGE.FORCE_COMPLETE true ->", out)


def mark():
    print(q("--dev", f"SELECT CAST(MAX(id) AS CHAR) mx FROM su_code_workflow_inst WHERE {T}")[0]["mx"])


def runs(after):
    assert after.isdigit()
    rows = q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, status, run_time, LENGTH(nodes_data) nd, LENGTH(request_json_data) rq, "
                      f"LEFT(error_msg, 120) err FROM su_code_workflow_inst WHERE {T} AND id > {after} ORDER BY id")
    big = 0
    for r in rows:
        mb = (r["nd"] or 0) / 1e6
        big = max(big, mb)
        print(f"{r['id']} {NAMES.get(r['wf'], r['wf']):22} {str(r['status']):8} {str(r['run_time']):>8} ms  nodes {mb:7.2f} MB  req {(r['rq'] or 0) / 1e3:8.1f} KB  {r['err'] or ''}")
    print(f"{len(rows)} runs, largest node data {big:.2f} MB")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["req"]:
        req(a[1], a[2], a[3])
    elif a[:1] == ["fcon"]:
        fcon(a[1])
    elif a[:1] == ["mark"]:
        mark()
    elif a[:1] == ["runs"]:
        runs(a[1])
    else:
        sys.exit(__doc__)
