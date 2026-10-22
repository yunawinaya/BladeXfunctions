#!/usr/bin/env python3
"""MIN-01: let a classic call queue behind another classic holder instead of answering 400 busy (the classic children's claim).

Patches `code_node_CLclaim` in the live SUBTRACT_INVENTORY v61, ADD_INVENTORY v66, SUBTRACT_INVENTORY_NEW v27 and ADD_INVENTORY_NEW v19
(bases: base/<NAME>.live_pre_queue.json; outputs: out/q_<NAME>.json). A token 0 owned by a CL| operation now routes TAKE: the take
waits for that call's run to end and reads the row fresh. Queue test, 22 Oct 16:24: both late callers waited and applied, no lost
update. Token 0 held by an engine run, a half release (owner '') or no lock row is still busy.

Usage: python3 -I build_queue_claim.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_subtract_lock as L  # noqa: E402

NAMES = ["SUBTRACT_INVENTORY", "ADD_INVENTORY", "SUBTRACT_INVENTORY_NEW", "ADD_INVENTORY_NEW"]
OLD_COMMENT = "// token 1 = free; token 0 = held by an engine run or another classic call (or half released); no row = busy (the seed lost)\n"
NEW_COMMENT = ("// token 1 = free. Token 0 held by another classic call (CL|): take anyway; the take waits for that call's run to end and\n"
               "// reads the row fresh. Token 0 held by an engine run or half released (owner ''), or no row (the seed lost): busy\n")
OLD_RULE = 'if (!/^[0-9]{1,20}$/.test(s(r.id)) || Number(r.free_token) !== 1) route = "BUSY";'
NEW_RULE = ('const classic = Number(r.free_token) === 0 && s(r.owner_operation_id).indexOf("CL|") === 0;\n'
            'if (!/^[0-9]{1,20}$/.test(s(r.id)) || (Number(r.free_token) !== 1 && !classic)) route = "BUSY";')

for name in NAMES:
    doc = json.load(open(os.path.join(L.ROOT, "base", name + ".live_pre_queue.json"), encoding="utf-8"))
    node = L.find(doc, "code_node_CLclaim")
    code = node["data"]["script"]["code"]
    if code.count(OLD_COMMENT) != 1 or code.count(OLD_RULE) != 1:
        sys.exit(f"{name}: claim code is not the expected one")
    node["data"]["script"]["code"] = code.replace(OLD_COMMENT, NEW_COMMENT).replace(OLD_RULE, NEW_RULE)
    L.check(doc)
    with open(os.path.join(L.ROOT, "out", "q_" + name + ".json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print(name, "-> out/q_" + name + ".json")
