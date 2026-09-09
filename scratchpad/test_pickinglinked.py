"""An SO edit must rewrite a Picking that is still at Created, even when auto_trigger_to = 0.

Mirrors prod GD/20260909/613 / PI-20260909-0081: item swapped on the SO, the GD updated,
the Picking left naming the old item because nothing opened the producer's branch.
"""
import sys, json
sys.path.insert(0, "scratchpad")
from harness import load, run

M = load("Goods Delivery/GDheadWorkflow.json")
REC  = M["code_pick_reconcile"]["data"]["script"]["code"]
PROD = M["code_node_o35eZx2c"]["data"]["script"]["code"]

GD, LINE, PK = "GD1", "GDL1", "PK1"
OLD, NEW, UOM = "ITEM_OLD", "ITEM_NEW", "UOM1"

def gdline(item):
    return {"id": LINE, "material_id": item, "material_name": "n", "gd_material_desc": "",
            "gd_qty": 3000, "base_qty": 3000, "gd_order_uom_id": UOM,
            "good_delivery_uom_id": UOM, "so_line_item_id": "SOL1", "line_so_id": "SO1",
            "line_so_no": "SO-1", "packing_uom": "", "packing_conversion": 1,
            "weight_conversion": 0, "invoice_qty": 0, "picking_status": "Created",
            "temp_qty_data": json.dumps([{"material_id": item, "location_id": "BIN1",
                                          "gd_quantity": 3000}])}

def gd(item, **kw):
    d = {"id": GD, "delivery_no": "GD/613", "gd_status": "Created", "plant_id": "PL1",
         "organization_id": "ORG1", "si_status": "None", "packing_status": "",
         "picking_status": "Created", "assigned_to": [], "table_gd": [gdline(item)]}
    d.update(kw); return d

def picking(to_status="Created", item=OLD, other_gd_rows=True):
    rows = [{"id": "PI_L1", "gd_id": GD, "gd_line_id": LINE, "item_code": item,
             "item_uom": UOM, "picking_uom": UOM, "qty_to_pick": 3000,
             "pending_process_qty": 3000, "line_status": "Open", "row_type": "item",
             "is_serialized_item": 0, "source_bin": "BIN1", "so_no": "SO-1"}]
    if other_gd_rows:   # a shared Picking: another delivery's row must survive untouched
        rows.append({"id": "PI_L9", "gd_id": "GD9", "gd_line_id": "GDL9",
                     "item_code": "ITEM_X", "item_uom": UOM, "qty_to_pick": 20,
                     "pending_process_qty": 20, "line_status": "Open",
                     "row_type": "item", "is_serialized_item": 0, "source_bin": "BIN2",
                     "so_no": "SO-9"})
    return {"id": PK, "to_id": "PI-0081", "to_status": to_status, "is_processing": 0,
            "table_picking_items": rows, "table_picking_records": []}

def rec(before, after_gd, pick, saveAs="Created", pageStatus="Edit", supported=1):
    return run(REC, {"wp": {"saveAs": saveAs, "pageStatus": pageStatus,
                            "isPicking": None, "confirmPickReversal": ""},
                     "node": {"get_node_xTRvHWB8": {"data": {"data": before}},
                              "get_pick_for_reconcile": {"data": {"data": pick}},
                              "code_node_IyJHrBst": {"data": {"allData": after_gd}},
                              "code_picking_defaults": {"data": {"pickReconcileSupported": supported}}}})

fails = []
def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (("  -- " + str(detail)) if not cond and detail else ""))
    if not cond: fails.append(name)

print("== the prod case: Picking untouched at Created, item swapped ==")
r = rec(gd(OLD), gd(NEW), picking())
check("pickingLinked = 1 (opens the producer branch)", r["pickingLinked"] == 1, r.get("pickingLinked"))
check("reconcileNeeded stays 0 (nothing picked)", r["reconcileNeeded"] == 0, r.get("reconcileNeeded"))
check("no reversal invented", r["hasReversals"] == 0 and r["recordAdjustments"] == [], r)
check("no line status forced", r["lineStatusOverrides"] == {}, r["lineStatusOverrides"])

print("== safety: no Picking at all -> branch stays shut ==")
r = rec(gd(OLD), gd(NEW), None)
check("pickingLinked = 0", r["pickingLinked"] == 0, r.get("pickingLinked"))
r = rec(gd(OLD), gd(NEW), picking(), saveAs="Completed")
check("non-Created save -> 0", r["pickingLinked"] == 0, r.get("pickingLinked"))
r = rec(gd(OLD), gd(NEW), picking(), pageStatus="Add")
check("Add (not Edit) -> 0", r["pickingLinked"] == 0, r.get("pickingLinked"))
r = rec(gd(OLD), gd(NEW), picking(), supported=0)
check("unsupported setup -> 0", r["pickingLinked"] == 0, r.get("pickingLinked"))

print("== regression: a started Picking still reconciles ==")
r = rec(gd(OLD), gd(NEW), picking(to_status="In Progress"))
check("reconcileNeeded = 1", r["reconcileNeeded"] == 1, r.get("reconcileNeeded"))
check("pickingLinked = 1", r["pickingLinked"] == 1, r.get("pickingLinked"))

print("== a refused save must not open the branch ==")
r = rec(gd(OLD, si_status="Fully Invoiced"), gd(NEW, si_status="Fully Invoiced"),
        picking(to_status="In Progress"))
check("blocked", r["blockCreatedEdit"] == 1, r)
check("pickingLinked = 0", r["pickingLinked"] == 0, r.get("pickingLinked"))

print("== producer rebuilds the plan onto the new item ==")
plan = rec(gd(OLD), gd(NEW), picking())
after = gd(NEW)
out = run(PROD, {"wp": {"pageStatus": "Edit"},
                 "node": {"code_node_Pgtw6zFL": {"data": {"gdDataFull": after}},
                          "code_pick_reconcile": {"data": plan},
                          "get_node_zna6o03F": {"data": {"data": {"id": "RULE1"}}},
                          "get_pick_for_reconcile": {"data": {"data": picking()}}}})
check("updates the existing Picking (no second one)", out["isUpdate"] == 1, out.get("isUpdate"))
check("targets PI-0081", str(out.get("existingTOId")) == PK, out.get("existingTOId"))
rows = out["transferOrderData"]["table_picking_items"]
mine = [r for r in rows if str(r.get("gd_id")) == GD]
check("our row now names the NEW item", len(mine) == 1 and mine[0]["item_code"] == NEW,
      [r.get("item_code") for r in mine])
check("full qty still to pick", mine and mine[0]["pending_process_qty"] == 3000, mine)
check("row is Open", mine and mine[0]["line_status"] == "Open", mine)
other = [r for r in rows if str(r.get("gd_id")) == "GD9"]
check("other delivery's row survives untouched",
      len(other) == 1 and other[0]["item_code"] == "ITEM_X", other)
check("Picking status not demoted", out["transferOrderData"]["to_status"] == "Created",
      out["transferOrderData"]["to_status"])

print()
print("ALL PASS" if not fails else "FAILURES: " + ", ".join(fails))
sys.exit(1 if fails else 0)
