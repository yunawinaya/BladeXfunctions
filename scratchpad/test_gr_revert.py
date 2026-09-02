"""Node tests for the Revert Completed Goods Receiving workflow.

The code under test is extracted BACK OUT of the workflow JSON, never retyped:
a self-contained copy would hide a helper that the spliced node never got.
"""
import sys, json, copy
sys.path.insert(0, "scratchpad")
from harness import load, run

WF = "Goods Receiving/RevertCompletedGR/GRrevertCompletedWorkflow.json"
M = load(WF)
PREP = M["code_node_grRvPrep"]["data"]["script"]["code"]
BUILD = M["code_node_grRvBuild"]["data"]["script"]["code"]
PARAMS = M["code_node_grRvParams"]["data"]["script"]["code"]

GR_ID = "2000000000000000000"
ORG = "ORG1"
GR_NO = "GR/202609/001"
PLANT = "PLANT1"

def mid(n):
    """A snowflake-shaped id; ids are compared as strings, so keep them equal length."""
    return str(2000000000000000000 + n)

def item(iid, method="First In First Out", batch=1, stock=1, conv=None):
    return {"id": iid, "material_code": "IT-" + iid, "material_name": "Item " + iid,
            "material_desc": "", "based_uom": "UOM_BASE", "stock_control": stock,
            "material_costing_method": method, "item_batch_management": batch,
            "purchase_unit_price": 0, "table_uom_conversion": conv or []}

def grn(n, iid, qty, price, batch=None, bin="BIN1", cat="Unrestricted", hu="", typ="GRN",
        uom="UOM_BASE", alt=None, po_no="PO/001", method="First In First Out"):
    return {"id": mid(n), "transaction_type": typ, "movement": "IN" if typ in ("GRN", "HU-R") else "OUT",
            "trx_no": GR_NO, "parent_trx_no": po_no, "item_id": iid, "plant_id": PLANT,
            "bin_location_id": bin, "batch_number_id": batch or "", "handling_unit_id": hu,
            "inventory_category": cat, "quantity": str(alt if alt is not None else qty),
            "base_qty": str(qty), "uom_id": uom, "base_uom_id": "UOM_BASE",
            "unit_price": str(price), "costing_method_id": method}

def line(iid, qty, batch="B1", po_line="POL1", **kw):
    d = {"id": "L-" + iid + "-" + str(qty), "item_id": iid, "item_name": "Item " + iid,
         "received_qty": qty, "base_received_qty": qty, "item_batch_no": batch,
         "po_line_item_id": po_line, "line_po_id": "PO1", "inv_category": "Unrestricted",
         "location_id": "BIN1", "temp_hu_data": "", "return_quantity": 0,
         "created_return_qty": 0}
    d.update(kw)
    return d

def po_line(lid="POL1", quantity=100, received=10, created=0, status="Processing", **kw):
    d = {"id": lid, "quantity": quantity, "received_qty": received,
         "created_received_qty": created, "line_status": status, "outstanding_quantity": quantity - received}
    d.update(kw)
    return d

def scenario(**over):
    s = {
        "gr": {"id": GR_ID, "gr_no": GR_NO, "gr_status": "Completed", "previous_status": "Draft",
               "putaway_status": "", "pi_status": "", "return_status": "", "posted_status": "",
               "plant_id": PLANT, "organization_id": ORG, "po_id": ["PO1"],
               "table_gr": [line("I1", 10)]},
        "movs": [grn(1, "I1", 10, 5, "B1")],
        "putaway": [], "qi": [], "transit": [], "batch": [],
        "later": [],
        "fifo": [{"id": mid(101), "material_id": "I1", "batch_id": "B1", "fifo_cost_price": "5.0000",
                  "fifo_initial_quantity": "10.000", "fifo_available_quantity": "10.000",
                  "fifo_sequence": "1"}],
        "wa": [], "cost": [{"t": "FIFO", "material_id": "I1", "cnt": 1}],
        "pi": [],
        "batchbal": [{"id": "BB1", "material_id": "I1", "location_id": "BIN1", "batch_id": "B1",
                      "plant_id": PLANT, "unrestricted_qty": 10, "balance_quantity": 10,
                      "reserved_qty": 0, "block_qty": 0, "qualityinsp_qty": 0, "intransit_qty": 0}],
        "itembal": [{"id": "IB1", "material_id": "I1", "location_id": "BIN1", "plant_id": PLANT,
                     "unrestricted_qty": 10, "balance_quantity": 10, "reserved_qty": 0,
                     "block_qty": 0, "qualityinsp_qty": 0, "intransit_qty": 0}],
        "hu": [],
        "po": [{"id": "PO1", "po_status": "Processing", "gr_status": "Partially Received",
                "table_po": [po_line()]}],
        "onorder": [{"id": "OO1", "po_line_id": "POL1", "scheduled_qty": 100,
                     "received_qty": 10, "open_qty": 90}],
        "items": [item("I1")],
    }
    s.update(over)
    return s

