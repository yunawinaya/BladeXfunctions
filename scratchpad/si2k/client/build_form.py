"""Patches the Sales Invoice form (live dev v387, base_SI_form.v387.json) with the 2,000-line handlers in this folder, and the
Goods Delivery list page (live dev v399, base_GoodsDelivery_page.v399.json) with the projected convert pre-check:

  form  SIcalculation          (e063qm85)              <- new_SIcalculation.js           bundle index built once, changed line
                                                                                         values only, { rows } = one call per row
  form  onRowRemove_item       (5vr8zl63)              <- new_onRowRemove_item.js        one { rows } call, not one per row
  form  onConfirm_batchAddItem (ua6gcgje)              <- new_onConfirm_batchAddItem.js  order lines 500 per read, UI calls per
                                                                                         state, one { rows } call, one read per doc
  form  onChange_taxInclusive  (um2s81kb rules[0])     <- new_onChange_taxInclusive.js   one { rows } call, not one per row
  page  func_convertSI         (5i0cg4mt)              <- new_handleConvertGDtoSI.js     .field() on the two pre-check reads

Writes out_SI_form.json, out_GoodsDelivery_page.json and out_js/ (the bodies for the repo mirrors) in this folder only.
usage: python3 build_form.py
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FORM_BASE = os.path.join(HERE, "base_SI_form.v387.json")
PAGE_BASE = os.path.join(HERE, "base_GoodsDelivery_page.v399.json")
FORM_PATCH = {  # key -> (name, base file, new file, where the code sits)
    "e063qm85": ("SIcalculation", "base_SIcalculation.js", "new_SIcalculation.js", "func"),
    "5vr8zl63": ("onRowRemove_item", "base_onRowRemove_item.js", "new_onRowRemove_item.js", "func"),
    "ua6gcgje": ("onConfirm_batchAddItem", "base_onConfirm_batchAddItem.js", "new_onConfirm_batchAddItem.js", "func"),
    "um2s81kb": ("onChange_taxInclusive", "base_onChange_taxInclusive.js", "new_onChange_taxInclusive.js", "rule"),
}
PAGE_PATCH = {"5i0cg4mt": ("func_convertSI", "base_handleConvertGDtoSI.js", "new_handleConvertGDtoSI.js", "func")}
# repo mirror name -> new body ("Sales Invoice/<name>" where one exists; the other two live only in the form JSON)
MIRRORS = {
    "SIcalculation.js": "new_SIcalculation.js",
    "SIbatchAddLineItem.js": "new_onConfirm_batchAddItem.js",
    "handleConvertGDtoSI.js": "new_handleConvertGDtoSI.js",
    "onRowRemove_item.js": "new_onRowRemove_item.js",
    "onChange_taxInclusive.js": "new_onChange_taxInclusive.js",
}


def text(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def canon(d):
    return hashlib.sha256(json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def prettier(raw):
    found = glob.glob(os.path.expanduser("~/.npm/_npx/*/node_modules/prettier/bin/prettier.cjs"))
    if not found:
        sys.exit("prettier not found under ~/.npm/_npx")
    out = subprocess.run(["node", found[0], "--parser", "json"], input=raw, capture_output=True, text=True)
    if out.returncode:
        sys.exit("prettier failed: " + out.stderr[:300])
    return out.stdout


def patch(doc, plan):
    entries = {e.get("key"): e for e in doc["config"]["eventScript"]}
    for key, (name, base, new, where) in plan.items():
        e = entries[key]
        assert e.get("name") == name, (key, e.get("name"))
        holder = e if where == "func" else e["rules"][0]["options"]
        assert holder["func"] == text(base), name + ": the live handler is not " + base + " any more"
        holder["func"] = text(new)


def build(base_path, plan, out_name):
    base = json.load(open(base_path, encoding="utf-8"))
    doc = json.loads(json.dumps(base))
    patch(doc, plan)
    # nothing else moved: putting the old bodies back gives the base again
    back = json.loads(json.dumps(doc))
    entries = {e.get("key"): e for e in back["config"]["eventScript"]}
    for key, (name, base_file, new, where) in plan.items():
        (entries[key] if where == "func" else entries[key]["rules"][0]["options"])["func"] = text(base_file)
    assert canon(back) == canon(base)
    out = prettier(json.dumps(doc, ensure_ascii=False, indent=2))
    with open(os.path.join(HERE, out_name), "w", encoding="utf-8") as f:
        f.write(out)
    print("%s: %d handlers changed, %s -> %s" % (os.path.basename(base_path), len(plan), canon(doc)[:12], out_name))


build(FORM_BASE, FORM_PATCH, "out_SI_form.json")
build(PAGE_BASE, PAGE_PATCH, "out_GoodsDelivery_page.json")
os.makedirs(os.path.join(HERE, "out_js"), exist_ok=True)
for mirror, new in MIRRORS.items():
    with open(os.path.join(HERE, "out_js", mirror), "w", encoding="utf-8") as f:
        f.write(text(new))
print("out_js/: " + ", ".join(sorted(MIRRORS)))
