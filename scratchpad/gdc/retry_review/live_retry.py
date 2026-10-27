"""live_retry.py <phase>: the GD/20261027/2168 retry repair (prod-hotfix/2026-10-27-kenhin-gd2168-retry/gen_retry.py), tested
on dev 000000 against a twin, phase by phase (state in state.json next to this file):

  A       twin A: SO/20260910-034 (10 x TES511, plant ...202) -> GD Created V2, the normal way (snapshots a0 / a1)
  cancelA GD Cancel V2 of twin A's GD, so the same SO converts again from the same stock (snapshot b0)
  B       twin B: the same SO again. While its stock call is MUTATING (after the balance re-read under the lock, before
          the pre-write read) one guarded dbw UPDATE adds 1 to the planned item_balance row - the unlocked writer of
          Kenhin's case - so the engine stops REQUIRES_REVIEW VERIFICATION_MISMATCH BEFORE_FIRST_WRITE as 2168 did.
          Then: the +1 reverted, the locks released (release_locks.sql's statement), gen_retry's preview / five
          UPDATEs / checks for this job, worker kicks until the job ends (snapshot b1)
  diff    twin A's delta against twin B's, table by table

Every write is a dev write through .dbtools/dbw --execute (guarded UPDATE) or a workflow run as admin@000000 (runas.mjs).
"""
import json
import os
import re
import subprocess
import sys
import threading
import time

ROOT = "/Users/yunawinaya/Developer/BladeXfunctions"
HERE = os.path.join(ROOT, "scratchpad/gdc/retry_review")
sys.path.insert(0, os.path.join(ROOT, "prod-hotfix/2026-10-27-kenhin-gd2168-retry"))
sys.path.insert(0, os.path.join(ROOT, "scratchpad/gdc/pkv2tools"))
import gen_retry  # noqa: E402
from dbq import q  # noqa: E402

TENANT, SO, SO_NO = "000000", "2097959057518673922", "SO/20260910-034"
PLANT, ORG = "1123598813738675202", "1123598813738675201"
SO_AUTO_GD, WORKER = "2076557490389835777", "2104840667119411201"
CANCEL_SUBMIT, CANCEL_WORKER = "2112455664139866113", "2112455700319932418"
ID = "scratchpad/gdc/tools/id000000.json"
STATE = os.path.join(HERE, "state.json")
ENDED = ("COMPLETED", "FAILED", "CANCELLED", "REQUIRES_REVIEW", "AWAITING_CONFIRMATION")
T = "tenant_id = '%s'" % TENANT


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save(s):
    json.dump(s, open(STATE, "w"), indent=1)


def run(wf, body, name):
    req, out = os.path.join(HERE, name + ".req.json"), os.path.join(HERE, name + ".out.json")
    json.dump(body, open(req, "w"))
    subprocess.run(["node", "scratchpad/gdc/tools/runas.mjs", ID, wf, req, out], cwd=ROOT, capture_output=True, text=True)
    try:
        return json.load(open(out))
    except Exception as e:
        return {"code": "NO_JSON", "error": str(e)}


def dbw(sql, expect=None):
    out = subprocess.run([os.path.join(ROOT, ".dbtools/dbw"), "--execute", sql], cwd=ROOT, capture_output=True, text=True).stdout
    m = re.search(r"EXECUTED - (\d+) row", out)
    n = int(m.group(1)) if m else 0
    if expect is not None and n != expect:
        raise SystemExit("dbw wrote %d row(s), expected %d:\n%s\n%s" % (n, expect, sql[:300], out[-600:]))
    return n


def snap(name, since):
    subprocess.run(["python3", os.path.join(HERE, "snap_create.py"), TENANT, SO, since, os.path.join(HERE, name + ".json")], cwd=ROOT, check=True)


def job_row(j):
    r = q("--dev", f"SELECT job_status, error_code, LEFT(error_message, 120) AS m, attempt_count, row_version, gd_no, CAST(gd_id AS CHAR) AS gd_id "
                   f"FROM gd_async_job WHERE {T} AND id = {j}")
    return r[0] if r else {}


def convert(tag):
    out = run(SO_AUTO_GD, {"so_ids": [SO], "gd_type": "multiple", "plant_id": PLANT, "organization_id": ORG, "created_by": "admin", "v2": "1"}, "convert_" + tag)
    d = out.get("data") or {}
    queued = d.get("queued") or []
    log("convert", tag, d.get("message") or out.get("msg") or out.get("error"), "queued", queued, "blocked", d.get("blocked"))
    if len(queued) != 1:
        raise SystemExit("expected one queued job")
    return str(queued[0]["job_id"])


