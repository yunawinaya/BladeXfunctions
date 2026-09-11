#!/usr/bin/env python3
"""Repair Item Assembly & BOM/ItemAssemblyFullJSON.json.

The form was produced from Misc Issue by a rename that appended _1/_2 to JS
property names as well as model paths, so several handlers read fields that do
not exist. The handler bodies here are restored from MSI (verified byte-identical
after the rename), and the components MSI has but this form dropped are cloned in.
"""
import json, os, subprocess, sys, copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, "Item Assembly & BOM")
FORM = os.path.join(MOD, "ItemAssemblyFullJSON.json")
MSI = os.path.join(ROOT, "Stock Movement", "Misc Issue", "MSIfullJSON.json")

doc = json.load(open(FORM))
msi = json.load(open(MSI))

# ------------------------------------------------------------------ helpers

def walk_find(node, pred):
    if isinstance(node, dict):
        if pred(node):
            return node
        for v in node.values():
            r = walk_find(v, pred)
            if r:
                return r
    elif isinstance(node, list):
        for v in node:
            r = walk_find(v, pred)
            if r:
                return r
    return None

def by_model(root, model):
    return walk_find(root, lambda n: n.get("model") == model)

def comp(model, root=None):
    n = by_model(root if root is not None else doc["list"], model)
    if n is None:
        sys.exit("component %r not found" % model)
    return n

def tab(container, name):
    for t in container.get("tabs", []):
        if t.get("name") == name:
            return t
    sys.exit("tab %r not found" % name)

def cols(table_node):
    for k in ("tableColumns", "columns"):
        if isinstance(table_node.get(k), list):
            return table_node[k]
    sys.exit("no column list on %r" % table_node.get("model"))

def insert_after(lst, model, node):
    for i, x in enumerate(lst):
        if isinstance(x, dict) and x.get("model") == model:
            lst.insert(i + 1, node)
            return
    lst.append(node)

# ------------------------------------------------------------------ 1. handlers

es = doc["config"]["eventScript"]
by_key = {e["key"]: e for e in es}
by_name = {e.get("name"): e for e in es}

MIRROR = [
    ("mounted",  "ItemAssemblyOnMounted.js",           "func"),
    ("fgivan7v", "ItemAssemblyOnChangePlant.js",       "func"),
    ("5y8a2wfi", "ItemAssemblyConfirmDialog.js",       "func"),
    ("1yc5v4i4", "ItemAssemblyOnChangeDialogUOM.js",   "func"),
    ("5ulwgpus", "ItemAssemblyOnChangeSelectHU.js",    "func"),
    ("cxk2kor9", "ItemAssemblyOnChangeSMQuantity.js",  "func"),
    ("bmxmqi0j", "ItemAssemblyOnChangeCategory.js",    "func"),
    ("efnv3l7q", "ItemAssemblySearchSN.js",            "func"),
    ("vlxg4fno", "ItemAssemblyResetSN.js",             "func"),
]

def read(rel):
    return open(os.path.join(MOD, rel)).read()

for k, rel, slot in MIRROR:
    by_key[k][slot] = read(rel)
    print("  mirrored   %-9s <- %s" % (k, rel))

# Category Transfer leftovers: they read movement_type and category_from/_to,
# none of which exist here, and nothing binds them.
DROP = ["gdmh7k1i", "umqs4zz3", "dc23nkxc", "ana28wmu",
        # The components table is locked to the BOM, so neither can fire.
        "llytn27o", "mr6auqmc"]
doc["config"]["eventScript"] = [e for e in es if e["key"] not in DROP]
es = doc["config"]["eventScript"]
print("  dropped    %s" % ", ".join(DROP))

NEW = [
    ("wv07g9xe", "onChange_assembledItem", "ItemAssemblyOnChangeItem.js"),
    ("iaqty01x", "onChange_itemQty",       "ItemAssemblyOnChangeItemQty.js"),
]
existing = set(e["key"] for e in es)
def collect(node, out):
    if isinstance(node, dict):
        if node.get("key"):
            out.add(node["key"])
        for v in node.values():
            collect(v, out)
    elif isinstance(node, list):
        for v in node:
            collect(v, out)
collect(doc["list"], existing)
for k, name, rel in NEW:
    if k in existing:
        sys.exit("minted key %r collides" % k)
    es.append({"key": k, "name": name, "func": read(rel), "type": "js"})
    print("  added      %-9s %s" % (k, name))

# ------------------------------------------------------------------ 2. clone components

msi_sm = comp("stock_movement", msi["list"])
ia_sm = comp("stock_movement")

