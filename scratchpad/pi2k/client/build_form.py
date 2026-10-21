"""Patches the PI form (Purchase Invoice/PIfullJSON.json = dev v625) with the lean handlers in this folder:
  PIcalculation          (uq6mkq3j) <- new_PIcalculation.js         line values written only where they change
  onConfirm_batchAddItem (ua6gcgje) <- new_onConfirm_batchAddItem.js  order lines read 500 at a time; per-line UI calls batched
and refreshes the .js mirrors (PIcalculation.js, PIbatchAddLineItem.js). The base is checked against base/PI_form.v625.json.

usage: python3 build_form.py [--write]
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FORM = os.path.join(R, "Purchase Invoice", "PIfullJSON.json")
BASE = os.path.join(HERE, "..", "base", "PI_form.v625.json")
WRITE = "--write" in sys.argv
PATCH = {"uq6mkq3j": ("PIcalculation", "new_PIcalculation.js", "PIcalculation.js"),
         "ua6gcgje": ("onConfirm_batchAddItem", "new_onConfirm_batchAddItem.js", "PIbatchAddLineItem.js")}


def canon(d):
    return hashlib.sha256(json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def prettier(text):
    found = glob.glob(os.path.expanduser("~/.npm/_npx/*/node_modules/prettier/bin/prettier.cjs"))
    out = subprocess.run(["node", found[0], "--parser", "json"], input=text, capture_output=True, text=True)
    if out.returncode:
        sys.exit("prettier failed: " + out.stderr[:300])
    return out.stdout


base = json.load(open(BASE, encoding="utf-8"))
doc = json.loads(json.dumps(base))
for e in doc["config"]["eventScript"]:
    if e["key"] in PATCH:
        name, src, _ = PATCH[e["key"]]
        assert e["name"] == name, (e["key"], e["name"])
        assert e["func"] == open(os.path.join(HERE, "base_" + name + ".js"), encoding="utf-8").read(), name + ": base handler moved"
        e["func"] = open(os.path.join(HERE, src), encoding="utf-8").read()
out = prettier(json.dumps(doc, ensure_ascii=False, indent=2))
with open(os.path.join(HERE, "out_PI_form.json"), "w", encoding="utf-8") as f:
    f.write(out)
print("patched form: %d handlers changed, %s -> out_PI_form.json" % (len(PATCH), canon(doc)[:12]))
if WRITE:
    current = json.load(open(FORM, encoding="utf-8"))
    assert canon(current) in (canon(base), canon(doc)), "Purchase Invoice/PIfullJSON.json is neither the v625 base nor this build"
    with open(FORM, "w", encoding="utf-8") as f:
        f.write(out)
    for _, (name, src, mirror) in PATCH.items():
        with open(os.path.join(R, "Purchase Invoice", mirror), "w", encoding="utf-8") as f:
            f.write(open(os.path.join(HERE, src), encoding="utf-8").read())
    print("wrote Purchase Invoice/PIfullJSON.json, PIcalculation.js, PIbatchAddLineItem.js")
