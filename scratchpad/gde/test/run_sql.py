"""run_sql.py <--dev|--prod> <tenant> <gd_id> <org_id> <out.json> [materials] [so_lines] [sos]: every GD_EDIT_PREPARE read,
tokens filled (the delta's id lists default to 0), read-only. Prints row counts and sizes."""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "prepare"))
sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from sql import SQL  # noqa: E402
from dbq import q  # noqa: E402

env, tenant, gd, org, out = sys.argv[1:6]
dm, dsl, dso = (sys.argv[6:9] + ["0", "0", "0"])[:3]
assert tenant.isdigit() and gd.isdigit() and org.isdigit() and all(x.replace(",", "").isdigit() for x in (dm, dsl, dso))
sub = {"tenantId": tenant, "gdId": gd, "organizationId": org, "deltaMaterialIdsSql": dm, "deltaSoLineIdsSql": dsl, "deltaSoIdsSql": dso,
       "deltaSoLineIdsQuoted": ",".join("'%s'" % x for x in dsl.split(",")), "deltaAllocMaterialIdsSql": "0", "deltaAllocLineIdsSql": "0", "deltaUomIdsSql": "0"}
res = {"organizationId": org}
for k, s in SQL.items():
    for name, v in sub.items():
        s = s.replace("{{node:code_node_GEentry.data.%s}}" % name, v)
    assert "{{" not in s, k
    t0 = time.time()
    rows = q(env, s)
    res[k] = [{kk: (str(v) if v is not None else None) for kk, v in r.items()} for r in rows]
    print(f"{k:6s} rows={len(rows):5d}  {len(json.dumps(res[k]))/1e6:6.2f} MB  {time.time()-t0:5.1f}s")
json.dump(res, open(out, "w"))
