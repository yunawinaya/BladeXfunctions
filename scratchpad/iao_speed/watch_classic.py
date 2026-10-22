"""watch_classic.py: read-only - follow the classic GOODS_DELIVERY run 2113181077574975489 (tenant 496474): its status, the count of
its per-line child runs, and any dev API down beat; one line per change and a progress line every 2 minutes."""
import json, subprocess, time, datetime
RUN, BOUND = 2113181077574975489, 2113180806804406272
def q(sql):
    t = subprocess.run(['.dbtools/db', '--dev', '--json', sql], capture_output=True, text=True, cwd='/Users/yunawinaya/Developer/BladeXfunctions').stdout
    i = t.find('[')
    return json.loads(t[i:]) if i >= 0 else []
tz = datetime.timezone(datetime.timedelta(hours=8))
last_status, last_progress, seen_down, t0 = None, 0, set(), time.time()
while time.time() - t0 < 3500:
    now = datetime.datetime.now(tz).strftime('%H:%M:%S')
    r = q(f"SELECT status, run_time FROM su_code_workflow_inst WHERE id = {RUN}")
    st = r[0]['status'] if r else '?'
    kids = q(f"SELECT w.name, COUNT(*) AS n FROM su_code_workflow_inst i JOIN su_code_workflow w ON w.id = i.workflow_id WHERE i.id > {BOUND} AND i.tenant_id = '496474' AND w.name IN ('GLOBAL_ALLOCATION', 'SUBTRACT_INVENTORY_NEW', 'ADD_INVENTORY_NEW', 'GD_UNUSED_FN_NEW') GROUP BY w.name")
    k = {x['name']: int(x['n']) for x in kids}
    down = q("SELECT CONVERT_TZ(time, '+00:00', '+08:00') AS t, status, LEFT(msg, 50) AS msg FROM uptime_monitor.heartbeat WHERE monitor_id = 32 AND time > '2026-10-22 08:12:00' AND status = 0")
    for d in down:
        if str(d['t']) not in seen_down:
            seen_down.add(str(d['t'])); print(f"{now} DEV API DOWN at {str(d['t'])[11:19]}: {d['msg']}", flush=True)
    if st != last_status or time.time() - last_progress > 120:
        print(f"{now} classic GOODS_DELIVERY {st} | GLOBAL_ALLOCATION {k.get('GLOBAL_ALLOCATION', 0)} | SUBTRACT {k.get('SUBTRACT_INVENTORY_NEW', 0)} ADD {k.get('ADD_INVENTORY_NEW', 0)} | GD_UNUSED_FN_NEW {k.get('GD_UNUSED_FN_NEW', 0)}", flush=True)
        last_status, last_progress = st, time.time()
    if st not in ('InExecute', '?'):
        print(f"{now} END classic GOODS_DELIVERY {st} after {r[0].get('run_time')} ms", flush=True); break
    time.sleep(30)
