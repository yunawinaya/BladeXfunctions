"""V2.1 bundles: the inputs of one LOT_V2_PREPARE plan run on a REAL classic payload that was never stored (read-only).

usage: python3 fetch_bundle.py <--dev|--prod> <classic SM_LOCATION_TRANSFER run id> <out.json>
  Takes the run's workflowparams (the form payload) and runs PREPARE's own reads (prepare/sql.py aitem, abal, items, bins) with
  the stored-lines subqueries replaced by the payload's ids: the auto allocation's candidates (code_node_LOTallocPrep's rule:
  requested_qty > 0, no temp_qty_data, an item) and the plant. Writes { tenant, params, reads } for run_bundle.js.
Fixtures hold customer data: write them to the session scratchpad, never into the repo.
"""
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SMV2 = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(SMV2, "lib"))
from dbq import q  # noqa: E402

_spec = importlib.util.spec_from_file_location("lot_prepare_sql", os.path.join(SMV2, "prepare", "sql.py"))
PSQL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PSQL)
BIG = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])')
DIG = re.compile(r"[0-9]{1,20}")


def P(text):
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(0)[0] == '"' else '"' + m.group(0) + '"', text))


def main():
    env, run_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
    assert env in ("--dev", "--prod") and DIG.fullmatch(run_id)
    r = q(env, f"SELECT tenant_id, request_json_data FROM su_code_workflow_inst WHERE workflow_id = 2013133675374927874 AND id = {run_id}")[0]
    params = P(r["request_json_data"])["workflowparams"]
    a = params["allData"]
    rows = []
    for top in a.get("stock_movement") or []:
        rows.append(top)
        rows += top.get("children") or []
    flat = [x for x in rows if not (x.get("item_bundle_id") and not x.get("parent_fm_key"))]
    has_tmp = lambda v: isinstance(v, str) and v.strip() not in ("", "[]")
    cand = sorted({str(x["item_selection"]) for x in flat if float(x.get("requested_qty") or 0) > 0 and not has_tmp(x.get("temp_qty_data")) and x.get("item_selection")})
    items = sorted({str(x["item_selection"]) for x in rows if x.get("item_selection")})
    plant, org, tenant = str(a["issuing_operation_faci"]), str(a["organization_id"]), str(r["tenant_id"])
    for v in cand + items + [plant, org, tenant]:
        assert DIG.fullmatch(v), v
    E = PSQL.ENTRY
    fill = lambda sql: (sql.replace(PSQL.CAND, ", ".join(cand) or "0").replace(PSQL.PLANT, plant)
                        .replace("(SELECT CAST(l.item_selection AS UNSIGNED) FROM " + PSQL.LINES_OF + ")", "(" + (", ".join(items) or "0") + ")")
                        .replace("'{{node:%s.data.tenantId}}'" % E, "'" + tenant + "'").replace("{{node:%s.data.organizationId}}" % E, org))
    reads = {}
    for k in ("aitem", "abal", "items", "bins"):
        sql = fill(PSQL.READS[k][0])
        assert "{{" not in sql, (k, sql[:300])
        reads[k] = q(env, sql)
        print(f"  {k:6s} rows={len(reads[k])}", file=sys.stderr)
    json.dump({"tenant": tenant, "run": run_id, "params": params, "reads": reads, "candidates": len(cand)}, open(out, "w"))
    print(f"{out}: {len(flat)} flat lines, {len(cand)} candidate items, plant {plant}")


if __name__ == "__main__":
    main()
