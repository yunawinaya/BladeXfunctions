"""live_retry_after.py: the AFTER_BALANCE_WRITE repair (LSH GD-2610-1774, gen_retry.py mode "after_balance_write") on dev
000000, against the twin of live_retry.py (SO/20260910-034, 10 x TES511; twin A = a0 / a1 there).

1. Convert the SO again; force the stop BEFORE the first write as live_retry.py does (the engine stores its mutation plan).
2. Turn it into 1774's state: the +1 taken back, the locks released, the plan's change applied to every planned row (the
   balance write the engine made at LSH), the message AFTER_BALANCE_WRITE, and one more change on a planned row by "another
   writer" (Reserved -1, balance -1: a classic delivery) that the undo must keep.
3. gen_retry.build(mode after_balance_write): preview, the undo + the five steps, checks; worker kicks until the job ends.
4. The other writer's -1 is still there (then taken back), and A's delta against this twin's delta (diff_twins_create.py).
Every write is a guarded dbw UPDATE or a workflow run as admin@000000.
"""
import json
import os
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_retry as L  # noqa: E402
from live_retry import ROOT, HERE, TENANT, SO, ORG, WORKER, T, q, dbw, run, log, job_row, convert, bump_sql, revert_sql, release_sql, snap  # noqa: E402

COLS = ["balance_quantity", "block_qty", "intransit_qty", "qualityinsp_qty", "reserved_qty", "unrestricted_qty"]


def table_of(row_id):
    for t in ("item_balance", "item_batch_balance"):
        if q("--dev", f"SELECT id FROM {t} WHERE {T} AND id = {row_id}"):
            return t
    raise SystemExit("planned row %s is in no balance table" % row_id)


