"""PPtoQty.js: rebuilding an allocation must not drop a bin that was picked from.

Runs the real allocationRespectingPicked helper, sliced out of the client file,
so the test tracks the shipped code rather than a copy of it.
"""
import json, subprocess, sys

SRC = open("Picking Plan/PPtoQty.js", encoding="utf-8").read()
START = "  const allocationKey = (entry) =>"
END = "  // A reference is an object in the form model and a plain id once stored."
assert SRC.count(START) == 1 and SRC.count(END) == 1
HELPER = SRC[SRC.index(START):SRC.index(END)]

PROGRAM = """
const roundQty = (v) => Math.round((parseFloat(v) || 0) * 1000) / 1000;
const cases = JSON.parse(process.argv[1]);
const out = cases.map(({ currentRow, quantity, fresh }) => {
%s
  return allocationRespectingPicked(fresh);
});
console.log(JSON.stringify(out));
""" % HELPER

def alloc(entries):
    return json.dumps([
        {"location_id": b, "batch_id": t, "handling_unit_id": h, "to_quantity": q}
        for b, t, h, q in entries
    ])

def entry(bin_, batch="", hu=""):
    return {"location_id": bin_, "batch_id": batch, "handling_unit_id": hu,
            "unrestricted_qty": 999, "material_id": "ITEM_A"}

A, B = "BIN_A", "BIN_B"

cases = [
    ("no picked stock -> single fresh entry",
     {"picked_temp_qty_data": ""}, 8, entry(A)),
    ("picked at the same bin -> one merged entry",
     {"picked_temp_qty_data": alloc([(A, "", "", 5)])}, 8, entry(A)),
    ("picked elsewhere -> floor kept, remainder on the new bin",
     {"picked_temp_qty_data": alloc([(A, "", "", 5)])}, 8, entry(B)),
    ("quantity equals what is picked elsewhere -> floor only",
     {"picked_temp_qty_data": alloc([(A, "", "", 5)])}, 5, entry(B)),
    ("quantity below what is picked -> floor kept, nothing invented",
     {"picked_temp_qty_data": alloc([(A, "", "", 5)])}, 3, entry(B)),
    ("two picked bins -> both kept",
     {"picked_temp_qty_data": alloc([(A, "", "", 3), (B, "", "", 2)])}, 9, entry(A)),
    ("picked batch differs from the fresh batch",
     {"picked_temp_qty_data": alloc([(A, "T1", "", 5)])}, 8, entry(A, "T2")),
    ("unparseable picked data -> falls back to the fresh entry",
     {"picked_temp_qty_data": "{not json"}, 8, entry(A)),
]

# The real temporaryData always carries the full requested quantity.
payload = [{"currentRow": c[1], "quantity": c[2],
            "fresh": dict(c[3], to_quantity=c[2])} for c in cases]
res = json.loads(subprocess.run(
    ["node", "-e", PROGRAM, "--", json.dumps(payload)],
    capture_output=True, text=True, check=True).stdout)

def key(e):
    return f"{e.get('location_id') or ''}|{e.get('batch_id') or ''}|{e.get('handling_unit_id') or ''}"

print("SCENARIOS (PPtoQty allocation rebuild)")
fail = 0
for (name, row, qty, fresh), r in zip(cases, res):
    got = {key(e): e["to_quantity"] for e in r["allocation"]}
    total = round(sum(got.values()), 3)
    print(f"  {name:56} total={total:<7} preserved={r['preserved']:<5} {got}")

    # Every bin that was picked from must still be allocated at least what it gave.
    picked = json.loads(row["picked_temp_qty_data"]) if row["picked_temp_qty_data"].startswith("[") else []
    for e in picked:
        k = key(e)
        if got.get(k, 0) < e["to_quantity"]:
            print(f"      FAIL picked bin {k} covered {got.get(k, 0)} < {e['to_quantity']}")
            fail += 1
    # The total is the requested quantity, unless that is below what is already picked.
    want = max(qty, round(sum(e["to_quantity"] for e in picked), 3))
    if total != want:
        print(f"      FAIL total {total} != expected {want}")
        fail += 1

assert not fail, f"{fail} assertion(s) failed"
assert len(json.loads(json.dumps(res[0]["allocation"]))) == 1, "clean line must stay a single entry"
assert res[2]["preserved"] == 5 and len(res[2]["allocation"]) == 2
assert len(res[4]["allocation"]) == 1, "below-picked must not invent a second entry"
print("\nall PP allocation scenarios passed")
