"""patch_text_qty.py: Picking adds allocation quantities as numbers (raw-text edits, each file's own formatting kept; every edit
asserted). GD Created V2 stores some temp_qty_data quantities as text ("gd_quantity":"100", GD_BULK_PREPARE code_node_egoCivrm),
and `+=` / `s + (e.gd_quantity || 0)` then join them as text. KF 073522 PICK-FG2610-160 (10-26 16:19): the loading-bay merge
turned 5 x "100" into "100100100100100" and GD_REPLAN refused the confirm.
- PICKING_BULK_PREPARE code_node_PPmove = scratchpad/pk1c/code/move.js + prepare_move_tail.js (the builder's concatenation),
  rebuilt from the fixed sources; code_node_PPfc: the view-stock total (scratchpad/pk1d/code/view_stock.js).
- classic PICKING code_node_iES7iMKA (merge + view-stock total), code_node_AGoxWP7x (merge), code_node_MNRecompute (total).
Run from the repo root: python3 prod-hotfix/2026-10-26-picking-text-qty/patch_text_qty.py"""
import json

PREPARE = "Picking/AsyncV2/PICKING_BULK_PREPARE.json"
PICKING = "Picking/PickingProcessWorkflow.json"


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r


def esc(s):
    return json.dumps(s, ensure_ascii=False)[1:-1]


def set_code(t, w, nid, new_code):
    old = find(w, nid)["data"]["script"]["code"]
    assert t.count(esc(old)) == 1, (nid, "code not unique in the file")
    return t.replace(esc(old), esc(new_code))


MERGE = [
    ("locationBatchMap[key].gd_quantity += entry.gd_quantity || 0;",
     "locationBatchMap[key].gd_quantity = (Number(locationBatchMap[key].gd_quantity) || 0) + (Number(entry.gd_quantity) || 0);"),
    ("locationBatchMap[key].unrestricted_qty += (entry.unrestricted_qty || 0);",
     "locationBatchMap[key].unrestricted_qty = (Number(locationBatchMap[key].unrestricted_qty) || 0) + (Number(entry.unrestricted_qty) || 0);"),
    ("locationBatchMap[key].balance_quantity += (entry.balance_quantity || 0);",
     "locationBatchMap[key].balance_quantity = (Number(locationBatchMap[key].balance_quantity) || 0) + (Number(entry.balance_quantity) || 0);"),
]
TOTAL = ("active.reduce((s, e) => s + (e.gd_quantity || 0), 0)", "active.reduce((s, e) => s + (Number(e.gd_quantity) || 0), 0)")
PICKED = ("mergedPicked.reduce((s, e) => s + (e.gd_quantity || 0), 0)", "mergedPicked.reduce((s, e) => s + (Number(e.gd_quantity) || 0), 0)")
NOTE = "// GD Created V2 stores some quantities as text (\"100\"): add them as numbers"


def edit(code, pairs, nid, note_before=None):
    for old, new in pairs:
        assert code.count(old) == 1, (nid, old, code.count(old))
        if note_before == old:
            i = code.index(old)
            indent = code[code.rfind("\n", 0, i) + 1:i]
            assert indent.strip() == "", (nid, "unexpected text before the merge line")
            new = NOTE + "\n" + indent + new
        code = code.replace(old, new)
    return code


# PICKING_BULK_PREPARE
t = open(PREPARE, encoding="utf-8").read()
w = json.loads(t)
move_src = open("scratchpad/pk1c/code/move.js", encoding="utf-8").read() + "\n" + open("scratchpad/pk1c/code/prepare_move_tail.js", encoding="utf-8").read()
assert "Number(entry.gd_quantity)" in move_src and "s + (Number(e.gd_quantity) || 0)" in move_src, "fix scratchpad/pk1c/code/move.js first"
t = set_code(t, w, "code_node_PPmove", move_src)
t = set_code(t, w, "code_node_PPfc", edit(find(w, "code_node_PPfc")["data"]["script"]["code"], [TOTAL], "code_node_PPfc"))
json.loads(t)
open(PREPARE, "w", encoding="utf-8").write(t)

# classic PICKING
t = open(PICKING, encoding="utf-8").read()
w = json.loads(t)
code = lambda nid: find(w, nid)["data"]["script"]["code"]
t = set_code(t, w, "code_node_iES7iMKA", edit(code("code_node_iES7iMKA"), MERGE + [TOTAL], "code_node_iES7iMKA", note_before=MERGE[0][0]))
t = set_code(t, w, "code_node_AGoxWP7x", edit(code("code_node_AGoxWP7x"), MERGE[1:], "code_node_AGoxWP7x"))
t = set_code(t, w, "code_node_MNRecompute", edit(code("code_node_MNRecompute"), [TOTAL, PICKED], "code_node_MNRecompute"))
json.loads(t)
open(PICKING, "w", encoding="utf-8").write(t)
print("patched", PREPARE, "and", PICKING)
