"""Node tests for the Revert Completed Item Assembly workflow.

The code under test is extracted back out of the generated workflow JSON.
"""
import sys, json, copy
sys.path.insert(0, "scratchpad")
from harness import load, run

WF = "Item Assembly & BOM/RevertCompletedIA/IArevertCompletedWorkflow.json"
M = load(WF)
PARAMS = M["code_node_iaRvParams"]["data"]["script"]["code"]
PREP = M["code_node_iaRvPrep"]["data"]["script"]["code"]
BUILD = M["code_node_iaRvBuild"]["data"]["script"]["code"]

ORG = "ORG1"
PLANT = "PLANT1"
IA_NO = "IA-2609-004"

def mid(n):
    """Snowflake-shaped ids, compared as strings, so keep them the same length."""
    return str(2000000000000000000 + n)

IA_ID = mid(0)

def item(iid, method="First In First Out", batch=0, stock=1, conv=None):
    return {"id": iid, "material_code": "IT-" + iid, "material_name": "Item " + iid,
            "based_uom": "UOM_BASE", "stock_control": stock, "material_costing_method": method,
            "item_batch_management": batch, "table_uom_conversion": conv or []}

def mov(n, typ, movement, iid, qty, price, bin="BIN1", batch="", hu="", cat="Unrestricted",
        method="First In First Out", trx=IA_NO):
    return {"id": mid(n), "organization_id": ORG, "transaction_type": typ, "movement": movement, "trx_no": trx,
            "item_id": iid, "plant_id": PLANT, "bin_location_id": bin, "batch_number_id": batch,
            "handling_unit_id": hu, "inventory_category": cat, "quantity": str(qty),
            "base_qty": str(qty), "uom_id": "UOM_BASE", "base_uom_id": "UOM_BASE",
            "unit_price": str(price), "total_price": str(qty * price), "costing_method_id": method}

def layer(n, iid, qty, price, avail=None, batch=""):
    return {"id": mid(n), "material_id": iid, "batch_id": batch, "fifo_cost_price": str(price),
            "fifo_initial_quantity": str(qty), "fifo_available_quantity": str(qty if avail is None else avail),
            "fifo_sequence": "1"}

def bal(iid, qty, bin="BIN1", batch=None, col="unrestricted_qty"):
    row = {"id": "BAL-" + iid + "-" + bin, "material_id": iid, "location_id": bin, "plant_id": PLANT,
           "unrestricted_qty": 0, "reserved_qty": 0, "block_qty": 0, "qualityinsp_qty": 0,
           "intransit_qty": 0, "balance_quantity": qty}
    row[col] = qty
    if batch is not None:
        row["batch_id"] = batch
    return row

def hu(huid="H1", status="Created", bin="BIN1", lines=None, **kw):
    d = {"id": huid, "handling_no": "HU/" + huid, "hu_status": status, "parent_hu_id": "",
         "packing_id": "", "location_id": bin, "plant_id": PLANT, "storage_location_id": "SL1",
         "table_hu_items": json.dumps(lines if lines is not None else [
             {"material_id": "C1", "balance_id": "BAL-C1", "batch_id": "", "quantity": 0, "is_deleted": 1}])}
    d.update(kw)
    return d

def scenario(**over):
    s = {
        "ia": {"id": IA_ID, "stock_movement_no": IA_NO, "item_assembly_status": "Completed",
               "posted_status": "Unposted", "issuing_operation_faci": PLANT, "item_id": "A1",
               "organization_id": ORG},
        "movs": [mov(1, "IA", "OUT", "C1", 5, 1), mov(2, "IA", "OUT", "C2", 5, 1),
                 mov(100, "IA", "IN", "A1", 1, 10)],
        "batch": [{"id": "BT1", "material_id": "A1", "batch_number": "", "transaction_no": IA_NO,
                   "organization_id": ORG}],
        "fifo": [layer(101, "A1", 1, 10)],
        "wa": [],
        "cost": [{"t": "FIFO", "material_id": x, "cnt": 1} for x in ("A1", "C1", "C2")],
        "itembal": [bal("A1", 1001)],
        "batchbal": [],
        "hu": [],
        "items": [item("A1"), item("C1"), item("C2")],
    }
    s.update(over)
    return s

