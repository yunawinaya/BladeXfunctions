"""After the prod paste: the ENABLED prod Picking form and list page must equal the paste files.   usage: python3 verify.py"""
import json, subprocess, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
ITEMS = [("Picking form", "su_code_tables_history", "form_json", "1935556443668959233", "PickingFullJSON.prod_paste.json"),
         ("Picking list page", "su_code_pages_history", "page_json", "1935635853539348481", "PickingListPageFullJSON.prod_paste.json")]

for name, table, col, data_id, paste in ITEMS:
    out = subprocess.run([R + ".dbtools/db", "--prod", "--json",
                          "SELECT version_number v, create_time t, %s j FROM %s WHERE data_id = %s AND status = 'enabled' ORDER BY version_number DESC LIMIT 1"
                          % (col, table, data_id)], capture_output=True, text=True, cwd=R)
    if out.returncode:
        sys.exit(out.stderr)
    row = json.loads(out.stdout)[0]
    same = json.loads(row["j"]) == json.load(open(os.path.join(HERE, paste)))
    print("%-18s %s  prod enabled v%s (%s)  %s" % (name, data_id, row["v"], row["t"], "IDENTICAL to " + paste if same else "DIFFERS from " + paste))
