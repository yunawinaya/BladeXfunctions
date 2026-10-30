"""Read-only: every 60 s, the next COMPLETE_GD job of GD/20261030/2341 after the 11:23 refusal; prints its end and the GD's
status, then exits. usage: python3 watch_complete.py [--minutes 90]"""
import json, os, subprocess, sys, time

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".dbtools", "db")
GD, AFTER = "2116007652147466242", "2116007906049658882"


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    return None if out.returncode else json.loads(out.stdout[out.stdout.find("["):])


minutes = float(sys.argv[sys.argv.index("--minutes") + 1]) if "--minutes" in sys.argv else 90
end = time.time() + minutes * 60
while time.time() < end:
    jobs = q(f"SELECT CAST(id AS CHAR) id, job_status s, DATE_FORMAT(create_time, '%H:%i:%s') t, "
             "TIMESTAMPDIFF(SECOND, create_time, CONVERT_TZ(finished_at, '+00:00', '+08:00')) secs, error_code, "
             f"LEFT(IFNULL(error_message, ''), 160) err FROM gd_async_job WHERE tenant_id = '528521' AND gd_id = {GD} "
             f"AND command = 'COMPLETE_GD' AND id > {AFTER} ORDER BY id") or []
    done = [j for j in jobs if j["s"] in ("COMPLETED", "FAILED", "CANCELLED", "REQUIRES_REVIEW")]
    if done:
        gd = (q(f"SELECT gd_status, delivery_no FROM goods_delivery WHERE id = {GD}") or [{}])[0]
        for j in done:
            print(f"COMPLETE_GD {j['id']} queued {j['t']}: {j['s']} after {j['secs']} s"
                  + (f" | {j['error_code']} {j['err']}" if j["s"] != "COMPLETED" else ""), flush=True)
        print(f"{gd.get('delivery_no')} gd_status now {gd.get('gd_status')}", flush=True)
        sys.exit(0)
    time.sleep(60)
print("no new completion of GD/20261030/2341 within the watch", flush=True)
