"""SO line UOM change must cascade into the Created GD (restamp + re-allocate)."""
import sys, json
sys.path.insert(0, "scratchpad")
from harness import load, run

C = load("Sales Order/SOcascadeDownstreamWorkflow.json")
DIFF = C["code_cd_diff"]["data"]["script"]["code"]
PLAN = C["code_cd_plan"]["data"]["script"]["code"]
S = load("Sales Order/SOsaveWorkflow.json")
GATE = S["code_node_CascadeGate"]["data"]["script"]["code"]

UNIT, BOX, ITEM = "392", "386", "IT1"
ITEMDATA = {"id": ITEM, "based_uom": UNIT, "material_name": "JN-2", "material_code": "JN-2",
            "table_uom_conversion": [{"alt_uom_id": UNIT, "base_qty": 1},
                                     {"alt_uom_id": BOX, "base_qty": 10}]}

def soline(uom, qty=10, item=ITEM, **kw):
    r = {"id": "SOL1", "item_name": item, "so_quantity": qty, "so_item_uom": uom,
         "so_desc": "JN-2", "item_id": "JN-2", "line_index": "1", "delivered_qty": 0,
         "planned_qty": 0, "packing_conversion": 1, "weight_conversion": 0,
         "packing_uom": ""}
    r.update(kw); return r

def gdline(uom, qty=10, base=10):
    return {"id": "GDL1", "material_id": ITEM, "gd_qty": qty, "gd_order_quantity": qty,
            "gd_initial_delivered_qty": 0, "base_qty": base, "gd_order_uom_id": uom,
            "good_delivery_uom_id": uom, "so_line_item_id": "SOL1",
            "temp_qty_data": json.dumps([{"location_id": "BIN1", "gd_quantity": qty}]),
            "picked_temp_qty_data": "[]", "packing_conversion": 1, "weight_conversion": 0}

def gd(status="Created", uom=UNIT, qty=10, base=10):
    return {"id": "GD1", "delivery_no": "GD/001", "gd_status": status, "plant_id": "PL1",
            "organization_id": "ORG1", "table_gd": [gdline(uom, qty, base)]}

def pp(status="Created", qty=10):
    return {"id": "PP1", "to_id": "PP/001", "to_status": status,
            "table_to": [{"id": "PPL1", "material_id": ITEM, "to_qty": qty,
                          "to_order_quantity": qty, "picked_qty": 0,
                          "so_line_item_id": "SOL1", "temp_qty_data": "[]",
                          "picked_temp_qty_data": "[]"}]}

def diff(prev, nxt, passNo=1):
    return run(DIFF, {"wp": {"passNo": passNo, "prev_table_so": prev, "next_table_so": nxt}})

def plan(changes, gds, pps=None, raise_ans="", passNo=1):
    return run(PLAN, {"wp": {"passNo": passNo, "raiseGdQty": raise_ans},
                      "node": {"code_cd_diff": {"data": {"changes": changes}},
                               "search_cd_gds": {"data": {"data": gds}},
                               "search_cd_pps": {"data": {"data": pps or []}},
                               "search_cd_items": {"data": {"data": [ITEMDATA]}},
                               "get_cd_setup": {"data": {"data": []}}}})

fails = []
def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (("  -- " + str(detail)) if not cond and detail else ""))
    if not cond: fails.append(name)

print("== gate (SO_SAVE) ==")
g = run(GATE, {"node": {"get_node_rvjWbHBF": {"data": {"data": [{"id": "SO1", "table_so": [soline(UNIT)]}]}},
                        "code_node_rPqQy5CD": {"data": {"table": {"table_so": [soline(BOX)]}}}},
               "wp": {"allData": {"id": "SO1"}}})
check("UOM-only edit sets needsCascade", g["needsCascade"] == 1, g)
g2 = run(GATE, {"node": {"get_node_rvjWbHBF": {"data": {"data": [{"id": "SO1", "table_so": [soline(UNIT)]}]}},
                         "code_node_rPqQy5CD": {"data": {"table": {"table_so": [soline(UNIT)]}}}},
                "wp": {"allData": {"id": "SO1"}}})
check("unchanged line still skips cascade", g2["needsCascade"] == 0, g2)

print("== diff ==")
d = diff([soline(UNIT)], [soline(BOX)])
check("UOM-only -> kind 'uom'", d["changeCount"] == 1 and d["changes"][0]["kind"] == "uom", d)
check("carries prevUom/nextUom",
      d["changes"][0]["prevUom"] == UNIT and d["changes"][0]["nextUom"] == BOX, d["changes"][0])
check("item is fetched for the change", ITEM in d["materialIds"], d["materialIds"])
dq = diff([soline(UNIT)], [soline(UNIT, qty=15)])
check("pure qty change unaffected", dq["changes"][0]["kind"] == "qty", dq)
ds = diff([soline(UNIT)], [soline(UNIT, item="IT2")])
check("item swap unaffected", ds["changes"][0]["kind"] == "swap", ds)
dn = diff([soline(UNIT)], [soline(UNIT)])
check("no change -> nothing", dn["changeCount"] == 0, dn)

print("== plan: UNIT -> BOX on a Created GD ==")
ch = d["changes"]
p = plan(ch, [gd()])
check("asks the 414 raise confirm", p["blockCode"] == "414", p.get("blockCode"))
check("raise names the new unit", "1 -> 10" in p.get("blockMessage", ""), p.get("blockMessage"))

