"""Run every GR Revert V2 read (prepare/sql.py) READ-ONLY against stored Goods Receivings, the placeholders filled as the
nodes fill them, and save the rows as the sql-nodes hand them on (JSON) for the harnesses: round 1 (code_node_VPentry's
tenantId / grId), then the assembled VPprep node on those rows (test/prep_vals.js; the receipt treated as locked by a test
job, its job's previous status = its stored status) for round 2's sql* values, then round 2 and the SUBMIT reads.

usage: <.dbtools venv python> run_prepare_sql.py <--dev|--prod> <out_dir> (<gr_id> ... | --completed [--limit N] | --recorded <runs.jsonl>)
  --completed: every Goods Receiving of the environment that is Completed / Received now
  --recorded: the receipt of every recorded GR_REVERT_COMPLETED run (fetch_grrv_runs.py) of the environment, round 2 keyed on
              the id lists that run's grRvPrep recorded (the receipts were reverted since: VPprep would find nothing to read)
  writes <out_dir>/<env>_<gr_id>.json (--recorded: <env>_run_<run id>.json) = {"_vals", "_prep" (VPprep's answer), "<key>": rows,
  ..., "submit": {"<key>": rows}}
  One connection; only SELECT statements; columns the environment lacks (prod: the GR V2 columns) read as NULL; prod has no
  gd_publish_step (the lock read is skipped).
Output holds customer data: write it to the session scratchpad, never into the repo.
"""
import json
import os
import re
import subprocess
import sys
import time

import pymysql

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "prepare"))
from sql import ROUND1, ROUND2, SUBMIT_SQL, COLUMNS, SUBMIT_COLUMNS, COLS  # noqa: E402

DBT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".dbtools"))
DIG = re.compile(r"[0-9]{1,20}")
TOKEN = re.compile(r"\{\{node:([^}]+)\}\}")


class DB:
    def __init__(self, env):
        cfg = {}
        for line in open(os.path.join(DBT, "db.%s.env" % env)):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
        self.conn = pymysql.connect(host=cfg["DB_HOST"], port=int(cfg["DB_PORT"]), user=cfg["DB_USER"], password=cfg["DB_PASSWORD"],
                                    database=cfg.get("DB_NAME") or None, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
                                    connect_timeout=15, read_timeout=300, autocommit=True)

    def q(self, sql):
        verb = sql.lstrip().lstrip("(").split(None, 1)[0].upper()
        if verb not in ("SELECT", "WITH"):
            raise SystemExit("refusing a non-read statement")
        with self.conn.cursor() as cur:
            cur.execute(sql)
            return [dict(r) for r in cur.fetchall()]


def fill(sql, vals):
    def rep(m):
        key = m.group(1).split(".")[-1]
        if key not in vals:
            raise KeyError(m.group(1))
        v = str(vals[key])
        # every interpolated value is digits or a comma-separated digit list
        if not re.fullmatch(r"[0-9]{1,20}(,[0-9]{1,20})*", v):
            raise ValueError("non-digit value for %s: %r" % (m.group(1), v))
        return v
    return TOKEN.sub(rep, sql)


def plain(rows):
    """rows as the sql-node hands them on: JSON text stays text, numbers stay numbers"""
    return json.loads(json.dumps(rows, default=str))


