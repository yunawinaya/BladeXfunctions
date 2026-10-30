"""Read-only: every 2 min, the bulk SO -> GD converts (5+ GDs from one user in one minute) queued after the paste. When one has
ended, prints its GDs, seconds until the last one, seconds per GD, and which code ran it: NEW (one worker run at a time) or OLD
(a browser not refreshed since the paste: one run per GD in the same moment). Exits after the first NEW batch.
usage: python3 watch_first_batch.py [--hours 4]"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.abspath(os.path.join(HERE, "..", "..", ".dbtools", "db"))
WORKER = "2104840667119411201"


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    return None if out.returncode else json.loads(out.stdout[out.stdout.find("["):])


hours = float(sys.argv[sys.argv.index("--hours") + 1]) if "--hours" in sys.argv else 4
since = None
while since is None:
    r = q("SELECT CAST(id AS CHAR) id FROM su_code_pages_history WHERE data_id = 1901872125787099137 AND status = 'enabled' ORDER BY id DESC LIMIT 1")
    since = r[0]["id"] if r else None
    if since is None:
        time.sleep(60)
done = set()
end = time.time() + hours * 3600
while time.time() < end:
    rows = q("SELECT j.tenant_id t, CAST(j.create_user AS CHAR) u, DATE_FORMAT(MIN(j.create_time), '%m-%d %H:%i:%s') batch, CAST(MIN(j.id) AS CHAR) first_id, "
             "COUNT(*) gds, SUM(j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW')) open_jobs, SUM(j.job_status <> 'COMPLETED') not_completed, "
             "MAX(TIMESTAMPDIFF(SECOND, j.create_time, CONVERT_TZ(j.finished_at, '+00:00', '+08:00'))) last_s FROM gd_async_job j "
             f"WHERE j.id > {since} AND j.command = 'CREATE_GD_FROM_FORM' AND j.correlation_id LIKE 'SOA:%' "
             "GROUP BY j.tenant_id, j.create_user, DATE_FORMAT(j.create_time, '%m-%d %H:%i') HAVING gds >= 5 ORDER BY MIN(j.id)")
    for x in rows or []:
        key = (x["t"], x["u"], x["batch"][:11])
        if key in done or int(x["open_jobs"]):
            continue
        done.add(key)
        lo = int(x["first_id"])
        # worker runs at that tenant from the first queued job to 6 s later: the old code starts one per GD at once
        burst = q(f"SELECT COUNT(*) n FROM su_code_workflow_inst WHERE workflow_id = {WORKER} AND tenant_id = '{x['t']}' "
                  f"AND id BETWEEN {lo} AND {lo + (6000 << 22)}") or [{"n": 0}]
        n = int(burst[0]["n"])
        kind = "OLD code (not refreshed)" if n >= 4 else "NEW code (one run at a time)"
        per = float(x["last_s"]) / int(x["gds"]) if x["last_s"] is not None else 0
        print(f"{x['batch']} {x['t']} user {x['u']}: {x['gds']} GDs, last after {x['last_s']} s, {per:.1f} s per GD, "
              f"{x['not_completed']} not completed; {n} worker runs in its first 6 s -> {kind}", flush=True)
        if n < 4:
            sys.exit(0)
    time.sleep(120)
print("no new-code bulk convert seen", flush=True)
