"""V2.1 bundles: a recorded classic SM_LOCATION_TRANSFER run that auto-allocated, for golden_alloc.js (read-only).

usage: python3 fetch_alloc_run.py <--dev|--prod> <classic run id> <out.json>
  Saves the run's workflowparams, what it recorded of the allocation (code_node_LOTallocPrep, get_cache_node_LOTallocOut,
  code_node_yPlLXIZW's output, the code each ran), the GLOBAL_ALLOCATION runs it made (their params and the Item / balance rows
  their nodes read, as recorded), and the stored document today (PREPARE's hdr / lines reads) when the run's LOT still exists.
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
EPOCH = 1288834974657
LOT_WF, GA_WF = "2013133675374927874", "2032298961937842178"
BIG = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])')
DIG = re.compile(r"[0-9]{1,20}")


def P(text):
    if text is None or text == "":
        return None
    try:
        return json.loads(BIG.sub(lambda m: m.group(0) if m.group(0)[0] == '"' else '"' + m.group(0) + '"', text))
    except ValueError:
        return text


def nodes(nodes_data):
    out = {}
    for n in P(nodes_data) or []:
        rq = P(n.get("request_json_data")) if n.get("request_json_data") else None
        out[n["node_id"]] = {"req": rq, "resp": P(n.get("response_json_data")) if n.get("response_json_data") else None}
    return out


def main():
    env, run_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
    assert env in ("--dev", "--prod") and DIG.fullmatch(run_id)
    r = q(env, f"SELECT tenant_id, start_date, end_date, current_node_id, response_json_data, request_json_data, nodes_data FROM su_code_workflow_inst "
              f"WHERE workflow_id = {LOT_WF} AND id = {run_id}")[0]
    params = P(r["request_json_data"])["workflowparams"]
    nd = nodes(r["nodes_data"])
    rec = {k: (nd.get(k) or {}).get("resp") for k in ("code_node_LOTallocPrep", "get_cache_node_LOTallocOut", "code_node_yPlLXIZW", "add_node_xxQX3uMU")}
    code = {k: ((nd.get(k) or {}).get("req") or {}).get("code") for k in ("code_node_LOTallocPrep", "code_node_yPlLXIZW")}
    hi = (int(r["end_date"] or r["start_date"]) + 3000 - EPOCH) << 22
    ga = []
    for g in q(env, f"SELECT CAST(id AS CHAR) id, request_json_data, response_json_data, nodes_data FROM su_code_workflow_inst WHERE workflow_id = {GA_WF} AND id BETWEEN {run_id} AND {hi} ORDER BY id"):
        gn = nodes(g["nodes_data"])
        ga.append({"id": g["id"], "params": (P(g["request_json_data"]) or {}).get("workflowparams"), "resp": P(g["response_json_data"]),
                   "reads": {k: (gn.get(k) or {}).get("resp") for k in ("sql_node_ItemAlloc", "search_node_mb8Vv8fZ", "search_node_ARAmvXyd", "search_node_OwnReserved01")},
                   "code_ga": ((gn.get("code_node_hDa6pSw5") or {}).get("req") or {}).get("code"), "out_ga": (gn.get("code_node_hDa6pSw5") or {}).get("resp")})
    stored = None
    lot = ((rec.get("add_node_xxQX3uMU") or {}).get("data") or {})
    lot = (lot[0] if lot else {}) if isinstance(lot, list) else lot
    lot_id = str(lot.get("id") or (params.get("allData") or {}).get("id") or "")
    if DIG.fullmatch(lot_id):
        E = PSQL.ENTRY
        fill = lambda sql: sql.replace("'{{node:%s.data.tenantId}}'" % E, "'" + str(r["tenant_id"]) + "'").replace("{{node:%s.data.lotId}}" % E, lot_id)
        stored = {"lotId": lot_id, "hdr": q(env, fill(PSQL.READS["hdr"][0]).replace("CAST(h.lot_v2_job_id AS CHAR)", "NULL")), "lines": q(env, fill(PSQL.READS["lines"][0]))}
    json.dump({"tenant": r["tenant_id"], "run": run_id, "exit": r["current_node_id"], "response": P(r["response_json_data"]), "params": params, "recorded": rec, "code": code,
               "ga": ga, "stored": stored}, open(out, "w"))
    print(f"{out}: {len(ga)} GLOBAL_ALLOCATION runs; stored LOT {lot_id or '-'} ({len(stored['lines']) if stored else 0} lines)")


if __name__ == "__main__":
    main()
