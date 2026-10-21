"""who_writes.py <--dev|--prod> <table source substring> : enabled workflows with an update-node / add-node on that table, and the props they write."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grv2"))
from dbq import q  # noqa: E402
env, needle = sys.argv[1], sys.argv[2]
rows = q(env, "SELECT w.name, h.version_number v, h.script_json FROM su_code_workflow w JOIN su_code_workflow_history h ON h.data_id = w.id AND h.status = 'enabled' "
              "AND h.version_number = (SELECT MAX(h2.version_number) FROM su_code_workflow_history h2 WHERE h2.data_id = w.id AND h2.status = 'enabled') "
              "WHERE w.is_deleted = 0 AND h.script_json LIKE '%%%s%%'" % needle.replace("'", "''"))
for r in rows:
    doc = json.loads(r["script_json"])
    def walk(o):
        if isinstance(o, dict):
            if o.get("type") in ("update-node", "add-node") and needle in json.dumps((o.get("data") or {}).get("table_id") or {}):
                props = [p.get("prop") for p in ((o["data"].get("props") or {}).get("list") or [])]
                print("%-32s v%-4s %-11s %-28s %s" % (r["name"], r["v"], o["type"], o.get("id"), props))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc)
