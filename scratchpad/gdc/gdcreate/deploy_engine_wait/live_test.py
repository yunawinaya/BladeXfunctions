"""live_test.py: INVENTORY_APPLY_OPERATION v12 on dev 000000 (user's yes 10-23). Holds one ITEM lock row by hand
(free_token 0, owner TEST|HOLD|20261023), saves a GD V2 on that item / bin (SO/20261020-050, 1 PCS of ITM-20260600005-A,
batch ...538 at bin ...2786) and kicks the worker: the job must WAIT (GD_INVENTORY_IN_PROGRESS), no crash. Then the lock row is
restored (always, in finally) and further kicks must recover the stale operation and create the GD.
"""
import json
import subprocess
import time

R = "scratchpad/gdc/tools/runas.mjs"
ID = "scratchpad/gdc/tools/id000000.json"
T = "scratchpad/gdc/gdcreate/deploy_engine_wait"
SUBMIT, WORKER = "2105133540498116609", "2104840667119411201"
LOCK, HOLD = "2110210358038888453", "TEST|HOLD|20261023"


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout


def dbw(sql):
    print("  dbw:", sh('.dbtools/dbw "%s" --execute 2>&1 | tail -1' % sql).strip())


def q(sql):
    out = sh('.dbtools/db --dev --json "%s" 2>/dev/null' % sql)
    return json.loads(out[out.index("["):]) if "[" in out else []


def run(wf, req, out):
    sh("node %s %s %s %s %s 2>&1 | tail -1" % (R, ID, wf, req, out))
    try:
        return json.load(open(out))
    except Exception as e:
        return {"code": "NO_JSON", "error": str(e)}


def job(j):
    return q("SELECT job_status, error_code, LEFT(error_message, 110) AS m, attempt_count, CAST(lease_expires_at AS CHAR) AS lease, "
             "CAST(next_attempt_at AS CHAR) AS nxt, gd_no FROM gd_async_job WHERE id = %s" % j)[0]


def ops(j):
    return q("SELECT operation_id, operation_status, result_code, CAST(lease_expires_at AS CHAR) AS lease, "
             "(lease_expires_at > NOW()) AS live FROM inventory_operation WHERE tenant_id = '000000' AND source_job_id = %s ORDER BY id" % j)


def kick(j, n):
    open("%s/kick.req.json" % T, "w").write(json.dumps({"job_id": j}))
    out = run(WORKER, "%s/kick.req.json" % T, "%s/kick_%d.out.json" % (T, n))
    s = job(j)
    d = out.get("data") or {}
    print("kick %d: worker code %s %s | job %s %s attempt %s gd %s | %s" % (n, out.get("code"), d.get("worker_route") or str(out.get("msg") or out.get("error") or "")[:120],
                                                                          s["job_status"], s["error_code"], s["attempt_count"], s["gd_no"], (s["m"] or "")[:90]))
    return s


req = json.load(open("scratchpad/gdc/gdcreate/deploy_prepare_unit/live_batch.req.json"))
req["idempotency_key"] = "UNITTEST-20261023-LOCK-0001"
json.dump(req, open("%s/live_lock.req.json" % T, "w"), ensure_ascii=False)

dbw("UPDATE inventory_balance_lock SET free_token = 0, owner_operation_id = '%s' WHERE id = %s AND tenant_id = '000000' AND free_token = 1 AND owner_operation_id = ''" % (HOLD, LOCK))
J = ""
try:
    out = run(SUBMIT, "%s/live_lock.req.json" % T, "%s/live_lock.out.json" % T)
    J = str((out.get("data") or {}).get("job_id") or "")
    print("submit:", (out.get("data") or {}).get("job_status"), (out.get("data") or {}).get("result_code"), "job", J)
    for n in range(1, 7):
        s = kick(J, n)
        if s["error_code"] == "GD_INVENTORY_IN_PROGRESS" or s["job_status"] in ("FAILED", "REQUIRES_REVIEW", "GD_COMMITTED", "COMPLETED"):
            break
        time.sleep(3)
    print("operations while held:", ops(J))
finally:
    dbw("UPDATE inventory_balance_lock SET free_token = 1, owner_operation_id = '' WHERE id = %s AND tenant_id = '000000' AND owner_operation_id = '%s'" % (LOCK, HOLD))
    print("lock row:", q("SELECT free_token, owner_operation_id, lock_version FROM inventory_balance_lock WHERE id = %s" % LOCK))

if J:
    for n in range(7, 17):
        s = kick(J, n)
        if s["job_status"] in ("FAILED", "REQUIRES_REVIEW", "GD_COMMITTED", "CREATING_PICKING", "PICKING_READY", "COMPLETED"):
            break
        time.sleep(4)
    print("operations after:", ops(J))