def go(s, wp=None):
    p = run(PARAMS, {"wp": wp or {"ia_id": IA_ID, "ia_no": IA_NO, "organization_id": ORG}, "node": {}})
    prep = run(PREP, {"wp": {}, "node": {
        "code_node_iaRvParams": {"data": p},
        "get_node_iaRvIa": {"data": {"data": s["ia"], "count": 1 if s["ia"] else 0}},
        "sql_node_iaRvMovs": {"data": s["movs"]},
        "search_node_iaRvBatch": {"data": {"data": s["batch"]}},
    }})
    if prep["refuse"] == 1:
        return prep, None
    build = run(BUILD, {"wp": {}, "node": {
        "code_node_iaRvPrep": {"data": prep},
        "sql_node_iaRvFifo": {"data": s["fifo"]},
        "sql_node_iaRvWa": {"data": s["wa"]},
        "sql_node_iaRvCostCounts": {"data": s["cost"]},
        "search_node_iaRvItemBal": {"data": {"data": s["itembal"]}},
        "search_node_iaRvBatchBal": {"data": {"data": s["batchbal"]}},
        "search_node_iaRvHu": {"data": {"data": s["hu"]}},
        "search_node_iaRvItems": {"data": {"data": s["items"]}},
        "search_node_iaRvBatch": {"data": {"data": s["batch"]}},
    }})
    return prep, build

FAILED = []
def ok(cond, label):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        FAILED.append(label)

def types(b):
    return sorted(set(c["type"] for c in b["conflicts"]))

NULLABLE = ("location_id", "batch_id", "handling_unit_id", "huStorageLocationId", "huLocationId")
def no_empty_strings(b):
    for row in b["subtracts"] + b["adds"]:
        for k in NULLABLE:
            if k in row and row[k] == "":
                return False
        for hi in row.get("huItems", []):
            if hi.get("batch_id") == "" or hi.get("location_id") == "":
                return False
    return True

print("PARAMS")
p = run(PARAMS, {"wp": {"ia_id": IA_ID, "ia_no": IA_NO, "organization_id": ORG}, "node": {}})
ok(p["hasParams"] == 1 and p["iaNoSql"] == IA_NO, "valid params pass")
p = run(PARAMS, {"wp": {"ia_id": "1 OR 1=1", "ia_no": "x' OR '1", "organization_id": ORG}, "node": {}})
ok(p["hasParams"] == 0 and p["iaIdSql"] == "0" and p["iaNoSql"] == "", "injection-shaped params are neutralised")
# The list grid only carries its visible columns, so organization_id arrives undefined.
p = run(PARAMS, {"wp": {"ia_id": IA_ID, "ia_no": IA_NO, "organization_id": None}, "node": {}})
ok(p["hasParams"] == 1, "a call without organization_id is accepted (IA-2609-004 regression)")
p, b = go(scenario(), wp={"ia_id": IA_ID, "ia_no": IA_NO, "organization_id": None})
ok(p["refuse"] == 0 and p["organizationId"] == ORG and p["orgSql"] == ORG and b["hasConflicts"] == 0,
   "without organization_id the org is taken from the record")
p, b = go(scenario(), wp={"ia_id": IA_ID, "ia_no": IA_NO, "organization_id": "ORG2"})
ok(p["refuse"] == 1, "a supplied organization_id that does not match the record is refused")
s = scenario(movs=scenario()["movs"] + [dict(mov(300, "IA", "OUT", "C1", 7, 1), organization_id="ORG2")],
             batch=scenario()["batch"] + [{"id": "BTX", "material_id": "A1", "batch_number": "",
                                           "transaction_no": IA_NO, "organization_id": "ORG2"}])
p, b = go(s)
ok(len(b["adds"]) == 2 and b["batchDeletes"] == [{"id": "BT1"}],
   "another organization's movement and batch under the same number are ignored")