def main():
    s = L.state()
    since = s["since"]
    snap("c0", since)
    j = convert("C")
    op = "GD|%s|1" % j
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
        run(WORKER, {"job_id": j}, "kick_C_1")
        for _ in range(60):
            o = q("--dev", f"SELECT operation_status FROM inventory_operation WHERE {T} AND operation_id = '{op}'")
            if o and o[0]["operation_status"] in ("DONE", "REJECTED", "REQUIRES_REVIEW"):
                break
            time.sleep(1)
    finally:
        stop.set()
        th.join()
    o = q("--dev", f"SELECT CAST(id AS CHAR) AS id, operation_status, result_code, LEFT(result_message, 40) AS m, review_reason FROM inventory_operation WHERE {T} AND operation_id = '{op}'")[0]
    log("bump", hit.get("at") or "NOT WRITTEN", "| operation", o["operation_status"], o["result_code"], o["m"])
    if o["operation_status"] != "REQUIRES_REVIEW" or not (o["m"] or "").startswith("BEFORE_FIRST_WRITE:"):
        raise SystemExit("the stop before the first write was not reproduced: handle by hand")
    log("take the +1 back:", dbw(revert_sql(op), 1))
    held = q("--dev", f"SELECT COUNT(*) AS n FROM inventory_balance_lock WHERE {T} AND owner_operation_id = '{op}' AND free_token = 0 AND is_deleted = 0")[0]["n"]
    log("release the locks:", dbw(release_sql(op), int(held)), "of", held)

    # 1774's state: the plan's change on every planned row, the message AFTER_BALANCE_WRITE, another writer's -1 on one row
    plan = json.loads(o["review_reason"])["mutation_plan"]["balances"]
    undo = {}
    for b in plan:
        t = table_of(b["id"])
        d = {c: str(__import__("decimal").Decimal(b["after"][c]) - __import__("decimal").Decimal(b["before"][c])) for c in COLS}
        changed = {c: v for c, v in d.items() if v not in ("0", "0E-8")}
        guard = " AND ".join(f"{c} = {b['before'][c]}" for c in COLS)
        sets = ", ".join(f"{c} = {c} + ({v})" for c, v in changed.items())
        log("write as the engine did:", t, b["id"], changed, "->", dbw(f"UPDATE {t} SET {sets} WHERE {T} AND id = {b['id']} AND {guard}", 1))
        undo.setdefault(t, []).append((b["id"], changed))
    log("message AFTER_BALANCE_WRITE:", dbw(f"UPDATE inventory_operation SET result_message = CONCAT('AFTER_BALANCE_WRITE: (dev simulation of LSH GD-2610-1774) ', result_message) "
                                         f"WHERE {T} AND id = {o['id']} AND result_message LIKE 'BEFORE_FIRST_WRITE:%'", 1))
    other_t, other_id = sorted(undo.items())[0][0], sorted(undo.items())[0][1][0][0]
    log("another writer: Reserved -1, balance -1 on", other_t, other_id, "->",
        dbw(f"UPDATE {other_t} SET reserved_qty = reserved_qty - 1, balance_quantity = balance_quantity - 1 WHERE {T} AND id = {other_id} AND reserved_qty >= 1", 1))
    before_repair = q("--dev", f"SELECT reserved_qty, unrestricted_qty, balance_quantity FROM {other_t} WHERE {T} AND id = {other_id}")[0]
    snap("c_review", since)

    gate = q("--dev", f"SELECT owner_operation_id FROM inventory_balance_lock WHERE {T} AND lock_key = 'GATE|{op}'")[0]["owner_operation_id"]
    p3 = q("--dev", f"SELECT CAST(id AS CHAR) AS id FROM gd_publish_step WHERE {T} AND job_id = '{j}' AND step_name = 'P3_INVENTORY_APPLY' AND is_deleted = 0")[0]["id"]
    neff = q("--dev", f"SELECT COUNT(*) AS n FROM inventory_operation_effect WHERE {T} AND operation_id = '{op}' AND is_deleted = 0")[0]["n"]
    ms = q("--dev", f"SELECT DATE_FORMAT(CONVERT_TZ(mutation_started_at, @@session.time_zone, '+00:00'), '%Y-%m-%d %H:%i:%s') AS t FROM inventory_operation WHERE {T} AND id = {o['id']}")[0]["t"]
    p = {"tenant": TENANT, "job_id": j, "gd_no": job_row(j)["gd_no"], "op_row_id": o["id"], "op_id": op, "organization_id": ORG, "p3_step_id": p3,
         "apply_nonce": gate.split("|", 1)[1], "n_effects": int(neff), "mutation_started_utc": ms, "attempt": 1, "mode": "after_balance_write", "undo": undo}
    json.dump(p, open(os.path.join(HERE, "after_params.json"), "w"), indent=1)
    import gen_retry
    b = gen_retry.build(p)
    for label, sql in b["preview"]:
        log("preview:", label, "->", q("--dev", sql))
    for label, rows, sql in b["updates"]:
        log("repair:", label, "->", dbw(sql, rows), "row(s)")
    for label, sql in b["checks"]:
        log("check:", label, "->", q("--dev", sql))
    after_undo = q("--dev", f"SELECT reserved_qty, unrestricted_qty, balance_quantity FROM {other_t} WHERE {T} AND id = {other_id}")[0]
    log("the other writer's row: before the repair", before_repair, "after the undo", after_undo)
    end = L.kick_until_end(j, "C2")
    log("twin C ended", end)
    final = q("--dev", f"SELECT reserved_qty, unrestricted_qty, balance_quantity FROM {other_t} WHERE {T} AND id = {other_id}")[0]
    log("the other writer's row after the retry (its -1 must still be there):", final)
    log("take the other writer's -1 back:", dbw(f"UPDATE {other_t} SET reserved_qty = reserved_qty + 1, balance_quantity = balance_quantity + 1 WHERE {T} AND id = {other_id}", 1))
    snap("c1", since)
    subprocess.run(["python3", os.path.join(HERE, "diff_twins_create.py")] + [os.path.join(HERE, n + ".json") for n in ("a0", "a1", "c0", "c1")], cwd=ROOT)
    log("operations:", q("--dev", f"SELECT operation_id, operation_status, result_code FROM inventory_operation WHERE {T} AND source_job_id = '{j}' ORDER BY id"))


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(ROOT, "prod-hotfix/2026-10-27-kenhin-gd2168-retry"))
    main()
