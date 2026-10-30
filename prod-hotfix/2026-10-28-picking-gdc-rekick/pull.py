"""Pull the ENABLED Picking form (transfer_order 1935556443668959233) and list page (1935635853539348481) from dev and prod,
and compare each with the repo file.   usage: python3 pull.py"""
import json, subprocess, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
ITEMS = [("form", "su_code_tables_history", "form_json", "1935556443668959233", R + "Picking/PickingFullJSON.json", "PickingFullJSON"),
         ("page", "su_code_pages_history", "page_json", "1935635853539348481", R + "Picking/PickingListPageFullJSON.json", "PickingListPageFullJSON")]


def q(env, sql):
    out = subprocess.run([R + ".dbtools/db", "--" + env, "--json", sql], capture_output=True, text=True, cwd=R)
    if out.returncode:
        sys.exit(out.stderr)
    return json.loads(out.stdout)


for kind, table, col, data_id, repo, name in ITEMS:
    mine = json.load(open(repo))
    for env in ("dev", "prod"):
        rows = q(env, "SELECT version_number v, %s j FROM %s WHERE data_id = %s AND status = 'enabled' ORDER BY version_number DESC LIMIT 1" % (col, table, data_id))
        v, j = rows[0]["v"], json.loads(rows[0]["j"])
        path = os.path.join(HERE, "%s.%s_v%s.base.json" % (name, env, v))
        json.dump(j, open(path, "w"), ensure_ascii=False, indent=1)
        print(kind, env, "v%s" % v, "IDENTICAL" if j == mine else "DIFFERS", "->", os.path.basename(path))