print("HAPPY PATHS")
p, b = go(scenario())
ok(b["hasConflicts"] == 0, "FIFO non-batch assembly reverts cleanly " + str(types(b)))
ok(len(b["subtracts"]) == 1 and b["subtracts"][0]["material_id"] == "A1" and b["subtracts"][0]["quantity"] == 1
   and b["subtracts"][0]["unit_price"] == 10, "assembled item taken out at its receipt cost")
ok(b["subtracts"][0]["fifoDeleteId"] == mid(101) and b["subtracts"][0]["hasFifoDelete"] == 1, "its FIFO layer is removed")
ok(sorted((a["material_id"], a["quantity"], a["unit_price"]) for a in b["adds"]) == [("C1", 5, 1), ("C2", 5, 1)],
   "both components returned at the cost they left at")
ok(b["batchDeletes"] == [{"id": "BT1"}], "the blank Batch row completion minted is removed")
ok(no_empty_strings(b), "nullable sub-workflow params are null, never ''")
ok(b["adds"][0]["batch_id"] is None and b["adds"][0]["handling_unit_id"] is None, "absent batch / HU are null")

p, b = go(scenario(movs=[]))
ok(p["refuse"] == 0 and p["headerOnly"] == 1, "a Completed assembly with no movements is a header-only revert")
ok(b["hasConflicts"] == 0 and b["subtracts"] == [] and b["adds"] == [] and b["batchDeletes"] == [{"id": "BT1"}],
   "header-only: nothing to move, blank batch still cleaned up")

s = scenario(fifo=[layer(101, "A1", 1, 10), layer(900, "A1", 1, 10)])
p, b = go(s)
ok(b["hasConflicts"] == 0 and b["subtracts"][0]["fifoDeleteId"] == mid(101),
   "of two identical layers, the one written with this movement is chosen")
s = scenario(fifo=[layer(101, "A1", 1, 10, avail=0), layer(900, "A1", 1, 10)])
p, b = go(s)
ok("fifo_layer_consumed" in types(b), "this assembly's own layer consumed blocks even if an identical one is untouched")

s = scenario(movs=scenario()["movs"] + [mov(500, "GDL", "OUT", "A1", 3, 1, trx="GD/001")])
p, b = go(s)
ok(b["hasConflicts"] == 0 and len(b["subtracts"]) == 1, "a sale of older stock of the same item does not block")

s = scenario(movs=[mov(1, "IA", "OUT", "C1", 5, 1), mov(2, "IA", "OUT", "C1", 3, 1.2, bin="BIN2"),
                   mov(100, "IA", "IN", "A1", 1, 8.6)],
             fifo=[layer(101, "A1", 1, 8.6)], items=[item("A1"), item("C1")],
             cost=[{"t": "FIFO", "material_id": x, "cnt": 1} for x in ("A1", "C1")])
p, b = go(s)
ok(b["hasConflicts"] == 0 and sorted((a["location_id"], a["quantity"]) for a in b["adds"]) == [("BIN1", 5), ("BIN2", 3)],
   "one component picked from two bins goes back to each bin")

print("WEIGHTED AVERAGE")
wa_items = [item("A1", method="Weighted Average"), item("C1"), item("C2")]
wa_cost = [{"t": "WA", "material_id": "A1", "cnt": 1}, {"t": "FIFO", "material_id": "C1", "cnt": 1},
           {"t": "FIFO", "material_id": "C2", "cnt": 1}]
wa_movs = [mov(1, "IA", "OUT", "C1", 5, 1), mov(2, "IA", "OUT", "C2", 5, 1),
           mov(100, "IA", "IN", "A1", 1, 10, method="Weighted Average")]
# 10 @ 1.0000 before, plus 1 @ 10 -> 11 @ 1.8182
s = scenario(items=wa_items, cost=wa_cost, movs=wa_movs, fifo=[],
             wa=[{"id": "WA1", "material_id": "A1", "batch_id": None, "wa_quantity": "11.000", "wa_cost_price": "1.8182"}])