# requested_qty = the BOM requirement; total_quantity = what was allocated.
req = copy.deepcopy(by_model(msi_sm, "requested_qty"))
if by_model(ia_sm, "requested_qty") is None:
    insert_after(cols(ia_sm), "transfer_stock", req)
    print("  cloned     stock_movement.requested_qty")

msi_dlg = comp("sm_item_balance", msi["list"])
ia_dlg = comp("sm_item_balance")

# onClick_select_stock stashes the unfiltered balance set here for serial search.
raw = copy.deepcopy(by_model(msi_dlg, "table_item_balance_raw"))
ia_grid = comp("grid_9rdvbt3l")
if by_model(ia_dlg, "table_item_balance_raw") is None:
    ia_grid_col = ia_grid["columns"][0] if ia_grid.get("columns") else ia_grid
    (ia_grid_col.get("list") or ia_grid_col.setdefault("list", [])).append(raw)
    print("  cloned     sm_item_balance.table_item_balance_raw")

msi_inv = comp("inventory_tabs", msi["list"])
ia_inv = comp("inventory_tabs")
msi_loose = tab(msi_inv, "loose")
ia_loose = tab(ia_inv, "loose")

# The serial search bar: MSI already points its buttons at efnv3l7q / vlxg4fno,
# the two handlers this form inherited with nothing bound to them.
search_flex = copy.deepcopy(by_model(msi_loose, "flex_a2xyamgv"))
if by_model(ia_loose, "search_serial_number") is None:
    ia_loose["list"].insert(0, search_flex)
    print("  cloned     serial search bar (search_serial_number/confirm_search/reset_search)")

msi_bal = by_model(msi_loose, "table_item_balance")
ia_bal = by_model(ia_loose, "table_item_balance")
for col in ("serial_number", "material_id"):
    if by_model(ia_bal, col) is None:
        src = copy.deepcopy(by_model(msi_bal, col))
        insert_after(cols(ia_bal), "batch_id", src)
        print("  cloned     table_item_balance.%s" % col)

# ------------------------------------------------------------------ 3. component fixes

# The components table is the BOM, so rows are neither added nor removed by hand.
ia_sm["options"]["isAdd"] = False
ia_sm["options"]["isDelete"] = False
ia_sm["events"]["onRowRemove"] = ""
comp("item_selection", ia_sm)["events"]["onChange"] = ""
# An Item-master uniqueness check against an id: a permanent no-op that costs a
# query per row per validation pass.
comp("item_selection", ia_sm)["options"]["validator"] = ""

comp("item_qty")["events"]["onChange"] = "iaqty01x"

# The plant model on this form is issuing_operation_faci; plant_id does not exist,
# so both location dropdowns were filtering on an empty value.
for model in ("storage_location_id", "location_id"):
    ds = json.dumps(comp(model)["options"]["datasource"], ensure_ascii=False)
    ds = ds.replace("{{value:plant_id}}", "{{value:issuing_operation_faci}}")
    comp(model)["options"]["datasource"] = json.loads(ds)

# Item has organization_id, not organization_id_1.
sel = comp("item_selection", ia_sm)
ds = json.dumps(sel["options"]["datasource"], ensure_ascii=False)
ds = ds.replace('"organization_id_1"', '"organization_id"')
sel["options"]["datasource"] = json.loads(ds)

# The status model is item_assembly_status.
snt = comp("stock_movement_no_type")
snt["options"]["disabled"] = snt["options"]["disabled"].replace(
    "stock_movement_status", "item_assembly_status")

# Queries mc2_stock_movement / item_assembly_batch, neither of which exists.
comp("batch_no")["options"]["validator"] = ""

print("  component fixes applied")

# ------------------------------------------------------------------ write

tmp = FORM + ".tmp"
json.dump(doc, open(tmp, "w"), ensure_ascii=False, indent=2)
pretty = subprocess.run(["npx", "--no-install", "prettier", "--parser", "json", tmp],
                        capture_output=True, text=True, cwd=ROOT)
os.remove(tmp)
if pretty.returncode:
    sys.exit(pretty.stderr)

check = json.loads(pretty.stdout)
chk = {e["key"]: e for e in check["config"]["eventScript"]}
for k, rel, slot in MIRROR:
    assert chk[k][slot] == read(rel), "%s did not land byte-identically" % k
for k, name, rel in NEW:
    assert chk[k]["func"] == read(rel), "%s did not land byte-identically" % k
for k in DROP:
    assert k not in chk, "%s still present" % k

open(FORM, "w").write(pretty.stdout)
print("patched OK")
