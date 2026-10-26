#!/usr/bin/env python3
"""
Read-only LSH (128671) watch for a busy day: one screen, a few light queries (no scan of run payloads except the classic-phone
count, bounded by the window). Lines starting "ALERT" need a look; the rest is the picture.

  JOBS      background jobs created / finished in the window, by command; open jobs untouched 10+ min; jobs that went to
            REQUIRES_REVIEW or FAILED today (business refusals like GD_INSUFFICIENT_STOCK are information, not alerts)
  LATENCY   create -> finish of jobs finished in the window, per command (an alert when the average passes 300 s)
  CRASHES   GD / Picking / Packing / stock-engine / SO convert runs with status Fail in the window
  LOCKS     stock locks (not GATE rows) held 10+ min
  CLASSIC   classic mobile writes in the window by user (Packing completions, Picking confirms) - phones still on 1.1.34

Usage: python3 scratchpad/lsh_watch.py [--minutes 30] [--tenant 128671]
Run scratchpad/prod_health.py --tenant 128671 hourly as well (BALANCE, NUMBERS, GD-STOCK, MASS-WRITE).
"""
import datetime
import json
import subprocess
import sys

EPOCH = 1288834974657
MYT = datetime.timezone(datetime.timedelta(hours=8))
NOW = "DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)"
BUSINESS = ("GD_INSUFFICIENT_STOCK", "GDC_INVENTORY_INSUFFICIENT", "GD_INVALID_UOM", "GDC_NOT_ELIGIBLE", "GDX_NOT_ELIGIBLE")
CRASH_WF = ("GD_", "GOODS_DELIVERY", "PACKING", "PICKING", "INVENTORY_", "SUBTRACT_INVENTORY", "ADD_INVENTORY", "SO_AUTO_GD", "REPACKING")


def rows(sql):
    out = subprocess.run([".dbtools/db", "--prod", "--json", "--limit", "5000", sql], capture_output=True, text=True).stdout
    i = out.find("[")
    if i < 0:
        raise RuntimeError("query failed: " + sql[:80])
    return json.loads(out[i:])