def go(s):
    p = run(PARAMS, {"wp": {"gr_id": GR_ID, "gr_no": GR_NO, "organization_id": ORG}, "node": {}})
    prep = run(PREP, {"wp": {}, "node": {
        "code_node_grRvParams": {"data": p},
        "get_node_grRvGr": {"data": {"data": s["gr"], "count": 1 if s["gr"] else 0}},
        "sql_node_grRvMovs": {"data": s["movs"]},
    }})
    if prep["refuse"] == 1:
        return prep, None
    build = run(BUILD, {"wp": {}, "node": {
        "code_node_grRvPrep": {"data": prep},
        "sql_node_grRvLater": {"data": s["later"]},
        "sql_node_grRvFifo": {"data": s["fifo"]},
        "sql_node_grRvWa": {"data": s["wa"]},
        "sql_node_grRvCostCounts": {"data": s["cost"]},
        "search_node_grRvPi": {"data": {"data": s["pi"]}},
        "search_node_grRvBatchBal": {"data": {"data": s["batchbal"]}},
        "search_node_grRvItemBal": {"data": {"data": s["itembal"]}},
        "search_node_grRvHu": {"data": {"data": s["hu"]}},
        "search_node_grRvPo": {"data": {"data": s["po"]}},
        "search_node_grRvOnOrder": {"data": {"data": s["onorder"]}},
        "search_node_grRvItems": {"data": {"data": s["items"]}},
        "search_node_grRvPutaway": {"data": {"data": s["putaway"]}},
        "search_node_grRvQi": {"data": {"data": s["qi"]}},
        "search_node_grRvTransit": {"data": {"data": s["transit"]}},
        "search_node_grRvBatch": {"data": {"data": s["batch"]}},
    }})
    return prep, build

FAILED = []
def ok(cond, label):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        FAILED.append(label)

def types(b):
    return sorted(set(c["type"] for c in b["conflicts"]))

# ---------------------------------------------------------------- happy paths
print("HAPPY PATHS")
p, b = go(scenario())
ok(b["hasConflicts"] == 0, "plain FIFO batch item: no conflicts (" + str(types(b)) + ")")
ok(len(b["subtracts"]) == 1 and b["subtracts"][0]["quantity"] == 10, "one subtract for 10")
ok(b["subtracts"][0]["fifoDeleteId"] == mid(101) and b["subtracts"][0]["hasFifoDelete"] == 1, "its FIFO layer is removed")
ok(b["poLineUpdates"][0] == {"id": "POL1", "received_qty": "0.000", "outstanding_quantity": "100.000",
                             "line_status": "Issued", "created_received_qty": "10.000"}, "PO line restored + re-reserved")
ok(b["onOrderUpdates"][0] == {"id": "OO1", "received_qty": "0.000", "open_qty": "100.000"}, "on order restored")
ok(b["poHeaderUpdates"][0]["po_status"] == "Issued" and b["poHeaderUpdates"][0]["gr_status"] == "Created"
   and b["poHeaderUpdates"][0]["fully_received"] == "0 / 1", "PO header lowered to Issued")

