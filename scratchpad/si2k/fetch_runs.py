"""fetch_runs.py <cache dir> [days] [NAME ...]: every recorded SI_SAVE / GD_Convert_SI / SO_Convert_SI run (dev + prod, read-only), 25 per
query -> <cache>/runs/<env>_<workflow>_<id>.json {id, env, workflow, status, create_time, request_json_data, nodes_data}. Snowflake-id
window, no create_time scan. Customer data: keep the cache outside the repo."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grv2"))
from dbq import q  # noqa: E402

cache = sys.argv[1]
days = int(sys.argv[2]) if len(sys.argv) > 2 else 90
names = sys.argv[3:] or ["SI_SAVE", "GD_Convert_SI", "SO_Convert_SI"]
os.makedirs(os.path.join(cache, "runs"), exist_ok=True)
lo = (int(time.time() * 1000) - days * 86400000 - 1288834974657) << 22
for env in ("--dev", "--prod"):
    for name in names:
        w = q(env, "SELECT CAST(id AS CHAR) id FROM su_code_workflow WHERE is_deleted = 0 AND name = '%s'" % name)
        if not w:
            continue
        ids = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id = {w[0]['id']} AND id > {lo} ORDER BY id DESC")]
        todo = [i for i in ids if not os.path.exists(os.path.join(cache, "runs", "%s_%s_%s.json" % (env.strip("-"), name, i)))]
        for k in range(0, len(todo), 25):
            chunk = ",".join(todo[k:k + 25])
            for row in q(env, f"SELECT CAST(id AS CHAR) id, status, create_time, tenant_id, request_json_data, nodes_data FROM su_code_workflow_inst WHERE id IN ({chunk})"):
                row.update({"env": env.strip("-"), "workflow": name})
                with open(os.path.join(cache, "runs", "%s_%s_%s.json" % (env.strip("-"), name, row["id"])), "w") as f:
                    json.dump(row, f, default=str)
        print(env, name, len(ids), "runs,", len(todo), "fetched now", flush=True)
