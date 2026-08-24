import sys, json
sys.path.insert(0, "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3613c4e4-f9cd-4b13-9107-41e0cdf55a20/scratchpad")
from harness import load, run

M = load("Goods Delivery/GDheadWorkflow.json")
PROD = M["code_node_o35eZx2c"]["data"]["script"]["code"]
RECON = M["code_pick_reconcile"]["data"]["script"]["code"]

GD_ID, LA = "GD1", "LA"

def temp(qty, bin="BIN1"):
    return json.dumps([{"material_id": "ITEM1", "location_id": bin, "gd_quantity": qty}])

def gline(lid, qty, bin="BIN1"):
    return {"id": lid, "material_id": "ITEM1", "material_name": "Widget",
            "gd_material_desc": "", "gd_qty": qty, "temp_qty_data": temp(qty, bin),
            "gd_order_uom_id": "UOM1", "so_line_item_id": "SOL1", "line_so_id": "SO1",
            "line_so_no": "SO/001", "packing_uom": "", "packing_conversion": 1,
            "weight_conversion": 0, "invoice_qty": 0, "picking_status": "Completed"}

def gdfull(lines):
    return {"id": GD_ID, "organization_id": "ORG1", "plant_id": "PL1",
            "delivery_no": "GD/001", "customer_name": "CUST1", "gd_ref_doc": "",
            "assigned_to": ["U1"], "project_id": "", "gd_delivery_method": "Self Pickup",
            "si_status": "None", "packing_status": "", "table_gd": lines}

def plan(lid, planned, pending, rid, gid=GD_ID, bin="BIN1"):
    return {"id": rid, "gd_id": gid, "gd_line_id": lid, "item_code": "ITEM1",
            "item_name": "Widget", "batch_no": None, "source_bin": bin,
            "handling_unit_id": None, "qty_to_pick": planned,
            "pending_process_qty": pending, "line_status": "Completed", "row_type": "item"}

def rec(lid, qty, bin="BIN1"):
    return {"gd_id": GD_ID, "gd_line_id": lid, "item_code": "ITEM1", "batch_no": None,
            "source_bin": bin, "target_location": bin, "handling_unit_id": None,
            "store_out_qty": qty}

def reconcile(after, pick, before):
    return run(RECON, {"wp": {"saveAs": "Created", "pageStatus": "Edit", "isPicking": None},
        "node": {"code_picking_defaults": {"data": {"pickReconcileSupported": 1}},
                 "code_node_IyJHrBst": {"data": {"allData": after}},
                 "get_pick_for_reconcile": {"data": {"data": pick}},
                 "get_node_xTRvHWB8": {"data": {"data": before}}}})

def produce(after, pick, plan_out):
    return run(PROD, {"wp": {"pageStatus": "Edit"},
        "node": {"code_node_Pgtw6zFL": {"data": {"gdDataFull": after}},
                 "get_node_zna6o03F": {"data": {"data": {"id": "FMT1"}}},
                 "code_pick_reconcile": {"data": plan_out},
                 "get_pick_for_reconcile": {"data": {"data": pick}}}})

def rows(out):
    return [r for r in out["transferOrderData"]["table_picking_items"]
            if r.get("row_type") != "header"]

def show(name, rs):
    print(f"  {name}")
    for r in rs:
        print(f"      id={str(r.get('id')):8} gd={r.get('gd_id'):5} line={str(r.get('gd_line_id')):6} "
              f"plan={r.get('qty_to_pick')} pend={r.get('pending_process_qty')} {r.get('line_status')}")

print("SCENARIOS (producer merge)")

# --- 1. qty up: row keeps its id, delta becomes pending -----------------
before = gdfull([gline(LA, 100)]); after = gdfull([gline(LA, 140)])
pick = {"id": "TO1", "to_id": "PK/001", "to_status": "Completed",
        "table_picking_items": [plan(LA, 100, 0, "ROW_A")],
        "table_picking_records": [rec(LA, 100)]}
p = reconcile(after, pick, before)
out = produce(after, pick, p)
rs = rows(out); show("qty 100 -> 140", rs)
assert len(rs) == 1
assert rs[0]["id"] == "ROW_A", "row id must be preserved"
assert rs[0]["qty_to_pick"] == 140 and rs[0]["pending_process_qty"] == 40
assert rs[0]["line_status"] == "In Progress"
assert out["transferOrderData"]["to_status"] == "In Progress", "picking must reopen"
assert out["pickingStatus"] == "In Progress"

# --- 2. consolidated picking: sibling delivery's row carried through ----
sibling = plan("LX", 50, 50, "ROW_X", gid="GD2")
sibling["line_status"] = "Open"
pick2 = {"id": "TO1", "to_id": "PK/001", "to_status": "In Progress",
         "table_picking_items": [plan(LA, 100, 0, "ROW_A"), sibling],
         "table_picking_records": [rec(LA, 100)]}
