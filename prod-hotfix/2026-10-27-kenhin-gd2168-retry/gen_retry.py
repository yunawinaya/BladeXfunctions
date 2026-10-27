"""gen_retry.py: the SQL that puts a GD Created V2 job back on the engine's own retry path when its stock operation
stopped BEFORE its first write (REQUIRES_REVIEW VERIFICATION_MISMATCH "BEFORE_FIRST_WRITE: this run wrote no business
row"), after that operation's locks were released.

The operation is recorded the way INVENTORY_APPLY_OPERATION records a stale operation it rejects before
mutation_started_at (its RECOVER plan): REJECTED + STALE_BEFORE_MUTATION, effects NOT_APPLIED, gate REJECT|<code>|<nonce>.
mutation_started_at is cleared: GD_BULK_COMMIT treats any non-DONE row that carries it as uncertain (review), whatever its
status. The P3 step goes back to STARTED on the same operation and the job back to COMMITTING_GD, due now. The next
GD_BULK_COMMIT run then reads REJECTED STALE_BEFORE_MUTATION and takes its own RETRY route (P3 row -> operation |2,
attempt 2; job attempt_count 1, backoff 2 s), and the run after that calls the engine with the new operation id.

The job row is written last: until it is COMMITTING_GD no worker touches the job, so a stop half way changes nothing.
Every UPDATE is guarded on the exact review state and must affect the expected row count.

  python3 gen_retry.py > retry_2168.sql          # the prod file (PROD below)
  import gen_retry; gen_retry.build(params)      # the dev test builds the same statements for its own job

Mode "after_balance_write" (LSH GD-2610-1774): the operation stopped AFTER its balance write (VERIFICATION_MISMATCH
"AFTER_BALANCE_WRITE": a classic writer, which takes no locks, changed a planned row during the check), with no movement
written. params["undo"] = {table: [(row id, {column: delta})]}, the delta being after - before from the operation's own
mutation plan (review_reason). The UPDATEs first take that change back by delta - every later change on the rows is kept -
one statement per table, all rows or none (no row may go below zero); then the steps above. params["attempt"] = N for the
job's Nth operation (GD|<job>|N, P3 attempt N).
"""
import json
import sys

PROD = {
    "tenant": "528521",
    "job_id": "2114948162857865218",
    "gd_no": "GD/20261027/2168",
    "op_row_id": "2114951960342958081",
    "op_id": "GD|2114948162857865218|1",
    "organization_id": "2006752085806436353",
    "p3_step_id": "2114948228590997505",
    "apply_nonce": "082e3d4c57124cf787420521",
    "n_effects": 18,
    "mutation_started_utc": "2026-10-27 05:26:57",
}

MYT_NOW = "CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')"


