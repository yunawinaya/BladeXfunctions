"""finish_test.py: after the recovered operation's 10-minute lease, kick the dev test job until the GD is created (max 6 min)."""
import json, subprocess, time
T = "scratchpad/gdc/gdcreate/deploy_engine_wait"
J = "2113486208250847233"
def q(sql):
    out = subprocess.run([".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True).stdout
    return json.loads(out[out.index("["):]) if "[" in out else []
def state():
    return q("SELECT j.job_status, j.error_code, j.attempt_count, j.gd_no, CAST(NOW(3) AS CHAR) AS now_t, "
             "(SELECT COUNT(*) FROM inventory_operation o WHERE o.tenant_id = '000000' AND o.source_job_id = '%s' AND o.lease_expires_at > NOW(3)) AS live_ops "
             "FROM gd_async_job j WHERE j.id = %s" % (J, J))[0]
start = time.time()
while time.time() - start < 360:
    s = state()
    if int(s["live_ops"]) == 0:
        open(T + "/kick.req.json", "w").write(json.dumps({"job_id": J}))
        subprocess.run(["node", "scratchpad/gdc/tools/runas.mjs", "scratchpad/gdc/tools/id000000.json", "2104840667119411201", T + "/kick.req.json", T + "/kick_final.out.json"], capture_output=True, text=True)
        s = state()
        print(s["now_t"], "kick ->", s["job_status"], s["error_code"], "attempt", s["attempt_count"], "gd", s["gd_no"], flush=True)
        if s["job_status"] in ("GD_COMMITTED", "CREATING_PICKING", "PICKING_READY", "COMPLETED", "FAILED", "REQUIRES_REVIEW"):
            break
    time.sleep(10)
print("ops:", q("SELECT operation_id, operation_status, result_code FROM inventory_operation WHERE tenant_id = '000000' AND source_job_id = '%s' ORDER BY id" % J))