p2 = reconcile(after, pick2, before)
out2 = produce(after, pick2, p2)
rs2 = rows(out2); show("consolidated picking", rs2)
ids = {r["id"] for r in rs2}
assert "ROW_X" in ids, "sibling delivery's row must survive"
assert "ROW_A" in ids
sib = [r for r in rs2 if r["id"] == "ROW_X"][0]
assert sib["qty_to_pick"] == 50 and sib["pending_process_qty"] == 50 and sib["gd_id"] == "GD2"

# --- 3. re-save with no change: ids stable, nothing re-created ----------
p3 = reconcile(before, pick, before)
out3 = produce(before, pick, p3)
rs3 = rows(out3); show("re-save unchanged", rs3)
assert rs3[0]["id"] == "ROW_A" and rs3[0]["pending_process_qty"] == 0
assert rs3[0]["line_status"] == "Completed"
assert out3["transferOrderData"]["to_status"] == "Completed"

# --- 4. picking at Created, nothing picked: ids still preserved ---------
pick4 = {"id": "TO1", "to_id": "PK/001", "to_status": "Created",
         "table_picking_items": [plan(LA, 100, 100, "ROW_A")],
         "table_picking_records": []}
pick4["table_picking_items"][0]["line_status"] = "Open"
beforeC = gdfull([dict(gline(LA, 100), picking_status="Created")])
p4 = reconcile(gdfull([gline(LA, 150)]), pick4, beforeC)
out4 = produce(gdfull([gline(LA, 150)]), pick4, p4)
rs4 = rows(out4); show("Created picking, qty 100 -> 150", rs4)
assert p4["reconcileNeeded"] == 0, "untouched path"
assert rs4[0]["id"] == "ROW_A", "id preserved even on the untouched path"
assert rs4[0]["qty_to_pick"] == 150 and rs4[0]["pending_process_qty"] == 150
assert out4["transferOrderData"]["to_status"] == "Created"

# --- 5. new line: emitted without an id so the platform inserts it ------
after5 = gdfull([gline(LA, 100), gline("LB", 20)])
p5 = reconcile(after5, pick, before)
out5 = produce(after5, pick, p5)
rs5 = rows(out5); show("line added", rs5)
newrow = [r for r in rs5 if r["gd_line_id"] == "LB"][0]
assert "id" not in newrow or not newrow.get("id"), "a new row must carry no id"
assert newrow["pending_process_qty"] == 20 and newrow["line_status"] == "Open"
assert [r for r in rs5 if r["gd_line_id"] == LA][0]["id"] == "ROW_A"

# --- 6. decimals stay clean through the subtraction ---------------------
beforeD = gdfull([gline(LA, 1.6)]); afterD = gdfull([gline(LA, 2.9)])
pickD = {"id": "TO1", "to_id": "PK/001", "to_status": "Completed",
         "table_picking_items": [plan(LA, 1.6, 0, "ROW_A")],
         "table_picking_records": [rec(LA, 1.6)]}
pD = reconcile(afterD, pickD, beforeD)
outD = produce(afterD, pickD, pD)
rsD = rows(outD); show("decimal 1.6 -> 2.9", rsD)
assert rsD[0]["pending_process_qty"] == 1.3, f"got {rsD[0]['pending_process_qty']}"
print(f"      raw float would have been {2.9 - 1.6!r}")

# --- 7. reconcileNeeded=1 must ALWAYS mean UPDATE, never ADD -----------
# if_9xhwui06 now lets a reconcile through even when auto_trigger_to = 0, which is
# the flag meaning "do not auto-create a Picking for this org". That is only safe
# because reconcileNeeded=1 implies get_pick_for_reconcile found one, so the
# producer can only ever take the update branch.
cases = [
    ("qty up",        gdfull([gline(LA, 140)]), pick),
    ("line added",    gdfull([gline(LA, 100), gline("LB", 20)]), pick),
]
for label, aft, pk in cases:
    pl = reconcile(aft, pk, before)
    o = produce(aft, pk, pl)
    assert pl["reconcileNeeded"] == 1
    assert o["isUpdate"] == 1, f"{label}: reconcile must never create a Picking"
    assert o["existingTOId"] == "TO1"
print(f"  reconcileNeeded=1 -> isUpdate=1 in {len(cases)} cases (never ADD)")

# and with no picking at all, the reconcile stands down entirely
pl_none = reconcile(gdfull([gline(LA, 140)]), None, before)
assert pl_none["reconcileNeeded"] == 0
o_none = produce(gdfull([gline(LA, 140)]), None, pl_none)
assert o_none["isUpdate"] == 0
print("  no picking          -> reconcileNeeded=0, isUpdate=0 (create path untouched)")

print("\nall producer scenarios passed")