def sq(v):
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def build(p):
    t, job, op, n = sq(p["tenant"]), p["job_id"], p["op_id"], int(p["n_effects"])
    attempt, after = int(p.get("attempt", 1)), p.get("mode") == "after_balance_write"
    for k in ("job_id", "op_row_id", "p3_step_id", "organization_id"):
        assert str(p[k]).isdigit(), k
    assert op == "GD|%s|%d" % (job, attempt), "the operation is the job's attempt %d" % attempt
    assert all(c.isalnum() for c in p["apply_nonce"])
    gate_key, apply_owner = "GATE|" + op, "APPLY|" + p["apply_nonce"]
    reject_owner = "REJECT|STALE_BEFORE_MUTATION|" + p["apply_nonce"]
    assert len(reject_owner) <= 64
    stop = "AFTER_BALANCE_WRITE" if after else "BEFORE_FIRST_WRITE"
    if after:
        note = ("Repair 2026-10-27 (%s): stopped AFTER_BALANCE_WRITE (a writer without locks changed a planned row during the "
                "check), no movement written; its balance change was taken back by delta (%d rows, later changes kept) and its "
                "locks released; recorded as STALE_BEFORE_MUTATION, the engine's retryable outcome, so the delivery retries with "
                "a new operation. mutation_started_at was %s UTC. Original: "
                % (p["gd_no"], sum(len(r) for r in p["undo"].values()), p["mutation_started_utc"]))
        effect_note = "Repair 2026-10-27: the operation's balance change was taken back by delta after an AFTER_BALANCE_WRITE stop; not applied"
    else:
        note = ("Repair 2026-10-27 (%s): stopped BEFORE_FIRST_WRITE with nothing written (no balance row, no movement) and its "
                "locks released; recorded as STALE_BEFORE_MUTATION, the engine's retryable outcome, so the delivery retries with a "
                "new operation. mutation_started_at was %s UTC. Original: " % (p["gd_no"], p["mutation_started_utc"]))
        effect_note = "Repair 2026-10-27: the operation stopped before its first write (VERIFICATION_MISMATCH BEFORE_FIRST_WRITE); never applied"
    details = json.dumps({"inventory_operation_id": op, "inventory_result_code": "STALE_BEFORE_MUTATION", "review_reference": ""},
                         sort_keys=True, separators=(",", ":"))
    mv_key = "%s|%s|" % (p["organization_id"], op)

    preview = [
        ("job: REQUIRES_REVIEW, GD_INVENTORY_REQUIRES_REVIEW, no lease",
         f"SELECT CAST(id AS CHAR) AS id, job_status, error_code, row_version, attempt_count, lease_owner, gd_no "
         f"FROM gd_async_job WHERE tenant_id = {t} AND id = {job} AND is_deleted = 0"),
        ("steps: P0-P2 DONE, P3 REQUIRES_REVIEW on the operation, attempt %d" % attempt,
         f"SELECT CAST(id AS CHAR) AS id, step_name, step_status, attempt_count, inventory_operation_id "
         f"FROM gd_publish_step WHERE tenant_id = {t} AND job_id = {sq(job)} AND is_deleted = 0 ORDER BY id"),
        ("operation: REQUIRES_REVIEW, VERIFICATION_MISMATCH, " + stop,
         f"SELECT CAST(id AS CHAR) AS id, operation_status, result_code, LEFT(result_message, 60) AS msg, row_version, "
         f"mutation_started_at, review_reference FROM inventory_operation WHERE tenant_id = {t} AND operation_id = {sq(op)} AND is_deleted = 0"),
        (f"effects: {n} UNCERTAIN, none applied, no movement",
         f"SELECT effect_status, COUNT(*) AS n, SUM(applied_at IS NULL) AS not_applied, SUM(IFNULL(movement_id, '') = '') AS no_movement "
         f"FROM inventory_operation_effect WHERE tenant_id = {t} AND operation_id = {sq(op)} AND is_deleted = 0 GROUP BY effect_status"),
        ("movements written by the operation: 0",
         f"SELECT COUNT(*) AS movements FROM inventory_movement WHERE id > {p['op_row_id']} AND tenant_id = {t} "
         f"AND operation_effect_key LIKE {sq(mv_key + '%')}"),
        ("locks still held by the operation: 0",
         f"SELECT COUNT(*) AS still_held FROM inventory_balance_lock WHERE tenant_id = {t} AND owner_operation_id = {sq(op)} AND is_deleted = 0"),
        ("gate: APPLY, free_token 0",
         f"SELECT lock_key, owner_operation_id, free_token FROM inventory_balance_lock WHERE tenant_id = {t} AND lock_key = {sq(gate_key)} AND is_deleted = 0"),
    ]

    updates = [
        ("1. operation -> REJECTED STALE_BEFORE_MUTATION, mutation_started_at cleared", 1,
         f"UPDATE inventory_operation SET result_message = CONCAT({sq(note)}, IFNULL(result_message, '')), "
         f"operation_status = 'REJECTED', result_code = 'STALE_BEFORE_MUTATION', "
         f"effect_summary = REPLACE(effect_summary, '\"UNCERTAIN\"', '\"NOT_APPLIED\"'), review_reference = '', "
         f"mutation_started_at = NULL, row_version = row_version + 1, update_time = {MYT_NOW} "
         f"WHERE tenant_id = {t} AND id = {p['op_row_id']} AND operation_id = {sq(op)} AND operation_status = 'REQUIRES_REVIEW' "
         f"AND result_code = 'VERIFICATION_MISMATCH' AND result_message LIKE '{stop}:%' AND is_deleted = 0"),
        (f"2. effects -> NOT_APPLIED ({n})", n,
         f"UPDATE inventory_operation_effect SET effect_status = 'NOT_APPLIED', error_code = 'STALE_BEFORE_MUTATION', "
         f"error_message = {sq(effect_note)}, "
         f"update_time = {MYT_NOW} "
         f"WHERE tenant_id = {t} AND operation_id = {sq(op)} AND effect_status = 'UNCERTAIN' AND IFNULL(movement_id, '') = '' "
         f"AND applied_at IS NULL AND is_deleted = 0"),
        ("3. gate -> REJECT|STALE_BEFORE_MUTATION|<same nonce>", 1,
         f"UPDATE inventory_balance_lock SET owner_operation_id = {sq(reject_owner)}, update_time = {MYT_NOW} "
         f"WHERE tenant_id = {t} AND lock_key = {sq(gate_key)} AND owner_operation_id = {sq(apply_owner)} AND free_token = 0 AND is_deleted = 0"),
        ("4. P3 step -> STARTED (same operation, attempt %d)" % attempt, 1,
         f"UPDATE gd_publish_step SET step_status = 'STARTED', finished_at = NULL, result_ref = '', error_code = NULL, "
         f"error_message = NULL, update_time = {MYT_NOW} "
         f"WHERE tenant_id = {t} AND id = {p['p3_step_id']} AND job_id = {sq(job)} AND step_name = 'P3_INVENTORY_APPLY' "
         f"AND step_status = 'REQUIRES_REVIEW' AND inventory_operation_id = {sq(op)} AND attempt_count = {attempt} AND is_deleted = 0"),
        ("5. job -> COMMITTING_GD, due now, no lease (LAST)", 1,
         f"UPDATE gd_async_job SET job_status = 'COMMITTING_GD', progress_percent = 70, progress_message = 'Publishing Goods Delivery', "
         f"error_code = 'GD_INVENTORY_RETRYABLE_REJECTION', error_message = 'Stock is busy; retrying (STALE_BEFORE_MUTATION)', "
         f"error_details = {sq(details)}, next_attempt_at = NOW(3), lease_owner = NULL, lease_expires_at = NULL, finished_at = NULL, "
         f"row_version = row_version + 1, update_time = {MYT_NOW} "
         f"WHERE tenant_id = {t} AND id = {job} AND job_status = 'REQUIRES_REVIEW' AND error_code = 'GD_INVENTORY_REQUIRES_REVIEW' "
         f"AND IFNULL(lease_owner, '') = '' AND is_deleted = 0"),
    ]

    if after:
        undo_preview, undo_updates = [], []
        for i, (table, rows) in enumerate(sorted(p["undo"].items())):
            assert table in ("item_balance", "item_batch_balance") and rows
            ids = ", ".join(str(int(r)) for r, _ in rows)
            cols = sorted({c for _, d in rows for c, v in d.items() if str(v) not in ("0", "0.00000000")})
            case = lambda c, a="": ("(CASE %sid " % a) + " ".join("WHEN %s THEN %s" % (r, d.get(c, "0")) for r, d in rows) + " ELSE 0 END)"
            below = " OR ".join("x.%s - %s < 0" % (c, case(c, "x.")) for c in cols)
            undo_preview += [
                ("undo %s: %d rows present, 0 would go below zero" % (table, len(rows)),
                 f"SELECT COUNT(*) AS present, SUM({below}) AS below_zero FROM {table} x "
                 f"WHERE x.tenant_id = {t} AND x.id IN ({ids}) AND x.is_deleted = 0")]
            undo_updates += [
                ("0%s. undo %s: take the operation's change back by delta (all %d rows or none)" % ("ab"[i], table, len(rows)), len(rows),
                 f"UPDATE {table} SET " + ", ".join("%s = %s - %s" % (c, c, case(c)) for c in cols) + f", update_time = {MYT_NOW} "
                 f"WHERE tenant_id = {t} AND id IN ({ids}) AND is_deleted = 0 "
                 f"AND (SELECT g.n FROM (SELECT COUNT(*) AS n FROM {table} x WHERE x.tenant_id = {t} AND x.id IN ({ids}) "
                 f"AND x.is_deleted = 0 AND ({below})) g) = 0 "
                 f"AND (SELECT h.n FROM (SELECT COUNT(*) AS n FROM {table} y WHERE y.tenant_id = {t} AND y.id IN ({ids}) "
                 f"AND y.is_deleted = 0) h) = {len(rows)}")]
        preview += undo_preview
        updates = undo_updates + updates

    checks = [
        ("operation: REJECTED STALE_BEFORE_MUTATION, mutation_started_at NULL, summary all NOT_APPLIED",
         f"SELECT operation_status, result_code, mutation_started_at, review_reference, row_version, "
         f"JSON_EXTRACT(effect_summary, '$.by_status') AS by_status FROM inventory_operation WHERE tenant_id = {t} AND id = {p['op_row_id']}"),
        (f"effects: {n} NOT_APPLIED",
         f"SELECT effect_status, COUNT(*) AS n FROM inventory_operation_effect WHERE tenant_id = {t} AND operation_id = {sq(op)} "
         f"AND is_deleted = 0 GROUP BY effect_status"),
        ("gate: REJECT|STALE_BEFORE_MUTATION|<nonce>",
         f"SELECT owner_operation_id, free_token FROM inventory_balance_lock WHERE tenant_id = {t} AND lock_key = {sq(gate_key)} AND is_deleted = 0"),
        ("P3 step: STARTED, operation |%d, attempt %d" % (attempt, attempt),
         f"SELECT step_status, attempt_count, inventory_operation_id, finished_at FROM gd_publish_step WHERE tenant_id = {t} AND id = {p['p3_step_id']}"),
        ("job: COMMITTING_GD, due, no lease",
         f"SELECT job_status, error_code, row_version, attempt_count, lease_owner, (next_attempt_at <= NOW(3)) AS due "
         f"FROM gd_async_job WHERE tenant_id = {t} AND id = {job}"),
    ]
    return {"preview": preview, "updates": updates, "checks": checks}


def as_sql_file(p, b):
    out = [
        f"-- {p['gd_no']} (tenant {p['tenant']}, job {p['job_id']}): retry repair, 2026-10-27. Generated by gen_retry.py; see README.md.",
        "-- Run the three parts in order. Stop at the first part whose result differs from its expectation, and send it to me.",
        "",
        "-- ===== PART 1: preview (read-only). Each result must match the line above it. =====",
    ]
    for label, sql in b["preview"]:
        out += [f"-- {label}", sql + ";", ""]
    out.append("-- ===== PART 2: the repair. Run one statement at a time; each must report exactly the rows shown. =====")
    for label, rows, sql in b["updates"]:
        out += [f"-- {label}: expect {rows} row(s) affected", sql + ";", ""]
    out.append("-- ===== PART 3: checks (read-only) =====")
    for label, sql in b["checks"]:
        out += [f"-- {label}", sql + ";", ""]
    return "\n".join(out)


if __name__ == "__main__":
    sys.stdout.write(as_sql_file(PROD, build(PROD)) + "\n")