def main():
    args = sys.argv[1:]
    minutes, tenant = 30, "128671"
    while args:
        a = args.pop(0)
        if a == "--minutes":
            minutes = int(args.pop(0))
        elif a == "--tenant":
            tenant = args.pop(0)
        else:
            print(__doc__)
            return 2
    assert tenant.isdigit()
    now = datetime.datetime.now(MYT)
    lo_id = (int((now - datetime.timedelta(minutes=minutes)).timestamp() * 1000) - EPOCH) << 22
    win = "%s - INTERVAL %d MINUTE" % (NOW, minutes)
    alerts = 0
    print("LSH watch %s MYT, last %d min" % (now.strftime("%H:%M"), minutes))

    made = rows("SELECT command, COUNT(*) n FROM gd_async_job WHERE tenant_id = '%s' AND is_deleted = 0 AND create_time > %s GROUP BY command ORDER BY n DESC" % (tenant, win))
    print("JOBS created: " + (", ".join("%s %s" % (r["command"], r["n"]) for r in made) or "none"))
    stale = rows("SELECT command, job_status, COUNT(*) n, MIN(update_time) oldest FROM gd_async_job WHERE tenant_id = '%s' AND is_deleted = 0 "
                 "AND job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW') AND update_time < %s - INTERVAL 10 MINUTE GROUP BY command, job_status" % (tenant, NOW))
    for r in stale:
        alerts += 1
        print("ALERT open job untouched 10+ min: %s %s x%s (oldest update %s)" % (r["command"], r["job_status"], r["n"], r["oldest"]))
    bad = rows("SELECT command, job_status, IFNULL(error_code, '') code, COUNT(*) n, MAX(update_time) latest, LEFT(MAX(IFNULL(error_message, '')), 90) msg FROM gd_async_job "
               "WHERE tenant_id = '%s' AND is_deleted = 0 AND job_status IN ('FAILED', 'REQUIRES_REVIEW') AND update_time >= DATE(%s) GROUP BY command, job_status, code ORDER BY latest DESC" % (tenant, NOW))
    for r in bad:
        business = r["job_status"] == "FAILED" and r["code"] in BUSINESS
        if not business and r["command"] != "SAVE_SO":
            alerts += 1
        print("%s %s %s %s x%s today, latest %s: %s" % ("info " if business or r["command"] == "SAVE_SO" else "ALERT", r["command"], r["job_status"], r["code"], r["n"], str(r["latest"])[11:19], r["msg"]))

    lat = rows("SELECT command, COUNT(*) n, ROUND(AVG(TIMESTAMPDIFF(SECOND, create_time, update_time))) avg_s, MAX(TIMESTAMPDIFF(SECOND, create_time, update_time)) max_s "
               "FROM gd_async_job WHERE tenant_id = '%s' AND is_deleted = 0 AND job_status = 'COMPLETED' AND update_time > %s GROUP BY command ORDER BY n DESC" % (tenant, win))
    for r in lat:
        slow = float(r["avg_s"] or 0) > 300
        alerts += 1 if slow else 0
        print("%s %-20s finished %-4s avg %5s s  max %5s s" % ("ALERT LATENCY" if slow else "LATENCY", r["command"], r["n"], r["avg_s"], r["max_s"]))

    crash = rows("SELECT workflow_name wf, COUNT(*) n, MAX(create_time) latest, LEFT(MAX(IFNULL(error_msg, '')), 110) err FROM su_code_workflow_inst "
                 "WHERE id > %d AND tenant_id = '%s' AND status = 'Fail' GROUP BY wf" % (lo_id, tenant))
    for r in crash:
        if str(r["wf"]).startswith(CRASH_WF):
            alerts += 1
            print("ALERT crash %s x%s, latest %s: %s" % (r["wf"], r["n"], str(r["latest"])[11:19], r["err"]))
    other = [r for r in crash if not str(r["wf"]).startswith(CRASH_WF)]
    if other:
        print("info other failed runs: " + ", ".join("%s x%s" % (r["wf"], r["n"]) for r in other))

    locks = rows("SELECT SUBSTRING_INDEX(owner_operation_id, '|', 1) kind, COUNT(*) n, MIN(claimed_at) oldest, MIN(owner_operation_id) sample FROM inventory_balance_lock "
                 "WHERE tenant_id = '%s' AND is_deleted = 0 AND free_token = 0 AND balance_type <> 'GATE' AND claimed_at < NOW() - INTERVAL 10 MINUTE GROUP BY kind" % tenant)
    for r in locks:
        alerts += 1
        print("ALERT stock locks held 10+ min: %s x%s since %s UTC (%s)" % (r["kind"], r["n"], r["oldest"], r["sample"]))
    # 10-26: an operation still LOCKING / LOCKED / MUTATING after its own lease ran out is frozen or orphaned (its caller may
    # have moved on to a new operation id); its keys are never released by themselves
    orphans = rows("SELECT o.operation_id op, o.operation_status st, DATE_FORMAT(o.lease_expires_at, '%%H:%%i:%%s') lease_utc, "
                   "(SELECT COUNT(*) FROM inventory_balance_lock l WHERE l.tenant_id = o.tenant_id AND l.is_deleted = 0 AND l.free_token = 0 "
                   "AND l.owner_operation_id = o.operation_id) keys_held FROM inventory_operation o WHERE o.tenant_id = '%s' AND o.is_deleted = 0 "
                   "AND o.operation_status IN ('LOCKING', 'LOCKED', 'MUTATING', 'VERIFYING') AND o.lease_expires_at < NOW() - INTERVAL 1 MINUTE "
                   "HAVING keys_held > 0" % tenant)  # a precheck WAIT expires its own lease on purpose but holds no key
    for r in orphans:
        alerts += 1
        print("ALERT stock operation past its lease: %s %s (lease %s UTC), holds %s key rows" % (r["op"], r["st"], r["lease_utc"], r["keys_held"]))

    classic = rows("SELECT IFNULL(create_user_name, create_user) u, workflow_name wf, COUNT(*) n FROM su_code_workflow_inst WHERE id > %d AND tenant_id = '%s' "
                   "AND ((workflow_name = 'PACKING_SAVE' AND JSON_UNQUOTE(JSON_EXTRACT(request_json_data, '$.workflowparams.saveAs')) = 'Completed') "
                   "OR (workflow_name = 'PICKING_LOOP' AND JSON_UNQUOTE(JSON_EXTRACT(request_json_data, '$.workflowparams.saveAs')) = 'Completed' "
                   "AND JSON_UNQUOTE(JSON_EXTRACT(request_json_data, '$.workflowparams.pageStatus')) = 'Edit')) GROUP BY u, wf" % (lo_id, tenant))
    print("CLASSIC writes: " + (", ".join("%s %s x%s" % (r["u"], "Packing" if r["wf"] == "PACKING_SAVE" else "Picking", r["n"]) for r in classic) or "none"))
    print("ALERTS: %d" % alerts if alerts else "OK: nothing needs a look")
    return 1 if alerts else 0


if __name__ == "__main__":
    sys.exit(main())
