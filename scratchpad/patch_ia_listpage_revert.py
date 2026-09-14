#!/usr/bin/env python3
"""Add the "Revert Completed" toolbar button to ItemAssemblyListPageJSON.json.

Idempotent: re-running replaces the handler body instead of adding a second button.
"""
import json, os, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
MOD = os.path.join(ROOT, "Item Assembly & BOM")
PAGE = os.path.join(MOD, "ItemAssemblyListPageJSON.json")
TITLE = "Revert Completed"
KEY = "iarvcmp1"
NAME = "revertCompleted"

doc = json.load(open(PAGE, encoding="utf-8"))
cp = doc["list"][0]["options"]["customProps"]
if cp.get("model") and cp["model"] != "custom_7rq6zmn4":
    sys.exit("unexpected grid model " + cp["model"])
toolbar = cp["toolbar"]

# Same shape as the Revert Completed button on the Picking list page.
button = {"title": TITLE, "permission": "", "icon": "arrow-left", "type": "custom",
          "showBottomBar": 1, "dialogPosition": "center", "dialogWidth": "",
          "close_on_click_modal": 1, "events": [{"key": KEY, "name": NAME}], "collapse": 1}
existing = [i for i, b in enumerate(toolbar) if b.get("title") == TITLE]
if existing:
    toolbar[existing[0]] = button
else:
    add_at = next((i for i, b in enumerate(toolbar) if b.get("type") == "addBtn"), len(toolbar) - 1)
    toolbar.insert(add_at + 1, button)

body = open(os.path.join(MOD, "ItemAssemblyListRevertCompleted.js"), encoding="utf-8").read()
es = doc["config"]["eventScript"]
hit = [e for e in es if e["key"] == KEY]
if hit:
    hit[0]["func"] = body
else:
    es.append({"key": KEY, "name": NAME, "func": body, "type": "js"})

tmp = PAGE + ".tmp"
json.dump(doc, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
pretty = subprocess.run(["npx", "--no-install", "prettier", "--parser", "json", tmp],
                        capture_output=True, text=True, cwd=ROOT)
os.remove(tmp)
if pretty.returncode:
    sys.exit(pretty.stderr)

check = json.loads(pretty.stdout)
ctb = check["list"][0]["options"]["customProps"]["toolbar"]
assert sum(1 for b in ctb if b.get("title") == TITLE) == 1
assert {e["key"]: e for e in check["config"]["eventScript"]}[KEY]["func"] == body
open(PAGE, "w", encoding="utf-8").write(pretty.stdout)
print("patched OK: toolbar has %d buttons" % len(ctb))
