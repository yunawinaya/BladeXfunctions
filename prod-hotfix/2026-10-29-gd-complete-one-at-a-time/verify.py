"""After the pastes: is each enabled prod Picking form / list the paste, and how fast do Picking-started GD completions go since
(per batch of 4+ from one user in one minute: completions, seconds until the last one ended, seconds per completion)?
usage: python3 verify.py"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.abspath(os.path.join(HERE, "..", "..", ".dbtools", "db"))
ITEMS = [("Picking form", "su_code_tables_history", "form_json", "1935556443668959233", "PickingFullJSON"),
         ("Picking list", "su_code_pages_history", "page_json", "1935635853539348481", "PickingListPageFullJSON")]


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.find("["):])


since = None
for label, table, col, did, name in ITEMS:
    r = q(f"SELECT CAST(id AS CHAR) id, version_number v, create_time t, {col} j FROM {table} WHERE data_id = {did} AND status = 'enabled' ORDER BY id DESC LIMIT 1")[0]
    live = json.loads(r["j"])
    paste = json.load(open(os.path.join(HERE, name + ".prod_paste.json")))
    base = [f for f in os.listdir(HERE) if f.startswith(name + ".prod_v") and f.endswith(".base.json")][0]
    state = "= the paste" if live == paste else "= %s (not pasted)" % base.split(".")[1] if live == json.load(open(os.path.join(HERE, base))) else "DIFFERS from both: check"
    print(f"{label}: enabled v{r['v']} ({str(r['t'])[:19]}) {state}")
    if live == paste:
        since = max(since or 0, int(r["id"]))
if since:
    rows = q("SELECT tenant_id t, DATE_FORMAT(MIN(create_time), '%m-%d %H:%i') batch, COUNT(*) n, "
             "MAX(TIMESTAMPDIFF(SECOND, create_time, CONVERT_TZ(finished_at, '+00:00', '+08:00'))) last_s, SUM(job_status <> 'COMPLETED') not_done "
             f"FROM gd_async_job WHERE id > {since} AND command = 'COMPLETE_GD' AND JSON_UNQUOTE(JSON_EXTRACT(request_payload, '$.source')) = 'PICKING' "
             "GROUP BY tenant_id, create_user, DATE_FORMAT(create_time, '%m-%d %H:%i') HAVING n >= 4 ORDER BY MIN(id)")
    for x in rows:
        per = float(x["last_s"]) / int(x["n"]) if x["last_s"] is not None else 0
        print(f"  {x['t']} {x['batch']}: {x['n']} completions, last after {x['last_s']} s, {per:.1f} s each" + (f", {x['not_done']} not completed" if int(x["not_done"]) else ""))
    if not rows:
        print("  no Picking-started batch of 4+ completions since the pastes yet")
