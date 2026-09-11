#!/usr/bin/env python3
"""Fill in Item Assembly & BOM/ItemAssemblyListPageJSON.json.

It was created from the BOM list page and left unconfigured: no columns, no
filters, a Delete action pointing at the BOM page's handler key, and an
organization filter comparing against a literal null (so the grid returns
nothing). Column and filter shapes are cloned from pages already in the repo
rather than hand-authored.
"""
import json, os, subprocess, sys, copy, itertools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, "Item Assembly & BOM")
PAGE = os.path.join(MOD, "ItemAssemblyListPageJSON.json")
BOMPAGE = os.path.join(MOD, "BOMlistPageJSON.json")
GDPAGE = os.path.join(ROOT, "Bulk Actions", "Sales & Distribution",
                      "Goods Delivery", "GDlistPageJSON.json")

doc = json.load(open(PAGE))
bom = json.load(open(BOMPAGE))
crud = doc["list"][0]
cp = crud["options"]["customProps"]
bcp = bom["list"][0]["options"]["customProps"]

def bom_col(name):
    for c in bcp["columns"]:
        if c.get("name") == name:
            return c
    sys.exit("BOM column %r not found" % name)

_id = itertools.count(1789300000001)

# ------------------------------------------------------------------ dataSource

# Shipped as `organization_id equal <literal null>`, which matches no rows.
cp["dataSource"]["rules"]["list"] = copy.deepcopy(
    bcp["dataSource"]["rules"]["list"])
for leaf in cp["dataSource"]["rules"]["list"]:
    leaf["id"] = next(_id); leaf["parentId"] = next(_id)
    for child in leaf.get("children", []):
        child["id"] = next(_id); child["parentId"] = leaf["id"]
print("  dataSource: org filter now field-based (was literal null)")

# ------------------------------------------------------------------ columns

plain = copy.deepcopy(bom_col("parent_material_name"))

def plain_column(name, title, key, bson, **over):
    c = copy.deepcopy(plain)
    c.update({"name": name, "title": title, "description": title, "key": key,
              "bsonType": bson, "maxLength": None, "defaultValue": None,
              "component": None, "foreignKey": None})
    c.update(over)
    return c

# A relation column is the TARGET field's definition plus a parent stub that
# only carries the foreign key, so Item Code clones straight off the BOM page.
item_code = copy.deepcopy(bom_col("parent_material_code.material_code"))
item_code["name"] = "item_id.material_code"
item_code["title"] = "Item Code"
item_code["description"] = "Item Code"

COLUMNS = [
    plain_column("stock_movement_no", "Item Assembly No", "fclbhogh", "string"),
    plain_column("item_assembly_status", "Status", "4cjp73ay", "string"),
    item_code,
    plain_column("item_name", "Item Name", "b3shd69n", "string"),
    plain_column("item_qty", "Quantity", "uonlz2q8", "decimal"),
    plain_column("item_assembly_date", "Date", "btdx1wqm", "timestamp",
                 format="YYYY-MM-DD", showType="timestamp"),
    plain_column("issued_by", "Issued By", "zowopncq", "string"),
    plain_column("posted_status", "Posted Status", "g4kspytf", "string"),
]

if not cp.get("columns"):
    cp["columns"] = COLUMNS
    print("  added %d columns" % len(COLUMNS))

# ------------------------------------------------------------------ filters

def as_filter(base, title):
    f = copy.deepcopy(base)
    f.update({"title": title, "matchMode": "looseMatch",
              "hideLabel": 0, "aggregate": 0, "isRequired": False})
    return f

# Status is a dict-backed select; clone GD's gd_status filter, which reads the
# same dictionary parent (1914242988707749889).
status_filter = None
gd = json.load(open(GDPAGE))
def find_gd_status(node):
    if isinstance(node, dict):
        for f in ((node.get("options") or {}).get("customProps") or {}).get("filters") or []:
            if f.get("name") == "gd_status":
                return f
        for v in node.values():
            r = find_gd_status(v)
            if r:
                return r
    elif isinstance(node, list):
        for v in node:
            r = find_gd_status(v)
            if r:
                return r
    return None
src = find_gd_status(gd)
if src:
    status_filter = copy.deepcopy(src)
    status_filter.update({"name": "item_assembly_status", "title": "Status",
                          "key": "4cjp73ay", "description": "Item Assembly Status",
                          "hideLabel": 0})

if not cp.get("filters"):
    cp["filters"] = [
        as_filter(COLUMNS[0], "Item Assembly No"),
        as_filter(item_code, "Item Code"),
        as_filter(COLUMNS[3], "Item Name"),
    ]
    if status_filter:
        cp["filters"].append(status_filter)
    print("  added %d filters%s" % (len(cp["filters"]),
                                    "" if status_filter else " (no status filter: GD template missing)"))

# ------------------------------------------------------------------ delete

es = doc["config"]["eventScript"]
keys = {e["key"] for e in es}
target = None
for a in cp.get("rowActions") or []:
    if a.get("type") == "custom" and a.get("title") == "Delete":
        target = (a.get("events") or [{}])[0]
if not target:
    sys.exit("Delete row action not found")

body = open(os.path.join(MOD, "ItemAssemblyListDelete.js")).read()
if target["key"] in keys:
    for e in es:
        if e["key"] == target["key"]:
            e["func"] = body
else:
    es.append({"key": target["key"], "name": target.get("name") or "delete",
               "func": body, "type": "js"})
print("  wired Delete -> %s" % target["key"])

# ------------------------------------------------------------------ write

tmp = PAGE + ".tmp"
json.dump(doc, open(tmp, "w"), ensure_ascii=False, indent=2)
pretty = subprocess.run(["npx", "--no-install", "prettier", "--parser", "json", tmp],
                        capture_output=True, text=True, cwd=ROOT)
os.remove(tmp)
if pretty.returncode:
    sys.exit(pretty.stderr)

check = json.loads(pretty.stdout)
ccp = check["list"][0]["options"]["customProps"]
assert len(ccp["columns"]) >= 8
assert len(ccp["filters"]) >= 3
assert {e["key"]: e for e in check["config"]["eventScript"]}[target["key"]]["func"] == body
assert "null" not in json.dumps(ccp["dataSource"]["rules"]["list"][0]["children"][0]["value"])
open(PAGE, "w").write(pretty.stdout)
print("patched OK: %d columns, %d filters" % (len(ccp["columns"]), len(ccp["filters"])))
