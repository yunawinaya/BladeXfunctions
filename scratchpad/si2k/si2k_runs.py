"""si2k_runs.py <--dev|--prod> <workflow name> [days] [n]: the largest runs by node data, by snowflake-id window (no create_time scan,
blob lengths read in chunks) so it survives the prod statement timeout on big histories. Line count = largest row array in the request."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grv2"))
from dbq import q  # noqa: E402
env, name = sys.argv[1], sys.argv[2]
days = int(sys.argv[3]) if len(sys.argv) > 3 else 90
n = int(sys.argv[4]) if len(sys.argv) > 4 else 12
w = q(env, "SELECT CAST(id AS CHAR) id FROM su_code_workflow WHERE is_deleted = 0 AND name = '%s'" % name)
if not w:
    sys.exit("no workflow " + name)
wid = w[0]["id"]
lo = (int(time.time() * 1000) - days * 86400000 - 1288834974657) << 22
ids = q(env, f"SELECT CAST(id AS CHAR) id, create_time, status, run_time, tenant_id FROM su_code_workflow_inst WHERE workflow_id = {wid} AND id > {lo} ORDER BY id DESC")
meta = {r["id"]: r for r in ids}
sizes = []
keys = list(meta)
for i in range(0, len(keys), 150):
    chunk = ",".join(keys[i:i + 150])
    for r in q(env, f"SELECT CAST(id AS CHAR) id, LENGTH(nodes_data) nd, LENGTH(request_json_data) rq FROM su_code_workflow_inst WHERE id IN ({chunk})"):
        sizes.append((int(r["nd"] or 0), int(r["rq"] or 0), r["id"]))
sizes.sort(reverse=True)
def lines_of(o):
    m = 0
    if isinstance(o, dict):
        for v in o.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                m = max(m, len(v) + sum(len(x.get("children") or []) for x in v if isinstance(x, dict)))
            m = max(m, lines_of(v))
    elif isinstance(o, list):
        for v in o[:3]:
            m = max(m, lines_of(v))
    return m
rt = sorted((int(r["run_time"] or 0) for r in ids), reverse=True)
print(name, env, "| runs in %d days: %d | max node data %.2f MB | slowest %s s" % (days, len(ids), (sizes[0][0] if sizes else 0) / 1e6, [x // 1000 for x in rt[:5]]))
for nd, rq, iid in sizes[:n]:
    r = meta[iid]
    req = q(env, f"SELECT request_json_data FROM su_code_workflow_inst WHERE id = {iid}")[0]["request_json_data"]
    try:
        lines = lines_of(json.loads(req))
    except Exception:
        lines = None
    print("  %s %s %-9s %-8s %6.1f s | node data %6.2f MB | request %6.0f KB | lines %s%s" % (iid, str(r["create_time"])[:16], r["tenant_id"], r["status"], int(r["run_time"] or 0) / 1000,
          nd / 1e6, rq / 1e3, lines, (" | %.1f KB/line" % (nd / 1e3 / lines)) if lines else ""))