s = scenario(gr=dict(scenario()["gr"], gr_status="Received", putaway_status="Created"),
             putaway=[{"id": "TO1", "to_id": "PA/001", "to_status": "Created", "is_processing": 0,
                       "qi_id": "", "table_putaway_records": "[]",
                       "table_putaway_item": json.dumps([{"line_status": "Open", "putaway_qty": 0}])}],
             transit=[{"id": "IT1", "material_id": "I1", "status": "In Transit",
                       "open_qty": 10, "transit_qty": 10}])
p, b = go(s)
ok(b["hasConflicts"] == 0 and b["putawayDeletes"] == [{"id": "TO1"}], "Received + Created putaway: putaway removed")
ok(b["transitUpdates"] == [{"id": "IT1", "status": "Cancelled", "open_qty": "0.000"}], "in transit row cancelled")

s2 = copy.deepcopy(s); s2["transit"] = []
p, b = go(s2)
ok(b["hasConflicts"] == 0 and b["transitUpdates"] == [], "same receipt with no in-transit ledger rows still reverts")

# two lines, one non-batch FIFO item
s = scenario(gr=dict(scenario()["gr"], table_gr=[line("I1", 4, batch=""), line("I1", 6, batch="")]),
             movs=[grn(1, "I1", 4, 5), grn(2, "I1", 6, 7)],
             fifo=[{"id": mid(101), "material_id": "I1", "batch_id": "", "fifo_cost_price": "5.0000",
                    "fifo_initial_quantity": "4.000", "fifo_available_quantity": "4.000", "fifo_sequence": "8"},
                   {"id": mid(102), "material_id": "I1", "batch_id": "", "fifo_cost_price": "7.0000",
                    "fifo_initial_quantity": "6.000", "fifo_available_quantity": "6.000", "fifo_sequence": "9"}],
             batchbal=[], items=[item("I1", batch=0)])
p, b = go(s)
ok(b["hasConflicts"] == 0 and len(b["subtracts"]) == 2, "non-batch FIFO, two lines on one item")
ok(sorted(x["fifoDeleteId"] for x in b["subtracts"]) == [mid(101), mid(102)], "both layers matched by qty+price")
ok(b["poLineUpdates"][0]["received_qty"] == "0.000", "both lines aggregate onto one PO line")

# weighted average, non-batch: back-solve
s = scenario(gr=dict(scenario()["gr"], table_gr=[line("I1", 4, batch=""), line("I1", 6, batch="")]),
             movs=[grn(1, "I1", 4, 5, method="Weighted Average"),
                   grn(2, "I1", 6, 10, method="Weighted Average")],
             fifo=[], batchbal=[], items=[item("I1", method="Weighted Average", batch=0)],
             cost=[{"t": "WA", "material_id": "I1", "cnt": 1}],
             wa=[{"id": "WA1", "material_id": "I1", "batch_id": None,
                  "wa_quantity": "30.000", "wa_cost_price": "6.0000"}])
p, b = go(s)
# forward merged 4@5 then 6@10 into a pool that ends at 30 @ 6.0000
upd = [x for x in b["subtracts"] if x["hasWaUpdate"] == 1]
ok(b["hasConflicts"] == 0 and len(upd) == 1, "weighted average non-batch: one restatement for the item")
ok(upd[0]["waQuantity"] == "20.000", "quantity backs out to 20")
ok(abs(float(upd[0]["waCostPrice"]) - ((6.0 * 30) - (4 * 5 + 6 * 10)) / 20) < 1e-4, "price backs out within a hundredth of a cent")

s["wa"] = [{"id": "WA1", "material_id": "I1", "batch_id": None, "wa_quantity": "10.000", "wa_cost_price": "8.0000"}]
p, b = go(s)
upd = [x for x in b["subtracts"] if x["hasWaUpdate"] == 1]
ok(b["hasConflicts"] == 0 and upd[0]["waQuantity"] == "0.000" and upd[0]["waCostPrice"] == "8.0000",
   "weighted average emptied exactly: quantity zeroed, price left alone")

