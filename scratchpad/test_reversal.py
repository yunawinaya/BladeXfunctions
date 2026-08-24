import sys, json
sys.path.insert(0, "scratchpad")
from harness import load, run

M = load("Goods Delivery/GDheadWorkflow.json")
RECON = M["code_pick_reconcile"]["data"]["script"]["code"]
MSG   = M["code_pick_reversal_msg"]["data"]["script"]["code"]
PROD  = M["code_node_o35eZx2c"]["data"]["script"]["code"]

GD, LA = "GD1", "LA"

def temp(q, bin="BIN1"):
    return json.dumps([{"material_id": "ITEM1", "location_id": bin, "gd_quantity": q}])

def gline(lid, q, bin="BIN1"):
    return {"id": lid, "material_id": "ITEM1", "material_name": "Widget",
            "gd_material_desc": "", "gd_qty": q, "temp_qty_data": temp(q, bin),
            "gd_order_uom_id": "UOM1", "so_line_item_id": "SOL1", "line_so_id": "SO1",
            "line_so_no": "SO/001", "packing_uom": "", "packing_conversion": 1,
            "weight_conversion": 0, "invoice_qty": 0, "picking_status": "Completed"}

def gd(lines, si="None", pack=""):
    return {"id": GD, "delivery_no": "GD/001", "si_status": si, "packing_status": pack,
            "organization_id": "ORG1", "plant_id": "PL1", "customer_name": "C1",
            "gd_ref_doc": "", "assigned_to": ["U1"], "project_id": "",
            "gd_delivery_method": "Self Pickup", "table_gd": lines}

def plan(lid, planned, pending, rid, bin="BIN1", gid=GD):
    return {"id": rid, "gd_id": gid, "gd_line_id": lid, "item_code": "ITEM1",
            "item_name": "Widget", "batch_no": None, "source_bin": bin,
            "handling_unit_id": None, "qty_to_pick": planned,
            "pending_process_qty": pending, "line_status": "Completed", "row_type": "item"}

def rec(rid, lid, q, src="BIN1", tgt=None, at="2026-08-01 10:00:00"):
    return {"id": rid, "gd_id": GD, "gd_line_id": lid, "item_code": "ITEM1",
            "item_name": "Widget", "batch_no": None, "source_bin": src,
            "target_location": tgt or src, "handling_unit_id": None,
            "store_out_qty": q, "picked_qty_alt": q, "confirmed_at": at}

def pick(items, records, to_status="Completed", processing=0):
    return {"id": "TO1", "to_id": "PK/001", "to_status": to_status,
            "is_processing": processing,
            "table_picking_items": items, "table_picking_records": records}

def reconcile(after, p, before, confirm=None):
    return run(RECON, {"wp": {"saveAs": "Created", "pageStatus": "Edit",
                              "isPicking": None, "confirmPickReversal": confirm},
        "node": {"code_picking_defaults": {"data": {"pickReconcileSupported": 1}},
                 "code_node_IyJHrBst": {"data": {"allData": after}},
                 "get_pick_for_reconcile": {"data": {"data": p}},
                 "get_node_xTRvHWB8": {"data": {"data": before}}}})

def message(planout, bins):
    return run(MSG, {"wp": {}, "node": {
        "code_pick_reconcile": {"data": planout},
        "search_bin_names": {"data": {"data": bins}}}})

def produce(after, p, planout):
    return run(PROD, {"wp": {"pageStatus": "Edit"},
        "node": {"code_node_Pgtw6zFL": {"data": {"gdDataFull": after}},
                 "get_node_zna6o03F": {"data": {"data": {"id": "FMT1"}}},
                 "code_pick_reconcile": {"data": planout},
                 "get_pick_for_reconcile": {"data": {"data": p}}}})

print("SCENARIOS (phase 3 reversal)")
before = gd([gline(LA, 100)])

# 1. reduce below picked -> plan a reversal, ask first
p1 = pick([plan(LA, 100, 0, "ROW_A")],
          [rec("R1", LA, 60, at="2026-08-01 09:00:00"),
           rec("R2", LA, 40, at="2026-08-02 09:00:00")])
r1 = reconcile(gd([gline(LA, 70)]), p1, before)
print(f"  qty 100 -> 70 (100 picked): hasRev={r1['hasReversals']} confirm={r1['needsReversalConfirm']} "
      f"reversals={[(x['qty'], x['return_to']) for x in r1['reversals']]} adj={[(a['id'],a['store_out_qty'],a['drop']) for a in r1['recordAdjustments']]}")
assert r1["hasReversals"] == 1 and r1["needsReversalConfirm"] == 1
assert r1["reversals"][0]["qty"] == 30           # newest record trimmed first
assert r1["recordAdjustments"][0]["id"] == "R2" and r1["recordAdjustments"][0]["store_out_qty"] == 10
assert r1["linePlans"][0]["mode"] == "reverse" and r1["linePlans"][0]["newPending"] == 0

# 2. already confirmed -> no prompt, still reverses
r2 = reconcile(gd([gline(LA, 70)]), p1, before, confirm="Yes")
print(f"  same, confirmed:          hasRev={r2['hasReversals']} confirm={r2['needsReversalConfirm']}")
assert r2["hasReversals"] == 1 and r2["needsReversalConfirm"] == 0

