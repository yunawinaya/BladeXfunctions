"""sql_check.py <tenant> <gd_id> [NAME ...]: every sql-node of the built GD Revert V2 workflows (Goods Delivery/RevertV2/*.json) run on dev,
read-only, with its placeholders filled with harmless values for one GD (ids "0" where a node would pass ids). Prints rows / the
error per node; exit 1 on any error. Proves the statements parse and every column exists - not what they return."""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "gdc", "pkv2tools"))
from dbq import q  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/RevertV2/"
tenant, gd = sys.argv[1], sys.argv[2]
assert tenant.isdigit() and gd.isdigit()
org = str(q("--dev", "SELECT organization_id FROM goods_delivery WHERE tenant_id = '%s' AND id = %s" % (tenant, gd))[0]["organization_id"])
VALS = {"tenantId": tenant, "gdId": gd, "organizationId": org, "jobId": "0", "partPrefix": "P|00000000|", "idemKey": "GDC|0|0", "jobIdsSql": "0", "nonce": "0"}


def fill(m):
    ref = m.group(1)
    if ref == "system:tenantId":
        return tenant
    key = ref.split(".")[-1]
    if key.endswith("IdsJson"):
        return '["0"]'
    if key.endswith("IdsSql"):
        return "0"
    if key in VALS:
        return VALS[key]
    raise SystemExit("no value for {{%s}}" % ref)


def sql_nodes(n, out):
    if isinstance(n, dict):
        if n.get("type") == "sql-node":
            out.append(n)
        for v in n.values():
            sql_nodes(v, out)
    elif isinstance(n, list):
        for v in n:
            sql_nodes(v, out)
    return out


def text_of(node):
    found = []

    def walk(v):
        if isinstance(v, str) and re.search(r"\bSELECT\b", v):
            found.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(node["data"])
    return max(found, key=len)


want = sys.argv[3:] or ["GD_REVERT_SUBMIT", "GD_REVERT_PREPARE", "GD_REVERT_COMMIT", "GD_REVERT_WORKER"]
bad = 0
for name in want:
    doc = json.load(open(R + name + ".json"))
    seen = set()
    for node in sql_nodes(doc, []):
        sql = text_of(node)
        if sql in seen:
            continue
        seen.add(sql)
        filled = re.sub(r"\{\{([^}]+)\}\}", fill, sql)
        try:
            rows = q("--dev", filled)
            print("%-18s %-28s ok   %d row(s)" % (name, node["id"], len(rows)))
        except BaseException as e:  # dbq exits on a SQL error
            bad += 1
            print("%-18s %-28s FAIL %s" % (name, node["id"], str(e)[:300]))
sys.exit(1 if bad else 0)
