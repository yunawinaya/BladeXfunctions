"""Runs every sql-node of the built GR V2 workflows READ-ONLY on dev with placeholder values of a real receipt.
usage: python3 sqlcheck_grv2.py <dir with built JSON> [NAME ...]"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbq import q

VALS = {
    "tenantId": "000000", "jobId": "2110228531056345089", "partPrefix": "P|abcd1234|", "poIdsSql": "0,2102378800418779138",
    "grId": "2102383604918513666", "grNoSql": "GR/202609220021", "organizationId": "1123598813738675201", "numbersSql": '[{"n":"B001"},{"n":"GR/X"}]',
    "jobIdsSql": "2110228531056345089", "itemIdsSql": "0,2094626841323700252", "plantId": "1123598813738675202", "key": "GRC:test:0000",
    "toId": "2105558352827682817",
}
# per-workflow overrides (the Putaway V2 workflows read a putaway and its receipt)
PW_VALS = {"grId": "2105558330853724162", "partPrefix": "P|abcd1234|"}
# columns the dev schema does not have yet (added with the GR form change) -> checked without them
MISSING_COLS = {}


def fill(sql, extra=None):
    vals = dict(VALS, **(extra or {}))
    def rep(m):
        key = m.group(1).split(".")[-1]
        if key not in vals:
            raise KeyError(m.group(1))
        return vals[key]
    sql = re.sub(r"\{\{node:([^}]+)\}\}", rep, sql)
    for a, b in MISSING_COLS.items():
        sql = sql.replace(a, b)
    return sql


def walk(n, out):
    if isinstance(n, dict):
        if n.get("type") == "sql-node":
            out.append(n)
        for v in n.values():
            walk(v, out)
    elif isinstance(n, list):
        for v in n:
            walk(v, out)


d = sys.argv[1]
want = sys.argv[2:]
bad = 0
for f in sorted(os.listdir(d)):
    if not f.endswith(".json") or (want and f[:-5] not in want):
        continue
    nodes = []
    walk(json.load(open(os.path.join(d, f))), nodes)
    for n in nodes:
        declared = [r["name"] for r in n["data"]["response_json"]]
        try:
            rows = q("--dev", fill(n["data"]["script"]["code"], PW_VALS if f.startswith("PUTAWAY") else None))
            cols = list(rows[0].keys()) if rows else []
            miss = [c for c in cols if c not in declared]
            extra = [c for c in declared if rows and c not in cols]
            bad += bool(miss or extra)
            print("%s %-20s %-26s rows=%-5d %s%s" % ("ok  " if not miss and not extra else "COLS", f[:-5][:20], n["id"], len(rows),
                                                    ("undeclared " + str(miss)) if miss else "", (" unreturned " + str(extra)) if extra else ""))
        except BaseException as e:
            bad += 1
            print("FAIL %-20s %-26s %s" % (f[:-5][:20], n["id"], str(e)[:400]))
print("problems:", bad)
