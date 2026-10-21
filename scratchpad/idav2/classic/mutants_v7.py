"""Mutation check of the classic v7 tests: each mutant is one exact change to the BUILT IDA_SAVE.json (copied to a temp folder, re-lifted);
classic/test_v7.js and classic/test_guard_sim.js must fail on every one (a mutant they pass = a blind spot). Read-only on the repo files.
usage: python3 scratchpad/idav2/classic/mutants_v7.py"""
import sys
sys.dont_write_bytecode = True
import json  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.dirname(HERE)
BUILT = os.path.join(IDAV2, "..", "..", "Item Disassembly", "AsyncV2", "IDA_SAVE.json")
sys.path.insert(0, os.path.join(IDAV2, "lib", "lift"))
import lift as L  # noqa: E402

# (label, node id, old text, new text)
MUTANTS = [
    ("stored check on every page (not Edit-only)", "code_node_IDAguardIn", 'idaS(idaGuardIn.pageStatus) === "Edit" && ', ""),
    ("cap on Draft too", "code_node_IDAguardIn", 'idaGuardSaveAs !== "Draft" && ', ""),
    ("cap at >= 250", "code_node_IDAguardIn", "idaGuardMoves > IDA_CLASSIC_MAX_MOVES", "idaGuardMoves >= IDA_CLASSIC_MAX_MOVES"),
    ("moves = lines only", "code_node_IDAguardIn", "idaMoveCount(idaGuardDoc, idaGuardDoc.stock_movement)", "idaRecoveryLines(idaGuardDoc.stock_movement).length"),
    ("no busy refusal", "code_node_IDAguardStored", 'idaGuardStored === "Processing"', "false"),
    ("Completed only (Fully Posted passes)", "code_node_IDAguardStored", "IDA_FINAL.indexOf(idaGuardStored) >= 0", 'idaGuardStored === "Completed"'),
    ("final refused for Completed saves too", "code_node_IDAguardStored", 'idaS(idaGuardOut.saveAs) === "Draft" && ', ""),
    ("price per line unit again", "code_cost_alloc", "unit_price: baseQty > 0 ? q8(lineValue / baseQty) : 0,", "unit_price: qty > 0 ? q8(lineValue / qty) : 0,"),
    ("conversion never found", "code_cost_alloc", "String(c.alt_uom_id) === String(alt)", "String(c.alt_uom_id) === String(alt) + 'x'"),
    ("conversion of the base UOM always", "code_cost_alloc", "const alt = line.quantity_uom || uomItem.based_uom;", "const alt = uomItem.based_uom;"),
    ("base_qty ignored", "code_cost_alloc", "q8(qty * Number(conv.base_qty))", "qty"),
]


def nodes(doc):
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str) and "type" in n:
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


blind = []
with tempfile.TemporaryDirectory() as tmp:
    for label, nid, old, new in MUTANTS:
        doc = json.load(open(BUILT, encoding="utf-8"))
        code = nodes(doc)[nid]["data"]["script"]
        assert code["code"].count(old) == 1, (label, code["code"].count(old))
        code["code"] = code["code"].replace(old, new)
        built = os.path.join(tmp, "IDA_SAVE.json")
        json.dump(doc, open(built, "w", encoding="utf-8"), ensure_ascii=False)
        text, _ = L.build([(built, ["code_node_IDAguardIn", "code_node_IDAguardStored", "code_fillback", "code_required", "code_item_ids", "code_validate",
                                    "code_idem_guard", "code_precheck_prep", "code_precheck_pick", "code_batch_plan", "code_gen_pick", "code_normalize_batch",
                                    "code_append_batch", "code_apply_batches", "code_persisted", "code_issue_prep", "code_issue_pick", "code_cost_alloc",
                                    "code_receipt_pick", "code_hu_unloads", "code_hu_pick", "code_item_txn", "code_doc_id"])], "// mutant\n", tmp)
        lifted = os.path.join(tmp, "lifted_v7.js")
        open(lifted, "w", encoding="utf-8").write(text)
        env = dict(os.environ, IDA_SAVE_BUILT=built, IDA_LIFTED_V7=lifted)
        res = {}
        for t in ("test_v7.js", "test_guard_sim.js"):
            p = subprocess.run(["node", os.path.join(HERE, t)], env=env, capture_output=True, text=True)
            res[t] = (p.stdout.strip().split("\n") or [""])[-1]
        killed = any(not v.startswith("OK") for v in res.values())
        if not killed:
            blind.append(label)
        print("%s %-44s test_v7: %-22s guard_sim: %s" % ("killed" if killed else "BLIND ", label, res["test_v7.js"][:22], res["test_guard_sim.js"]))
print("mutants: %d, killed: %d, blind: %d%s" % (len(MUTANTS), len(MUTANTS) - len(blind), len(blind), (" " + str(blind)) if blind else ""))
sys.exit(1 if blind else 0)
