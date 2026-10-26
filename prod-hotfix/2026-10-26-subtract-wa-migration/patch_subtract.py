"""patch_subtract.py <base.json> <out.json>: SUBTRACT_INVENTORY_NEW, the WA price and the WA deduction use what the costing
migration wrote in the same run (raw-text edits, the file's own formatting kept; each edit asserted).
Why: search_node_7bvv7f8g reads the item's WA row BEFORE the migration block. When the migration then writes it, the two
readers act on the stale lookup:
- a FIFO-only WA item (code_node_oz7GGSQA + add_node_yOylfPVp add the WA row): price 0, and process WA Data throws "No
  Weighted Average costing record" - the issue fails once per item and plant (Kenhin 528521: 10-23 x2, 10-26 V131, each
  stranding an auto-complete Picking);
- FIFO merged into an existing WA row (code_node_YqMfJIMz + update_node_aw5PNoxu): the pre-merge price, and the WA
  quantity written back as pre-merge minus the issue, so the merged FIFO quantity is lost.
What: code_node_7l9u4Zca prices from the migrated row; code_node_fVEv7HuP and its classic-lock copy deduct from the merged
row, or from the row the migration added (its id from add_node_yOylfPVp). Nodes of a branch that did not run read null.
A true no-record case still throws the named error."""
import json
import sys

base, out = sys.argv[1:3]
t = open(base, encoding="utf-8").read()
w = json.loads(t)


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


def replace_code(nid, old, new):
    global t
    code = find(w, nid)["data"]["script"]["code"]
    assert code.count(old) == 1, (nid, "anchor not unique")
    new_code = code.replace(old, new)
    old_esc, new_esc = json.dumps(code, ensure_ascii=False)[1:-1], json.dumps(new_code, ensure_ascii=False)[1:-1]
    return old_esc, new_esc


# 1. the WA unit price
price_old = """

return {
  calculatedUnitPrice: calculatedUnitPrice
}"""
price_new = """

// The costing migration above may have just written this item's WA row (FIFO merged into it, or added for a FIFO-only
// item) after the WA lookup was read: price from what it wrote. A node of a branch that did not run reads null.
const migratedWa = [{{node:code_node_YqMfJIMz.data}}, {{node:code_node_oz7GGSQA.data}}]
  .find((m) => m && m.targetCosting === "WA" && m.targetRecord);
if (migratedWa) {
  calculatedUnitPrice = q8(migratedWa.targetRecord.wa_cost_price || 0);
}

return {
  calculatedUnitPrice: calculatedUnitPrice
}"""
o, n = replace_code("code_node_7l9u4Zca", price_old, price_new)
assert t.count(o) == 1
t = t.replace(o, n)

# 2. the WA deduction, in code_node_fVEv7HuP and its classic-lock copy (identical scripts: one replacement covers both)
ded_old = """const waDoc = waData[0];
"""
ded_new = """let waDoc = waData[0];

// The costing migration above may have just written this item's WA row after the WA lookup was read: deduct from the
// merged row (FIFO merged into it), or from the row it added for a FIFO-only item. A node of a branch that did not run
// reads null.
const migratedMerge = {{node:code_node_YqMfJIMz.data}};
const migratedAdd = {{node:code_node_oz7GGSQA.data}};
const addedWaRows = {{node:add_node_yOylfPVp.data}};
if (migratedMerge && migratedMerge.targetCosting === "WA" && migratedMerge.targetRecord && migratedMerge.targetRecord.id) {
  waDoc = { id: migratedMerge.targetRecord.id, wa_quantity: migratedMerge.targetRecord.wa_quantity };
} else if (migratedAdd && migratedAdd.targetCosting === "WA" && migratedAdd.targetRecord &&
    Array.isArray(addedWaRows) && addedWaRows[0] && addedWaRows[0].id) {
  waDoc = { id: addedWaRows[0].id, wa_quantity: migratedAdd.targetRecord.wa_quantity };
}
"""
assert find(w, "code_node_fVEv7HuP")["data"]["script"]["code"] == find(w, "code_node_fVEv7HuPCLp")["data"]["script"]["code"]
o, n = replace_code("code_node_fVEv7HuP", ded_old, ded_new)
assert t.count(o) == 2, t.count(o)
t = t.replace(o, n)

w2 = json.loads(t)
for nid in ("code_node_7l9u4Zca", "code_node_fVEv7HuP", "code_node_fVEv7HuPCLp"):
    assert "code_node_oz7GGSQA.data}}" in find(w2, nid)["data"]["script"]["code"], nid
open(out, "w", encoding="utf-8").write(t)
print("patched ->", out)
