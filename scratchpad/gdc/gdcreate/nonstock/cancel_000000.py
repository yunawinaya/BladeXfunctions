"""cancel_000000.py: the cancel half of live_test_000000.py (its reads parsed nothing - the database tool's banner goes to stderr - so it
never cancelled). GD/20261023/616 (TES501 stock line + TES502 line created while TES502 was non-stock): TES502 is marked
non-stock again for the cancel, GD Cancel V2 cancels the GD, the tables are read, and TES502 is restored in finally."""
import json
import subprocess
import time

T = "scratchpad/gdc/gdcreate/nonstock"
RUNAS = ["node", "scratchpad/gdc/tools/runas.mjs", "scratchpad/gdc/tools/id000000.json"]
CAN_SUBMIT, CAN_WORKER = "2112455664139866113", "2112455700319932418"
GD, SO_ID, TES502 = "2113529814227144705", "2109851081567735810", "2094626841323700253"


def q(sql):
    out = subprocess.run([".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True).stdout
    return json.loads(out[out.index("["):]) if "[" in out else []


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
    r = q("SELECT job_status, IFNULL(error_code, '') AS e, LEFT(IFNULL(error_message, ''), 240) AS m FROM gd_async_job WHERE tenant_id = '000000' AND id = %s" % j)
    return r[0] if r else {}


print("TES502 before:", q("SELECT stock_control, IFNULL(show_delivery, 'NULL') AS sd FROM item WHERE id = %s" % TES502))
dbw("UPDATE item SET stock_control = 0, show_delivery = 0 WHERE id = %s AND tenant_id = '000000' AND stock_control = 1 AND show_delivery IS NULL" % TES502)
try:
    c = run(CAN_SUBMIT, "cancel_submit", {"operation": "SUBMIT", "gd_id": GD, "source": "LIST"})
    d = c.get("data") or {}
    print("cancel submit:", {k: d.get(k) for k in ("route", "code", "message", "reason", "job_id", "job_status")}, str(c.get("msg") or "")[:160])
    J = str(d.get("job_id") or "")
    if J:
        t0 = time.time()
        for k in range(12):
            run(CAN_WORKER, "cancel_kick%d" % k, {"job_id": J})
            s = job(J)
            print("  cancel kick %d (%.0f s): %s %s %s" % (k + 1, time.time() - t0, s.get("job_status"), s.get("e"), s.get("m", "")[:120]))
            if s.get("job_status") in ("COMPLETED", "FAILED", "CANCELLED", "REQUIRES_REVIEW"):
                break
            time.sleep(4)
    time.sleep(2)
    print("GD:", q("SELECT delivery_no, gd_status, IFNULL(picking_status, '') AS picking FROM goods_delivery WHERE id = %s" % GD))
    print("GD lines:", q("SELECT line_index, CAST(material_id AS CHAR) AS mat, gd_qty, IFNULL(picking_status, '') AS picking, IFNULL(packing_status, '') AS packing FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id = %s AND is_deleted = 0 ORDER BY line_index" % GD))
    print("reservations:", q("SELECT CAST(material_id AS CHAR) AS mat, status, reserved_qty FROM on_reserved_gd WHERE tenant_id = '000000' AND (doc_id = %s OR target_gd_id = %s) AND is_deleted = 0" % (GD, GD)))
    print("movements:", q("SELECT trx_no, CAST(item_id AS CHAR) AS mat, movement, base_qty FROM inventory_movement WHERE tenant_id = '000000' AND trx_no LIKE 'GD/20261023/616%%' AND is_deleted = 0 ORDER BY id"))
    print("SO lines:", q("SELECT line_index, so_quantity, IFNULL(planned_qty, 0) AS planned FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0 ORDER BY id" % SO_ID))
    print("SO:", q("SELECT so_status, IFNULL(gd_status, '') AS gd_status FROM sales_order WHERE id = %s" % SO_ID))
finally:
    dbw("UPDATE item SET stock_control = 1, show_delivery = NULL WHERE id = %s AND tenant_id = '000000' AND stock_control = 0 AND show_delivery = 0" % TES502)
    print("TES502 after:", q("SELECT stock_control, IFNULL(show_delivery, 'NULL') AS sd FROM item WHERE id = %s" % TES502))
