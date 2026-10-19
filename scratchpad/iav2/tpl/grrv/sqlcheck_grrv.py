"""Runs every sql-node of the built GR Revert V2 workflows READ-ONLY on dev with placeholder values of a real receipt
(GR/202610010001, tenant 000000: putaway, in-transit rows, batches).
usage: python3 sqlcheck_grrv.py <dir with built JSON> [NAME ...]"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grv2"))
from dbq import q  # noqa: E402

VALS = {
    "tenantId": "000000", "jobId": "2110228531056345089", "partPrefix": "P|abcd1234|", "poIdsSql": "0,2105557941966245890", "grId": "2105558330853724162",
    "grNoSql": "GR/202610010001", "organizationId": "1123598813738675201", "plantIdSql": "1123598813738675202", "plantId": "1123598813738675202",
    "minLiveIdSql": "2105558332145569794", "itemIdsCsv": "0,2105557416063438850", "fifoIdsSql": "0,2107720517613977602,2107724306957926402",
    "waIdsSql": "0,2018913742812639233,2018913743429201922", "toIdsSql": "0,2105558352827682817", "itIdsSql": "0,2105558353557491714,2105558353557491715",
    "qiIdsSql": "0,2029853910158245890", "batchIdsSql": "0,2105558332095238146", "key": "GRV:test:0000", "jobIdsSql": "2110228531056345089",
}
# columns the dev schema does not have yet (the GR form change) -> checked without them
MISSING_COLS = {}
EXTRA = json.loads(os.environ.get("GRRV_VALS", "{}"))


def fill(sql):
    vals = dict(VALS, **EXTRA)

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
            rows = q("--dev", fill(n["data"]["script"]["code"]))
            cols = list(rows[0].keys()) if rows else []
            miss = [c for c in cols if c not in declared]
            extra = [c for c in declared if rows and c not in cols]
            bad += bool(miss or extra)
            print("%s %-18s %-28s rows=%-5d %s%s" % ("ok  " if not miss and not extra else "COLS", f[:-5][:18], n["id"], len(rows),
                                                    ("undeclared " + str(miss)) if miss else "", (" unreturned " + str(extra)) if extra else ""))
        except BaseException as e:
            bad += 1
            print("FAIL %-18s %-28s %s" % (f[:-5][:18], n["id"], str(e)[:400]))
print("problems:", bad)
