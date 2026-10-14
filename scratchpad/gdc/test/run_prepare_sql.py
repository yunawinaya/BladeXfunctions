"""run_prepare_sql.py --dev <tenant> <gd_id> <org_id> <out.json>: run every GD_COMPLETE_PREPARE read with the tokens filled."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "prepare"))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
from sql import SQL  # noqa: E402
from dbq import q  # noqa: E402

env, tenant, gd, org, out = sys.argv[1:6]
assert tenant.isdigit() and gd.isdigit() and org.isdigit()
res = {"organizationId": org}
for k, s in SQL.items():
    s = s.replace("{{node:code_node_GCentry.data.tenantId}}", tenant).replace("{{node:code_node_GCentry.data.gdId}}", gd).replace("{{node:code_node_GCentry.data.organizationId}}", org)
    assert "{{" not in s, k
    rows = q(env, s)
    res[k] = [{kk: (str(v) if v is not None else None) for kk, v in r.items()} for r in rows]
    print(f"{k:6s} rows={len(rows)}")
json.dump(res, open(out, "w"))