print("SPLIT, BUNDLE AND NON-STOCK ROWS")
split = [
    line("I1", 10, id="LP", is_split="Yes", parent_or_child="Parent", parent_index=0),
    line("I1", 4, id="LC1", is_split="Yes", parent_or_child="Child", parent_index=0),
    line("I1", 6, id="LC2", is_split="Yes", parent_or_child="Child", parent_index=0),
]
s = scenario(gr=dict(scenario()["gr"], table_gr=split),
             movs=[grn(1, "I1", 4, 5, "B1"), grn(2, "I1", 6, 5, "B1")],
             fifo=[{"id": mid(101), "material_id": "I1", "batch_id": "B1", "fifo_cost_price": "5.0000",
                    "fifo_initial_quantity": "4.000", "fifo_available_quantity": "4.000", "fifo_sequence": "1"},
                   {"id": mid(102), "material_id": "I1", "batch_id": "B1", "fifo_cost_price": "5.0000",
                    "fifo_initial_quantity": "6.000", "fifo_available_quantity": "6.000", "fifo_sequence": "2"}],
             batch=[{"id": "B1", "transaction_no": GR_NO, "parent_transaction_no": "PO/001"}])
p, b = go(s)
ok(b["hasConflicts"] == 0 and len(b["subtracts"]) == 2, "split parent contributes no stock movement")
ok(b["poLineUpdates"][0]["received_qty"] == "0.000", "PO line decremented once, from the parent")
ok(b["onOrderUpdates"][0]["received_qty"] == "0.000", "on order decremented once, from the parent")
ok(b["batchDeletes"] == [{"id": "B1"}], "the split parent's batch is removed so re-completion cannot duplicate it")

s2 = copy.deepcopy(s)
s2["batch"] = [{"id": "B1", "transaction_no": GR_NO, "parent_transaction_no": ""}]
p, b = go(s2)
ok(b["batchDeletes"] == [], "a batch created through the inventory workflow is kept for reuse")

bundle = [
    dict(line("", 1, po_line="POLB"), id="LB", item_id="", item_bundle_id="BND1", children=[
        line("I1", 10, id="LBC", item_bundle_id="BND1")]),
]
s = scenario(gr=dict(scenario()["gr"], table_gr=bundle),
             po=[{"id": "PO1", "po_status": "Processing", "gr_status": "Partially Received",
                  "table_po": [dict(po_line("POLB", 5, 1), item_bundle_id="BND1", children=[
                      dict(po_line("POL1", 100, 10), item_bundle_id="BND1", item_id="I1")])]}])
p, b = go(s)
ids = sorted(u["id"] for u in b["poLineUpdates"])
ok(b["hasConflicts"] == 0 and ids == ["POL1", "POLB"], "bundle row and its item each update their own PO line")
ok(b["poHeaderUpdates"][0]["fully_received"] == "0 / 1", "PO header counts the bundle as one line")

s = scenario(gr=dict(scenario()["gr"], table_gr=[line("I1", 10), line("I2", 3)]),
             items=[item("I1"), item("I2", stock=0)])
p, b = go(s)
ok(b["hasConflicts"] == 0 and len(b["subtracts"]) == 1, "a non-stock-controlled line has no stock to reverse")

print("EDGE VALUES")
s = scenario(movs=[grn(1, "I1", 10, 0, "B1")],
             fifo=[{"id": mid(101), "material_id": "I1", "batch_id": "B1", "fifo_cost_price": "0.0000",
                    "fifo_initial_quantity": "10.000", "fifo_available_quantity": "10.000", "fifo_sequence": "1"}])
p, b = go(s)
ok(b["hasConflicts"] == 0 and b["subtracts"][0]["unit_price"] == 0, "a zero unit price still matches its layer")

s = scenario(gr=dict(scenario()["gr"], table_gr=[line("I1", 12)]),
             movs=[grn(1, "I1", 12, 5, "B1")],
             fifo=[{"id": mid(101), "material_id": "I1", "batch_id": "B1", "fifo_cost_price": "5.0000",
                    "fifo_initial_quantity": "12.000", "fifo_available_quantity": "12.000", "fifo_sequence": "1"}],
             batchbal=[dict(scenario()["batchbal"][0], unrestricted_qty=12, balance_quantity=12)],
             itembal=[dict(scenario()["itembal"][0], unrestricted_qty=12, balance_quantity=12)],
             po=[{"id": "PO1", "po_status": "Completed", "gr_status": "Fully Received",
                  "table_po": [po_line("POL1", 10, 12, status="Completed")]}],
             onorder=[{"id": "OO1", "po_line_id": "POL1", "scheduled_qty": 10, "received_qty": 12, "open_qty": 0}])
