"""run_reads.py <tenant> <gd_id> <out.json>: every GD_CANCEL_PREPARE read on DEV (read-only) with the tokens filled; the GD's
organization is read first. Prints each read's row count."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "prepare"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "gdc", "pkv2tools"))
from sql import SQL  # noqa: E402
from dbq import q  # noqa: E402

tenant, gd, out = sys.argv[1:4]
assert tenant.isdigit() and gd.isdigit()
org = str(q("--dev", "SELECT CAST(organization_id AS CHAR) AS o FROM goods_delivery WHERE tenant_id = '%s' AND id = %s" % (tenant, gd))[0]["o"])
assert org.isdigit()
res = {"organizationId": org}
for k, s in SQL.items():
    s = s.replace("{{node:code_node_GCentry.data.tenantId}}", tenant).replace("{{node:code_node_GCentry.data.gdId}}", gd).replace("{{node:code_node_GCentry.data.organizationId}}", org)
    assert "{{" not in s, k
    rows = q("--dev", s)
    res[k] = [{kk: (str(v) if v is not None else None) for kk, v in r.items()} for r in rows]
    print(f"{k:6s} rows={len(rows)}")
json.dump(res, open(out, "w"))
