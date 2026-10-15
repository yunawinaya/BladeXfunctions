"""sql_live.py <workflow.json>...: every sql-node of a built workflow executed READ-ONLY on dev with sample values for its
tokens (a real GD: 711077 GD/20261003/006), so a syntax / collation / unknown-column error shows before a live run. Only
SELECTs are run (each statement is checked to start with SELECT). The interpreter sims never execute SQL.

usage: python3 sql_live.py <workflow.json>...
"""
import json, re, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

GD, ORG, TENANT = "2106410908064858113", "1123598813738675201", "711077"
LINE_CHECK = "JSON_OBJECT('id', gl.`id`, 'is_deleted', gl.`is_deleted`, 'job_line_key', gl.`job_line_key`, 'line_index', gl.`line_index`)"
SAMPLE = {"tenantId": TENANT, "gdId": GD, "organizationId": ORG, "partPrefix": "P|x|", "jobId": "0", "createLike": "0|C|%", "lineCheckSql": LINE_CHECK,
          "deltaSoLineIdsQuoted": "'0'", "pickingId": "", "idemKey": "x", "nonce": "abc", "plantId": "0", "jobIdsSql": "0"}


def value(token):
    last = token.split(".")[-1]
    if last in SAMPLE:
        return SAMPLE[last]
    if last.endswith("IdsJson") or last.endswith("Json"):
        return '["0"]'
    if last.endswith("Sql"):
        return "0"
    return "0"


bad = 0
for path in sys.argv[1:]:
    doc = json.load(open(path))
    nodes = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                nodes.append(n)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    seen = set()
    for n in nodes:
        text = n["data"]["script"]["code"]
        if text in seen:
            continue
        seen.add(text)
        sql = re.sub(r"\{\{(?:node|workflowparams|system):([^}]+)\}\}", lambda m: value(m.group(1)), text)
        assert re.match(r"\s*SELECT\b", sql, re.I), n["id"]
        try:
            rows = q("--dev", sql)
            status = "ok %d row(s)" % len(rows)
        except BaseException as e:  # dbq exits on an SQL error
            bad += 1
            status = "FAILED " + str(e).strip().splitlines()[-1][:300]
        if not status.startswith("ok"):
            print("%s %s: %s" % (path.split("/")[-1], n["id"], status))
    print("%s: %d distinct SQL node(s) run" % (path.split("/")[-1], len(seen)))
print("FAILED: %d" % bad if bad else "all SQL ran")
sys.exit(1 if bad else 0)
