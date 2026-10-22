"""watch_2k.py: read-only - follow the next CREATE_GD_FROM_FORM job of tenant 496474 (status changes, DB connections) until it ends."""
import json, subprocess, time, datetime
def q(sql):
    t = subprocess.run(['.dbtools/db', '--dev', '--json', sql], capture_output=True, text=True, cwd='/Users/yunawinaya/Developer/BladeXfunctions').stdout
    i = t.find('[')
    return json.loads(t[i:]) if i >= 0 else []
tz = datetime.timezone(datetime.timedelta(hours=8))
bound = (int(datetime.datetime.now(tz).timestamp() * 1000) - 1288834974657) << 22
last, peak, t0 = None, 0, time.time()
print(datetime.datetime.now(tz).strftime('%H:%M:%S'), 'watching for the next CREATE_GD_FROM_FORM job on 496474', flush=True)
while time.time() - t0 < 5400:
    jobs = q(f"SELECT CAST(id AS CHAR) AS id, job_status, line_count, gd_no, LEFT(IFNULL(progress_message, ''), 70) AS pm, IFNULL(error_code, '') AS ec FROM gd_async_job WHERE id > {bound} AND tenant_id = '496474' AND command = 'CREATE_GD_FROM_FORM' AND is_deleted = 0 ORDER BY id DESC LIMIT 1")
    c = q("SELECT VARIABLE_VALUE AS v FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_connected'")
    conn = int(c[0].get('v') or c[0].get('VARIABLE_VALUE') or 0) if c else 0
    now = datetime.datetime.now(tz).strftime('%H:%M:%S')
    if conn > peak + 9:
        print(f'{now} DB connections {conn}', flush=True)
    peak = max(peak, conn)
    if jobs:
        j = jobs[0]
        state = (j['id'], j['job_status'], j['pm'])
        if state != last:
            print(f"{now} job {j['id']} {j['job_status']} lines={j['line_count']} gd={j['gd_no']} conn={conn} | {j['pm']} {j['ec']}", flush=True)
            last = state
        if j['job_status'] in ('COMPLETED', 'FAILED', 'REQUIRES_REVIEW', 'CANCELLED'):
            print(f'{now} END {j["job_status"]} (DB connections peak {peak})', flush=True)
            break
    time.sleep(10)
