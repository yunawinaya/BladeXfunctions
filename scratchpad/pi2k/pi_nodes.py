"""pi_nodes.py <--dev|--prod> <instance id>: node data per node (input / output bytes) and the largest arrays it carries (read-only)"""
import json, sys
sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "..", "grv2"))
from dbq import q
env, iid = sys.argv[1], sys.argv[2]
r = q(env, f"SELECT nodes_data, request_json_data, run_time FROM su_code_workflow_inst WHERE id = {iid}")[0]
nd = json.loads(r["nodes_data"])
nodes = nd if isinstance(nd, list) else nd.get("nodes") or list(nd.values())
def sz(o):
    return len(json.dumps(o, ensure_ascii=False)) if o is not None else 0
def arrays(o, path="", out=None):
    out = [] if out is None else out
    if isinstance(o, dict):
        for k, v in o.items():
            arrays(v, path + "." + k, out)
    elif isinstance(o, list):
        if o and isinstance(o[0], dict):
            out.append((sz(o), len(o), path))
        for i, v in enumerate(o[:2]):
            arrays(v, path + "[%d]" % i, out)
    return out
tot = 0
print("run_time %.1f s" % (int(r["run_time"] or 0) / 1000))
for n in nodes:
    if not isinstance(n, dict):
        continue
    nid = n.get("nodeId") or n.get("id") or n.get("node_id")
    i, o = n.get("request_json_data"), n.get("response_json_data")
    i = json.loads(i) if isinstance(i, str) and i[:1] in "[{" else i
    o = json.loads(o) if isinstance(o, str) and o[:1] in "[{" else o
    si, so = sz(i), sz(o)
    tot += si + so
    big = sorted(arrays({"in": i, "out": o}), reverse=True)[:2]
    t0, t1 = n.get("start_time_millis") or n.get("startTime"), n.get("end_time_millis") or n.get("endTime")
    dur = (int(t1) - int(t0)) / 1000 if t0 and t1 else None
    print("%-30s in %9d out %9d  %s  %s" % (nid, si, so, ("%.2fs" % dur) if dur is not None else "", " | ".join("%s n=%d %d B" % (p, c, b) for b, c, p in big)))
print("sum %d B, stored %d B" % (tot, len(r["nodes_data"])))
