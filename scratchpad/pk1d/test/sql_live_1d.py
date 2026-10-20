"""sql_live_1d.py drive|loop|status: Picking 1d's new reads run read-only on DEV. drive = sql_drive_live.py (PICKING_FC_DRIVE's three reads);
loop = PICKING_LOOP's lock gate with the open-job column: as built on a Picking whose job is finished (open_job NULL) and as a
must-match variant (COMPLETED counted open) that must find that job."""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

OPEN = "('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING', 'REQUIRES_REVIEW')"


def loop():
    with open(os.path.join(HERE, "..", "code", "loop_openjob.sql"), encoding="utf-8") as f:
        sql = f.read()
    # PI-20261020-0081 on 496474: its CONFIRM_PICKING job is COMPLETED
    pick, job = "2112378032604360705", "2112396481570902018"
    text = sql.replace("{{node:code_node_hjAwTKzF.data.lockId}}", pick)
    assert "{{" not in text and OPEN in text
    rows = q("--dev", text)
    ok1 = len(rows) == 1 and str(rows[0]["id"]) == pick and rows[0]["open_job"] is None and rows[0]["lock_age_sec"] is not None
    print("loop gate as built (a finished job: open_job NULL)           %s  %s" % ("OK  " if ok1 else "FAIL", {k: rows[0][k] for k in rows[0]} if rows else rows))
    rows = q("--dev", text.replace(OPEN, OPEN[:-1] + ", 'COMPLETED')"))
    ok2 = len(rows) == 1 and str(rows[0]["open_job"] or "").startswith(job + "|COMPLETED")
    print("loop gate must-match (COMPLETED counted open: finds the job)  %s  %s" % ("OK  " if ok2 else "FAIL", rows[0]["open_job"] if rows else rows))
    return ok1 and ok2


def status():
    """STATUS (and the worker's final read): the kick column, gated to an open force complete, its edits through job_status"""
    ok = True
    for name, tokens in (("submit_status.sql", {"code_node_PSguard.data.tenantId": "496474", "code_node_PSguard.data.organizationId": "1901545950162329602",
                                               "code_node_PSguard.data.pickingId": "2112378032604360705"}),
                         ("worker_final.sql", {"code_node_PWguard.data.tenantId": "496474", "code_node_PWplan.data.jobIdsSql": "2112396481570902018"})):
        with open(os.path.join(HERE, "..", "code", name), encoding="utf-8") as f:
            sql = f.read()
        for k, v in tokens.items():
            sql = sql.replace("{{node:%s}}" % k, v)
        assert "{{" not in sql
        rows = q("--dev", sql)
        good = len(rows) == 1 and rows[0]["kick"] is None
        print("%-18s a finished confirm: kick NULL  %s  %s" % (name, "OK  " if good else "FAIL", {k: rows[0][k] for k in ("id", "job_status", "kick")} if rows else rows))
        ok &= good
        sub = sql[sql.index("FROM gd_async_job e"):sql.index("END AS kick")].rstrip().rstrip(")").replace("= j.id", "= 1").replace("j.tenant_id", "'496474'")
        plan = q("--dev", "EXPLAIN SELECT e.id " + sub)
        idx = [(p["table"], p["type"], p["key"], p["rows"]) for p in plan]
        good = any(p["type"] == "range" and p["key"] in ("Worker Poll", "Lease Recovery") for p in plan)
        print("%-18s the edits read through job_status: %s  %s" % (name, "OK  " if good else "FAIL", idx))
        ok &= good
    return ok


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else ""
    if what == "status":
        sys.exit(0 if status() else 1)
    if what == "drive":
        sys.exit(subprocess.run([sys.executable, os.path.join(HERE, "sql_drive_live.py")]).returncode)
    if what == "loop":
        sys.exit(0 if loop() else 1)
    sys.exit("usage: sql_live_1d.py drive|loop|status")


if __name__ == "__main__":
    main()
