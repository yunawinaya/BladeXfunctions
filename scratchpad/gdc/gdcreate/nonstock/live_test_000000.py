"""live_test_000000.py: non-stock lines through GD Created V2 on dev 000000 (user's yes 10-23: "Flip TES502 briefly").
SO/20261013-019 has two open lines, TES501 and TES502 (both stock items). TES502 is marked non-stock (stock_control 0,
show_delivery 0) for the run; SO_AUTO_GD (v2 "1") must plan the SO V2, the worker runs PREPARE + COMMIT, and the tables must
show: TES502's GD line with temp_qty_data "[]", picking + packing Completed (picking required), no reservation and no movement
for it, its sales order line planned like TES501's; the Picking without it. Then GD Cancel V2 cancels the test GD (planned
back to 0, reservation released) and TES502 is restored (stock_control 1, show_delivery NULL) in finally - after the cancel."""
import json
import subprocess
import time

T = "scratchpad/gdc/gdcreate/nonstock"
RUNAS = ["node", "scratchpad/gdc/tools/runas.mjs", "scratchpad/gdc/tools/id000000.json"]
AUTO, WORKER = "2076557490389835777", "2104840667119411201"
CAN_SUBMIT, CAN_WORKER = "2112455664139866113", "2112455700319932418"
ORG, PLANT = "1123598813738675201", "1123598813738675202"
SO_ID, TES501, TES502 = "2109851081567735810", "2094626841323700252", "2094626841323700253"
DONE = ("COMPLETED", "FAILED", "CANCELLED", "REQUIRES_REVIEW", "AWAITING_CONFIRMATION")


def q(sql):
    out = subprocess.run([".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True).stdout
    return json.loads(out[out.index("\n[") + 1:]) if "\n[" in out else []


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
    r = q("SELECT command, job_status, IFNULL(error_code, '') AS e, LEFT(IFNULL(error_message, ''), 240) AS m, attempt_count AS a, IFNULL(gd_no, '') AS gd_no, "
          "CAST(IFNULL(gd_id, 0) AS CHAR) AS gd_id FROM gd_async_job WHERE tenant_id = '000000' AND id = %s" % j)
    return r[0] if r else {}


def follow(worker, j, label, tries=12):
    t0 = time.time()
    for k in range(tries):
        run(worker, "%s_kick%d" % (label, k), {"job_id": j})
        s = job(j)
        print("  %s kick %d (%.0f s): %s %s %s" % (label, k + 1, time.time() - t0, s.get("job_status"), s.get("e"), s.get("m")[:100] if s.get("e") else ""))
        if s.get("job_status") in DONE:
            return s
        time.sleep(4)
    return job(j)


def tables(gd, when):
    print("== %s" % when)
    print("GD:", q("SELECT delivery_no, gd_status, IFNULL(picking_status, '') AS picking FROM goods_delivery WHERE id = %s" % gd))
    print("GD lines:", q("SELECT line_index, CAST(material_id AS CHAR) AS mat, gd_qty, temp_qty_data, IFNULL(picking_status, '') AS picking, IFNULL(packing_status, '') AS packing FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id = %s AND is_deleted = 0 ORDER BY line_index" % gd))
    print("reservations:", q("SELECT CAST(material_id AS CHAR) AS mat, status, reserved_qty FROM on_reserved_gd WHERE tenant_id = '000000' AND doc_id = %s AND is_deleted = 0" % gd))
    print("movements:", q("SELECT CAST(item_id AS CHAR) AS mat, movement, base_qty, IFNULL(bin_location_id, '') AS bin FROM inventory_movement WHERE tenant_id = '000000' AND trx_no = (SELECT delivery_no FROM goods_delivery WHERE id = %s) AND is_deleted = 0" % gd))
    print("SO lines:", q("SELECT line_index, CAST(item_name AS CHAR) AS mat, so_quantity, IFNULL(planned_qty, 0) AS planned, IFNULL(line_status, '') AS st FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0 ORDER BY id" % SO_ID))
    print("SO:", q("SELECT so_status, IFNULL(gd_status, '') AS gd_status FROM sales_order WHERE id = %s" % SO_ID))
    print("Picking rows:", q("SELECT p.to_id, p.to_status, CAST(r.item_code AS CHAR) AS item, r.qty_to_pick, r.line_status FROM transfer_order p JOIN transfer_order_jz8m9w3h_sub r ON r.transfer_order_id = p.id AND r.is_deleted = 0 WHERE p.tenant_id = '000000' AND p.is_deleted = 0 AND r.gd_id = '%s'" % gd))


print("TES502 before:", q("SELECT stock_control, IFNULL(show_delivery, 'NULL') AS sd FROM item WHERE id = %s" % TES502))
print("SO lines before:", q("SELECT line_index, IFNULL(planned_qty, 0) AS planned FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0 ORDER BY id" % SO_ID))
dbw("UPDATE item SET stock_control = 0, show_delivery = 0 WHERE id = %s AND tenant_id = '000000' AND stock_control = 1 AND show_delivery IS NULL" % TES502)
try:
    t0 = time.time()
    a = (run(AUTO, "auto000", {"so_ids": [SO_ID], "gd_type": "multiple", "plant_id": PLANT, "organization_id": ORG, "created_by": "live-test", "v2": "1"}).get("data") or {})
    print("SO_AUTO_GD (%.1f s): code %s | %s | created %s | blocked %s | queued %s" % (time.time() - t0, a.get("code"), str(a.get("message"))[:160], a.get("created"), a.get("blocked"), a.get("queued")))
    queued = a.get("queued") or []
    if queued:
        J = str(queued[0]["job_id"])
        s = follow(WORKER, J, "create")
        print("create job:", s)
        gd = s.get("gd_id")
        if gd and gd != "0":
            time.sleep(3)
            tables(gd, "after the V2 create")
            c = (run(CAN_SUBMIT, "cancel_submit", {"operation": "SUBMIT", "gd_id": gd, "source": "LIST"}).get("data") or {})
            print("cancel submit:", {k: c.get(k) for k in ("route", "code", "message", "job_id", "job_status")})
            if c.get("job_id"):
                s2 = follow(CAN_WORKER, str(c["job_id"]), "cancel")
                print("cancel job:", s2)
                time.sleep(2)
                tables(gd, "after GD Cancel V2")
finally:
    dbw("UPDATE item SET stock_control = 1, show_delivery = NULL WHERE id = %s AND tenant_id = '000000' AND stock_control = 0 AND show_delivery = 0" % TES502)
    print("TES502 after:", q("SELECT stock_control, IFNULL(show_delivery, 'NULL') AS sd FROM item WHERE id = %s" % TES502))
