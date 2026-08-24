import sys, json
sys.path.insert(0, "scratchpad")
from harness import load, run

M = load("Goods Delivery/GDheadWorkflow.json")
RECON = M["code_pick_reconcile"]["data"]["script"]["code"]
PROD  = M["code_node_o35eZx2c"]["data"]["script"]["code"]
GD, LA = "GD1", "LA"

def gline(lid, q, item, name):
    return {"id": lid, "material_id": item, "material_name": name,
            "gd_material_desc": "", "gd_qty": q,
            "temp_qty_data": json.dumps([{"material_id": item, "location_id": "BIN1",
                                          "gd_quantity": q}]),
            "gd_order_uom_id": "UOM1", "so_line_item_id": "SOL1", "line_so_id": "SO1",
            "line_so_no": "SO/001", "packing_uom": "", "packing_conversion": 1,
            "weight_conversion": 0, "invoice_qty": 0, "picking_status": "Completed"}

def gd(lines):
    return {"id": GD, "delivery_no": "GD/001", "si_status": "None", "packing_status": "",
            "organization_id": "ORG1", "plant_id": "PL1", "customer_name": "C1",
            "gd_ref_doc": "", "assigned_to": ["U1"], "project_id": "",
            "gd_delivery_method": "Self Pickup", "table_gd": lines}

def plan(item):
    return {"id": "ROW_A", "gd_id": GD, "gd_line_id": LA, "item_code": item,
            "item_name": "Item " + item, "batch_no": None, "source_bin": "BIN1",
            "handling_unit_id": None, "qty_to_pick": 5, "pending_process_qty": 0,
            "line_status": "Completed", "row_type": "item", "is_serialized_item": 0}

def rec(item):
    return {"id": "R1", "gd_id": GD, "gd_line_id": LA, "item_code": item,
            "item_name": "Item " + item, "batch_no": None, "source_bin": "BIN1",
            "target_location": "BIN1", "handling_unit_id": None,
            "store_out_qty": 5, "picked_qty_alt": 5,
            "confirmed_at": "2026-08-01 10:00:00"}

pick = {"id": "TO1", "to_id": "PK/001", "to_status": "Completed", "is_processing": 0,
        "table_picking_items": [plan("ITEM_A")], "table_picking_records": [rec("ITEM_A")]}

before = gd([gline(LA, 5, "ITEM_A", "Widget A")])
after  = gd([gline(LA, 5, "ITEM_B", "Widget B")])   # same line, DIFFERENT item

r = run(RECON, {"wp": {"saveAs": "Created", "pageStatus": "Edit", "isPicking": None,
                       "confirmPickReversal": None},
    "node": {"code_picking_defaults": {"data": {"pickReconcileSupported": 1}},
             "code_node_IyJHrBst": {"data": {"allData": after}},
             "get_pick_for_reconcile": {"data": {"data": pick}},
             "get_node_xTRvHWB8": {"data": {"data": before}}}})

print("ITEM SWAP on a fully-picked line (A x5 picked -> line now wants B x5)")
print(f"  hasReversals        = {r['hasReversals']}      <- 5 of ITEM_A are still picked")
print(f"  needsReversalConfirm= {r['needsReversalConfirm']}")
print(f"  linePlans           = {[(p['mode'], p['picked'], p['desired'], p['newPending']) for p in r['linePlans']]}")
print(f"  targetToStatus      = {r['targetToStatus']}")

o = run(PROD, {"wp": {"pageStatus": "Edit"},
    "node": {"code_node_Pgtw6zFL": {"data": {"gdDataFull": after}},
             "get_node_zna6o03F": {"data": {"data": {"id": "FMT1"}}},
             "code_pick_reconcile": {"data": r},
             "get_pick_for_reconcile": {"data": {"data": pick}}}})
rows = [x for x in o["transferOrderData"]["table_picking_items"] if x.get("row_type") != "header"]
recs = o["transferOrderData"]["table_picking_records"]
print("\n  resulting picking plan rows:")
for x in rows:
    print(f"    item={x.get('item_code'):8} id={str(x.get('id')):8} plan={x.get('qty_to_pick')} "
          f"pend={x.get('pending_process_qty')} {x.get('line_status')}")
print("  resulting pick records:", [(x.get("item_code"), x.get("store_out_qty")) for x in recs] or "(none — old item fully reversed)")

# the swap decomposes into a reversal of the old item and a fresh row for the new
assert r["hasReversals"] == 1, "swapping the item must reverse the old item's picks"
assert r["needsReversalConfirm"] == 1, "and must ask before doing it"
modes = sorted(p["mode"] for p in r["linePlans"])
assert modes == ["rebuild", "reverse"], modes
rev = [p for p in r["linePlans"] if p["mode"] == "reverse"][0]
new = [p for p in r["linePlans"] if p["mode"] == "rebuild"][0]
assert rev["item_code"] == "ITEM_A" and rev["desired"] == 0
assert new["item_code"] == "ITEM_B" and new["picked"] == 0 and new["newPending"] == 5
assert r["reversals"][0]["item_code"] == "ITEM_A" and r["reversals"][0]["qty"] == 5
assert r["lineStatusOverrides"][LA] == "Created", r["lineStatusOverrides"]
assert r["targetToStatus"] == "Created"

# the new item must NOT inherit the old item's progress
assert len(rows) == 1 and rows[0]["item_code"] == "ITEM_B"
assert rows[0]["pending_process_qty"] == 5 and rows[0]["line_status"] == "Open"
assert not rows[0].get("id"), "the new item is a new row, not the old one renamed"
assert recs == [], "the old item's pick record must be dropped, not left dangling"

print("\nitem-swap scenario passed")
