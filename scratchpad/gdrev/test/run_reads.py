"""run_reads.py <tenant> <gd_id> [<out.json>]: every GD_REVERT_PREPARE read (prepare/sql.py) on dev, read-only, for one GD: the
placeholders filled the way the entry / ids nodes fill them (round-2 ids from the snapshot the round-1 read finds). Prints row
counts; with <out.json> writes {key: [rows]} for test/plan_live.js (tenant data: session scratchpad only)."""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "gdc", "pkv2tools"))
sys.path.insert(0, os.path.join(HERE, "..", "prepare"))
from dbq import q  # noqa: E402
from sql import SQL, ROUND1, ROUND2  # noqa: E402

tenant, gd = sys.argv[1], sys.argv[2]
assert tenant.isdigit() and gd.isdigit()
org = q("--dev", f"SELECT organization_id FROM goods_delivery WHERE tenant_id = '{tenant}' AND id = {gd}")[0]["organization_id"]
assert str(org).isdigit()
base = {"tenantId": tenant, "gdId": gd, "organizationId": str(org)}


def fill(sql, ids):
    sql = re.sub(r"\{\{node:code_node_GCentry\.data\.(\w+)\}\}", lambda m: base[m.group(1)], sql)
    return re.sub(r"\{\{node:code_node_RPids\.data\.(\w+)\}\}", lambda m: ids.get(m.group(1), "0"), sql)


out = {}
for k in ROUND1:
    out[k] = q("--dev", fill(SQL[k], {}))
    print(f"{k:6s} {len(out[k])} rows")
# round 2: the ids inside the snapshot, as code_node_inParseSnap derives them (pending ids, picking record ids, header ids, HU ids)
ids = {}
snap = json.loads(out["snap"][0]["j"]) if out["snap"] else {}


def arr(v):
    try:
        x = json.loads(v) if isinstance(v, str) else v
        return x if isinstance(x, list) else []
    except Exception:
        return []


digits = lambda xs: ",".join(sorted({str(x) for x in xs if str(x).isdigit()})) or "0"
ids["pendingIdsSql"] = digits(r.get("id") for r in arr(snap.get("pre_pending_state")))
ids["pickingRecordIdsSql"] = digits(r.get("id") for r in arr(snap.get("pre_picking_records")))
ids["ppHeaderIdsSql"] = digits(r.get("id") for r in arr(snap.get("pre_pp_headers")))
hu = arr(snap.get("pre_hu_state"))
ids["huIdsSql"] = digits(r.get("handling_unit_id") or r.get("hu_id") or r.get("id") for r in hu)
ids["huLineIdsSql"] = digits(r.get("line_id") or r.get("hu_line_id") for r in hu)
print("round-2 ids (from the snapshot):", {k: (v if len(v) < 60 else v[:57] + "...") for k, v in ids.items()})
for k in ROUND2:
    out[k] = q("--dev", fill(SQL[k], ids))
    print(f"{k:6s} {len(out[k])} rows")
if len(sys.argv) > 3:
    json.dump({"tenant": tenant, "gd": gd, "org": str(org), "ids": ids, "reads": out}, open(sys.argv[3], "w"), default=str)
    print("wrote", sys.argv[3])
