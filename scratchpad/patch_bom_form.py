#!/usr/bin/env python3
"""Mirror Item Assembly & BOM/*.js into BOMFullJSON.json and apply the component edits.

A json.load/json.dump round-trip followed by `prettier --parser json` reproduces
this file byte-identically (verified), so the structural edits below are safe.
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, "Item Assembly & BOM")
FORM = os.path.join(MOD, "BOMFullJSON.json")

# key -> (relative .js, slot)  slot: "func" | "rule0"
MIRROR = [
    ("mounted",  "BOMonMounted.js",              "func"),
    ("iky7wors", "BOMonChangeParentMaterial.js", "func"),
    ("rxwwwgd8", "BOMonChangeSubMaterial.js",    "rule0"),
    ("2raaz2db", "BOMsave.js",                   "rule0"),
    ("wco16rzc", "BOMonChangeIsDefault.js",      "rule0"),
    ("o9ec1nsx", "BOMconfirmDefaultDialog.js",   "rule0"),
    ("hcxsdru3", "BOMcancelDefaultDialog.js",    "rule0"),
    ("fz5dx56d", "BOMonReadyVersionType.js",     "func"),
    ("piwzxkia", "BOMonChangeVersionType.js",    "func"),
]

NEW_HANDLERS = [
    ("bomcncl1", "onClick_cancel",     "BOMcancel.js"),
    ("bomtype1", "onChange_bom_type",  "BOMonChangeBomType.js"),
]

doc = json.load(open(FORM))
es = doc["config"]["eventScript"]
by_key = {e["key"]: e for e in es}

existing_keys = set(by_key)
def collect_component_keys(node, out):
    if isinstance(node, dict):
        if node.get("key"):
            out.add(node["key"])
        for v in node.values():
            collect_component_keys(v, out)
    elif isinstance(node, list):
        for v in node:
            collect_component_keys(v, out)
collect_component_keys(doc["list"], existing_keys)

already = {k for k, _, _ in NEW_HANDLERS if k in by_key}
for k, _, _ in NEW_HANDLERS:
    if len(k) != 8:
        sys.exit("minted key %r must be 8 chars" % k)
    # Re-runnable: a key already present as a handler is an earlier run of this
    # script, not a collision. A collision with a COMPONENT key still aborts.
    if k in existing_keys and k not in by_key:
        sys.exit("minted key %r collides with a component key" % k)

def read(rel):
    return open(os.path.join(MOD, rel)).read()

def set_slot(entry, slot, text):
    if slot == "func":
        entry["func"] = text
    else:
        entry["rules"][0]["options"]["func"] = text

for k, rel, slot in MIRROR:
    set_slot(by_key[k], slot, read(rel))
    print("  mirrored %-10s <- %s" % (k, rel))

# The rule body does this work correctly and with a row index; the stale
# top-level copy uses a row-index-less path and a column name Item does not have.
by_key["rxwwwgd8"]["func"] = ""

# 4rfxs5xg fired on the disabled parent_material_name, re-clearing the subform and
# writing '' into a DECIMAL column. onChange_parent_update_name_category owns the reset.
by_key["4rfxs5xg"]["rules"][0]["options"]["func"] = ""
print("  emptied    4rfxs5xg (superseded by iky7wors)")

for k, name, rel in NEW_HANDLERS:
    if k in by_key:
        by_key[k]["func"] = read(rel)
        print("  re-mirrored %-9s %s" % (k, name))
        continue
    es.append({"key": k, "name": name, "func": read(rel), "type": "js"})
    print("  added      %-10s %s" % (k, name))

# ---------------------------------------------------------------- components

def find(node, model):
    if isinstance(node, dict):
        if node.get("model") == model:
            return node
        for v in node.values():
            r = find(v, model)
            if r:
                return r
    elif isinstance(node, list):
        for v in node:
            r = find(v, model)
            if r:
                return r
    return None

def comp(model):
    n = find(doc["list"], model)
    if n is None:
        sys.exit("component %r not found" % model)
    return n

comp("parent_material_name")["events"]["onChange"] = ""
comp("button_cancel")["events"]["onClick"] = "bomcncl1"
comp("bom_type")["events"]["onChange"] = "bomtype1"
comp("bom_type")["options"]["defaultValue"] = "standard"
comp("consume_type")["options"]["defaultValue"] = "USE"

ref = comp("ref_bom_id")
ref["options"]["disabled"] = True
# Leftovers copied from an unrelated field; ref_bom_id is a remote select.
ref["options"]["options"] = []

comp("sub_material_bom_version")["options"]["hidden"] = True

for model in ("parent_material_code", "parent_mat_base_quantity",
              "bom_material_code", "sub_material_qty"):
    comp(model)["options"]["required"] = True

print("  component edits applied")

# ---------------------------------------------------------------- write

tmp = FORM + ".tmp"
json.dump(doc, open(tmp, "w"), ensure_ascii=False, indent=2)
pretty = subprocess.run(["npx", "--no-install", "prettier", "--parser", "json", tmp],
                        capture_output=True, text=True, cwd=ROOT)
os.remove(tmp)
if pretty.returncode:
    sys.exit(pretty.stderr)

check = json.loads(pretty.stdout)
for k, rel, slot in MIRROR:
    e = {x["key"]: x for x in check["config"]["eventScript"]}[k]
    got = e["func"] if slot == "func" else e["rules"][0]["options"]["func"]
    assert got == read(rel), "%s did not land byte-identically" % k
assert len(check["config"]["eventScript"]) == len(es)

open(FORM, "w").write(pretty.stdout)
print("patched OK: %d handlers mirrored, %d added" % (len(MIRROR), len(NEW_HANDLERS)))
