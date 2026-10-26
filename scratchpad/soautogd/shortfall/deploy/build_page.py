"""build_page.py: the SO list page (su_code_pages 1901872125787099137) with func_handleConvertGD replaced by the repo handler.

The page is taken from the live enabled page_json (dev or prod, read-only); the handler entry is the one eventScript func
holding "handleConvertGDCreated" (exactly one). Nothing is replaced unless that func is exactly the expected old text
(the repo handler before this change), so a page someone changed since is refused instead of overwritten.

usage: python3 build_page.py --env dev|prod --old OLD_HANDLER.js --new NEW_HANDLER.js --base-out BASE.json [--out PAGE.json]
       [--old-out OLD_FUNC.js]
"""
import argparse
import json
import subprocess

R = "/Users/yunawinaya/Developer/BladeXfunctions"
PAGE_ID = "1901872125787099137"

ap = argparse.ArgumentParser()
ap.add_argument("--env", choices=["dev", "prod"], required=True)
ap.add_argument("--old", required=True)
ap.add_argument("--new", required=True)
ap.add_argument("--base-out", required=True)
ap.add_argument("--out")
ap.add_argument("--old-out")
a = ap.parse_args()

q = ("SELECT id, version_number, page_json FROM su_code_pages_history WHERE data_id=%s AND status='enabled' "
     "ORDER BY version_number DESC LIMIT 1" % PAGE_ID)
p = subprocess.run([R + "/.dbtools/db", "--" + a.env, "--json", q], capture_output=True, text=True, check=True)
rows = json.loads("\n".join(ln for ln in p.stdout.splitlines() if not ln.startswith("[DEV]") and not ln.startswith("[PROD]")))
assert len(rows) == 1, rows
page = json.loads(rows[0]["page_json"])
print("%s SO list: enabled v%s (history id %s)" % (a.env, rows[0]["version_number"], rows[0]["id"]))
json.dump(page, open(a.base_out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

hits = [e for e in page["config"]["eventScript"] if "handleConvertGDCreated" in (e.get("func") or "")]
assert len(hits) == 1, "%d eventScript funcs hold handleConvertGDCreated" % len(hits)
old = open(a.old, encoding="utf-8").read()
new = open(a.new, encoding="utf-8").read()
assert hits[0]["func"].strip() == old.strip(), "the live func_handleConvertGD is not %s: rebuild on what is live" % a.old
print("live handler == %s (%s: %s)" % (a.old, hits[0].get("name") or hits[0].get("key"), len(hits[0]["func"])))
if a.old_out:
    open(a.old_out, "w", encoding="utf-8").write(hits[0]["func"])
if a.out:
    hits[0]["func"] = new
    json.dump(page, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote %s (handler %d -> %d chars)" % (a.out, len(old), len(new)))