p, b = go(s)
sub = b["subtracts"][0]
ok(b["hasConflicts"] == 0 and sub["hasWaUpdate"] == 1 and sub["waQuantity"] == "10.000", "WA pool quantity backs out to 10")
ok(abs(float(sub["waCostPrice"]) - 1.0) < 0.0005, "WA price backs out to ~1.0000 (" + sub["waCostPrice"] + ")")
s["wa"][0]["wa_quantity"] = "0.500"
p, b = go(s)
ok("wa_qty_short" in types(b), "WA pool smaller than the assembly output blocks")

s = scenario(items=[item("A1", method="Weighted Average", batch=1), item("C1"), item("C2")], cost=wa_cost, fifo=[],
             movs=wa_movs[:2] + [mov(100, "IA", "IN", "A1", 1, 10, batch="BT9", method="Weighted Average")],
             batch=[{"id": "BT9", "material_id": "A1", "batch_number": "LOT-1", "transaction_no": IA_NO}],
             batchbal=[bal("A1", 1, batch="BT9")],
             wa=[{"id": "WA9", "material_id": "A1", "batch_id": "BT9", "wa_quantity": "1.000", "wa_cost_price": "10.0000"}])
p, b = go(s)
ok(b["hasConflicts"] == 0 and b["subtracts"][0]["waDeleteId"] == "WA9" and b["subtracts"][0]["batch_id"] == "BT9",
   "WA batch item: its batch costing row is removed")
ok(b["batchDeletes"] == [{"id": "BT9"}], "the batch the assembly minted is removed once it is empty")
s["batchbal"] = [bal("A1", 3, batch="BT9")]
p, b = go(s)
ok(b["hasConflicts"] == 0 and b["batchDeletes"] == [], "a batch still holding other stock is kept")

print("HANDLING UNITS")
s = scenario(movs=[mov(1, "IA", "OUT", "C1", 5, 1, hu="H1"), mov(2, "IA", "OUT", "C2", 5, 1),
                   mov(100, "IA", "IN", "A1", 1, 10)], hu=[hu()])
p, b = go(s)
c1 = [a for a in b["adds"] if a["material_id"] == "C1"][0]
ok(b["hasConflicts"] == 0 and c1["hasHuLoad"] == 1 and c1["handling_unit_id"] == "H1", "HU pick is loaded back")
ok(c1["huItems"][0]["balance_id"] == "BAL-C1" and c1["huItems"][0]["quantity"] == 5,
   "load reuses the emptied line's balance id so it re-activates")
ok(c1["huLocationId"] == "BIN1" and c1["huStorageLocationId"] == "SL1", "HU's own bin is echoed back")
ok(no_empty_strings(b), "HU payload has no '' in nullable params")

for want, h in [("hu_missing", []), ("hu_status", [hu(status="Packed")]),
                ("hu_nested", [hu(parent_hu_id="HP")]), ("hu_moved", [hu(bin="BIN9")]),
                ("hu_line_missing", [hu(lines=[{"material_id": "C9", "balance_id": "X", "batch_id": "", "quantity": 1}])])]:
    s = scenario(movs=[mov(1, "IA", "OUT", "C1", 5, 1, hu="H1"), mov(100, "IA", "IN", "A1", 1, 10)], hu=h)
    p, b = go(s)
    ok(want in types(b), want + " detected " + str(types(b)))

print("PAIRING")
full = scenario()["movs"] + [mov(200, "IA-R", "OUT", "A1", 1, 10), mov(201, "IA-R", "IN", "C1", 5, 1),
                             mov(202, "IA-R", "IN", "C2", 5, 1)]
p, b = go(scenario(movs=full))
ok(p["headerOnly"] == 1 and b["subtracts"] == [] and b["adds"] == [],
   "fully reversed stock whose header update failed: only the header is left to do")
