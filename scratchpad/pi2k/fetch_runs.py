"""fetch_runs.py <cache dir> [days]: every recorded PI_SAVE / GR_Convert_PI / PO_CONVERT_PI run (dev + prod, read-only) ->
<cache>/runs/<env>_<workflow>_<id>.json  {id, env, workflow, status, create_time, request_json_data, nodes_data}.
Customer data: keep the cache outside the repo."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grv2"))
from dbq import q  # noqa: E402

cache = sys.argv[1]
days = int(sys.argv[2]) if len(sys.argv) > 2 else 90
os.makedirs(os.path.join(cache, "runs"), exist_ok=True)
for env in ("--dev", "--prod"):
    for name in ("PI_SAVE", "GR_Convert_PI", "PO_CONVERT_PI"):
        w = q(env, "SELECT CAST(id AS CHAR) id FROM su_code_workflow WHERE is_deleted = 0 AND name = '%s'" % name)
        if not w:
            continue
        ids = q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id = {w[0]['id']} "
                     f"AND create_time > NOW() - INTERVAL {days} DAY ORDER BY id DESC")
        got = 0
        for r in ids:
            path = os.path.join(cache, "runs", "%s_%s_%s.json" % (env.strip("-"), name, r["id"]))
            if os.path.exists(path):
                got += 1
                continue
            row = q(env, f"SELECT CAST(id AS CHAR) id, status, create_time, request_json_data, nodes_data FROM su_code_workflow_inst WHERE id = {r['id']}")[0]
            row.update({"env": env.strip("-"), "workflow": name})
            with open(path, "w") as f:
                json.dump(row, f, default=str)
            got += 1
        print(env, name, got, "runs")
