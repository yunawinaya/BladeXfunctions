"""Runs every sql-node of the Picking V2 workflows on dev (read-only SELECTs) with placeholder values filled in."""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dbq import q

R = os.environ.get("PK_OUT", "/Users/yunawinaya/Developer/BladeXfunctions/Picking/AsyncV2/")
VALS = {
    "tenantId": "496474", "pickingId": "2108480588689354754", "organizationId": "1901545950162329602", "idempotencyKey": "TEST-KEY-0000000000",
    "jobId": "0", "jobPrefixLike": "0|%", "uomRowIdsSql": "2108480588706131973", "rowIdsSql": "2108480588706131973,2108480588706131974",
    "gdIdsSql": "2106273454887186434", "gdIdsAllSql": "2106273454887186434", "gdLineIdsSql": "2106273454908157955,2106273454908157956",
    "jobIdsSql": "0", "expectSql": "'2106273454887186434'", "gdIdsCsv": "2106273454887186434",
}

def fill(sql):
    def rep(m):
        path = m.group(1)
        key = path.split(".")[-1]
        if key not in VALS:
            raise KeyError(path)
        return VALS[key]
    return re.sub(r"\{\{node:([^}]+)\}\}", rep, sql)

def walk(n, out):
    if isinstance(n, dict):
        if n.get("type") == "sql-node":
            out.append(n)
        for v in n.values():
            walk(v, out)
    elif isinstance(n, list):
        for v in n:
            walk(v, out)

bad = 0
for f in sorted(os.listdir(R)):
    if not f.endswith(".json"):
        continue
    nodes = []
    walk(json.load(open(R + f)), nodes)
    for n in nodes:
        sql = fill(n["data"]["script"]["code"])
        declared = [r["name"] for r in n["data"]["response_json"]]
        try:
            rows = q("--dev", sql + ("" if "LIMIT" in sql.split("\n")[-1] else ""))
            cols = list(rows[0].keys()) if rows else []
            miss = [c for c in cols if c not in declared]
            extra = [c for c in declared if rows and c not in cols]
            flag = "ok  " if not miss and not extra else "COLS"
            if miss or extra:
                bad += 1
            print("%s %-22s %-24s rows=%-5d %s%s" % (flag, f[:-5], n["id"], len(rows), ("undeclared " + str(miss)) if miss else "", (" unreturned " + str(extra)) if extra else ""))
        except BaseException as e:
            bad += 1
            print("FAIL %-22s %-24s %s" % (f[:-5], n["id"], str(e)[:300]))
print("problems:", bad)