def main():
    env = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    db = DB(env[2:])
    have = {}
    for r in db.q("SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = DATABASE() "
                  "AND table_name IN ('goods_receiving', 'goods_receiving_eg6l4ywi_sub')"):
        have.setdefault(r["t"].lower(), set()).add(r["c"])
    missing = [("g", c) for c in COLS["goods_receiving"] if c not in have.get("goods_receiving", set())]
    missing += [("l", c) for c in COLS["goods_receiving_eg6l4ywi_sub"] if c not in have.get("goods_receiving_eg6l4ywi_sub", set())]
    no_steps = not db.q("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'gd_publish_step'")
    if missing:
        print("columns read as NULL here:", ", ".join(a + "." + c for a, c in missing), file=sys.stderr)

    def env_sql(sql):
        for a, c in missing:
            sql = sql.replace("%s.`%s`" % (a, c), "NULL")
        return sql

    args = sys.argv[3:]
    recorded = {}
    if "--recorded" in args:
        for line in open(args[args.index("--recorded") + 1]):
            if not line.strip():
                continue
            r = json.loads(line)
            pr = ((r["nodes"].get("code_node_grRvPrep") or {}).get("resp") or {}).get("data")
            gid = str((r.get("params") or {}).get("gr_id") or "")
            if pr and DIG.fullmatch(gid):
                recorded[r["id"]] = (gid, pr)
        ids = list(recorded)
    elif "--completed" in args:
        lim = int(args[args.index("--limit") + 1]) if "--limit" in args else 100000
        ids = [r["id"] for r in db.q("SELECT CAST(id AS CHAR) id FROM goods_receiving WHERE is_deleted = 0 AND gr_status IN ('Completed', 'Received') ORDER BY id")][:lim]
    else:
        ids = [a for a in args if DIG.fullmatch(a)]
    t_all = time.time()
    for n, key in enumerate(ids):
        run_id, rec = (key, recorded[key][1]) if recorded else ("", None)
        gr_id = recorded[key][0] if recorded else key
        g = db.q(f"SELECT tenant_id, organization_id, gr_status FROM goods_receiving WHERE id = {gr_id}")
        if not g or not DIG.fullmatch(str(g[0]["tenant_id"] or "")):
            print(f"{gr_id}: no such Goods Receiving / tenant")
            continue
        vals = {"tenantId": g[0]["tenant_id"], "grId": gr_id}
        res = {"_vals": dict(vals, organizationId=g[0]["organization_id"], grStatus=g[0]["gr_status"]), "_times": {}}
        for k, sql in ROUND1.items():
            if k == "lock" and no_steps:
                res[k] = []
                continue
            t0 = time.time()
            rows = plain(db.q(env_sql(fill(sql, vals))))
            res["_times"][k] = round((time.time() - t0) * 1000)
            bad = [c for c in (rows[0].keys() if rows else []) if c not in COLUMNS[k]]
            if bad:
                raise SystemExit(f"{gr_id} {k}: undeclared columns {bad}")
            res[k] = rows
        tmp = os.path.join(out_dir, f".r1_{env[2:]}_{gr_id}.json")
        json.dump(res, open(tmp, "w"))
        p = subprocess.run(["node", os.path.join(HERE, "prep_vals.js"), tmp], capture_output=True, text=True, env=dict(os.environ, TZ="Asia/Kuala_Lumpur"))
        os.remove(tmp)
        if p.returncode:
            raise SystemExit(f"{gr_id}: prep_vals.js failed: {p.stderr[-800:]}")
        prep = json.loads(p.stdout)
        res["_prep"] = prep
        v2 = dict(vals)
        go = prep.get("route") == "GO" and str(prep.get("refuse")) != "1"
        for k in ("sqlMinLiveId", "sqlPlantId", "sqlItemIds", "sqlBatchIds", "sqlHuIds", "sqlPoIds", "sqlPoLineIds"):
            v2[k] = prep.get(k) if go else "0"
        if rec is not None:
            ids_of = lambda a: ",".join(x for x in (rec.get(a) or []) if DIG.fullmatch(str(x))) or "0"  # noqa: E731
            v2.update(sqlMinLiveId=rec.get("minLiveIdSql") or "0", sqlPlantId=rec.get("plantIdSql") or "0", sqlItemIds=ids_of("itemIds"),
                      sqlBatchIds=ids_of("batchIds"), sqlHuIds=ids_of("huIds"), sqlPoIds=ids_of("poIds"), sqlPoLineIds=ids_of("poLineIds"))
            res["_vals"]["run"] = run_id
        for k, sql in ROUND2.items():
            t0 = time.time()
            rows = plain(db.q(env_sql(fill(sql, v2))))
            res["_times"][k] = round((time.time() - t0) * 1000)
            bad = [c for c in (rows[0].keys() if rows else []) if c not in COLUMNS[k]]
            if bad:
                raise SystemExit(f"{gr_id} {k}: undeclared columns {bad}")
            res[k] = rows
        res["submit"] = {}
        for k, sql in SUBMIT_SQL.items():
            rows = plain(db.q(env_sql(fill(sql, vals))))
            bad = [c for c in (rows[0].keys() if rows else []) if c not in SUBMIT_COLUMNS[k]]
            if bad:
                raise SystemExit(f"{gr_id} submit {k}: undeclared columns {bad}")
            res["submit"][k] = rows
        json.dump(res, open(os.path.join(out_dir, f"{env[2:]}_run_{run_id}.json" if run_id else f"{env[2:]}_{gr_id}.json"), "w"))
        print(f"{env} {n + 1}/{len(ids)} GR {gr_id} ({g[0]['gr_status']}): prep {prep.get('route')} {prep.get('code')} lines {prep.get('lineCount')} "
              f"| rows " + " ".join(f"{k}={len(res[k])}" for k in list(ROUND1) + list(ROUND2) if res.get(k)) + f" | {sum(res['_times'].values())} ms")
    print(f"{len(ids)} receipts in {time.time() - t_all:.0f} s", file=sys.stderr)


if __name__ == "__main__":
    main()
