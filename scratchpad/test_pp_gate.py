import sys, json
sys.path.insert(0, "scratchpad")
from harness import load, run

M = load("Picking Plan/PPheadWorkflow.json")
GATE = M["code_node_pp_gate"]["data"]["script"]["code"]
IDS  = M["code_node_pp_gate_ids"]["data"]["script"]["code"]
FMT  = M["code_node_8Z1krUr1"]["data"]["script"]["code"]

PP, L1 = "PP1", "L1"

def line(lid, to_qty, picked, item="ITEM_A", status="Completed"):
    return {"id": lid, "material_id": item, "material_name": "Widget",
            "to_material_desc": "", "to_qty": to_qty, "picked_qty": picked,
            "to_order_quantity": to_qty, "to_delivered_qty": 0,
            "to_undelivered_qty": 0, "to_initial_delivered_qty": 0,
            "unit_price": 1, "total_price": to_qty, "picking_status": status}

def pp(lines, status="Completed"):
    return {"id": PP, "to_no": "CA-1", "picking_status": status,
            "to_total": 0, "table_to": lines}

def resv(line_id, target=PP, status="Allocated"):
    return {"doc_line_id": line_id, "target_gd_id": target, "status": status,
            "doc_type": "Picking Plan", "reserved_qty": 5}

def picking(processing=0, to_status="Completed"):
    return {"id": "TO1", "to_id": "PK-001", "to_status": to_status,
            "is_processing": processing}

def gate(before, after, res=None, picks=None, isPicking=None, saveAs="Created", gd=None):
    return run(GATE, {"wp": {"saveAs": saveAs, "isPicking": isPicking, "allData": after},
        "node": {"get_node_zG6KDDEF": {"data": {"data": before}},
                 "search_node_pp_reserved": {"data": {"data": res if res is not None else [resv(L1)]}},
                 "search_node_pp_pickings": {"data": {"data": picks if picks is not None else [picking()]}},
                 "search_node_pp_gd_claims": {"data": {"data": gd or []}}}})

def show(name, r):
    tag = "BLOCK" if r["blockEdit"] else "allow"
    print(f"  {name:44} {tag}  lines={r['lineStatusOverrides']} hdr={r['headerPickingStatus'] or '-'}")
    if r["blockEdit"]: print(f"      -> {r['blockMessage'][:104]}")
    return r

print("SCENARIOS (PP edit gate)")
before = pp([line(L1, 5, 5)])

r = show("qty 5 -> 8 (5 picked)", gate(before, pp([line(L1, 8, 5)])))
assert r["blockEdit"] == 0 and r["lineStatusOverrides"][L1] == "In Progress"
assert r["headerPickingStatus"] == "In Progress"

r = show("no change", gate(before, pp([line(L1, 5, 5)])))
assert r["blockEdit"] == 0 and r["lineStatusOverrides"][L1] == "Completed"
assert r["headerPickingStatus"] == "Completed"

r = show("qty 8 -> 5, 5 picked (down to picked)",
         gate(pp([line(L1, 8, 5)]), pp([line(L1, 5, 5)])))
assert r["blockEdit"] == 0 and r["lineStatusOverrides"][L1] == "Completed"

r = show("qty 5 -> 3, 5 picked (below picked)", gate(before, pp([line(L1, 3, 5)])))
assert r["blockEdit"] == 1 and "reducing it" in r["blockMessage"].lower()

r = show("picked line deleted", gate(before, pp([])))
assert r["blockEdit"] == 1 and "cannot be removed" in r["blockMessage"]

r = show("item changed on a picked line",
         gate(before, pp([line(L1, 5, 5, item="ITEM_B")])))
assert r["blockEdit"] == 1 and "item on that row" in r["blockMessage"]

r = show("reservation claimed by a GD",
         gate(before, pp([line(L1, 8, 5)]), res=[resv(L1, target="GD-99")]))
assert r["blockEdit"] == 1 and "Goods Delivery" in r["blockMessage"]

r = show("reservation Delivered",
         gate(before, pp([line(L1, 8, 5)]), res=[resv(L1, target="GD-99", status="Delivered")]))
assert r["blockEdit"] == 1

r = show("picker mid-confirm (open Picking)",
         gate(before, pp([line(L1, 8, 5)]),
              picks=[picking(processing=1, to_status="Created")]))
assert r["blockEdit"] == 1 and "device" in r["blockMessage"]

r = show("nothing picked yet (untouched path)",
         gate(pp([line(L1, 5, 0, status="Created")], status="Created"),
              pp([line(L1, 8, 0, status="Created")], status="Created")))