p, b = go(s)
ok(b["poLineUpdates"][0]["outstanding_quantity"] == "10.000", "over-receipt: outstanding recomputed, not un-clamped")
ok(b["onOrderUpdates"][0]["open_qty"] == "10.000", "over-receipt: open quantity recomputed from the scheduled quantity")

s = scenario(po=[{"id": "PO1", "po_status": "Draft", "gr_status": "",
                  "table_po": [po_line("POL1", 100, 10, status="Cancelled")]}])
p, b = go(s)
ok(b["poHeaderUpdates"][0]["po_status"] == "Draft" and b["poLineUpdates"][0]["line_status"] == "Cancelled",
   "a Draft purchase order and a Cancelled line are left as they are")

print("HANDLING UNITS")
# A handling unit that already existed has a lower id than the movement row;
# one created by this receipt is inserted after the stock and so has a higher id.
OLD_HU = "1999999999999999500"
s = scenario(movs=[grn(1, "I1", 10, 5, "B1")],
             hu=[{"id": OLD_HU, "handling_no": "HU/001", "hu_status": "Created", "parent_hu_id": "",
                  "packing_id": "", "location_id": "BIN1", "plant_id": PLANT,
                  "storage_location_id": "SL1",
                  "table_hu_items": json.dumps([{"material_id": "I1", "batch_id": "B1",
                                                 "quantity": 10, "balance_id": "BB1"}])}])
s["movs"][0]["handling_unit_id"] = OLD_HU
p, b = go(s)
ok(b["hasConflicts"] == 0 and b["subtracts"][0]["huIsUnload"] == 1, "a handling unit older than the receipt is unloaded")
ok(b["subtracts"][0]["huItems"][0]["balance_id"] == "BB1", "the unload uses the balance id the handling unit recorded")
ok(b["subtracts"][0]["huLocationId"] == "BIN1" and b["subtracts"][0]["huStorageLocationId"] == "SL1",
   "the handling unit's own bin is echoed back so the update cannot blank it")

s["hu"][0]["id"] = mid(50)
s["movs"][0]["handling_unit_id"] = mid(50)
p, b = go(s)
ok(b["subtracts"][0]["huIsDelete"] == 1 and b["subtracts"][0]["hasHuReadd"] == 0,
   "a handling unit created by the receipt is removed, with no packaging to put back")

s["movs"].append(grn(2, "PKG", 1, 2, typ="HU", uom="UOM_BASE", po_no=GR_NO))
s["movs"][1]["trx_no"] = "HU/001"
s["movs"][1]["parent_trx_no"] = GR_NO
s["items"].append(item("PKG", batch=0))
p, b = go(s)
ok(b["subtracts"][0]["hasHuReadd"] == 1 and b["subtracts"][0]["readdMaterialId"] == "PKG"
   and b["subtracts"][0]["readdQuantity"] == 1, "the packaging the handling unit consumed is put back")

s["movs"].append(dict(grn(3, "PKG", 1, 2, typ="HU-R"), trx_no="HU/001", parent_trx_no=GR_NO))
p, b = go(s)
ok(b["subtracts"][0]["hasHuReadd"] == 0, "packaging already put back by an earlier revert is not put back twice")

print("REPEATED AND PARTIAL REVERTS")
# reverted, completed again, reverted again: only the newest receipt is live
s = scenario(movs=[grn(1, "I1", 10, 5, "B1"),
                   dict(grn(2, "I1", 10, 5, "B1", typ="GRN-R"), movement="OUT"),
                   grn(3, "I1", 10, 5, "B1")])
