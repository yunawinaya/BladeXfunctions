#!/usr/bin/env python3
"""Repair Item Assembly & BOM/BOMlistPageJSON.json.

The page shipped with no filters, a column bound to bom_status (a field nothing
writes), and a Delete row action pointing at a handler that does not exist.
"""
import json, os, subprocess, sys, copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, "Item Assembly & BOM")
PAGE = os.path.join(MOD, "BOMlistPageJSON.json")

doc = json.load(open(PAGE))
crud = doc["list"][0]
cp = crud["options"]["customProps"]
cols = cp["columns"]

def col(name):
    for c in cols:
        if c.get("name") == name:
            return c
    sys.exit("column %r not found" % name)

# ---------------------------------------------------------------- columns

# bom_status is never written by anything, so the column is always blank.
cp["columns"] = [c for c in cols if c.get("name") != "bom_status.dict_key"]
cols = cp["columns"]
print("  removed column bom_status.dict_key (field is never written)")

template = copy.deepcopy(col("parent_material_name"))

def plain_column(name, title, key, bson, **over):
    c = copy.deepcopy(template)
    c.update({"name": name, "title": title, "description": title,
              "key": key, "bsonType": bson, "maxLength": None,
              "defaultValue": None, "component": None, "foreignKey": None})
    c.update(over)
    return c

NEW_COLUMNS = [
    # key mirrors the form component's key, as the existing columns do.
    ("is_active", "Active", "svyua4rh", "int"),
    ("parent_mat_is_default", "Default", "63zexxpm", "int"),
    ("parent_mat_base_quantity", "Base Quantity", "wqzj4vko", "decimal"),
]
for name, title, key, bson in NEW_COLUMNS:
    if any(c.get("name") == name for c in cols):
        continue
    cols.append(plain_column(name, title, key, bson))
    print("  added column %s (%s)" % (name, title))

# ---------------------------------------------------------------- filters

def as_filter(base, title):
    f = copy.deepcopy(base)
    f["title"] = title
    f["matchMode"] = "looseMatch"
    f["hideLabel"] = 0
    f["aggregate"] = 0
    f["isRequired"] = False
    return f

if not cp.get("filters"):
    cp["filters"] = [
        as_filter(col("parent_material_code.material_code"), "Material Code"),
        as_filter(col("parent_material_name"), "Material Name"),
        as_filter(col("parent_mat_bom_version"), "BOM Version"),
    ]
    print("  added 3 filters: Material Code, Material Name, BOM Version")

# ---------------------------------------------------------------- delete handler

es = doc["config"]["eventScript"]
keys = {e["key"] for e in es}

wanted = None
for a in cp.get("rowActions") or []:
    if a.get("type") == "custom" and a.get("title") == "Delete":
        wanted = (a.get("events") or [{}])[0]
if not wanted:
    sys.exit("Delete row action not found")

body = open(os.path.join(MOD, "BOMlistDelete.js")).read()
if wanted["key"] in keys:
    for e in es:
        if e["key"] == wanted["key"]:
            e["func"] = body
else:
    es.append({"key": wanted["key"], "name": wanted.get("name") or "delete",
               "func": body, "type": "js"})
print("  wired Delete -> %s (%s)" % (wanted["key"], wanted.get("name")))

# ---------------------------------------------------------------- write

tmp = PAGE + ".tmp"
json.dump(doc, open(tmp, "w"), ensure_ascii=False, indent=2)
pretty = subprocess.run(["npx", "--no-install", "prettier", "--parser", "json", tmp],
                        capture_output=True, text=True, cwd=ROOT)
os.remove(tmp)
if pretty.returncode:
    sys.exit(pretty.stderr)

check = json.loads(pretty.stdout)
ccp = check["list"][0]["options"]["customProps"]
assert len(ccp["filters"]) == 3
assert not any(c.get("name") == "bom_status.dict_key" for c in ccp["columns"])
assert {e["key"]: e for e in check["config"]["eventScript"]}[wanted["key"]]["func"] == body
open(PAGE, "w").write(pretty.stdout)
print("patched OK: %d columns, %d filters" % (len(ccp["columns"]), len(ccp["filters"])))
