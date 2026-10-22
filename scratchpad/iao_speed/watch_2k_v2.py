"""watch_2k_v2.py: read-only - follow the next GD save on tenant 496474 (10-22 2k lanes test, Batch Add on GD_STOCK_CHECK): the CREATE_GD_FROM_FORM job and its
engine operation (status changes), a classic GOODS_DELIVERY run if the save falls back, DB connections and any dev API down beat."""
import json, subprocess, time, datetime
def q(sql):
    t = subprocess.run(['.dbtools/db', '--dev', '--json', sql], capture_output=True, text=True, cwd='/Users/yunawinaya/Developer/BladeXfunctions').stdout
    i = t.find('[')
    return json.loads(t[i:]) if i >= 0 else []
tz = datetime.timezone(datetime.timedelta(hours=8))
start = datetime.datetime.now(datetime.timezone.utc)
bound = (int(start.timestamp() * 1000) - 1288834974657) << 22
utc0 = start.strftime('%Y-%m-%d %H:%M:%S')
last, last_op, last_cl, peak, seen_down, t0, last_sc = None, None, None, 0, set(), time.time(), 0
print(datetime.datetime.now(tz).strftime('%H:%M:%S'), 'watching tenant 496474 for the next GD save (V2 job or classic run)', flush=True)
while time.time() - t0 < 1750:
    now = datetime.datetime.now(tz).strftime('%H:%M:%S')
    for d in q(f"SELECT CONVERT_TZ(time, '+00:00', '+08:00') AS t, LEFT(msg, 50) AS msg FROM uptime_monitor.heartbeat WHERE monitor_id = 32 AND time > '{utc0}' AND status = 0"):
        if str(d['t']) not in seen_down:
            seen_down.add(str(d['t'])); print(f"{now} DEV API DOWN at {str(d['t'])[11:19]}: {d['msg']}", flush=True)
    c = q("SELECT VARIABLE_VALUE AS v FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_connected'")
    conn = int(c[0].get('v') or 0) if c else 0
    if conn > peak + 9:
        print(f'{now} DB connections {conn}', flush=True)
    peak = max(peak, conn)
    sc = q(f"SELECT COUNT(*) AS n, MAX(i.run_time) AS mx FROM su_code_workflow_inst i WHERE i.id > {bound} AND i.tenant_id = '496474' AND i.workflow_id = 2105663605526925314")
    if sc and int(sc[0]['n'] or 0) != last_sc:
        print(f"{now} Batch Add stock check: {sc[0]['n']} GD_STOCK_CHECK runs so far (slowest {sc[0]['mx']} ms)", flush=True)
        last_sc = int(sc[0]['n'] or 0)
    cl = q(f"SELECT CAST(i.id AS CHAR) AS id, i.status, i.run_time FROM su_code_workflow_inst i JOIN su_code_workflow w ON w.id = i.workflow_id WHERE i.id > {bound} AND i.tenant_id = '496474' AND w.name = 'GOODS_DELIVERY' ORDER BY i.id DESC LIMIT 1")
    if cl and (cl[0]['id'], cl[0]['status']) != last_cl:
        print(f"{now} CLASSIC GOODS_DELIVERY run {cl[0]['id']} {cl[0]['status']} {cl[0]['run_time'] or ''}", flush=True)
        last_cl = (cl[0]['id'], cl[0]['status'])
    jobs = q(f"SELECT CAST(id AS CHAR) AS id, job_status, line_count, gd_no, LEFT(IFNULL(progress_message, ''), 70) AS pm, IFNULL(error_code, '') AS ec FROM gd_async_job WHERE id > {bound} AND tenant_id = '496474' AND command = 'CREATE_GD_FROM_FORM' AND is_deleted = 0 ORDER BY id DESC LIMIT 1")
    if jobs:
        j = jobs[0]
        state = (j['id'], j['job_status'], j['pm'])
        if state != last:
            print(f"{now} job {j['id']} {j['job_status']} lines={j['line_count']} gd={j['gd_no']} conn={conn} | {j['pm']} {j['ec']}", flush=True)
            last = state
        op = q(f"SELECT operation_status, effect_count, lock_count FROM inventory_operation WHERE operation_id = 'GD|{j['id']}|1'")
        if op and op[0]['operation_status'] != last_op:
            print(f"{now} engine {op[0]['operation_status']} effects={op[0]['effect_count']} locks={op[0]['lock_count']}", flush=True)
            last_op = op[0]['operation_status']
        if j['job_status'] in ('COMPLETED', 'FAILED', 'REQUIRES_REVIEW', 'CANCELLED'):
            print(f'{now} END {j["job_status"]} (DB connections peak {peak})', flush=True)
            break
    if last_cl and last_cl[1] not in ('InExecute',) and not jobs:
        print(f'{now} END classic run {last_cl[1]} (DB connections peak {peak})', flush=True)
        break
    time.sleep(10)
