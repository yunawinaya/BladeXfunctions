#!/usr/bin/env python3
"""TEST ONLY (never publish): can a classic call queue behind another classic holder instead of answering 400 busy?

From the live SUBTRACT_INVENTORY v61 build (out/floor_SUBTRACT_INVENTORY.json) it writes two doTest copies:
  out/qtest_holder.json  - the locked path spins ~2 s right after the take (in code_node_CLvf2c), holding the key
  out/qtest_late.json    - spins ~0.6 s before its claim read (in code_node_CLkey), so the claim sees the token taken, and
                           code_node_CLclaim routes TAKE also when token 0 is held by a CL| owner
If the take reads the row fresh after waiting for the holder's run to end, the late calls apply in turn (200 each). If it reads
the snapshot from before its wait (atomicCount doc), its minus on token 0 fails the run before taking anything.
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_subtract_lock as L  # noqa: E402

SRC = os.path.join(L.ROOT, "out", "floor_SUBTRACT_INVENTORY.json")
SPIN = "const __t0 = Date.now(); while (Date.now() - __t0 < {ms}) {{}}\n"
CLAIM_OLD = 'if (!/^[0-9]{1,20}$/.test(s(r.id)) || Number(r.free_token) !== 1) route = "BUSY";'
CLAIM_NEW = ('if (!/^[0-9]{1,20}$/.test(s(r.id))) route = "BUSY";\n'
             'else if (Number(r.free_token) === 0 && s(r.owner_operation_id).indexOf("CL|") === 0) route = "TAKE";\n'
             'else if (Number(r.free_token) !== 1) route = "BUSY";')


def variant(spin_node, spin_ms, refine):
    doc = json.load(open(SRC, encoding="utf-8"))
    n = L.find(doc, spin_node)
    n["data"]["script"]["code"] = SPIN.format(ms=spin_ms) + n["data"]["script"]["code"]
    if refine:
        c = L.find(doc, "code_node_CLclaim")
        code = c["data"]["script"]["code"]
        if code.count(CLAIM_OLD) != 1:
            sys.exit("claim code changed")
        c["data"]["script"]["code"] = code.replace(CLAIM_OLD, CLAIM_NEW)
    return doc


for name, doc in (("qtest_holder", variant("code_node_CLvf2c", 2000, False)),
                  ("qtest_late", variant("code_node_CLkey", 600, True))):
    L.check(doc)
    with open(os.path.join(L.ROOT, "out", name + ".json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print("TEST ONLY ->", name)
