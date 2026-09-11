#!/usr/bin/env python3
"""Add the missing datasource filters to BOMFullJSON.json.

Five remote selects shipped with an empty rule list, so they list every row in
every organization. The shape mirrors parent_material_code, which is already
correct on this form: one top-level branch/all, org scoping as a nested any.
"""
import json, os, subprocess, sys, itertools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORM = os.path.join(ROOT, "Item Assembly & BOM", "BOMFullJSON.json")

doc = json.load(open(FORM))
_id = itertools.count(1789200000001)

def org_any(level):
    top = next(_id)
    return {"id": top, "parentId": next(_id), "isTop": False, "type": "branch",
            "operator": "any", "level": level,
            "children": [
                {"id": next(_id), "parentId": top, "isTop": False,
                 "prop": "organization_id", "operator": "equal",
                 "valueType": "field", "value": "{{system:deptIds}}",
                 "type": "leaf", "level": level + 1, "propLabel": "Organization",
                 "valueLabel": "", "operatorLabel": "Equal", "valueTypeLabel": "值"},
                {"id": next(_id), "parentId": top, "isTop": False,
                 "prop": "organization_id", "operator": "equal",
                 "valueType": "field", "value": "{{global:deptParentId}}",
                 "type": "leaf", "level": level + 1, "propLabel": "Organization",
                 "valueLabel": "", "operatorLabel": "Equal", "valueTypeLabel": "值"},
            ]}

def rules(with_active=False):
    top = next(_id)
    children = []
    if with_active:
        children.append({"id": next(_id), "parentId": top, "isTop": False,
                         "prop": "is_active", "operator": "numberEqual",
                         "valueType": "value", "value": 1, "type": "leaf",
                         "level": 2, "propLabel": "Active", "valueLabel": "",
                         "operatorLabel": "Equal", "valueTypeLabel": "值"})
    children.append(org_any(2))
    return [{"id": top, "parentId": next(_id), "isTop": True, "type": "branch",
             "operator": "all", "prop": "", "valueType": "", "value": "",
             "level": 1, "children": children}]

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

TARGETS = [
    ("parent_material_category", False),
    ("parent_mat_base_uom",      False),
    ("sub_material_category",    False),
    ("sub_material_qty_uom",     False),
    ("ref_bom_id",               True),   # also active-only
]

for model, with_active in TARGETS:
    n = find(doc["list"], model)
    if n is None:
        sys.exit("component %r not found" % model)
    ds = n["options"]["datasource"]
    existing = ds.get("rules", {}).get("list") or []
    has_prop = any(l.get("prop") or l.get("children") for l in existing)
    if has_prop:
        print("  %-26s already filtered, left alone" % model)
        continue
    ds["rules"]["list"] = rules(with_active)
    print("  %-26s + organization scope%s" % (model, " + is_active" if with_active else ""))

tmp = FORM + ".tmp"
json.dump(doc, open(tmp, "w"), ensure_ascii=False, indent=2)
pretty = subprocess.run(["npx", "--no-install", "prettier", "--parser", "json", tmp],
                        capture_output=True, text=True, cwd=ROOT)
os.remove(tmp)
if pretty.returncode:
    sys.exit(pretty.stderr)
check = json.loads(pretty.stdout)
for model, _ in TARGETS:
    lst = find(check["list"], model)["options"]["datasource"]["rules"]["list"]
    assert lst and lst[0].get("children"), "%s filter did not land" % model
open(FORM, "w").write(pretty.stdout)
print("patched OK")
