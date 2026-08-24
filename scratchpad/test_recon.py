import sys, json, copy
sys.path.insert(0, "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3613c4e4-f9cd-4b13-9107-41e0cdf55a20/scratchpad")
from harness import load, run

M = load("Goods Delivery/GDheadWorkflow.json")
RECON = M["code_pick_reconcile"]["data"]["script"]["code"]

GD_ID, LINE_A, LINE_B = "GD1", "LA", "LB"

def temp(qty, bin="BIN1", batch=None, hu=None):
    e = {"material_id": "ITEM1", "location_id": bin, "gd_quantity": qty}
    if batch: e["batch_id"] = batch
    if hu: e["handling_unit_id"] = hu
    return json.dumps([e])

def gd(lines, si="None", pack=""):
    return {"id": GD_ID, "delivery_no": "GD/001", "si_status": si,
            "packing_status": pack, "table_gd": lines}

def line(lid, qty, bin="BIN1"):
    return {"id": lid, "material_id": "ITEM1", "gd_qty": qty,
            "temp_qty_data": temp(qty, bin), "invoice_qty": 0,
            "picking_status": "Completed"}

def plan(lid, planned, pending, bin="BIN1", rid=None, status="Completed"):
    return {"id": rid or ("P" + lid), "gd_id": GD_ID, "gd_line_id": lid,
            "item_code": "ITEM1", "batch_no": None, "source_bin": bin,
            "handling_unit_id": None, "qty_to_pick": planned,
            "pending_process_qty": pending, "line_status": status,
            "row_type": "item"}

_rid = [0]
def rec(lid, qty, bin="BIN1"):
    _rid[0] += 1
    return {"id": "R%d" % _rid[0], "gd_id": GD_ID, "gd_line_id": lid,
            "item_code": "ITEM1", "item_name": "Widget", "batch_no": None,
            "source_bin": bin, "target_location": bin, "handling_unit_id": None,
            "store_out_qty": qty, "picked_qty_alt": qty,
            "confirmed_at": "2026-08-01 10:00:00"}

def picking(items, records, to_status="Completed", tid="TO1"):
    return {"id": tid, "to_id": "PK/001", "to_status": to_status,
            "table_picking_items": items, "table_picking_records": records}

def fx(allData, pick, before=None):
    return {"wp": {"saveAs": "Created", "pageStatus": "Edit", "isPicking": None,
                   "confirmPickReversal": None},
            "node": {
              "code_picking_defaults": {"data": {"pickReconcileSupported": 1}},
              "code_node_IyJHrBst": {"data": {"allData": allData}},
              "get_pick_for_reconcile": {"data": {"data": pick}},
              "get_node_xTRvHWB8": {"data": {"data": before or allData}},
            }}

def show(name, r):
    plans = {p["gd_line_id"]: (p["mode"], p["picked"], p["desired"], p["newPending"])
             for p in r["linePlans"]}
    print(f"  {name:38} need={r['reconcileNeeded']} block={r['blockCreatedEdit']} "
          f"to={r['targetToStatus'] or '-':11} gd={r['targetGdPickingStatus'] or '-':11} {plans}")
    if r["blockCreatedEdit"]:
        print(f"      -> {r['blockMessage'][:110]}")
    return r

print("SCENARIOS (reconcile planning pass)")

# 1. qty up on a fully picked line -> reopen
before = gd([line(LINE_A, 100)])
after  = gd([line(LINE_A, 140)])
r = show("qty 100 -> 140, fully picked",
    run(RECON, fx(after, picking([plan(LINE_A,100,0)], [rec(LINE_A,100)]), before)))
assert r["reconcileNeeded"] == 1 and r["targetToStatus"] == "In Progress"
assert r["lineStatusOverrides"][LINE_A] == "In Progress"
assert r["linePlans"][0]["newPending"] == 40

# 2. new line added alongside a picked one
after2 = gd([line(LINE_A,100), line(LINE_B,20)])
r = show("line added, other line fully picked",
    run(RECON, fx(after2, picking([plan(LINE_A,100,0)], [rec(LINE_A,100)]), before)))
assert r["reconcileNeeded"] == 1 and r["targetToStatus"] == "In Progress"

# 3. decrease that only eats pending -> no reversal
before3 = gd([line(LINE_A, 100)])
after3  = gd([line(LINE_A, 70)])
r = show("qty 100 -> 70, only 60 picked",
    run(RECON, fx(after3, picking([plan(LINE_A,100,40)], [rec(LINE_A,60)]), before3)))
assert r["reconcileNeeded"] == 1 and r["linePlans"][0]["newPending"] == 10

# 4. decrease below picked -> reversal planned, not refused (phase 3)
after4 = gd([line(LINE_A, 20)])
r = show("qty 100 -> 20, 60 picked",
    run(RECON, fx(after4, picking([plan(LINE_A,100,40)], [rec(LINE_A,60)]), before3)))
assert r["blockCreatedEdit"] == 0 and r["hasReversals"] == 1
assert r["needsReversalConfirm"] == 1
assert r["linePlans"][0]["mode"] == "reverse"

# 5. line deleted after being picked -> full reversal planned
r = show("picked line deleted",
    run(RECON, fx(gd([]), picking([plan(LINE_A,100,0)], [rec(LINE_A,100)]), before)))
assert r["blockCreatedEdit"] == 0 and r["hasReversals"] == 1
assert r["lineStatusOverrides"][LINE_A] == "Cancelled"

# 6. invoiced -> blocked
r = show("invoiced delivery",
    run(RECON, fx(after, picking([plan(LINE_A,100,0)], [rec(LINE_A,100)]),
                  gd([line(LINE_A,100)], si="Fully Invoiced"))))
assert r["blockCreatedEdit"] == 1 and "invoiced" in r["blockMessage"]

# 7. packing doc -> blocked
r = show("packing in progress",
    run(RECON, fx(after, picking([plan(LINE_A,100,0)], [rec(LINE_A,100)]),
                  gd([line(LINE_A,100)], pack="Created"))))
assert r["blockCreatedEdit"] == 1 and "packing" in r["blockMessage"]

# 8. picking still at Created -> untouched path
r = show("picking still Created (untouched)",
    run(RECON, fx(after, picking([plan(LINE_A,100,100,status="Open")], [], to_status="Created"),
                  gd([dict(line(LINE_A,100), picking_status="Created")]))))
assert r["reconcileNeeded"] == 0 and r["blockCreatedEdit"] == 0

# 9. consolidated picking: another delivery's rows must not be read as ours
other = dict(plan(LINE_A,50,50,status="Open"), id="POTHER", gd_id="GD2", gd_line_id="LX")
r = show("consolidated picking, sibling still open",
    run(RECON, fx(after, picking([plan(LINE_A,100,0), other], [rec(LINE_A,100)]), before)))
assert r["targetToStatus"] == "In Progress"       # sibling still pending
assert r["targetGdPickingStatus"] == "In Progress" # our own line reopened
assert len(r["linePlans"]) == 1                    # sibling not classified as ours

# 10. everything already satisfied -> Completed rollup
r = show("no change, all picked",
    run(RECON, fx(before, picking([plan(LINE_A,100,0)], [rec(LINE_A,100)]), before)))
assert r["targetToStatus"] == "Completed" and r["targetGdPickingStatus"] == "Completed"

print("\nall reconcile scenarios passed")
