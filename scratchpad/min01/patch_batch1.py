#!/usr/bin/env python3
"""MIN-01 batch 1: edit two code nodes in the pinned live workflow JSON (the CLI refuses both .ts as degraded).

T1 CANCEL_PENDING `Released Data` (code_node_sBKm3kz1): refuse a row that is not Pending.
T2 SM_DISPOSAL_SCRAP `Validate Location & Quantity` (code_node_SFwfSnsO): refuse any Reserved pick before the first write.

Reads base/<NAME>.live_v<N>.json, writes out/<NAME>.json. Only data.script.code changes.
Usage: python3 -I patch_batch1.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

T1_OLD = "\n\n// Validate qty\n"
T1_NEW = (
    "\n\n// Only Pending reservations are released here; any other status belongs to its document\n"
    'if (record.status !== "Pending") {\n  return {\n    code: "400",\n'
    '    message: "Only Pending reservations can be released (this one is " + (record.status || "blank") + ")",\n'
    "    recordsToUpdate: [],\n    recordsToUpdateLength: 0,\n    recordToCreate: null,\n    recordToCreateExists: 0,\n  };\n}"
    "\n\n// Validate qty\n"
)

T2_OLD = (
    "let quantityFailed = 0\nlet quantityMessage\n\nfor(const subform of subformData) {\n"
    "  let balancesToProcess = JSON.parse(subform.temp_qty_data);\n  balancesToProcess = balancesToProcess.filter(\n"
    "    (tempData) => tempData.sm_quantity > 0\n  );\n\n  if (balancesToProcess.length === 0) {\n"
    "    quantityFailed = 1\n    quantityMessage = 'No quantity selected to issue'\n  }\n}\n\nreturn {"
)
T2_NEW = (
    "let quantityFailed = 0\nlet quantityMessage\nlet reservedLine = 0\n\nfor(const subform of subformData) {\n"
    "  let balancesToProcess = JSON.parse(subform.temp_qty_data);\n  balancesToProcess = balancesToProcess.filter(\n"
    "    (tempData) => tempData.sm_quantity > 0\n  );\n\n  if (balancesToProcess.length === 0) {\n"
    "    quantityFailed = 1\n    quantityMessage = 'No quantity selected to issue'\n  }\n\n"
    "  // Reserved stock is held for another document; Disposal / Scrap never owns a reservation\n"
    "  if (!reservedLine && balancesToProcess.some((b) => b.category === 'Reserved')) {\n"
    "    reservedLine = subformData.indexOf(subform) + 1\n  }\n}\n\n"
    "if (reservedLine) {\n  quantityFailed = 1\n"
    "  quantityMessage = 'Line ' + reservedLine + ': Reserved stock belongs to another document. Release it there first.'\n}\n\nreturn {"
)

PATCHES = [
    ("CANCEL_PENDING", "CANCEL_PENDING.live_v4.json", "code_node_sBKm3kz1", T1_OLD, T1_NEW),
    ("SM_DISPOSAL_SCRAP", "SM_DISPOSAL_SCRAP.live_v17.json", "code_node_SFwfSnsO", T2_OLD, T2_NEW),
]


def find_node(n, node_id):
    if isinstance(n, dict):
        if n.get("id") == node_id:
            return n
        for v in n.values():
            hit = find_node(v, node_id)
            if hit:
                return hit
    elif isinstance(n, list):
        for v in n:
            hit = find_node(v, node_id)
            if hit:
                return hit
    return None


def main():
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    for name, base, node_id, old, new in PATCHES:
        doc = json.load(open(os.path.join(HERE, "base", base), encoding="utf-8"))
        node = find_node(doc, node_id)
        if not node:
            sys.exit(f"{name}: node {node_id} not found")
        data = node["data"]
        # the live JSON keeps the code in data.script.code only (data.code is empty)
        if data.get("code"):
            sys.exit(f"{name}: data.code is not empty - check which copy the runtime reads before patching")
        text = data["script"]["code"]
        if text.count(old) != 1:
            sys.exit(f"{name}: old text occurs {text.count(old)} times in {node_id}.script.code, expected 1")
        data["script"]["code"] = text.replace(old, new)
        out = os.path.join(HERE, "out", name + ".json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
        print(f"{name}: {node_id} patched -> {os.path.relpath(out, os.getcwd())}")


if __name__ == "__main__":
    main()
