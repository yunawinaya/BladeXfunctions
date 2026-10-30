"""live_test.py: GD_BULK_PREPARE bin names on dev 000000 after the publish (user's yes 10-30). SO/20261013-019 (TES501 1, TES502 1,
both auto-allocated) goes through SO_AUTO_GD v2 -> GD_ASYNC_WORKER; every stock line's view_stock must name its bins by
bin_location_combine (the bins in its temp_qty_data), never by id. GD Cancel V2 then cancels the test GD (SO lines back to 0,
reservations released)."""
import json
import re
import subprocess
import sys
import time

T = "scratchpad/gdc/gdcreate/deploy_bin_names"
RUNAS = ["node", "scratchpad/gdc/tools/runas.mjs", "scratchpad/gdc/tools/id000000.json"]
AUTO, WORKER = "2076557490389835777", "2104840667119411201"
CAN_SUBMIT, CAN_WORKER = "2112455664139866113", "2112455700319932418"
ORG, PLANT, SO_ID = "1123598813738675201", "1123598813738675202", "2109851081567735810"
DONE = ("COMPLETED", "FAILED", "CANCELLED", "REQUIRES_REVIEW", "AWAITING_CONFIRMATION")


def q(sql):
    out = subprocess.run([".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit("db read failed: " + out.stderr.strip()[-300:])
    return json.loads(out.stdout[out.stdout.find("["):])


def run(wf, name, body):
    open("%s/%s.req.json" % (T, name), "w").write(json.dumps(body))
    subprocess.run(RUNAS + [wf, "%s/%s.req.json" % (T, name), "%s/%s.out.json" % (T, name)], capture_output=True, text=True)
    try:
        return json.load(open("%s/%s.out.json" % (T, name)))
    except Exception as e:
        return {"error": str(e)}


def job(j):
    r = q("SELECT job_status, IFNULL(error_code, '') AS e, LEFT(IFNULL(error_message, ''), 240) AS m, CAST(IFNULL(gd_id, 0) AS CHAR) AS gd_id, "
          "IFNULL(gd_no, '') AS gd_no FROM gd_async_job WHERE tenant_id = '000000' AND id = %s" % j)
    return r[0] if r else {}


def follow(worker, j, label, tries=12):
    for k in range(tries):
        run(worker, "%s_kick%d" % (label, k), {"job_id": j})
        s = job(j)
        print("  %s kick %d: %s %s %s" % (label, k + 1, s.get("job_status"), s.get("e"), s.get("m", "")[:100] if s.get("e") else ""))
        if s.get("job_status") in DONE:
            return s
        time.sleep(4)
    return job(j)


def check_names(gd):
    ok = True
    for r in q("SELECT line_index, CAST(material_id AS CHAR) AS mat, temp_qty_data AS tq, view_stock AS vs FROM goods_delivery_fwii8mvb_sub "
               "WHERE goods_delivery_id = %s AND is_deleted = 0 ORDER BY line_index" % gd):
        bins = sorted({str(a.get("location_id")) for a in json.loads(r["tq"] or "[]") if a.get("location_id")})
        names = {x["id"]: x["n"] for x in q("SELECT CAST(id AS CHAR) AS id, bin_location_combine AS n FROM bin_location WHERE id IN (%s)" % (",".join(bins) or "0"))}
        labels = re.findall(r"^\d+\. (.+?): ", r["vs"] or "", re.M)
        good = bool(labels) and not any(re.fullmatch(r"\d{18,20}", l) for l in labels) and set(labels) <= set(names.values())
        ok = ok and good
        print("  line %s: bins %s -> labels %s %s" % (r["line_index"], [names.get(b, b) for b in bins], labels, "OK" if good else "FAIL"))
        print("    view_stock: %s" % (r["vs"] or "").replace("\n", " | "))
    return ok


print("SO lines before:", q("SELECT CAST(item_name AS CHAR) AS mat, IFNULL(planned_qty, 0) AS planned FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0 ORDER BY id" % SO_ID))
if "--job" in sys.argv:  # resume a create job already queued
    queued = [{"job_id": sys.argv[sys.argv.index("--job") + 1]}]
else:
    a = (run(AUTO, "auto", {"so_ids": [SO_ID], "gd_type": "multiple", "plant_id": PLANT, "organization_id": ORG, "created_by": "live-test", "v2": "1"}).get("data") or {})
    print("SO_AUTO_GD: code %s | %s | queued %s" % (a.get("code"), str(a.get("message"))[:160], a.get("queued")))
    queued = a.get("queued") or []
if queued:
    s = follow(WORKER, str(queued[0]["job_id"]), "create")
    print("create job:", s)
    gd = s.get("gd_id")
    if gd and gd != "0":
        time.sleep(2)
        print("RESULT:", "PASS" if check_names(gd) else "FAIL")
        c = (run(CAN_SUBMIT, "cancel_submit", {"operation": "SUBMIT", "gd_id": gd, "source": "LIST"}).get("data") or {})
        print("cancel submit:", {k: c.get(k) for k in ("route", "code", "message", "job_id", "job_status")})
        if c.get("job_id"):
            print("cancel job:", follow(CAN_WORKER, str(c["job_id"]), "cancel"))
        time.sleep(2)
        print("GD after:", q("SELECT delivery_no, gd_status FROM goods_delivery WHERE id = %s" % gd))
        print("reservations left:", q("SELECT status, COUNT(*) AS n, SUM(open_qty) AS open_q FROM on_reserved_gd WHERE tenant_id = '000000' AND target_gd_id = %s AND is_deleted = 0 AND open_qty > 0 GROUP BY status" % gd))
print("SO lines after:", q("SELECT CAST(item_name AS CHAR) AS mat, IFNULL(planned_qty, 0) AS planned FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0 ORDER BY id" % SO_ID))
