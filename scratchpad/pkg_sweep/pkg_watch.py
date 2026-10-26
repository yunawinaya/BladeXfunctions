# Read-only prod watch of Packing for one tenant: prints one line per event worth acting on, nothing otherwise.
# Seen events are kept in watch_state.json next to this file, so a restarted watch does not repeat them.
# Usage: python3 -I pkg_watch.py [tenant] [poll seconds] [--once]   (env PKG_WATCH_STATE / PKG_WATCH_SINCE for a test run)
import datetime, json, os, subprocess, sys, time

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
T = ARGS[0] if ARGS else "128671"
POLL = int(ARGS[1]) if len(ARGS) > 1 else 150
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "..", ".dbtools", "db")
STATE = os.environ.get("PKG_WATCH_STATE") or os.path.join(HERE, "watch_state.json")
ONCE = "--once" in sys.argv
WF = {"2109924558618333185": "PACKING_ASYNC_SUBMIT", "2109924593737240578": "PACKING_ASYNC_WORKER", "2109924633813815298": "PACKING_BULK_PREPARE",
      "2109924671239589890": "PACKING_BULK_COMMIT", "1994279909883895810": "PACKING_SAVE"}
NOW = "DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)"  # prod datetimes are MYT, the session is UTC
myt = lambda fmt: (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime(fmt)


def db(sql):
    r = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr.strip().splitlines()[-1][:200] if r.stderr.strip() else "db error")
    return json.loads(r.stdout)


def load():
    try:
        return json.load(open(STATE))
    except Exception:
        return {"seen": {}, "since": os.environ.get("PKG_WATCH_SINCE") or myt("%Y-%m-%d %H:%M:%S"), "classic_at": 0}


def emit(state, key, line):
    if key in state["seen"]:
        return
    state["seen"][key] = time.strftime("%H:%M:%S")
    print(myt("%H:%M") + " PACKING " + line, flush=True)


state = load()
fails = 0
while True:
    try:
        since = state["since"]
        for r in db(f"""SELECT CAST(id AS CHAR) id, job_status st, COALESCE(error_code,'') ec, LEFT(COALESCE(error_message,''), 150) msg, causation_id pk
              FROM gd_async_job WHERE tenant_id = '{T}' AND command = 'COMPLETE_PACKING' AND is_deleted = 0 AND update_time >= '{since}'
               AND job_status IN ('FAILED', 'REQUIRES_REVIEW')"""):
            emit(state, "end:" + r["id"], f"JOB {r['st']}: job {r['id']} packing {r['pk']} {r['ec']} - {r['msg']}")
        for r in db(f"""SELECT CAST(id AS CHAR) id, job_status st, COALESCE(error_code,'') ec, TIMESTAMPDIFF(SECOND, create_time, {NOW}) age, causation_id pk
              FROM gd_async_job WHERE tenant_id = '{T}' AND command = 'COMPLETE_PACKING' AND is_deleted = 0
               AND job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW') AND create_time < {NOW} - INTERVAL 5 MINUTE"""):
            emit(state, "stuck:" + r["id"], f"JOB OPEN {int(r['age']) // 60} min: job {r['id']} packing {r['pk']} {r['st']} {r['ec']}")
        for r in db(f"""SELECT CAST(id AS CHAR) id, job_status st, attempt_count n, causation_id pk FROM gd_async_job
              WHERE tenant_id = '{T}' AND command = 'COMPLETE_PACKING' AND is_deleted = 0 AND update_time >= '{since}'
               AND (error_code = 'PK_INVENTORY_RETRY' OR attempt_count > 0) AND job_status NOT IN ('COMPLETED', 'FAILED', 'REQUIRES_REVIEW')"""):
            emit(state, "retry:" + r["id"], f"LOCK/STEP RETRY: job {r['id']} packing {r['pk']} attempt {r['n']} ({r['st']})")
        for r in db(f"""SELECT CAST(id AS CHAR) id, idempotency_key k, causation_id pk FROM gd_async_job WHERE tenant_id = '{T}'
              AND command = 'COMPLETE_PACKING' AND is_deleted = 0 AND idempotency_key LIKE 'PKM:%' ORDER BY id LIMIT 1"""):
            emit(state, "first_mobile", f"FIRST MOBILE V2 JOB: job {r['id']} packing {r['pk']} key {r['k']} - verify it end to end")
        for r in db(f"""SELECT CAST(id AS CHAR) id, TIMESTAMPDIFF(SECOND, create_time, finished_at) s, causation_id pk FROM gd_async_job
              WHERE tenant_id = '{T}' AND command = 'COMPLETE_PACKING' AND is_deleted = 0 AND job_status = 'COMPLETED'
               AND update_time >= '{since}' AND TIMESTAMPDIFF(SECOND, create_time, finished_at) > 120"""):
            emit(state, "slow:" + r["id"], f"SLOW JOB: job {r['id']} packing {r['pk']} took {r['s']} s from queue to done")
        ids = ",".join(WF)
        for r in db(f"""SELECT CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, create_user_name u, LEFT(COALESCE(error_msg,''), 150) err
              FROM su_code_workflow_inst WHERE workflow_id IN ({ids}) AND tenant_id = '{T}' AND status = 'Fail' AND create_time >= '{since}'"""):
            emit(state, "crash:" + r["id"], f"CRASH {WF.get(r['wf'], r['wf'])} run {r['id']} user {r['u']}: {r['err']}")
        for r in db(f"""SELECT p.packing_no, p.packing_lock_session_id s, j.job_status st FROM packing p
              LEFT JOIN gd_async_job j ON j.id = CAST(SUBSTRING(p.packing_lock_session_id, 8) AS UNSIGNED)
             WHERE p.tenant_id = '{T}' AND p.is_deleted = 0 AND p.packing_lock_session_id LIKE 'PKGJOB-%'
               AND (j.id IS NULL OR j.job_status IN ('COMPLETED', 'FAILED', 'CANCELLED'))"""):
            emit(state, "lock:" + r["packing_no"] + r["s"], f"LOCK LEFT: {r['packing_no']} still held by {r['s']} (job {r['st'] or 'missing'})")
        if time.time() - state.get("classic_at", 0) > 1800:
            rows = db(f"""SELECT create_user_name u, COUNT(*) n FROM su_code_workflow_inst WHERE workflow_id = 1994279909883895810 AND tenant_id = '{T}'
                  AND create_time >= {NOW} - INTERVAL 30 MINUTE AND request_json_data LIKE '%"saveAs":"Completed"%' GROUP BY u ORDER BY n DESC""")
            state["classic_at"] = time.time()
            if rows:
                print(myt("%H:%M") + " PACKING classic Completed saves, last 30 min: " + ", ".join(f"{r['u']} {r['n']}" for r in rows), flush=True)
        fails = 0
        json.dump(state, open(STATE, "w"))
    except Exception as e:
        fails += 1
        if fails == 3:
            print(myt("%H:%M") + " PACKING WATCH: prod unreachable 3 polls in a row: " + str(e)[:150], flush=True)
    if ONCE:
        break
    time.sleep(POLL)
