"""Fetch PO_SAVE runs (dev/prod, read-only, filtered by workflow_id / id only) into the session scratchpad and parse
nodes_data into {node_id: {"in": variableMap-or-request, "out": response, "code": script, "bytes_in", "bytes_out"}}."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402

WF_ID = 2069257894280118274
CACHE = os.environ.get("P1A_CACHE", "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/"
                       "3184bace-c1a2-43fd-9910-40a12d531785/scratchpad/phase1a/runs")


def _path(env, rid):
    return os.path.join(CACHE, "%s_%s.json" % (env.strip("-"), rid))


def fetch(env, rid):
    p = _path(env, rid)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    rows = q(env, "SELECT id, status, tenant_id, create_time, run_time, current_node_id, error_msg, request_json_data, "
                  "nodes_data FROM su_code_workflow_inst WHERE id = %d AND workflow_id = %d" % (int(rid), WF_ID))
    assert rows, "no run %s" % rid
    r = rows[0]
    os.makedirs(CACHE, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False)
    return r


def parse_json(x):
    if isinstance(x, str):
        try:
            return json.loads(x, strict=False)
        except ValueError:
            return x
    return x


def nodes(run):
    out = {}
    nd = parse_json(run.get("nodes_data")) or []
    for x in nd:
        req = parse_json(x.get("request_json_data"))
        res = parse_json(x.get("response_json_data"))
        ent = {"type": x.get("node_type"), "req": req, "out": res,
               "bytes_in": len(x.get("request_json_data") or ""), "bytes_out": len(x.get("response_json_data") or ""),
               "start": x.get("start_time_millis"), "end": x.get("end_time_millis"), "status": x.get("status")}
        if isinstance(req, dict):
            ent["vars"] = req.get("variableMap")
            ent["code"] = req.get("code")
        out[x.get("node_id")] = ent
    return out


def all_data(run):
    rq = parse_json(run.get("request_json_data")) or {}
    wp = parse_json(rq.get("workflowparams")) or parse_json(rq.get("request_json")) or {}
    a = parse_json(wp.get("allData"))
    return a


def list_runs(env, limit=300):
    return q(env, "SELECT id, status, tenant_id, create_time, run_time, current_node_id, LENGTH(nodes_data) nd, "
                  "LENGTH(request_json_data) rq FROM su_code_workflow_inst WHERE workflow_id = %d ORDER BY id DESC LIMIT %d"
             % (WF_ID, limit))
