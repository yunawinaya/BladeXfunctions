"""node_io.py <--dev|--prod> <instance id> <node id> [in|out] : print one node's parsed input or output JSON (read-only)."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grv2"))
from dbq import q  # noqa: E402
env, iid, nid = sys.argv[1], sys.argv[2], sys.argv[3]
which = sys.argv[4] if len(sys.argv) > 4 else "out"
r = q(env, f"SELECT nodes_data FROM su_code_workflow_inst WHERE id = {iid}")[0]
for n in json.loads(r["nodes_data"]):
    if n.get("node_id") == nid:
        s = n.get("request_json_data" if which == "in" else "response_json_data")
        try:
            print(json.dumps(json.loads(s), ensure_ascii=False))
        except Exception:
            print(s)
        break
