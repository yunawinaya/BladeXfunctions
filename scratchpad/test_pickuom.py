"""code_pick_reconcile must compare the Picking and the delivery line in the SAME unit."""
import sys, json
sys.path.insert(0, "scratchpad")
from harness import load, run

M = load("Goods Delivery/GDheadWorkflow.json")
REC = M["code_pick_reconcile"]["data"]["script"]["code"]
UNIT, BOX, ITEM = "392", "386", "IT1"
GD, LINE = "GD1", "GDL1"

def gdline(uom, qty, base, temp_qty):
    return {"id": LINE, "material_id": ITEM, "gd_qty": qty, "base_qty": base,
            "gd_order_uom_id": uom, "good_delivery_uom_id": uom,
            "temp_qty_data": json.dumps([{"material_id": ITEM, "location_id": "BIN1",
                                          "gd_quantity": temp_qty}])}

def picking(rec_uom, store_out, alt, plan_uom=None, qty_to_pick=None, to_pick_alt=None):
    plan_uom = plan_uom or rec_uom
    qty_to_pick = store_out if qty_to_pick is None else qty_to_pick
    to_pick_alt = alt if to_pick_alt is None else to_pick_alt
    return {"id": "PK1", "to_id": "PI-1", "to_status": "Completed",
            "table_picking_items": [{"id": "PI_L1", "gd_id": GD, "gd_line_id": LINE,
                "item_code": ITEM, "item_uom": plan_uom, "picking_uom": plan_uom,
                "qty_to_pick": qty_to_pick, "to_pick_alt": to_pick_alt,
                "pending_process_qty": 0, "line_status": "Completed",
                "is_serialized_item": 0, "source_bin": "BIN1"}],
            "table_picking_records": [{"id": "PR1", "gd_id": GD, "gd_line_id": LINE,
                "item_code": ITEM, "item_name": "JN-2", "item_uom": rec_uom,
                "store_out_qty": store_out, "picked_qty_alt": alt, "picked_uom": UNIT,
                "source_bin": "BIN1", "target_location": "BIN1",
                "confirmed_at": "2026-09-07 09:00:00"}]}

def rec(line, pick):
    gd = {"id": GD, "delivery_no": "GD/001", "gd_status": "Created", "table_gd": [line]}
    return run(REC, {"wp": {"saveAs": "Created", "pageStatus": "Edit", "isPicking": False,
                            "confirmPickReversal": ""},
                     "node": {"get_node_xTRvHWB8": {"data": {"data": gd}},
                              "get_pick_for_reconcile": {"data": {"data": pick}},
                              "code_node_IyJHrBst": {"data": {"allData": gd}},
                              "code_picking_defaults": {"data": {"pickReconcileSupported": 1}}}})

fails = []
def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (("  -- " + str(detail)) if not cond and detail else ""))
    if not cond: fails.append(name)

print("== regression: same unit throughout ==")
r = rec(gdline(UNIT, 10, 10, 10), picking(UNIT, 10, 10))
p = r["linePlans"][0]
check("picked stays 10", p["picked"] == 10.0, p)
check("desired 10, mode hold", p["desired"] == 10.0 and p["mode"] == "hold", p)
check("no reversals", r["hasReversals"] == 0, r["hasReversals"])

print("== the bug: line moved UNIT -> BOX (1 BOX = 10 UNIT) ==")
# delivery now wants 10 BOX (=100 base); the picking holds 10 UNIT (=10 base = 1 BOX)
r = rec(gdline(BOX, 10, 100, 10), picking(UNIT, 10, 10))
p = r["linePlans"][0]
check("picked restated to 1 BOX", p["picked"] == 1.0, p)
check("desired 10 BOX", p["desired"] == 10.0, p)
check("mode extend (was 'hold')", p["mode"] == "extend", p)
check("9 BOX still to pick", p["newPending"] == 9.0, p)
check("line NOT marked Completed", r["lineStatusOverrides"].get(LINE) != "Completed", r["lineStatusOverrides"])
check("no spurious reversal", r["hasReversals"] == 0, r["hasReversals"])

print("== the reverse: line moved BOX -> UNIT ==")
# delivery now wants 10 UNIT (=10 base); the picking holds 10 BOX (=100 base)
r = rec(gdline(UNIT, 10, 10, 10), picking(BOX, 10, 100, qty_to_pick=10, to_pick_alt=100))
check("reversal raised", r["hasReversals"] == 1, r)
adj = r["recordAdjustments"][0]
check("cut is in RECORD units (9 BOX of 10)", adj["qty"] == 9.0, adj)
check("record left holding 1 BOX", adj["store_out_qty"] == 1.0, adj)
check("its base twin follows (10)", adj["picked_qty_alt"] == 10.0, adj)

print("== safety: unknown factor falls back to identity ==")
r = rec(gdline(BOX, 10, 0, 10), picking(UNIT, 10, 10))   # base_qty missing
p = r["linePlans"][0]
check("no conversion attempted", p["picked"] == 10.0, p)

print()
print("ALL PASS" if not fails else "FAILURES: " + ", ".join(fails))
sys.exit(1 if fails else 0)
