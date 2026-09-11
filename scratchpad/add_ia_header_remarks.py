#!/usr/bin/env python3
"""Add header remarks_2 / remarks_3 to ItemAssemblyFullJSON.json.

Both are clones of the existing `remarks` textarea. This writes the form_json
half only — the physical columns still have to be created in the field editor,
which is what runs the DDL.
"""
import json, os, subprocess, sys, copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORM = os.path.join(ROOT, "Item Assembly & BOM", "ItemAssemblyFullJSON.json")

NEW = [("remarks_2", "Remarks 2", "iarmks02"),
       ("remarks_3", "Remarks 3", "iarmks03")]

doc = json.load(open(FORM))

used = set()
def collect(n):
    if isinstance(n, dict):
        if n.get("key"): used.add(n["key"])
        for v in n.values(): collect(v)
    elif isinstance(n, list):
        for v in n: collect(v)
collect(doc)
for _, _, key in NEW:
    if key in used:
        sys.exit("key %r already in use" % key)
    if len(key) != 8:
        sys.exit("key %r must be 8 chars" % key)

# Find the container holding the header `remarks` field so the clones sit beside it.
holder = None
def locate(node):
    global holder
    if isinstance(node, dict):
        for k in ("list", "columns", "children", "tableColumns"):
            v = node.get(k)
            if isinstance(v, list):
                if any(isinstance(c, dict) and c.get("model") == "remarks" for c in v):
                    holder = v
                    return True
                for c in v:
                    if locate(c): return True
        for k, v in (node.get("options") or {}).items():
            if k in ("list", "columns") and isinstance(v, list):
                if any(isinstance(c, dict) and c.get("model") == "remarks" for c in v):
                    holder = v
                    return True
                for c in v:
                    if locate(c): return True
    elif isinstance(node, list):
        for c in node:
            if locate(c): return True
    return False
locate(doc["list"])
if holder is None:
    sys.exit("could not locate the header `remarks` container")

src = next(c for c in holder if c.get("model") == "remarks")
idx = holder.index(src)

for offset, (model, label, key) in enumerate(NEW, start=1):
    if any(c.get("model") == model for c in holder):
        print("  %s already present" % model); continue
    clone = copy.deepcopy(src)
    clone["name"] = label
    clone["key"] = key
    clone["model"] = model
    # remoteFunc / remoteOption embed the component key.
    clone["options"]["remoteFunc"] = "func_%s" % key
    clone["options"]["remoteOption"] = "option_%s" % key
    holder.insert(idx + offset, clone)
    print("  added %-10s key=%s label=%r" % (model, key, label))

tmp = FORM + ".tmp"
json.dump(doc, open(tmp, "w"), ensure_ascii=False, indent=2)
p = subprocess.run(["npx", "--no-install", "prettier", "--parser", "json", tmp],
                   capture_output=True, text=True, cwd=ROOT)
os.remove(tmp)
if p.returncode: sys.exit(p.stderr)

chk = json.loads(p.stdout)
found = []
def scan(n, parent=None):
    if isinstance(n, dict):
        if n.get("model") in ("remarks", "remarks_2", "remarks_3"):
            found.append((n["model"], n["key"]))
        for k, v in n.items():
            if k != "parent": scan(v, n)
    elif isinstance(n, list):
        for v in n: scan(v, parent)
scan(chk["list"])
assert {m for m, _ in found} == {"remarks", "remarks_2", "remarks_3"}, found
open(FORM, "w").write(p.stdout)
print("patched OK ->", found)