p = plan(ch, [gd()], raise_ans="Yes")
row = p["gdDrafts"][0]["allData"]["table_gd"][0]
req = p["allocRequests"][0]
check("not blocked", p["blocked"] == 0, p.get("blockMessage"))
check("gd_order_uom_id restamped", row["gd_order_uom_id"] == BOX, row["gd_order_uom_id"])
check("good_delivery_uom_id restamped", row["good_delivery_uom_id"] == BOX, row["good_delivery_uom_id"])
check("gd_qty in new unit", row["gd_qty"] == "10.000", row["gd_qty"])
check("gd_order_quantity restamped", row["gd_order_quantity"] == "10.000", row["gd_order_quantity"])
check("allocation cleared for re-serve", row["temp_qty_data"] == "[]", row["temp_qty_data"])
check("base factor = new unit factor", row["_baseFactor"] == 10, row["_baseFactor"])
check("alloc request in new unit", req["orderUomId"] == BOX and req["quantity"] == 10, req)
check("alloc keeps the same item", req["material_id"] == ITEM, req["material_id"])
check("conversions restated", row["packing_conversion"] == "1.000" and row["weight_conversion"] == "0.000", row)

p = plan(ch, [gd()], raise_ans="No")
row = p["gdDrafts"][0]["allData"]["table_gd"][0]
check("'No' keeps the original base qty (1 BOX = 10 UNIT)", row["gd_qty"] == "1.000", row["gd_qty"])
check("'No' still restamps the unit", row["gd_order_uom_id"] == BOX, row["gd_order_uom_id"])

print("== plan: BOX -> UNIT (base decrease) ==")
d2 = diff([soline(BOX)], [soline(UNIT)])
p = plan(d2["changes"], [gd(uom=BOX, qty=10, base=100)], raise_ans="")
check("reduction needs no raise confirm", p["blockCode"] == "", p.get("blockCode"))
row = p["gdDrafts"][0]["allData"]["table_gd"][0]
check("restated down to 10 UNIT", row["gd_qty"] == "10.000", row["gd_qty"])
check("unit restamped to UNIT", row["gd_order_uom_id"] == UNIT, row["gd_order_uom_id"])
check("base factor = 1", row["_baseFactor"] == 1, row["_baseFactor"])

print("== refusals ==")
p = plan(ch, [gd(status="Completed")])
check("delivered line refuses a unit change", p["blockCode"] == "406" and "unit of measure" in p["blockMessage"], p.get("blockMessage"))
p = plan(ch, [gd()], pps=[pp("Created")])
check("live plan refuses a unit change", p["blockCode"] == "406" and "Picking Plan" in p["blockMessage"], p.get("blockMessage"))
p = plan(ch, [gd()], pps=[pp("Completed")])
check("completed plan refuses a unit change", p["blockCode"] == "406", p.get("blockMessage"))
bad = json.loads(json.dumps(ch)); bad[0]["nextUom"] = "999"
p = plan(bad, [gd()])
check("unconvertible unit is refused, not guessed",
      p["blockCode"] == "406" and "no conversion" in p["blockMessage"], p.get("blockMessage"))

print("== regression: qty + swap still behave ==")
p = plan(dq["changes"], [gd()], raise_ans="Yes")
row = p["gdDrafts"][0]["allData"]["table_gd"][0]
check("qty raise unchanged", p["blocked"] == 0 and row["gd_order_quantity"] == "15.000", row)
check("qty path keeps its unit", row["gd_order_uom_id"] == UNIT if "gd_order_uom_id" in row else True, row.get("gd_order_uom_id"))
p = plan(ds["changes"], [gd()], raise_ans="Yes")
row = p["gdDrafts"][0]["allData"]["table_gd"][0]
check("swap still swaps the item", row["material_id"] == "IT2", row["material_id"])


print("== pipeline: plan -> payloads (final written row) ==")
PAY = C["code_cd_payloads"]["data"]["script"]["code"]
p = plan(ch, [gd()], raise_ans="Yes")
# GLOBAL_ALLOCATION answers in the request's unit: 10 BOX served out of one bin.
alloc = [{"key": "GD1|GDL1", "code": "200",
          "allocationData": [{"location_id": "BIN1", "batch_id": None,
                              "unrestricted_qty": 200, "gd_quantity": 10,
                              "balance_id": "BAL1"}]}]
out = run(PAY, {"wp": {"passNo": 1},
                "node": {"code_cd_plan": {"data": {"gdDrafts": p["gdDrafts"], "ppDrafts": []}},
                         "code_cd_diff": {"data": {"changes": ch}},
                         "get_cd_alloc_final": {"data": alloc},
                         "search_cd_gds": {"data": {"data": [gd()]}},
                         "search_cd_items": {"data": {"data": [ITEMDATA]}},
                         "search_cd_bins": {"data": {"data": [{"id": "BIN1", "bin_location_combine": "A-01"}]}},
                         "search_cd_uoms": {"data": {"data": [{"id": BOX, "uom_name": "BOX"},
                                                              {"id": UNIT, "uom_name": "UNIT"}]}},
                         "search_cd_batches": {"data": {"data": []}}}})
row = out["gdPayloads"][0]["allData"]["table_gd"][0]
check("allocation succeeded", out["allocFailed"] == 0, out.get("allocMessage"))
check("final gd_qty = 10 BOX", row["gd_qty"] == "10.000", row["gd_qty"])
check("final base_qty = 100 UNIT", row["base_qty"] == "100.000", row["base_qty"])
check("summary renders the new unit", "BOX" in row["view_stock"], row["view_stock"])
check("no internal keys leak",
      not any(k in row for k in ("_reallocate", "_baseFactor", "_viewStock")), list(row))
check("temp_qty_data sums to gd_qty",
      sum(e["gd_quantity"] for e in json.loads(row["temp_qty_data"])) == 10, row["temp_qty_data"])

print()
print(("ALL PASS" if not fails else "FAILURES: " + ", ".join(fails)))
sys.exit(1 if fails else 0)
