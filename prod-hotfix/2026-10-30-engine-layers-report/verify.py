"""After the paste (read-only): is prod's enabled INVENTORY_BULK_APPLY the paste; its runs since (any 'is not loaded' = stuck, see
../2026-10-28-2133-v2-workers-not-loaded/); operations that asked for and answered layers since.
usage: python3 verify.py"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.abspath(os.path.join(HERE, "..", "..", ".dbtools", "db"))
WF = "2109916822821744641"


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.find("["):])


LABELLED = ("condition-or-node-item", "condition-all-node-item", "tryBlock", "catchBlock")


def norm(o):
    """a designer save adds empty defaults and drops the branch labels; compare without them"""
    if isinstance(o, dict):
        return {k: norm(v) for k, v in o.items()
                if not (v in ([], "", {}, None) or (k == "expire_time" and v == 3600) or (k == "key" and o.get("type") in LABELLED))}
    if isinstance(o, list):
        return [norm(x) for x in o]
    return o


canon = lambda o: json.dumps(norm(o), sort_keys=True, ensure_ascii=False)
r = q(f"SELECT CAST(id AS CHAR) id, version_number v, create_time t, script_json s FROM su_code_workflow_history WHERE data_id = {WF} AND status = 'enabled' ORDER BY version_number DESC LIMIT 1")[0]
live = canon(json.loads(r["s"]))
paste = canon(json.load(open(os.path.join(HERE, "INVENTORY_BULK_APPLY.prod_paste.json"), encoding="utf-8")))
base = canon(json.load(open(os.path.join(HERE, "INVENTORY_BULK_APPLY.prod_v13.base.json"), encoding="utf-8")))
state = "= the paste" if live == paste else "= v13 (not pasted)" if live == base else "DIFFERS from both: check"
print(f"INVENTORY_BULK_APPLY: enabled v{r['v']} ({str(r['t'])[:19]}) {state}")
if live != paste:
    raise SystemExit(0)
since = r["id"]
runs = q(f"SELECT status, COUNT(*) n, SUM(IFNULL(error_msg, '') LIKE '%is not loaded%') not_loaded, DATE_FORMAT(MAX(create_time), '%m-%d %H:%i:%s') last "
         f"FROM su_code_workflow_inst WHERE workflow_id = {WF} AND id > {since} GROUP BY status")
print("  engine runs since:", runs or "none yet")
if any(int(x["not_loaded"] or 0) for x in runs):
    print("  STUCK: 'script for node is not loaded' - paste the base back (or rename the stuck node), see ../2026-10-28-2133-v2-workers-not-loaded/")
review = q(f"SELECT tenant_id, COUNT(*) n FROM gd_publish_step WHERE id > {since} AND step_name = 'IBA|REVIEW' GROUP BY tenant_id")
print("  engine operations sent to review since:", review or "none")
layers = q(f"SELECT tenant_id, COUNT(*) n FROM gd_publish_step WHERE id > {since} AND step_name = 'IBA|DONE' AND result_ref LIKE '%fifo_layers%' GROUP BY tenant_id")
print("  operations that answered fifo_layers since:", layers or "none yet (no caller asks for them until consignment ships)")
