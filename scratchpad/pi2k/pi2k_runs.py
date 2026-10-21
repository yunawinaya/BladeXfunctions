"""pi2k_runs.py <--dev|--prod> <workflow name> [days] [n]: the largest runs by node data, with line counts from the request (read-only)"""
import json, sys
sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "..", "grv2"))
from dbq import q
env, name = sys.argv[1], sys.argv[2]
days = int(sys.argv[3]) if len(sys.argv) > 3 else 60
n = int(sys.argv[4]) if len(sys.argv) > 4 else 12
w = q(env, "SELECT CAST(id AS CHAR) id FROM su_code_workflow WHERE is_deleted = 0 AND name = '%s'" % name)
if not w:
    sys.exit("no workflow " + name)
wid = w[0]["id"]
rows = q(env, f"""SELECT CAST(id AS CHAR) id, create_time, status, run_time, tenant_id, LENGTH(nodes_data) nd, LENGTH(request_json_data) rq
  FROM su_code_workflow_inst WHERE workflow_id = {wid} AND create_time > NOW() - INTERVAL {days} DAY ORDER BY LENGTH(nodes_data) DESC LIMIT {n}""")
def lines_of(o, best=[0]):
    m = 0
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                cnt = len(v) + sum(len(x.get("children") or []) for x in v if isinstance(x, dict))
                m = max(m, cnt)
            m = max(m, lines_of(v))
    elif isinstance(o, list):
        for v in o[:3]:
            m = max(m, lines_of(v))
    return m
total = q(env, f"SELECT COUNT(*) c, MAX(LENGTH(nodes_data)) mx FROM su_code_workflow_inst WHERE workflow_id = {wid} AND create_time > NOW() - INTERVAL {days} DAY")[0]
print(name, env, "| runs in %d days:" % days, total["c"], "| max node data %.1f MB" % ((total["mx"] or 0) / 1e6))
for r in rows:
    req = q(env, f"SELECT request_json_data FROM su_code_workflow_inst WHERE id = {r['id']}")[0]["request_json_data"]
    try:
        lines = lines_of(json.loads(req).get("request_json"))
    except Exception:
        lines = None
    nd = int(r["nd"] or 0)
    print("  %s %s %-8s %6.1f s | node data %6.2f MB | request %5.0f KB | lines %s%s" % (r["id"], str(r["create_time"])[:16], r["status"], int(r["run_time"] or 0) / 1000,
          nd / 1e6, int(r["rq"] or 0) / 1e3, lines, (" | %.1f KB node data per line" % (nd / 1e3 / lines)) if lines else ""))
