"""Run every PREPARE read (prepare/sql.py SQL) and every SUBMIT read (SUBMIT_SQL) read-only against stored Transfer Order
Putaways, the placeholders filled as code_node_PPentry / the SUBMIT entry would fill them, and save the rows as the
sql-nodes would hand them on (JSON) for the adapter / chain harnesses.

usage: python3 run_prepare_sql.py <--dev|--prod> <out_dir> <to_id> [<to_id> ...]
       python3 run_prepare_sql.py <--dev|--prod> <out_dir> --add-audit   (adds transit_audit to saved fixtures)
  writes <out_dir>/<env>_<to_id>.json = {"_vals": {...}, "<key>": rows, ..., "submit": {"<key>": rows}}
Output holds customer data: write it to the session scratchpad, never into the repo.
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
sys.path.insert(0, os.path.join(HERE, "..", "prepare"))
from dbq import q  # noqa: E402
from sql import SQL, SUBMIT_SQL, COLUMNS, SUBMIT_COLUMNS, IT, E, jcols  # noqa: E402

DIG = re.compile(r"[0-9]{1,20}")
# the V2 tables are dev-only so far
PROD_SKIP = {"lock": "gd_publish_step does not exist on prod"}
# writes_vs_db.js compares what a run wrote with every column of every in-transit row of the GR; PREPARE reads closed rows as keys only
AUDIT_SQL = {"transit_audit": (
    f"SELECT {jcols('t', IT)} AS j\n  FROM in_transit_detail t\n"
    f" WHERE t.tenant_id = '{{{{node:{E}.data.tenantId}}}}' AND t.doc_id = '{{{{node:{E}.data.grId}}}}'"
    f" AND t.organization_id = '{{{{node:{E}.data.organizationId}}}}' AND t.is_deleted = 0\n ORDER BY t.id")}


def fill(sql, vals):
    def rep(m):
        key = m.group(1).split(".")[-1]
        if key not in vals:
            raise KeyError(m.group(1))
        return vals[key]
    return re.sub(r"\{\{node:([^}]+)\}\}", rep, sql)


def run(env, stmts, cols, vals, label):
    res = {}
    for k, sql in stmts.items():
        t0 = time.time()
        if env == "--prod" and k in PROD_SKIP:
            print(f"  {label:7s} {k:8s} skipped on prod ({PROD_SKIP[k]})")
            continue
        text = fill(sql, vals)
        if env == "--prod":
            # columns V2 added on dev only (prod has not got them yet): read as NULL there
            text = text.replace("'job_line_key', r.`job_line_key`", "'job_line_key', NULL")
        rows = q(env, text)
        dt = time.time() - t0
        got = list(rows[0].keys()) if rows else []
        bad = [c for c in got if c not in cols[k]]
        size = sum(len(json.dumps(r)) for r in rows)
        print(f"  {label:7s} {k:8s} rows={len(rows):5d} bytes={size:9d} {dt * 1000:7.0f} ms" + (f"  UNDECLARED {bad}" if bad else ""))
        res[k] = rows
    return res


def add_audit(env, out_dir):
    # fixtures saved before AUDIT_SQL: add its rows in place
    for f in sorted(os.listdir(out_dir)):
        if not f.startswith(env[2:] + "_") or not f.endswith(".json"):
            continue
        p = os.path.join(out_dir, f)
        res = json.load(open(p))
        if "transit_audit" in res:
            continue
        print(f"{env} {f}")
        res.update(run(env, AUDIT_SQL, {"transit_audit": ["j"]}, res["_vals"], "AUDIT"))
        json.dump(res, open(p, "w"))


def main():
    env, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    if sys.argv[3:] == ["--add-audit"]:
        return add_audit(env, out_dir)
    for to_id in sys.argv[3:]:
        if not DIG.fullmatch(to_id):
            raise SystemExit("to_id must be digits")
        h = q(env, f"SELECT tenant_id, organization_id, gr_no FROM transfer_order_putaway WHERE id = {to_id}")
        if not h:
            print(f"{to_id}: no such Transfer Order Putaway")
            continue
        vals = {"tenantId": h[0]["tenant_id"], "toId": to_id, "grId": h[0]["gr_no"] or "0", "organizationId": h[0]["organization_id"] or "0"}
        if not DIG.fullmatch(vals["grId"]) or not DIG.fullmatch(vals["organizationId"]) or not DIG.fullmatch(vals["tenantId"]):
            print(f"{to_id}: non-digit keys {vals}")
            continue
        print(f"{env} TO {to_id}")
        res = {"_vals": vals}
        res.update(run(env, SQL, COLUMNS, vals, "PREPARE"))
        res.update(run(env, AUDIT_SQL, {"transit_audit": ["j"]}, vals, "AUDIT"))
        res["submit"] = run(env, SUBMIT_SQL, SUBMIT_COLUMNS, vals, "SUBMIT")
        json.dump(res, open(os.path.join(out_dir, f"{env[2:]}_{to_id}.json"), "w"))


if __name__ == "__main__":
    main()