# 3. line deleted entirely -> full reversal, both records dropped
r3 = reconcile(gd([]), p1, before, confirm="Yes")
drops = [a for a in r3["recordAdjustments"] if a["drop"] == 1]
print(f"  line deleted:             reversed={sum(x['qty'] for x in r3['reversals'])} dropped={len(drops)} "
      f"status={r3['lineStatusOverrides']}")
assert sum(x["qty"] for x in r3["reversals"]) == 100 and len(drops) == 2
assert r3["lineStatusOverrides"][LA] == "Cancelled"

# 4. force-completed line: plan says picked but no records exist -> refuse
p4 = pick([plan(LA, 100, 0, "ROW_A")], [])
r4 = reconcile(gd([gline(LA, 20)]), p4, before)
print(f"  force-completed, no records: block={r4['blockCreatedEdit']}")
assert r4["blockCreatedEdit"] == 1 and "force-completed" in r4["blockMessage"]

# 5. picker mid-confirm
r5 = reconcile(gd([gline(LA, 140)]), pick([plan(LA,100,0,"ROW_A")], [rec("R1",LA,100)], processing=1), before)
print(f"  is_processing=1:          block={r5['blockCreatedEdit']} -> {r5['blockMessage'][:52]}")
assert r5["blockCreatedEdit"] == 1 and "device" in r5["blockMessage"]

# 6. loading bay: stock sits somewhere else, so say so
pbay = pick([plan(LA, 100, 0, "ROW_A")], [rec("R1", LA, 100, src="BIN1", tgt="BAY1")])
r6 = reconcile(gd([gline(LA, 60)]), pbay, before)
m6 = message(r6, [{"id": "BIN1", "bin_location_combine": "A-01-02"},
                  {"id": "BAY1", "bin_location_combine": "LOADING-BAY-1"}])
print("  loading bay message:")
for l in m6["confirmMessage"].splitlines():
    if l.strip(): print("      " + l)
assert "LOADING-BAY-1" in m6["confirmMessage"] and "A-01-02" in m6["confirmMessage"]
assert "move it back" in m6["confirmMessage"]

# 7. plain pick: no physical move implied
m7 = message(r1, [{"id": "BIN1", "bin_location_combine": "A-01-02"}])
print("  plain message:            " + [l for l in m7["confirmMessage"].splitlines() if l.startswith("•")][0])
assert "no physical move needed" in m7["confirmMessage"]
assert "put back" in m7["noticeMessage"]

# 8. producer applies the reversal to the records
out = produce(gd([gline(LA, 70)]), p1, r2)
recs = out["transferOrderData"]["table_picking_records"]
rows = [r for r in out["transferOrderData"]["table_picking_items"] if r.get("row_type") != "header"]
print(f"  producer: records={[(r['id'], r['store_out_qty']) for r in recs]} "
      f"row(plan={rows[0]['qty_to_pick']}, pend={rows[0]['pending_process_qty']}, {rows[0]['line_status']}, id={rows[0].get('id')})")
assert {r["id"] for r in recs} == {"R1", "R2"}
assert [r for r in recs if r["id"] == "R2"][0]["store_out_qty"] == 10
assert [r for r in recs if r["id"] == "R1"][0]["store_out_qty"] == 60
assert rows[0]["qty_to_pick"] == 70 and rows[0]["pending_process_qty"] == 0
assert rows[0]["id"] == "ROW_A"

# 9. full delete: emptied records omitted so the platform soft-deletes them
out9 = produce(gd([]), p1, r3)
recs9 = out9["transferOrderData"]["table_picking_records"]
rows9 = [r for r in out9["transferOrderData"]["table_picking_items"] if r.get("row_type") != "header"]
print(f"  producer (deleted line):  records kept={len(recs9)} plan rows kept={len(rows9)}")
assert recs9 == [] and rows9 == []

# 10. serialised line: no record says WHICH serial was taken, so refuse
pser = pick([dict(plan(LA, 100, 0, "ROW_A"), is_serialized_item=1,
                  serial_numbers="SN-1, SN-2")],
            [rec("R1", LA, 100)])
r10 = reconcile(gd([gline(LA, 40)]), pser, before)
print(f"  serialised line reduced:  block={r10['blockCreatedEdit']} rev={r10['hasReversals']}")
print(f"      -> {r10['blockMessage'][:104]}")
assert r10["blockCreatedEdit"] == 1 and r10["hasReversals"] == 0
assert "serial" in r10["blockMessage"]

# 11. but a serialised line may still be INCREASED
r11 = reconcile(gd([gline(LA, 160)]), pser, before)
print(f"  serialised line increased: block={r11['blockCreatedEdit']} need={r11['reconcileNeeded']} "
      f"pend={r11['linePlans'][0]['newPending']}")
assert r11["blockCreatedEdit"] == 0 and r11["reconcileNeeded"] == 1
assert r11["linePlans"][0]["newPending"] == 60

print("\nall reversal scenarios passed")
