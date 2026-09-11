#!/usr/bin/env python3
"""Strip the serial-rule apparatus off the BOM version field.

A BOM version is per parent material (Item A's first BOM is V1 and Item B's first
BOM is also V1). The platform's serial engine cannot express that: it is one
global counter per department, and -- proven on 2026-09-11 -- it overwrites the
field whenever <field>_type holds a rule id, even when a real value was written
(sent V1, saved V2). So the whole apparatus comes off and the per-material scan
in BOMonChangeParentMaterial.js becomes the only source.
"""
import json, os, subprocess, sys, copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, "Item Assembly & BOM")
FORM = os.path.join(MOD, "BOMFullJSON.json")

doc = json.load(open(FORM))

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

# ---- build the replacement input by cloning a real fm-input from this form
template = copy.deepcopy(find(doc["list"], "page_status"))
version = copy.deepcopy(template)
version["name"] = "BOM Version"
version["key"] = "phv0n6qb"          # reuse the old key so nothing else needs rewiring
version["model"] = "parent_mat_bom_version"
version["events"] = {"onChange": "", "onFocus": "", "onBlur": ""}
o = version["options"]
o["disabled"] = True                  # computed per material, never typed
o["hidden"] = False
o["defaultValue"] = ""
o["placeholder"] = "Auto-generated"
o["remoteFunc"] = "func_phv0n6qb"
o["remoteOption"] = "option_phv0n6qb"

# ---- swap the serial wrapper (version + rule selector) for that single input
replaced = False
def swap(container):
    global replaced
    if isinstance(container, dict):
        for k, v in container.items():
            if isinstance(v, list):
                for i, child in enumerate(v):
                    if isinstance(child, dict) and child.get("model") == "serial_flex_wrapper_mfsfr70f":
                        v[i] = version
                        replaced = True
                        return True
                    if swap(child):
                        return True
            elif isinstance(v, dict):
                if swap(v):
                    return True
    elif isinstance(container, list):
        for child in container:
            if swap(child):
                return True
    return False
swap(doc["list"])
if not replaced:
    sys.exit("serial_flex_wrapper_mfsfr70f not found")
print("  replaced the serial wrapper with a plain disabled input")

assert find(doc["list"], "parent_mat_bom_version_type") is None, "type selector still present"
assert find(doc["list"], "parent_mat_bom_version") is not None, "version field lost"
print("  parent_mat_bom_version_type removed")

# ---- drop the three serial handlers
DROP = {"fz5dx56d", "piwzxkia", "hazurcwj"}
before = len(doc["config"]["eventScript"])
doc["config"]["eventScript"] = [e for e in doc["config"]["eventScript"] if e["key"] not in DROP]
print("  dropped %d serial handlers (%d -> %d entries)"
      % (before - len(doc["config"]["eventScript"]), before, len(doc["config"]["eventScript"])))

tmp = FORM + ".tmp"
json.dump(doc, open(tmp, "w"), ensure_ascii=False, indent=2)
pretty = subprocess.run(["npx", "--no-install", "prettier", "--parser", "json", tmp],
                        capture_output=True, text=True, cwd=ROOT)
os.remove(tmp)
if pretty.returncode:
    sys.exit(pretty.stderr)

chk = json.loads(pretty.stdout)
assert find(chk["list"], "parent_mat_bom_version_type") is None
v = find(chk["list"], "parent_mat_bom_version")
assert v["type"] == "input" and v["options"]["disabled"] is True, v.get("type")
assert not any(e["key"] in DROP for e in chk["config"]["eventScript"])
open(FORM, "w").write(pretty.stdout)
print("patched OK")