def kick_until_end(j, tag, kicks=20):
    for n in range(1, kicks + 1):
        out = run(WORKER, {"job_id": j}, "kick_%s_%d" % (tag, n))
        s = job_row(j)
        d = out.get("data") or {}
        log("kick %s %d: worker %s | job %s %s attempt %s rv %s gd %s | %s" % (tag, n, out.get("code"), s.get("job_status"), s.get("error_code"),
                                                                                s.get("attempt_count"), s.get("row_version"), s.get("gd_no"), (s.get("m") or "")[:100]))
        if s.get("job_status") in ENDED:
            return s
        time.sleep(3)
    raise SystemExit("job %s did not end after %d kicks" % (j, kicks))


def phase_a():
    since = str(int((time.time() * 1000 - 60000 - 1288834974657)) << 22)
    s = {"since": since}
    snap("a0", since)
    s["jobA"] = convert("A")
    save(s)
    end = kick_until_end(s["jobA"], "A")
    s["gdA"], s["gdA_no"] = end["gd_id"], end["gd_no"]
    save(s)
    snap("a1", since)


def phase_cancel_a(gd=None):
    s = state()
    gd = gd or s["gdA"]
    out = run(CANCEL_SUBMIT, {"operation": "SUBMIT", "gd_id": gd, "source": "LIST"}, "cancel_submit_" + gd)
    d = out.get("data") or {}
    log("cancel submit", d.get("answer") or d.get("route"), d.get("result_code"), d.get("job_id"), (d.get("result_message") or d.get("message") or "")[:120])
    cj = str(d.get("job_id") or "")
    if not cj:
        raise SystemExit("no cancel job")
    s.setdefault("cancelJobs", {})[gd] = cj
    save(s)
    for n in range(1, 21):
        run(CANCEL_WORKER, {"job_id": cj}, "cancel_kick_%s_%d" % (gd, n))
        r = q("--dev", f"SELECT j.job_status, j.error_code, g.gd_status, g.delivery_no FROM gd_async_job j JOIN goods_delivery g ON g.{T} AND g.id = {gd} "
                       f"WHERE j.{T} AND j.id = {cj}")[0]
        log("cancel kick %d: job %s %s | GD %s %s" % (n, r["job_status"], r["error_code"], r["delivery_no"], r["gd_status"]))
        if r["job_status"] in ENDED:
            break
        time.sleep(3)
    if r["gd_status"] != "Cancelled":
        raise SystemExit("GD %s is not Cancelled" % gd)
    if gd == s.get("gdA"):
        snap("b0", s["since"])


def bump_sql(op):
    eff = f"FROM inventory_operation_effect e WHERE e.{T} AND e.operation_id = '{op}' AND e.effect_key LIKE '%.ITEM.OUT' AND e.target_table = 'item_balance'"
    return (f"UPDATE item_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1 "
            f"WHERE {T} AND id IN (SELECT CAST(e.target_id AS UNSIGNED) {eff}) "
            f"AND unrestricted_qty = (SELECT e.expected_before_qty {eff} LIMIT 1) "
            f"AND EXISTS (SELECT 1 FROM inventory_operation o WHERE o.{T} AND o.operation_id = '{op}' AND o.operation_status = 'MUTATING')")


def revert_sql(op):
    eff = f"FROM inventory_operation_effect e WHERE e.{T} AND e.operation_id = '{op}' AND e.effect_key LIKE '%.ITEM.OUT' AND e.target_table = 'item_balance'"
    return (f"UPDATE item_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1 "
            f"WHERE {T} AND id IN (SELECT CAST(e.target_id AS UNSIGNED) {eff}) "
            f"AND unrestricted_qty = (SELECT e.expected_before_qty + 1 {eff} LIMIT 1) "
            f"AND EXISTS (SELECT 1 FROM inventory_operation o WHERE o.{T} AND o.operation_id = '{op}' AND o.operation_status = 'REQUIRES_REVIEW')")


def release_sql(op):
    # prod-hotfix/2026-10-27-kenhin-gd2168-review-locks/release_locks.sql, with this operation (update_time in MYT on any session)
    return (f"UPDATE inventory_balance_lock SET owner_operation_id = '', last_owner_operation_id = '{op}', last_released_at = NOW(3), "
            f"lock_version = lock_version + 1, free_token = 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00') "
            f"WHERE {T} AND owner_operation_id = '{op}' AND free_token = 0 AND is_deleted = 0")


