"""build_review_retry.py <tenant> <job_id> <attempt> <out_dir>: release_locks.sql + retry.sql (+ params.json) for a GD Created
V2 job whose stock operation GD|<job>|<attempt> stopped in review with nothing moved (VERIFICATION_MISMATCH,
BEFORE_FIRST_WRITE or AFTER_BALANCE_WRITE), read from prod (read-only). The general form of build_1774.py; the SQL comes
from gen_retry.py. Run the release first (it unblocks the jobs behind the locks), then retry.sql.
"""
import json
import os
import subprocess
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import gen_retry  # noqa: E402

TENANT, JOB, ATTEMPT, OUT = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
assert TENANT.isdigit() and JOB.isdigit()
OP = "GD|%s|%d" % (JOB, ATTEMPT)
COLS = ["balance_quantity", "block_qty", "intransit_qty", "qualityinsp_qty", "reserved_qty", "unrestricted_qty"]
T = f"tenant_id = '{TENANT}'"


def q(sql):
    out = subprocess.run([os.path.join(ROOT, ".dbtools/db"), "--prod", "--json", sql], capture_output=True, text=True).stdout
    i = out.find("[")
    if i < 0:
        raise SystemExit("query failed: " + sql[:120])
    return json.loads(out[i:])


job = q(f"SELECT organization_id, gd_no FROM gd_async_job WHERE {T} AND id = {JOB}")[0]
op = q(f"SELECT CAST(id AS CHAR) AS id, result_message, review_reason, DATE_FORMAT(mutation_started_at, '%Y-%m-%d %H:%i:%s') AS ms "
       f"FROM inventory_operation WHERE {T} AND operation_id = '{OP}' AND is_deleted = 0")[0]
after = op["result_message"].startswith("AFTER_BALANCE_WRITE:")
assert after or op["result_message"].startswith("BEFORE_FIRST_WRITE:"), op["result_message"][:60]
undo = {}
if after:
    plan = json.loads(op["review_reason"])["mutation_plan"]["balances"]
    ids = ",".join(b["id"] for b in plan)
    table = {}
    for t in ("item_balance", "item_batch_balance"):
        for r in q(f"SELECT CAST(id AS CHAR) AS id FROM {t} WHERE {T} AND id IN ({ids})"):
            table[r["id"]] = t
    assert len(table) == len(plan), "every planned row is in exactly one balance table"
    for b in plan:
        d = {c: Decimal(b["after"][c]) - Decimal(b["before"][c]) for c in COLS}
        undo.setdefault(table[b["id"]], []).append((b["id"], {c: str(v) for c, v in d.items() if v != 0}))
p3 = q(f"SELECT CAST(id AS CHAR) AS id, attempt_count FROM gd_publish_step WHERE {T} AND job_id = '{JOB}' AND step_name = 'P3_INVENTORY_APPLY' AND is_deleted = 0")[0]
gate = q(f"SELECT owner_operation_id FROM inventory_balance_lock WHERE {T} AND lock_key = 'GATE|{OP}' AND is_deleted = 0")[0]["owner_operation_id"]
neff = q(f"SELECT COUNT(*) AS n FROM inventory_operation_effect WHERE {T} AND operation_id = '{OP}' AND is_deleted = 0")[0]["n"]
assert gate.startswith("APPLY|") and int(p3["attempt_count"]) == ATTEMPT
p = {"tenant": TENANT, "job_id": JOB, "gd_no": job["gd_no"], "op_row_id": op["id"], "op_id": OP, "organization_id": str(job["organization_id"]),
     "p3_step_id": p3["id"], "apply_nonce": gate.split("|", 1)[1], "n_effects": int(neff), "mutation_started_utc": op["ms"], "attempt": ATTEMPT}
if after:
    p.update({"mode": "after_balance_write", "undo": undo})
os.makedirs(OUT, exist_ok=True)
json.dump(p, open(os.path.join(OUT, "params.json"), "w"), indent=1)
open(os.path.join(OUT, "retry.sql"), "w").write(gen_retry.as_sql_file(p, gen_retry.build(p)) + "\n")
held = q(f"SELECT COUNT(*) AS n FROM inventory_balance_lock WHERE {T} AND owner_operation_id = '{OP}' AND free_token = 0 AND is_deleted = 0")[0]["n"]
open(os.path.join(OUT, "release_locks.sql"), "w").write(f"""-- {job['gd_no']} (tenant {TENANT}): release the {held} stock locks held by {OP}, which stopped in review. Run this FIRST
-- (it unblocks the jobs waiting behind them), then retry.sql. Same statement as the Kenhin 2168 / LSH 1774 releases.

-- 1. Preview: must return {held}.
SELECT COUNT(*) AS held FROM inventory_balance_lock
 WHERE tenant_id = '{TENANT}' AND owner_operation_id = '{OP}' AND free_token = 0 AND is_deleted = 0;

-- 2. Release: expect "{held} rows affected".
UPDATE inventory_balance_lock
   SET owner_operation_id = '',
       last_owner_operation_id = '{OP}',
       last_released_at = NOW(3),
       lock_version = lock_version + 1,
       free_token = 1,
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '{TENANT}' AND owner_operation_id = '{OP}' AND free_token = 0 AND is_deleted = 0;

-- 3. Check: must return 0.
SELECT COUNT(*) AS still_held FROM inventory_balance_lock
 WHERE tenant_id = '{TENANT}' AND owner_operation_id = '{OP}' AND is_deleted = 0;
""")
print(job["gd_no"], "| mode", "after_balance_write" if after else "before_first_write", "| undo rows", {t: len(r) for t, r in undo.items()},
      "| effects", neff, "| locks held", held, "| P3", p3["id"])