part = scenario()["movs"] + [mov(200, "IA-R", "OUT", "A1", 1, 10), mov(201, "IA-R", "IN", "C1", 5, 1)]
p, b = go(scenario(movs=part, fifo=[]))
ok([r["item_id"] for r in p["liveOut"]] == ["C2"] and p["liveIn"] == [], "after a partial run only C2 is still live")
ok(b["hasConflicts"] == 0 and len(b["adds"]) == 1 and b["subtracts"] == [], "a retry finishes the remaining component only")
p, b = go(scenario(movs=scenario()["movs"] + [mov(300, "IA", "OUT", "C1", 7, 1, trx="IA-OTHER")]))
ok(len(b["adds"]) == 2, "a movement under another number is ignored")

print("REFUSALS")
for over, word in [(dict(item_assembly_status="Draft"), "Completed"),
                   (dict(item_assembly_status="Fully Posted"), "posted"),
                   (dict(posted_status="Posted"), "posted")]:
    p, b = go(scenario(ia=dict(scenario()["ia"], **over)))
    ok(p["refuse"] == 1 and word.lower() in p["refuseMessage"].lower(), str(over) + " refused: " + p["refuseMessage"])
p, b = go(scenario(ia=None))
ok(p["refuse"] == 1 and "not found" in p["refuseMessage"], "missing record refused")

print("CONFLICTS")
cases = [
    ("balance_short", dict(itembal=[bal("A1", 0)])),
    ("balance_missing", dict(itembal=[])),
    ("fifo_layer_consumed", dict(fifo=[layer(101, "A1", 1, 10, avail=0)])),
    ("fifo_layer_missing", dict(fifo=[])),
    ("costing_inconsistent", dict(cost=scenario()["cost"] + [{"t": "WA", "material_id": "C1", "cnt": 1}])),
    ("costing_method_changed", dict(items=[item("A1", method="Weighted Average"), item("C1"), item("C2")])),
    ("stock_control_changed", dict(items=[item("A1"), item("C1", stock=0), item("C2")])),
    ("uom_conversion_changed", dict(items=[item("A1", conv=[{"alt_uom_id": "UOM_BASE", "base_qty": 2}]), item("C1"), item("C2")])),
    ("item_missing", dict(items=[item("A1"), item("C1")])),
    ("wa_row_missing", dict(items=wa_items, cost=wa_cost, movs=wa_movs, fifo=[], wa=[])),
    ("fetch_truncated", dict(itembal=[dict(bal("A1", 1001), id="IB" + str(i)) for i in range(1000)])),
]
for want, over in cases:
    p, b = go(scenario(**over))
    ok(want in types(b), want + " detected " + str(types(b)))
    ok(b["subtracts"] == [] and b["adds"] == [] and b["batchDeletes"] == [] and b["hasSubtracts"] == 0
       and b["hasAdds"] == 0 and b["hasBatchDeletes"] == 0, "  ...and nothing is queued for writing")

print("GENERATED WORKFLOW")
def body_params(nid):
    return {x["prop"]: (x["valueType"], x["value"]) for x in M[nid]["data"]["body_params"]["list"]}
sp = body_params("workflow_node_iaRvSubtract")
ok(sp["isMovingInv"] == ("value", 1) and sp["transaction_type"] == ("value", "IA-R"), "SUBTRACT: IA-R, isMovingInv 1")
ap = body_params("workflow_node_iaRvAdd")
ok(ap["isMovingInv"] == ("value", 0) and ap["batch_number"] == ("value", "-"), "ADD: isMovingInv 0, batch_number '-'")
hp = body_params("workflow_node_iaRvHuLoad")
ok(hp["process_type"] == ("value", "load") and "organization_id" in hp, "HU: load with organization_id")
upd = {x["prop"]: x["value"] for x in M["update_node_iaRvIa"]["data"]["props"]["list"]}
ok(upd == {"item_assembly_status": "Draft", "posted_status": ""}, "header goes to Draft and keeps its number")

print()
if FAILED:
    print(str(len(FAILED)) + " FAILED:")
    for f in FAILED:
        print("  - " + f)
    sys.exit(1)
print("all assertions passed")
