"""build_1774.py: retry_1774.sql for LSH GD-2610-1774 (gen_retry.py mode after_balance_write), from prod, read-only: the
operation's own mutation plan (review_reason), the table of each planned row, the P3 step, the gate's nonce.
  python3 prod-hotfix/2026-10-27-lsh-gd1774-review/build_1774.py      (writes retry_1774.sql + params_1774.json next to it)
"""
import json
import os
import subprocess
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "prod-hotfix/2026-10-27-kenhin-gd2168-retry"))
import gen_retry  # noqa: E402

TENANT, JOB, OP = "128671", "2114978878563946498", "GD|2114978878563946498|2"
COLS = ["balance_quantity", "block_qty", "intransit_qty", "qualityinsp_qty", "reserved_qty", "unrestricted_qty"]


def q(sql):
    out = subprocess.run([os.path.join(ROOT, ".dbtools/db"), "--prod", "--json", sql], capture_output=True, text=True).stdout
    i = out.find("[")
    if i < 0:
        raise SystemExit("query failed: " + sql[:120])
    return json.loads(out[i:])


T = f"tenant_id = '{TENANT}'"
job = q(f"SELECT organization_id, gd_no FROM gd_async_job WHERE {T} AND id = {JOB}")[0]
op = q(f"SELECT CAST(id AS CHAR) AS id, review_reason, DATE_FORMAT(mutation_started_at, '%Y-%m-%d %H:%i:%s') AS ms FROM inventory_operation "
       f"WHERE {T} AND operation_id = '{OP}' AND is_deleted = 0")[0]
plan = json.loads(op["review_reason"])["mutation_plan"]["balances"]
ids = ",".join(b["id"] for b in plan)
table = {}
for t in ("item_balance", "item_batch_balance"):
    for r in q(f"SELECT CAST(id AS CHAR) AS id FROM {t} WHERE {T} AND id IN ({ids})"):
        assert r["id"] not in table, r["id"]
        table[r["id"]] = t
assert len(table) == len(plan), "every planned row is in exactly one balance table"
undo = {}
for b in plan:
    d = {c: Decimal(b["after"][c]) - Decimal(b["before"][c]) for c in COLS}
    undo.setdefault(table[b["id"]], []).append((b["id"], {c: str(v) for c, v in d.items() if v != 0}))
p3 = q(f"SELECT CAST(id AS CHAR) AS id, attempt_count FROM gd_publish_step WHERE {T} AND job_id = '{JOB}' AND step_name = 'P3_INVENTORY_APPLY' AND is_deleted = 0")[0]
gate = q(f"SELECT owner_operation_id FROM inventory_balance_lock WHERE {T} AND lock_key = 'GATE|{OP}' AND is_deleted = 0")[0]["owner_operation_id"]
neff = q(f"SELECT COUNT(*) AS n FROM inventory_operation_effect WHERE {T} AND operation_id = '{OP}' AND is_deleted = 0")[0]["n"]
assert gate.startswith("APPLY|") and int(p3["attempt_count"]) == 2
p = {"tenant": TENANT, "job_id": JOB, "gd_no": job["gd_no"], "op_row_id": op["id"], "op_id": OP, "organization_id": str(job["organization_id"]),
     "p3_step_id": p3["id"], "apply_nonce": gate.split("|", 1)[1], "n_effects": int(neff), "mutation_started_utc": op["ms"],
     "attempt": 2, "mode": "after_balance_write", "undo": undo}
json.dump(p, open(os.path.join(HERE, "params_1774.json"), "w"), indent=1)
open(os.path.join(HERE, "retry_1774.sql"), "w").write(gen_retry.as_sql_file(p, gen_retry.build(p)) + "\n")
print("rows per table:", {t: len(r) for t, r in undo.items()}, "| columns:", sorted({c for r in undo.values() for _, d in r for c in d}),
      "| P3", p3["id"], "| gate", gate, "| effects", neff, "| mutation_started", op["ms"])
