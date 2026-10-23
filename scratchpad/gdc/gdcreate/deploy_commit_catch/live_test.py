"""live_test.py: GD_BULK_COMMIT's caught inventory call on dev 000000 (user's yes 10-23).
The engine's lock seed refuses a soft-deleted lock row by throwing (INV_LOCK_SEED) before its operation insert - the same
place Kenhin's seed race failed. So: soft-delete the free ITEM lock row the test GD needs, save a 1-unit GD V2
(SO/20261020-045, the batch template), kick the worker. Expected: the engine run fails, COMMIT catches it and writes a
counted retry (COMMITTING_GD, GD_INVENTORY_RETRYABLE_REJECTION ... INVENTORY_CALL_FAILED, attempt 1, lease released, P3
moved to the next operation id), no operation row. Then the row is restored and a second kick completes the job.
The lock row is restored in finally."""
import json
import subprocess
import time

T = "scratchpad/gdc/gdcreate/deploy_commit_catch"
RUNAS = ["node", "scratchpad/gdc/tools/runas.mjs", "scratchpad/gdc/tools/id000000.json"]
SUBMIT, WORKER = "2105133540498116609", "2104840667119411201"
LOCK = "2110210358038888453"
SO_ID, SO_NO, SO_LINE = "2112386058800959490", "SO/20261020-045", "2112386058813542402"


def q(sql):
    out = subprocess.run([".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True).stdout
    return json.loads(out[out.index("["):]) if "[" in out else []


def dbw(sql):
    out = subprocess.run([".dbtools/dbw", sql, "--execute"], capture_output=True, text=True).stdout
    print("  dbw:", (out.strip().splitlines() or ["?"])[-1])


def job(j):
    r = q("SELECT job_status, IFNULL(error_code, '') AS e, LEFT(IFNULL(error_message, ''), 160) AS m, attempt_count AS a, IFNULL(lease_owner, '') AS lo, "
          "IFNULL(DATE_FORMAT(lease_expires_at, '%%H:%%i:%%s'), '') AS le, IFNULL(gd_no, '') AS gd_no FROM gd_async_job WHERE id = %s" % j)
    return r[0] if r else {}


def run(wf, name, body):
    open("%s/%s.req.json" % (T, name), "w").write(json.dumps(body, ensure_ascii=False))
    subprocess.run(RUNAS + [wf, "%s/%s.req.json" % (T, name), "%s/%s.out.json" % (T, name)], capture_output=True, text=True)
    try:
        return json.load(open("%s/%s.out.json" % (T, name)))
    except Exception as e:
        return {"error": str(e)}


req = json.load(open("scratchpad/gdc/gdcreate/deploy_prepare_unit/live_batch.req.json"))
p = json.loads(req["payload"])
p["header"]["so_id"], p["header"]["so_no"] = [SO_ID], SO_NO
p["lines"][0].update({"line_so_id": SO_ID, "line_so_no": SO_NO, "so_line_item_id": SO_LINE, "gd_order_quantity": "100000", "gd_undelivered_qty": 99999})
req.update({"idempotency_key": "UNITTEST-20261023-CATCH-B", "payload": json.dumps(p, ensure_ascii=False)})

print("lock row before:", q("SELECT is_deleted, free_token, owner_operation_id FROM inventory_balance_lock WHERE id = %s" % LOCK))
dbw("UPDATE inventory_balance_lock SET is_deleted = 1 WHERE id = %s AND tenant_id = '000000' AND is_deleted = 0 AND free_token = 1 AND owner_operation_id = ''" % LOCK)
restored = False
try:
    d = run(SUBMIT, "submit", req).get("data") or {}
    J = str(d.get("job_id") or "")
    print("submit: %s %s job %s" % (d.get("job_status"), d.get("result_code") or "", J))
    t0 = time.time()
    k1 = run(WORKER, "kick1", {"job_id": J})
    print("kick 1 (%.1f s): code %s msg %s" % (time.time() - t0, k1.get("code"), str(k1.get("msg") or "")[:160]))
    print("job after kick 1:", job(J))
    print("operations:", q("SELECT operation_id, operation_status FROM inventory_operation WHERE tenant_id = '000000' AND source_job_id = '%s'" % J))
    print("P3 row:", q("SELECT step_status, attempt_count, inventory_operation_id, LEFT(IFNULL(error_message, ''), 120) AS m FROM gd_publish_step WHERE tenant_id = '000000' AND job_id = '%s' AND step_name = 'P3_INVENTORY_APPLY'" % J))
    dbw("UPDATE inventory_balance_lock SET is_deleted = 0 WHERE id = %s AND tenant_id = '000000' AND is_deleted = 1" % LOCK)
    restored = True
    time.sleep(3)
    t0 = time.time()
    k2 = run(WORKER, "kick2", {"job_id": J})
    print("kick 2 (%.1f s): code %s status %s" % (time.time() - t0, k2.get("code"), (k2.get("data") or {}).get("job_status")))
    print("job after kick 2:", job(J))
    print("operations:", q("SELECT operation_id, operation_status, IFNULL(result_code, '') AS rc FROM inventory_operation WHERE tenant_id = '000000' AND source_job_id = '%s'" % J))
finally:
    if not restored:
        dbw("UPDATE inventory_balance_lock SET is_deleted = 0 WHERE id = %s AND tenant_id = '000000' AND is_deleted = 1" % LOCK)
    print("lock row after:", q("SELECT is_deleted, free_token, owner_operation_id FROM inventory_balance_lock WHERE id = %s" % LOCK))
