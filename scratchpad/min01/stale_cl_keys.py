#!/usr/bin/env python3
"""MIN-01: find engine lock keys stranded by a classic-child run (owner CL|...) and print a guarded repair per key.

A classic SUBTRACT/ADD_INVENTORY(_NEW) run that fails between its take and its release leaves inventory_balance_lock at
token 0: owned by its CL|<nonce> (died mid-section) or owner '' with last owner CL|<nonce> (died between the two release
steps). Nothing expires it: every engine run on that material + bin answers 409 LOCK_BUSY and every locked classic call 400
busy, until it is cleared. A classic critical section takes well under a second, so a CL| key held for minutes is dead.

  python3 -I scratchpad/min01/stale_cl_keys.py --dev|--prod [--minutes 10]

Read-only: it only SELECTs and prints. Each repair UPDATE re-checks the exact state it saw (id, token 0, owner, claimed_at),
so it does nothing if the key moved since. Apply it on DEV with `.dbtools/dbw "<UPDATE>"` (preview) then `--execute` after a yes;
on PROD the user pastes it. Clocks: both sides use the database's NOW(3), as the engine does (dev MYT, prod UTC).
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ap = argparse.ArgumentParser()
env = ap.add_mutually_exclusive_group(required=True)
env.add_argument("--dev", action="store_true")
env.add_argument("--prod", action="store_true")
ap.add_argument("--minutes", type=int, default=10)
a = ap.parse_args()
if not 1 <= a.minutes <= 1440:
    sys.exit("--minutes must be 1..1440")

SQL = f"""
SELECT CAST(id AS CHAR) AS id, tenant_id, organization_id, lock_key, free_token, owner_operation_id, last_owner_operation_id,
       DATE_FORMAT(claimed_at, '%Y-%m-%d %H:%i:%s.%f') AS claimed_at, DATE_FORMAT(last_released_at, '%Y-%m-%d %H:%i:%s') AS last_released_at,
       lock_version, TIMESTAMPDIFF(MINUTE, claimed_at, NOW(3)) AS held_min
  FROM inventory_balance_lock
 WHERE is_deleted = 0
   AND free_token = 0
   AND claimed_at < NOW(3) - INTERVAL {a.minutes} MINUTE
   AND (owner_operation_id LIKE 'CL|%' OR (owner_operation_id = '' AND last_owner_operation_id LIKE 'CL|%'))
 ORDER BY claimed_at
"""

out = subprocess.run([os.path.join(ROOT, ".dbtools", "db"), "--prod" if a.prod else "--dev", "--json", "--limit", "0", SQL],
                     capture_output=True, text=True)
if out.returncode != 0:
    sys.exit(out.stderr[-1500:])
lines = out.stdout.splitlines()
start = next((i for i, ln in enumerate(lines) if ln.strip() in ("[", "[]") or ln.startswith("[{")), None)
rows = json.loads("\n".join(lines[start:])) if start is not None else []
print(f"{len(rows)} stranded CL| key(s) older than {a.minutes} min ({'PROD' if a.prod else 'DEV'})")


def q(v):
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


for r in rows:
    owner = r["owner_operation_id"] or ""
    last = owner or r["last_owner_operation_id"]
    print(f"\n-- {r['lock_key']}  tenant {r['tenant_id']}  org {r['organization_id']}  owner {owner or '(none)'}  last owner "
          f"{r['last_owner_operation_id']}  held {r['held_min']} min")
    print(
        "UPDATE inventory_balance_lock SET free_token = 1, owner_operation_id = '', last_owner_operation_id = " + q(last)
        + ", last_released_at = NOW(3), lock_version = lock_version + 1"
        + f" WHERE id = {int(r['id'])} AND tenant_id = {q(r['tenant_id'])} AND free_token = 0"
        + f" AND owner_operation_id = {q(owner)} AND claimed_at = {q(r['claimed_at'])};"
    )