p, b = go(s)
ok(len(p["liveRows"]) == 1 and p["liveRows"][0]["id"] == mid(3), "pairing leaves only the latest receipt live")
ok(b["hasConflicts"] == 0 and len(b["subtracts"]) == 1, "the second revert reverses one row, not two")

# a run that stopped half way: two rows reversed, one still live
s = scenario(gr=dict(scenario()["gr"], table_gr=[line("I1", 4, batch=""), line("I1", 6, batch=""), line("I1", 5, batch="")]),
             movs=[grn(1, "I1", 4, 5), grn(2, "I1", 6, 5), grn(3, "I1", 5, 5),
                   dict(grn(4, "I1", 4, 5, typ="GRN-R"), movement="OUT"),
                   dict(grn(5, "I1", 6, 5, typ="GRN-R"), movement="OUT")],
             fifo=[{"id": mid(103), "material_id": "I1", "batch_id": "", "fifo_cost_price": "5.0000",
                    "fifo_initial_quantity": "5.000", "fifo_available_quantity": "5.000", "fifo_sequence": "3"}],
             batchbal=[], items=[item("I1", batch=0)])
p, b = go(s)
ok([r["id"] for r in p["liveRows"]] == [mid(3)], "after a partial run only the unreversed row is live")
ok(b["hasConflicts"] == 0 and len(b["subtracts"]) == 1 and b["subtracts"][0]["quantity"] == 5,
   "a retry finishes the remaining row only")

print("REFUSALS FROM THE DOCUMENT ITSELF")
for field, value, word in [("gr_status", "Draft", "Completed"), ("pi_status", "Fully Invoiced", "invoiced"),
                           ("return_status", "Partially Returned", "purchase return"),
                           ("posted_status", "Posted", "posted"),
                           ("putaway_status", "In Progress", "Putaway")]:
    p, b = go(scenario(gr=dict(scenario()["gr"], **{field: value})))
    ok(p["refuse"] == 1 and word.lower() in p["refuseMessage"].lower(),
       field + "=" + value + " refused: " + p["refuseMessage"][:58])

p, b = go(scenario(gr=dict(scenario()["gr"], pi_status="Cancelled")))
ok(p["refuse"] == 0, "a cancelled purchase invoice does not block the revert")
p, b = go(scenario(gr=dict(scenario()["gr"], table_gr=[line("I1", 10, return_quantity=2)])))
ok(p["refuse"] == 1 and "purchase return" in p["refuseMessage"].lower(), "a returned line refuses")
p, b = go(scenario(movs=[]))
ok(p["refuse"] == 1 and "already have been reverted" in p["refuseMessage"], "nothing left to reverse refuses")

print("CONFLICTS FOUND AGAINST LIVE DATA")
cases = [
    ("later_movement", dict(later=[{"item_id": "I1", "batch_id": "B1", "max_id": mid(900), "latest": "GDL GD/007"}])),
    ("invoiced", dict(pi=[{"id": "PI1", "purchase_invoice_no": "PI/001", "pi_status": ""}])),
    ("balance_short", dict(batchbal=[dict(scenario()["batchbal"][0], unrestricted_qty=3)])),
    ("balance_missing", dict(itembal=[])),
    ("fifo_layer_consumed", dict(fifo=[dict(scenario()["fifo"][0], fifo_available_quantity="4.000")])),
    ("fifo_layer_mismatch", dict(fifo=[])),
    ("costing_inconsistent", dict(cost=[{"t": "FIFO", "material_id": "I1", "cnt": 1},
                                        {"t": "WA", "material_id": "I1", "cnt": 1}])),
    ("costing_method_changed", dict(items=[item("I1", method="Weighted Average")])),
    ("stock_control_changed", dict(items=[item("I1", stock=0)])),
    ("uom_conversion_changed", dict(movs=[grn(1, "I1", 10, 5, "B1", uom="BOX", alt=1)],
                                    items=[item("I1", conv=[{"alt_uom_id": "BOX", "base_qty": 5}])])),
    ("item_missing", dict(items=[])),
    ("integrity_qty", dict(movs=[grn(1, "I1", 7, 5, "B1")])),
    ("putaway_progressed", dict(putaway=[{"id": "TO1", "to_id": "PA/001", "to_status": "In Progress",
                                          "is_processing": 0, "qi_id": "", "table_putaway_records": "[]",
                                          "table_putaway_item": "[]"}])),
    ("inspection_progressed", dict(qi=[{"id": "Q1", "inspection_lot_no": "IL/001",
                                        "receiving_insp_status": "Completed"}])),
    ("transit_consumed", dict(transit=[{"id": "IT1", "material_id": "I1", "status": "In Transit",
                                        "open_qty": 4, "transit_qty": 10}])),
    ("po_line_missing", dict(po=[{"id": "PO1", "po_status": "Processing", "gr_status": "",
                                  "table_po": []}])),
    ("wa_row_missing", dict(items=[item("I1", method="Weighted Average", batch=0)], fifo=[],
                            movs=[grn(1, "I1", 10, 5, method="Weighted Average")], batchbal=[],
                            cost=[{"t": "WA", "material_id": "I1", "cnt": 0}], wa=[])),
]
for want, over in cases:
    p, b = go(scenario(**over))
    got = types(b)
    ok(want in got, want + " detected " + str(got))
    ok(b["subtracts"] == [] and b["hasSubtracts"] == 0 and b["poLineUpdates"] == [],
       "  ...and nothing is queued for writing")

