"""live_test3.py: GD_ASYNC_WORKER v12 on dev 000000 (user's yes 10-23).
A - in-run retry: the ITEM lock of ITM-20260600005-A at bin ...2786 is held by hand, a GD V2 save (SO/20261020-044, 1 PCS, batch
    ...538) is kicked in the background; as soon as the job waits (GD_INVENTORY_IN_PROGRESS) the lock is released - the same
    worker run must then recover and complete the job (no second kick). The lock row is restored in finally.
B - stale sweep: a second save (SO/20261020-046) is NOT kicked; 12 s later a kick for job A's id (no longer due) must sweep it.
"""
import json
import subprocess
import time

T = "scratchpad/gdc/gdcreate/deploy_worker_sweep"
RUNAS = ["node", "scratchpad/gdc/tools/runas.mjs", "scratchpad/gdc/tools/id000000.json"]
SUBMIT, WORKER = "2105133540498116609", "2104840667119411201"
LOCK, HOLD = "2110210358038888453", "TEST|HOLD|20261023D"
SOS = {"A": ("2112386070364655618", "SO/20261020-047", "2112386070385627138"), "B": ("2112386064501018625", "SO/20261020-046", "2112386064509407235")}


def q(sql):
    out = subprocess.run([".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True).stdout
    return json.loads(out[out.index("["):]) if "[" in out else []


def dbw(sql):
    out = subprocess.run([".dbtools/dbw", sql, "--execute"], capture_output=True, text=True).stdout
    print("  dbw:", (out.strip().splitlines() or ["?"])[-1])


def request(key):
    so_id, so_no, line_id = SOS[key]
    req = json.load(open("scratchpad/gdc/gdcreate/deploy_prepare_unit/live_batch.req.json"))
    p = json.loads(req["payload"])
    p["header"]["so_id"], p["header"]["so_no"] = [so_id], so_no
    ln = p["lines"][0]
    ln.update({"line_so_id": so_id, "line_so_no": so_no, "so_line_item_id": line_id})
    req.update({"idempotency_key": "UNITTEST-20261023-SWEEP2-" + key, "payload": json.dumps(p, ensure_ascii=False)})
    path = "%s/live_%s.req.json" % (T, key)
    json.dump(req, open(path, "w"), ensure_ascii=False)
    return path


def submit(key):
    path = request(key)
    subprocess.run(RUNAS + [SUBMIT, path, "%s/submit_%s.out.json" % (T, key)], capture_output=True, text=True)
    d = json.load(open("%s/submit_%s.out.json" % (T, key))).get("data") or {}
    print("submit %s: %s %s job %s" % (key, d.get("job_status"), d.get("result_code") or "", d.get("job_id")))
    return str(d.get("job_id") or "")


def job(j):
    r = q("SELECT job_status, IFNULL(error_code, '') AS e, attempt_count AS a, gd_no FROM gd_async_job WHERE id = %s" % j)
    return r[0] if r else {}


def kick(j, name):
    open("%s/%s.req.json" % (T, name), "w").write(json.dumps({"job_id": j}))
    return subprocess.Popen(RUNAS + [WORKER, "%s/%s.req.json" % (T, name), "%s/%s.out.json" % (T, name)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def answer(name):
    try:
        d = json.load(open("%s/%s.out.json" % (T, name)))
    except Exception as e:
        return {"error": str(e)}
    data = d.get("data") or {}
    return {"code": d.get("code"), "route": data.get("worker_route"), "processed": data.get("processed"), "job_id": data.get("job_id"), "job_status": data.get("job_status"), "msg": str(d.get("msg") or "")[:200]}


# A - in-run retry
dbw("UPDATE inventory_balance_lock SET free_token = 0, owner_operation_id = '%s' WHERE id = %s AND tenant_id = '000000' AND free_token = 1 AND owner_operation_id = ''" % (HOLD, LOCK))
released = False
try:
    JA = submit("A")
    t0 = time.time()
    proc = kick(JA, "kickA")
    while proc.poll() is None and time.time() - t0 < 180:
        s = job(JA)
        if not released and s.get("e") == "GD_INVENTORY_IN_PROGRESS":
            dbw("UPDATE inventory_balance_lock SET free_token = 1, owner_operation_id = '' WHERE id = %s AND tenant_id = '000000' AND owner_operation_id = '%s'" % (LOCK, HOLD))
            released = True
            print("A: %.1f s - the job waited (IN_PROGRESS): lock released, the run keeps going" % (time.time() - t0))
        time.sleep(0.3)
    print("A: the kick ended after %.1f s: %s" % (time.time() - t0, answer("kickA")))
    print("A: job now", job(JA))
finally:
    if not released:
        dbw("UPDATE inventory_balance_lock SET free_token = 1, owner_operation_id = '' WHERE id = %s AND tenant_id = '000000' AND owner_operation_id = '%s'" % (LOCK, HOLD))
    print("lock row:", q("SELECT free_token, owner_operation_id, lock_version FROM inventory_balance_lock WHERE id = %s" % LOCK))
print("A ops:", q("SELECT operation_id, operation_status, result_code FROM inventory_operation WHERE tenant_id = '000000' AND source_job_id = '%s' ORDER BY id" % JA))

import sys; sys.exit(0)
JB = submit("B")
print("B: waiting 12 s (not kicked) ...", job(JB))
time.sleep(12)
t0 = time.time()
proc = kick(JA, "kickB")
proc.wait(timeout=180)
print("B: kick for job A ended after %.1f s: %s" % (time.time() - t0, answer("kickB")))
print("B: job now", job(JB))
