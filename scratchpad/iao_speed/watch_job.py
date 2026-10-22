"""watch_job.py <job_id>: read-only - one gd_async_job's status / progress and its gd_publish_step rows as they finish, plus any dev
API down beat, until the job ends (10-22 2k lanes chain)."""
import json, subprocess, sys, time, datetime
JOB = sys.argv[1]
def q(sql):
    t = subprocess.run(['.dbtools/db', '--dev', '--json', sql], capture_output=True, text=True, cwd='/Users/yunawinaya/Developer/BladeXfunctions').stdout
    i = t.find('[')
    return json.loads(t[i:]) if i >= 0 else []
tz = datetime.timezone(datetime.timedelta(hours=8))
utc0 = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
last, seen, down, t0 = None, set(), set(), time.time()
while time.time() - t0 < 1750:
    now = datetime.datetime.now(tz).strftime('%H:%M:%S')
    for d in q(f"SELECT CONVERT_TZ(time, '+00:00', '+08:00') AS t, LEFT(msg, 50) AS msg FROM uptime_monitor.heartbeat WHERE monitor_id = 32 AND time > '{utc0}' AND status = 0"):
        if str(d['t']) not in down:
            down.add(str(d['t'])); print(f"{now} DEV API DOWN at {str(d['t'])[11:19]}: {d['msg']}", flush=True)
    j = q(f"SELECT command, job_status, progress_percent pp, LEFT(IFNULL(progress_message, ''), 80) pm, IFNULL(error_code, '') ec FROM gd_async_job WHERE id = {JOB}")
    if j:
        st = (j[0]['job_status'], j[0]['pm'], j[0]['ec'])
        if st != last:
            print(f"{now} job {j[0]['command']} {j[0]['job_status']} {j[0]['pp']}% | {j[0]['pm']} {j[0]['ec']}", flush=True)
            last = st
    for r in q(f"SELECT step_name, step_status, started_at, finished_at FROM gd_publish_step WHERE job_id = '{JOB}' AND step_status IN ('DONE', 'FAILED') AND is_deleted = 0 AND step_name NOT LIKE '%|I|%' ORDER BY id"):
        k = r['step_name'] + r['step_status']
        if k not in seen:
            seen.add(k); print(f"{now} step {r['step_name']} {r['step_status']} {str(r['started_at'])[11:19]} -> {str(r['finished_at'])[11:19]}", flush=True)
    if j and j[0]['job_status'] in ('COMPLETED', 'FAILED', 'REQUIRES_REVIEW', 'CANCELLED'):
        print(f"{now} END {j[0]['job_status']}", flush=True)
        break
    time.sleep(10)
