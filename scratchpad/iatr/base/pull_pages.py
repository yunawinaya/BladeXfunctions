"""Pull the live (enabled) list pages this feature patches into this folder, exactly as stored, and compare dev with prod
(read-only SELECTs through .dbtools/db).

usage: python3 scratchpad/iatr/base/pull_pages.py           (writes <name>_v<N>.json, checks MD5(page_json))
       python3 scratchpad/iatr/base/pull_pages.py --check   (writes nothing; exit 1 when the live page differs from the file)
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "smv2", "lib"))
from dbq import q  # noqa: E402

PAGES = {"lot_list": 2013863255693197313, "ia_list": 2098312073316716546}
CHECK = "--check" in sys.argv


def live(env, page_id):
    rows = q(env, "SELECT version_number, MD5(page_json) AS md5, page_json FROM su_code_pages_history "
                  "WHERE data_id = %d AND status = 'enabled' ORDER BY version_number DESC, id DESC LIMIT 1" % page_id)
    if not rows:
        raise SystemExit("no enabled page %d on %s" % (page_id, env))
    return rows[0]


bad = 0
for name, page_id in PAGES.items():
    d = live("--dev", page_id)
    p = live("--prod", page_id)
    text = d["page_json"]
    assert hashlib.md5(text.encode("utf-8")).hexdigest() == d["md5"], name + ": the text read back is not what the database stores"
    same = json.dumps(json.loads(text), sort_keys=True) == json.dumps(json.loads(p["page_json"]), sort_keys=True)
    path = os.path.join(HERE, "%s_v%s.json" % (name, d["version_number"]))
    if CHECK:
        ok = os.path.exists(path) and open(path, encoding="utf-8").read() == text
        bad += 0 if ok else 1
        print("%-9s dev v%s %s | prod v%s %s" % (name, d["version_number"], "= file" if ok else "DIFFERS from the file", p["version_number"],
                                                "same content" if same else "DIFFERENT content"))
        continue
    open(path, "w", encoding="utf-8").write(text)
    print("%-9s dev v%s -> %s (md5 %s) | prod v%s %s" % (name, d["version_number"], os.path.basename(path), d["md5"], p["version_number"],
                                                         "same content" if same else "DIFFERENT content"))
sys.exit(1 if bad else 0)
