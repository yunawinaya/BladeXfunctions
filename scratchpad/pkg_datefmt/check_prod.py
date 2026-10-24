# Exits 0 once prod PACKING_ASYNC_SUBMIT equals the fixed file (ignoring an empty "blocks" key the designer adds).
import json, subprocess, sys
r = subprocess.run([".dbtools/db", "--prod", "--json", "SELECT h.version_number v, h.create_time t, h.script_json s FROM su_code_workflow_history h WHERE h.data_id = 2109924558618333185 AND h.status = 'enabled' ORDER BY h.version_number DESC LIMIT 1"], capture_output=True, text=True)
row = json.loads(r.stdout)[0]
live = json.loads(row["s"]) if isinstance(row["s"], str) else row["s"]
want = json.load(open("prod-hotfix/2026-10-24-packing-submit-date-format/PACKING_ASYNC_SUBMIT.prod_paste.json"))
def norm(o):
    if isinstance(o, dict): return {k: norm(v) for k, v in o.items() if not (k == "blocks" and v == [])}
    if isinstance(o, list): return [norm(v) for v in o]
    return o
ok = norm(live) == norm(want)
print(f"prod v{row['v']} {row['t']} fixed={ok} %%_left={'%%' in row['s']}")
sys.exit(0 if ok else 1)