p, b = go(scenario(putaway=[{"id": "TO1", "to_id": "PA/001", "to_status": "Created", "is_processing": 1,
                             "qi_id": "", "table_putaway_records": "[]", "table_putaway_item": "[]"}]))
ok("putaway_progressed" in types(b), "a putaway held by a picker refuses")
p, b = go(scenario(putaway=[{"id": "TO1", "to_id": "PA/001", "to_status": "Created", "is_processing": 0,
                             "qi_id": "", "table_putaway_records": json.dumps([{"id": "R1"}]),
                             "table_putaway_item": "[]"}]))
ok("putaway_progressed" in types(b), "a putaway with confirmed picks refuses")
p, b = go(scenario(pi=[{"id": "PI1", "purchase_invoice_no": "PI/001", "pi_status": "Cancelled"}]))
ok(b["hasConflicts"] == 0, "a cancelled purchase invoice row is ignored")

for want, over in [
    ("hu_missing", dict(hu=[])),
    ("hu_status", dict(hu=[{"id": mid(50), "handling_no": "HU/001", "hu_status": "Packed",
                            "parent_hu_id": "", "packing_id": "", "location_id": "BIN1",
                            "table_hu_items": "[]"}])),
    ("hu_nested", dict(hu=[{"id": mid(50), "handling_no": "HU/001", "hu_status": "Created",
                            "parent_hu_id": "HUP", "packing_id": "", "location_id": "BIN1",
                            "table_hu_items": "[]"}])),
    ("hu_moved", dict(hu=[{"id": mid(50), "handling_no": "HU/001", "hu_status": "Created",
                           "parent_hu_id": "", "packing_id": "", "location_id": "BIN9",
                           "table_hu_items": "[]"}])),
    ("hu_items_mismatch", dict(hu=[{"id": mid(50), "handling_no": "HU/001", "hu_status": "Created",
                                    "parent_hu_id": "", "packing_id": "", "location_id": "BIN1",
                                    "table_hu_items": json.dumps([{"material_id": "I1", "batch_id": "B1",
                                                                   "quantity": 2}])}])),
]:
    s = scenario(movs=[grn(1, "I1", 10, 5, "B1")], **over)
    s["movs"][0]["handling_unit_id"] = mid(50)
    p, b = go(s)
    ok(want in types(b), want + " detected " + str(types(b)))

p, b = go(scenario(itembal=[dict(scenario()["itembal"][0], id="IB" + str(i)) for i in range(1000)]))
ok("fetch_truncated" in types(b), "a fetch that came back at its ceiling is treated as unverifiable")

print()
if FAILED:
    print(str(len(FAILED)) + " FAILED:")
    for f in FAILED:
        print("  - " + f)
    sys.exit(1)
print("all assertions passed")
