"""Run every PREPARE read (prepare/sql.py) read-only against one stored Goods Receiving, the placeholders filled as
code_node_RPentry would fill them, and save the rows as the sql-nodes would hand them on (JSON) for the adapter / chain
harnesses.

usage: python3 run_prepare_sql.py <--dev|--prod> <gr_id> <out.json> [--skip lock,...]   (prod has no gd_publish_step: --skip lock)
Output holds customer data: write it to the session scratchpad, never into the repo.
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "prepare"))
from dbq import q  # noqa: E402
from sql import SQL, COLUMNS  # noqa: E402


def fill(sql, vals):
    def rep(m):
        key = m.group(1).split(".")[-1]
        if key not in vals:
            raise KeyError(m.group(1))
        return vals[key]
    return re.sub(r"\{\{node:([^}]+)\}\}", rep, sql)


def main():
    env, gr_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
    if not re.fullmatch(r"[0-9]{1,20}", gr_id):
        raise SystemExit("gr_id must be digits")
    g = q(env, f"SELECT tenant_id, organization_id FROM goods_receiving WHERE id = {gr_id}")
    if not g:
        raise SystemExit("no such Goods Receiving")
    vals = {"tenantId": g[0]["tenant_id"], "grId": gr_id, "organizationId": g[0]["organization_id"]}
    res = {"_vals": vals}
    skip = set(sys.argv[sys.argv.index("--skip") + 1].split(",")) if "--skip" in sys.argv else set()
    for k, sql in SQL.items():
        if k in skip:
            continue
        t0 = time.time()
        rows = q(env, fill(sql, vals))
        dt = time.time() - t0
        cols = list(rows[0].keys()) if rows else []
        bad = [c for c in cols if c not in COLUMNS[k]]
        size = sum(len(json.dumps(r)) for r in rows)
        print(f"  {k:8s} rows={len(rows):5d} bytes={size:9d} {dt * 1000:7.0f} ms" + (f"  UNDECLARED {bad}" if bad else ""))
        res[k] = rows
    json.dump(res, open(out, "w"))


if __name__ == "__main__":
    main()
