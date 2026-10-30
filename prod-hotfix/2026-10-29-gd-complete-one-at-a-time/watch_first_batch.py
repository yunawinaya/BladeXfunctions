"""Read-only: every 2 min, the Picking-started GD completion batches (4+ COMPLETE_GD from one user in one minute) queued after the
pastes. When one has ended, prints its completions, seconds until the last one, seconds each, and which code drove it: NEW (only
GD_COMPLETE_WORKER {} runs, one at a time) or OLD (a browser not refreshed since the paste: one run per completion, by job id).
Exits after the first NEW batch.   usage: python3 watch_first_batch.py [--hours 4]"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.abspath(os.path.join(HERE, "..", "..", ".dbtools", "db"))
WORKER = "2110182645714518018"


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    return None if out.returncode else json.loads(out.stdout[out.stdout.find("["):])


hours = float(sys.argv[sys.argv.index("--hours") + 1]) if "--hours" in sys.argv else 4
since = None
while since is None:
    r = q("SELECT CAST(MAX(id) AS CHAR) id FROM su_code_pages_history WHERE data_id = 1935635853539348481 AND status = 'enabled'")
    since = r[0]["id"] if r and r[0]["id"] else None
    if since is None:
        time.sleep(60)
done = set()
end = time.time() + hours * 3600
while time.time() < end:
    rows = q("SELECT tenant_id t, CAST(create_user AS CHAR) u, DATE_FORMAT(MIN(create_time), '%m-%d %H:%i:%s') batch, CAST(MIN(id) AS CHAR) first_id, "
             "COUNT(*) n, SUM(job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW')) open_jobs, SUM(job_status <> 'COMPLETED') not_completed, "
             "MAX(TIMESTAMPDIFF(SECOND, create_time, CONVERT_TZ(finished_at, '+00:00', '+08:00'))) last_s, "
             "MAX(UNIX_TIMESTAMP(CONVERT_TZ(finished_at, '+00:00', '@@session.time_zone'))) last_end FROM gd_async_job "
             f"WHERE id > {since} AND command = 'COMPLETE_GD' AND JSON_UNQUOTE(JSON_EXTRACT(request_payload, '$.source')) = 'PICKING' "
             "GROUP BY tenant_id, create_user, DATE_FORMAT(create_time, '%m-%d %H:%i') HAVING n >= 4 ORDER BY MIN(id)")
    for x in rows or []:
        key = (x["t"], x["u"], x["batch"][:11])
        if key in done or int(x["open_jobs"]):
            continue
        done.add(key)
        lo = int(x["first_id"])
        hi = lo + ((int(x["last_s"] or 0) + 30) * 1000 << 22)
        runs = q(f"SELECT COUNT(*) n, SUM(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(request_json_data, '$.workflowparams.job_id')), '') <> '') by_job "
                 f"FROM su_code_workflow_inst WHERE workflow_id = {WORKER} AND tenant_id = '{x['t']}' AND id BETWEEN {lo} AND {hi}") or [{"n": 0, "by_job": 0}]
        n, by_job = int(runs[0]["n"] or 0), int(runs[0]["by_job"] or 0)
        kind = "OLD code (not refreshed)" if by_job >= 2 else "NEW code (one {} run at a time)"
        per = float(x["last_s"]) / int(x["n"]) if x["last_s"] is not None else 0
        print(f"{x['batch']} {x['t']} user {x['u']}: {x['n']} completions, last after {x['last_s']} s, {per:.1f} s each, "
              f"{x['not_completed']} not completed; worker runs {n} ({by_job} by job id) -> {kind}", flush=True)
        if by_job < 2:
            sys.exit(0)
    time.sleep(120)
print("no new-code Picking batch seen", flush=True)
