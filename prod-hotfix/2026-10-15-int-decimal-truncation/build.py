#!/usr/bin/env python3
"""Code-node outputs declared bsonType "int" drop the decimals of what they return (7.5 -> 7), silently.

- GOODS_RECEIVING code_node_D9IbUV8t.onOrderQty: the on-order row of a fractional receipt gets received_qty 7 for 7.5 and
  keeps open_qty 0.5 on a fully received PO line.
- SUBTRACT_INVENTORY_NEW code_node_fVEv7HuP.wa_quantity and SUBTRACT_INVENTORY code_node_4yvZMf0Q.wa_quantity: the
  weighted-average quantity is written floored after a fractional issue.
- SM_PLANT_TRANSFER code_node_CdNEX3lE.quantity: the picked quantity of a fractional transfer reaches the receiving lines
  and the cost-price call as a whole number.

Fix: those response_json entries become "decimal". Nothing else changes.

  python3 build.py [NAME ...]         # fetch the enabled prod versions, patch, write <NAME>.prod.json
  python3 build.py --dev [NAME ...]   # same against dev, write <NAME>.dev.json
  python3 build.py --check            # print the diffs only
An entry already "decimal" (fix pasted) is reported and its file left alone.
"""
import difflib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ENV = "--dev" if "--dev" in sys.argv else "--prod"
TARGETS = [
    ("GOODS_RECEIVING", 2029090678383042562, "code_node_D9IbUV8t", "onOrderQty"),
    ("SUBTRACT_INVENTORY_NEW", 2031973476128071681, "code_node_fVEv7HuP", "wa_quantity"),
    ("SUBTRACT_INVENTORY", 2012096660219564034, "code_node_4yvZMf0Q", "wa_quantity"),
    ("SM_PLANT_TRANSFER", 2025864403783462913, "code_node_CdNEX3lE", "quantity"),
]
ONLY = [a for a in sys.argv[1:] if not a.startswith("--")]


def fetch(wf_id):
    # what runs is the enabled history row with the highest version, not su_code_workflow.script_json
    out = subprocess.run([os.path.join(ROOT, ".dbtools", "db"), ENV, "--json",
                          f"SELECT version_number, create_time, script_json FROM su_code_workflow_history "
                          f"WHERE data_id={wf_id} AND status='enabled' ORDER BY version_number DESC LIMIT 1"],
                         capture_output=True, text=True, check=True).stdout
    row = json.loads(out)[0]
    return row["version_number"], str(row["create_time"])[:19], json.loads(row["script_json"])


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return n
        for v in n.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def main():
    for name, wf_id, node, key in TARGETS:
        if ONLY and name not in ONLY:
            continue
        version, at, base = fetch(wf_id)
        print(f"== {name} ({ENV[2:]} enabled v{version}, {at})")
        doc = json.loads(json.dumps(base))
        entries = [e for e in find(doc, node)["data"]["response_json"] if e.get("name") == key]
        if len(entries) == 1 and entries[0].get("bsonType") == "decimal":
            print(f"  {node}.{key} is already decimal: nothing to do")
            continue
        if len(entries) != 1 or entries[0].get("bsonType") != "int":
            sys.exit(f"  {node}.{key}: expected one entry declared int, found {[(e.get('name'), e.get('bsonType')) for e in entries]}")
        entries[0]["bsonType"] = "decimal"
        a = json.dumps(base, indent=1, ensure_ascii=False).splitlines()
        b = json.dumps(doc, indent=1, ensure_ascii=False).splitlines()
        print("\n".join(difflib.unified_diff(a, b, "enabled", "patched", lineterm="", n=2)))
        if "--check" not in sys.argv:
            out = os.path.join(HERE, f"{name}.{ENV[2:]}.json")
            with open(out, "w") as f:
                f.write(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
            print(f"  wrote {os.path.relpath(out, ROOT)}")


main()
