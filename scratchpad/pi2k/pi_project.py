"""pi_project.py <--dev|--prod> <instance id> <lines in the run> [target lines]: stored node data of a recorded run, re-serialised
with every line array (list of row dicts with >= 15 keys and as many rows as the run had lines) grown to the target by repeating
its rows. Read-only; prints the reproduction of the stored size first so the projection can be trusted."""
import json, sys
sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "..", "grv2"))
from dbq import q
env, iid, L = sys.argv[1], sys.argv[2], int(sys.argv[3])
T = int(sys.argv[4]) if len(sys.argv) > 4 else 2000
r = q(env, f"SELECT nodes_data FROM su_code_workflow_inst WHERE id = {iid}")[0]
stored = len(r["nodes_data"])
nodes = json.loads(r["nodes_data"])
def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))
def grow(o, counter):
    if isinstance(o, dict):
        return {k: grow(v, counter) for k, v in o.items()}
    if isinstance(o, list):
        if len(o) == L and o and all(isinstance(x, dict) and len(x) >= 15 for x in o):
            counter[0] += 1
            return [grow(o[i % L], counter) for i in range(T)]
        return [grow(v, counter) for v in o]
    return o
tot_now = tot_new = 0
rows = []
for n in nodes:
    now = new = 0
    hits = [0]
    for key in ("request_json_data", "response_json_data"):
        s = n.get(key)
        if not isinstance(s, str):
            continue
        try:
            obj = json.loads(s)
        except ValueError:
            now += len(dumps(s)); new += len(dumps(s)); continue
        now += len(dumps(dumps(obj)))
        new += len(dumps(dumps(grow(obj, hits))))
    rows.append((new, now, hits[0], n.get("node_id")))
    tot_now += now; tot_new += new
print("run %s: stored %.0f KB, reproduced %.0f KB (%.2fx)" % (iid, stored / 1e3, tot_now / 1e3, stored / max(1, tot_now)))
for new, now, h, nid in sorted(rows, reverse=True)[:14]:
    print("  %-28s %8.2f MB at %d lines (%2d line arrays; %6.1f KB now)" % (nid, new / 1e6, T, h, now / 1e3))
print("TOTAL at %d lines: %.1f MB (x%.2f calibration = %.1f MB)" % (T, tot_new / 1e6, stored / max(1, tot_now), tot_new / 1e6 * stored / max(1, tot_now)))