assert r["blockEdit"] == 0 and r["lineStatusOverrides"] == {} and r["headerPickingStatus"] == ""

r = show("picking re-invoke (isPicking=Yes)",
         gate(before, pp([line(L1, 8, 5)]), isPicking="Yes"))
assert r["blockEdit"] == 0 and r["lineStatusOverrides"] == {}

# --- the ids extractor -------------------------------------------------
ids = run(IDS, {"wp": {}, "node": {"get_node_zG6KDDEF": {"data": {"data": before}}}})
print(f"  ids extractor                                lineIds={ids['lineIds']} ppId={ids['ppId']}")
assert ids["lineIds"] == [L1] and ids["ppId"] == [PP]
empty = run(IDS, {"wp": {}, "node": {"get_node_zG6KDDEF": {"data": {"data": pp([])}}}})
assert empty["lineIds"] == ["__none__"], "empty equalAny would match everything"

# --- the override actually lands on table_to ---------------------------
g = gate(before, pp([line(L1, 8, 5)]))
out = run(FMT, {"wp": {}, "node": {
    "code_node_Nj60Z2XF": {"data": {"allData": pp([line(L1, 8, 5)])}},
    "code_node_pp_gate": {"data": g}}})
row = out["allData"]["table_to"][0]
print(f"  formatter applied override                   picking_status={row['picking_status']} "
      f"to_qty={row['to_qty']} header={out['allData']['picking_status']}")
assert row["picking_status"] == "In Progress"
assert row["to_qty"] == "8.000"
assert out["allData"]["picking_status"] == "In Progress"

# --- a Goods Delivery at Created writes NO reservation row, so the delivery
# --- line itself is the only evidence it has claimed the plan
r = show("GD at Created claims the line (no reservation)",
         gate(before, pp([line(L1, 8, 5)]), gd=[{"pp_line_item_id": L1}]))
assert r["blockEdit"] == 1 and "Goods Delivery" in r["blockMessage"]

# --- an open (Created) Picking is as dangerous as a picked one for removals
openpick = [picking(to_status="Created")]
fresh = pp([line(L1, 5, 0, status="Created")], status="Created")

r = show("open Picking + line deleted", gate(fresh, pp([]), picks=openpick))
assert r["blockEdit"] == 1

r = show("open Picking + reduce below its qty",
         gate(fresh, pp([line(L1, 2, 0, status="Created")], status="Created"), picks=openpick))
assert r["blockEdit"] == 1, "reducing under an open Picking makes it unclosable forever"

r = show("open Picking + raise (still allowed)",
         gate(fresh, pp([line(L1, 9, 0, status="Created")], status="Created"), picks=openpick))
assert r["blockEdit"] == 0

# --- is_processing is honoured only on an open Picking; it leaks on terminal ones
r = show("stale is_processing on a Completed Picking",
         gate(before, pp([line(L1, 8, 5)]), picks=[picking(processing=1, to_status="Completed")]))
assert r["blockEdit"] == 0, "a leaked flag on a terminal Picking must not lock the plan forever"

# --- Completed with nothing picked = delivered straight to a GD; leave it alone
two = pp([line(L1, 5, 5), line("L2", 4, 0, status="Completed")])
r = show("Completed line with 0 picked is not re-offered",
         gate(two, pp([line(L1, 8, 5), line("L2", 4, 0, status="Completed")])))
assert r["blockEdit"] == 0
assert "L2" not in r["lineStatusOverrides"], "would have been sent back to Created"

# --- the binding check: the assertion that would have caught the dead write ----
import json as _json
_wf = _json.load(open("Picking Plan/PPheadWorkflow.json", encoding="utf-8"))
def _idx(nodes, m):
    for n in nodes:
        if isinstance(n, dict):
            if n.get("id"): m[n["id"]] = n
            _idx(n.get("blocks") or [], m)
    return m
_m = _idx(_wf["nodes"], {})
_bad = []
for nid in ("update_node_tAcAOGma", "update_node_t5agKmTu", "add_node_hafE02oF",
            "update_node_xlKOU7K6", "add_node_XdkCKta4"):
    for prop in (_m[nid]["data"].get("props") or {}).get("list", []):
        if prop.get("prop") in ("picking_status", "table_to"):
            if "code_node_8Z1krUr1" not in str(prop.get("value")):
                _bad.append((nid, prop["prop"], prop.get("value")))
print(f"  persistence nodes bound to the formatter          {'OK' if not _bad else _bad}")
assert not _bad, "a value computed in code_node_8Z1krUr1 that is bound from an earlier node is a dead write"

print("\nall PP gate scenarios passed")
