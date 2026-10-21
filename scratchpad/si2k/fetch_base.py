"""fetch_base.py <--dev|--prod> NAME ...: the enabled (live) JSON of each workflow -> base/<env>/<NAME>.v<N>.json (read-only)."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "grv2"))
from dbq import q  # noqa: E402
env, names = sys.argv[1], sys.argv[2:]
out = os.path.join(HERE, "base", env.strip("-"))
os.makedirs(out, exist_ok=True)
for name in names:
    w = q(env, "SELECT CAST(id AS CHAR) id FROM su_code_workflow WHERE is_deleted = 0 AND name = '%s'" % name.replace("'", "''"))
    if not w:
        print("no workflow", name); continue
    h = q(env, "SELECT version_number v, script_json FROM su_code_workflow_history WHERE data_id = %s AND status = 'enabled' ORDER BY version_number DESC LIMIT 1" % w[0]["id"])
    if not h:
        print("no enabled version", name); continue
    p = os.path.join(out, "%s.v%s.json" % (name, h[0]["v"]))
    with open(p, "w", encoding="utf-8") as f:
        json.dump(json.loads(h[0]["script_json"]), f, ensure_ascii=False, indent=1)
    print(name, w[0]["id"], "v%s" % h[0]["v"], "->", os.path.relpath(p, HERE))
