"""live_test.py: non-stock lines through GD Created V2 on dev 711077 (user's yes 10-23). SO/20261006-029 is one item bundle of 330
items: 327 stock items plus three non-stock ones (I-DL / I-IDL / I-VO: stock_control 0, show_delivery 0). SO_AUTO_GD (v2 "1")
must now plan it V2 (before: CLASSIC, "not a stock-controlled item"); the worker runs PREPARE + COMMIT. Checked from the tables:
the non-stock lines are written with temp_qty_data "[]" and packing Completed, get no reservation and no movement, and their
sales order lines are planned like any line; the bundle row's sales order line stays untouched. SO_AUTO_GD's gate needs
picking_setup.convert_gd_created = 1: set on the organization's two rows for the run, restored in finally."""
import json
import subprocess
import time

T = "scratchpad/gdc/gdcreate/nonstock"
RUNAS = ["node", "scratchpad/gdc/tools/runas.mjs", "scratchpad/gdc/tools/id711077.json"]
AUTO, WORKER = "2076557490389835777", "2104840667119411201"
ORG = "2105190589240086530"
SO_ID = "2107314676375941122"
SETUP_IDS = "2106278678876041218, 2106278679383552001"
NONSTOCK = "'2105490681599791130', '2105490681599791131', '2105490681599791132'"


def q(sql):
    out = subprocess.run([".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True).stdout
    return json.loads(out[out.index("\n[") + 1:]) if "\n[" in out else (json.loads(out[out.index("["):]) if out.lstrip().startswith("[") else [])


def dbw(sql):
    out = subprocess.run([".dbtools/dbw", sql, "--execute"], capture_output=True, text=True).stdout
    print("  dbw:", (out.strip().splitlines() or ["?"])[-1])


def run(wf, name, body):
    open("%s/%s.req.json" % (T, name), "w").write(json.dumps(body))
    subprocess.run(RUNAS + [wf, "%s/%s.req.json" % (T, name), "%s/%s.out.json" % (T, name)], capture_output=True, text=True)
    try:
        return json.load(open("%s/%s.out.json" % (T, name)))
    except Exception as e:
        return {"error": str(e)}


def job(j):
    r = q("SELECT job_status, IFNULL(error_code, '') AS e, LEFT(IFNULL(error_message, ''), 200) AS m, attempt_count AS a, IFNULL(gd_no, '') AS gd_no, "
          "CAST(IFNULL(gd_id, 0) AS CHAR) AS gd_id FROM gd_async_job WHERE tenant_id = '711077' AND id = %s" % j)
    return r[0] if r else {}


print("SO lines before:", q("SELECT COUNT(*) AS n, SUM(IFNULL(planned_qty, 0)) AS planned FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0" % SO_ID))
dbw("UPDATE picking_setup SET convert_gd_created = 1 WHERE tenant_id = '711077' AND id IN (%s) AND convert_gd_created = 0" % SETUP_IDS)
try:
    t0 = time.time()
    a = (run(AUTO, "auto", {"so_ids": [SO_ID], "gd_type": "multiple", "plant_id": ORG, "organization_id": ORG, "created_by": "live-test", "v2": "1"}).get("data") or {})
    print("SO_AUTO_GD (%.1f s): code %s | %s | created %s | blocked %s | queued %s" % (time.time() - t0, a.get("code"), str(a.get("message"))[:160], a.get("created"), a.get("blocked"), a.get("queued")))
    queued = a.get("queued") or []
    if queued:
        J = str(queued[0]["job_id"])
        t0 = time.time()
        for k in range(12):
            run(WORKER, "kick%d" % k, {"job_id": J})
            s = job(J)
            print("  kick %d (%.0f s): %s %s %s" % (k + 1, time.time() - t0, s.get("job_status"), s.get("e"), s.get("gd_no")))
            if s.get("job_status") in ("COMPLETED", "FAILED", "CANCELLED", "REQUIRES_REVIEW", "AWAITING_CONFIRMATION"):
                break
            time.sleep(5)
        s = job(J)
        print("job:", s)
        gd = s.get("gd_id")
        if gd and gd != "0":
            print("GD lines:", q("SELECT COUNT(*) AS n, SUM(material_id IN (%s)) AS nonstock FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id = %s AND is_deleted = 0" % (NONSTOCK, gd)))
            print("non-stock GD lines:", q("SELECT line_index, gd_qty, base_qty, temp_qty_data, IFNULL(picking_status, '') AS picking, IFNULL(packing_status, '') AS packing, CAST(so_line_item_id AS CHAR) AS so_line FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id = %s AND is_deleted = 0 AND material_id IN (%s) ORDER BY line_index" % (gd, NONSTOCK)))
            print("header:", q("SELECT delivery_no, gd_status, IFNULL(picking_status, '') AS picking FROM goods_delivery WHERE id = %s" % gd))
            print("reservations:", q("SELECT COUNT(*) AS n, SUM(material_id IN (%s)) AS nonstock FROM on_reserved_gd WHERE tenant_id = '711077' AND doc_id = %s AND is_deleted = 0" % (NONSTOCK, gd)))
            print("movements:", q("SELECT COUNT(*) AS n, SUM(item_id IN (%s)) AS nonstock FROM inventory_movement WHERE tenant_id = '711077' AND trx_no = (SELECT delivery_no FROM goods_delivery WHERE id = %s) AND is_deleted = 0" % (NONSTOCK, gd)))
            print("SO lines after:", q("SELECT line_index, so_quantity, IFNULL(planned_qty, 0) AS planned FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0 AND (item_name IN (%s) OR parent_id IS NULL OR line_index IN ('1/1', '1/2')) ORDER BY id" % (SO_ID, NONSTOCK)))
            print("SO lines total:", q("SELECT COUNT(*) AS n, SUM(IFNULL(planned_qty, 0)) AS planned, SUM(planned_qty = so_quantity) AS full FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0" % SO_ID))
finally:
    dbw("UPDATE picking_setup SET convert_gd_created = 0 WHERE tenant_id = '711077' AND id IN (%s) AND convert_gd_created = 1" % SETUP_IDS)
    print("setup after:", q("SELECT CAST(id AS CHAR) AS id, convert_gd_created FROM picking_setup WHERE tenant_id = '711077' AND id IN (%s)" % SETUP_IDS))