def phase_b():
    s = state()
    j = convert("B")
    op = "GD|%s|1" % j
    s["jobB"], s["opB"] = j, op
    save(s)
    stop, hit = threading.Event(), {}

    def bump_loop():
        sql, until = bump_sql(op), time.time() + 600
        while not stop.is_set() and time.time() < until:
            if dbw(sql):
                hit["at"] = time.strftime("%H:%M:%S")
                return

    th = threading.Thread(target=bump_loop)
    th.start()
    try:
        out = run(WORKER, {"job_id": j}, "kick_B_1")
        log("kick B 1: worker", out.get("code"), "| job", job_row(j))
        for _ in range(60):
            o = q("--dev", f"SELECT operation_status FROM inventory_operation WHERE {T} AND operation_id = '{op}'")
            if o and o[0]["operation_status"] in ("DONE", "REJECTED", "REQUIRES_REVIEW"):
                break
            time.sleep(1)
    finally:
        stop.set()
        th.join()
    o = q("--dev", f"SELECT CAST(id AS CHAR) AS id, operation_status, result_code, LEFT(result_message, 160) AS m, mutation_started_at, review_reference "
                   f"FROM inventory_operation WHERE {T} AND operation_id = '{op}'")
    log("bump", hit.get("at") or "NOT WRITTEN", "| operation", o)
    if not o or o[0]["operation_status"] != "REQUIRES_REVIEW" or o[0]["result_code"] != "VERIFICATION_MISMATCH" or not (o[0]["m"] or "").startswith("BEFORE_FIRST_WRITE:"):
        raise SystemExit("not reproduced: handle by hand (see the bump time; a DONE operation overwrote any +1 itself)")
    s["opRow"] = o[0]["id"]
    save(s)
    snap("b_review", s["since"])  # the review state, as prod's 2168 was
    log("revert the +1:", dbw(revert_sql(op), 1))
    held = q("--dev", f"SELECT COUNT(*) AS n FROM inventory_balance_lock WHERE {T} AND owner_operation_id = '{op}' AND free_token = 0 AND is_deleted = 0")[0]["n"]
    log("release the locks:", dbw(release_sql(op), int(held)), "of", held)
    gate = q("--dev", f"SELECT owner_operation_id FROM inventory_balance_lock WHERE {T} AND lock_key = 'GATE|{op}'")[0]["owner_operation_id"]
    p3 = q("--dev", f"SELECT CAST(id AS CHAR) AS id FROM gd_publish_step WHERE {T} AND job_id = '{j}' AND step_name = 'P3_INVENTORY_APPLY' AND is_deleted = 0")[0]["id"]
    neff = q("--dev", f"SELECT COUNT(*) AS n FROM inventory_operation_effect WHERE {T} AND operation_id = '{op}' AND is_deleted = 0")[0]["n"]
    ms = q("--dev", f"SELECT DATE_FORMAT(CONVERT_TZ(mutation_started_at, @@session.time_zone, '+00:00'), '%Y-%m-%d %H:%i:%s') AS t "
                    f"FROM inventory_operation WHERE {T} AND id = {s['opRow']}")[0]["t"]
    jr = job_row(j)
    p = {"tenant": TENANT, "job_id": j, "gd_no": jr["gd_no"], "op_row_id": s["opRow"], "op_id": op, "organization_id": ORG, "p3_step_id": p3,
         "apply_nonce": gate.split("|", 1)[1] if gate.startswith("APPLY|") else "MISSING", "n_effects": int(neff), "mutation_started_utc": ms}
    s["params"] = p
    save(s)
    b = gen_retry.build(p)
    for label, sql in b["preview"]:
        log("preview:", label, "->", q("--dev", sql))
    for label, rows, sql in b["updates"]:
        log("repair:", label, "->", dbw(sql, rows), "row(s)")
    for label, sql in b["checks"]:
        log("check:", label, "->", q("--dev", sql))
    end = kick_until_end(j, "B2")
    log("twin B ended", end)
    snap("b1", s["since"])


def phase_diff():
    subprocess.run(["python3", os.path.join(HERE, "diff_twins_create.py")] + [os.path.join(HERE, n + ".json") for n in ("a0", "a1", "b0", "b1")], cwd=ROOT)
    s = state()
    for k in ("jobA", "jobB"):
        log(k, "steps", q("--dev", f"SELECT step_name, step_status, attempt_count, inventory_operation_id FROM gd_publish_step WHERE {T} AND job_id = '{s[k]}' ORDER BY id"))
        log(k, "operations", q("--dev", f"SELECT operation_id, operation_status, result_code FROM inventory_operation WHERE {T} AND source_job_id = '{s[k]}' ORDER BY id"))
    log("locks still held by either job:", q("--dev", f"SELECT lock_key, owner_operation_id FROM inventory_balance_lock WHERE {T} AND free_token = 0 AND "
                                                       f"(owner_operation_id LIKE 'GD|{s['jobA']}|%' OR owner_operation_id LIKE 'GD|{s['jobB']}|%')"))


if __name__ == "__main__":
    if sys.argv[1] == "cancel":  # any Created GD (cleanup): live_retry.py cancel <gd_id>
        phase_cancel_a(sys.argv[2])
    else:
        {"A": phase_a, "cancelA": phase_cancel_a, "B": phase_b, "diff": phase_diff}[sys.argv[1]]()
