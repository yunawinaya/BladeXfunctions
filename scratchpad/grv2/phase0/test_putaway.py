"""Phase 0 Putaway tests (read-only on dev):
  1. PUTAWAY_LOOP guard logic on sample inputs (size guard, lock decision);
  2. the new lock-gate SQL against real TOs;
  3. PUTAWAY's new Item / in-transit reads vs what the old search-nodes returned in recorded dev runs, and the movement
     builder re-run with the bridged items vs its recorded output;
  4. the stored-pending check on sample inputs.
Usage: python3 test_putaway.py [run_id ...]"""
import json
import sys

from test_guards import expect, run_js, run_sql
import test_guards
from dbq import q
from lib import find, load

RUNS = sys.argv[1:] or ["2105945867283509249", "2102383812536561666", "2102330039592153089"]


def loop_tests():
    doc = json.loads(load("Putaway/PutawayLoopWorkflow.json"))
    pick = find(doc, "code_node_kku8SAT9")["data"]["script"]["code"]
    rows = lambda n: json.dumps({"id": "2101", "to_status": "Created", "to_id_type": -9999, "to_id": "TO-1",
                                 "table_putaway_item": [{"line_index": i + 1, "putaway_qty": 1} for i in range(n)]})
    for label, n, save_as, want in (("Completed 500", 500, "Completed", {"isInvalid": 0}),
                                    ("Completed 501", 501, "Completed", {"isInvalid": 1}),
                                    ("Draft 2000", 2000, "Draft", {"isInvalid": 0})):
        got = run_js(pick, {"workflowparams:arrayData": "[" + rows(n) + "]", "node:get_cache_node_OMu4rhrM.data": '"0"',
                            "workflowparams:saveAs": json.dumps(save_as), "workflowparams:pageStatus": '"Edit"'})
        expect("LOOP size " + label, got, want)
    decide = find(doc, "code_node_LockDecide")["data"]["script"]["code"]
    for label, row, want in (("free", {"id": "1", "to_status": "Created", "is_processing": 0, "lock_age_sec": 5, "open_jobs": 0, "gr_status": "Received"}, 0),
                             ("open job", {"id": "1", "to_status": "Created", "is_processing": 0, "lock_age_sec": 5, "open_jobs": 1, "gr_status": "Received"}, 1),
                             ("GR Processing", {"id": "1", "to_status": "In Progress", "is_processing": 0, "lock_age_sec": 5, "open_jobs": 0, "gr_status": "Processing"}, 1),
                             ("stale lock + open job", {"id": "1", "to_status": "Created", "is_processing": 1, "lock_age_sec": 5000, "open_jobs": 2, "gr_status": "Received"}, 1),
                             ("stale lock only", {"id": "1", "to_status": "Created", "is_processing": 1, "lock_age_sec": 5000, "open_jobs": 0, "gr_status": "Received"}, 0),
                             ("Completed + open job", {"id": "1", "to_status": "Completed", "is_processing": 0, "lock_age_sec": 5, "open_jobs": 1, "gr_status": "Processing"}, 2)):
        expect("LOOP decide " + label, run_js(decide, {"node:sql_node_LockGate.data": json.dumps([row])}), {"lockState": want})
    gate = find(doc, "sql_node_LockGate")["data"]["script"]["code"]
    tos = q("--dev", "SELECT CAST(id AS CHAR) id, tenant_id FROM transfer_order_putaway WHERE is_deleted=0 ORDER BY id DESC LIMIT 3")
    for t in tos:
        run_sql("LOOP lock gate TO " + t["id"], gate, {"node:code_node_kku8SAT9.data.lockId": t["id"]})
    run_sql("LOOP lock gate id 0", gate, {"node:code_node_kku8SAT9.data.lockId": "0"})


def recorded(run_id):
    r = q("--dev", "SELECT tenant_id, nodes_data FROM su_code_workflow_inst WHERE id=%s" % run_id)[0]
    out = {}
    for n in json.loads(r["nodes_data"] or "[]"):
        if not n.get("node_id"):
            continue
        try:
            out[n["node_id"]] = json.loads(n.get("response_json_data") or "null")
        except ValueError:
            out[n["node_id"]] = None
    return r["tenant_id"], out


def norm(v):
    """The shape a code node sees: big ids as strings, numbers to 8 dp, NULL / empty / absent alike."""
    if isinstance(v, dict):
        return {k: norm(x) for k, x in v.items() if x is not None and x != ""}
    if isinstance(v, list):
        return [norm(x) for x in v]
    if isinstance(v, bool):
        return v
    if isinstance(v, int) and abs(v) >= 10 ** 15:
        return str(v)
    if isinstance(v, (int, float)):
        return round(float(v), 8)
    return v


def data_of(node_out):
    d = (node_out or {}).get("data")
    return d


# platform system columns: the search-node returns them, code_node_ITmatch and its clone add-node read none of them
SYSTEM = ("create_dept", "create_time", "create_user", "update_time", "update_user", "is_deleted", "tenant_id", "sub_tenant_id")


def putaway_reads(run_id):
    doc = json.loads(load("Putaway/PutawayProcessWorkflow.json"))
    tenant, rec = recorded(run_id)
    qf = data_of(rec.get("code_node_qfSZO0bi")) or {}
    keys = run_js(find(doc, "code_node_PwKeys")["data"]["script"]["code"], {
        "node:code_node_qfSZO0bi.data.uniqueItemCodes": json.dumps(qf.get("uniqueItemCodes") or []),
        "node:code_node_qfSZO0bi.data.grId": json.dumps(qf.get("grId") or ""),
        "node:code_node_qfSZO0bi.data.organizationId": json.dumps(qf.get("organizationId") or "")})
    print("     run %s tenant %s keys %s" % (run_id, tenant, keys))
    vals = {"system:tenantId": tenant, "node:code_node_PwKeys.data.itemIdsCsv": keys["itemIdsCsv"],
            "node:code_node_PwKeys.data.grId": keys["grId"], "node:code_node_PwKeys.data.orgId": keys["orgId"]}
    item_rows = run_sql("PUTAWAY items SQL (%s)" % run_id, find(doc, "sql_node_PwItems")["data"]["script"]["code"], vals)
    items = run_js(find(doc, "code_node_PwItems")["data"]["script"]["code"], {"node:sql_node_PwItems.data": json.dumps(item_rows or [])})["items"]
    old_items = (data_of(rec.get("search_node_6yzlT81I")) or {}).get("data") or []
    old_by = {str(i.get("id")): i for i in old_items}
    for it in items:
        o = old_by.get(it["id"])
        if not o:
            expect("item %s present in old read" % it["id"], {"x": 0}, {"x": 1})
            continue
        pick = lambda x: norm({"based_uom": x.get("based_uom"), "item_batch_management": x.get("item_batch_management"),
                               "material_costing_method": x.get("material_costing_method"),
                               "table_uom_conversion": sorted([{"alt_uom_id": c.get("alt_uom_id"), "base_qty": c.get("base_qty")} for c in (x.get("table_uom_conversion") or [])], key=lambda c: str(c.get("alt_uom_id")))})
        want, got = pick(o), pick(it)
        expect("item %s fields = old search (%s)" % (it["id"], run_id), got, want)
    expect("item count (%s)" % run_id, {"n": len(items)}, {"n": len(old_items)})

    # movement builder: recorded inputs + bridged items -> recorded output
    m7 = find(doc, "code_node_M7XzDZ48")["data"]["script"]["code"]
    req = json.loads(q("--dev", "SELECT request_json_data FROM su_code_workflow_inst WHERE id=%s" % run_id)[0]["request_json_data"])
    all_data = (req.get("request_json") or req.get("workflowparams") or {}).get("allData")
    got = run_js(m7, {"workflowparams:allData": json.dumps(all_data), "node:code_node_qfSZO0bi.data.itemsToProcess": json.dumps(qf.get("itemsToProcess") or []),
                      "node:code_node_PwItems.data.items": json.dumps(items)})
    old_m7 = data_of(rec.get("code_node_M7XzDZ48")) or {}
    same = norm(got.get("inventoryMovements")) == norm(old_m7.get("inventoryMovements"))
    if not same:
        for a, b in zip(norm(got.get("inventoryMovements")) or [], norm(old_m7.get("inventoryMovements")) or []):
            if a != b:
                print("     first diff:", {k: (a.get(k), b.get(k)) for k in set(a) | set(b) if a.get(k) != b.get(k)})
                break
    expect("movements identical to recorded (%s)" % run_id, {"same": same}, {"same": True})

    t_rows = run_sql("PUTAWAY transit SQL (%s)" % run_id, find(doc, "sql_node_PwTransit")["data"]["script"]["code"], vals)
    rows = run_js(find(doc, "code_node_PwTransit")["data"]["script"]["code"], {"node:sql_node_PwTransit.data": json.dumps(t_rows or [])})["rows"]
    old_rows = (data_of(rec.get("search_node_ITopen")) or {}).get("data") or []
    old_by = {str(r.get("id")): r for r in old_rows}
    static = ["doc_type", "doc_id", "doc_no", "doc_line_id", "line_no", "material_id", "item_code", "item_uom", "batch_id", "plant_id",
              "organization_id", "transit_bin", "from_bin", "from_category", "to_category", "transit_date", "source_transit_id"]
    for r in rows:
        o = old_by.get(r["id"])
        if not o:
            continue
        expect("transit %s static fields = old search" % r["id"], norm({k: r.get(k) for k in static}), norm({k: o.get(k) for k in static}))
        expect("transit %s keys = old search keys" % r["id"], {"keys": sorted(k for k in norm(r) if k not in ("status", "received_qty", "open_qty", "transit_qty", "to_bin", "to_category", "received_date", "target_doc_type", "target_doc_id", "target_doc_no", "target_doc_line_id"))},
               {"keys": sorted(k for k in norm(o) if k not in ("status", "received_qty", "open_qty", "transit_qty", "to_bin", "to_category", "received_date", "target_doc_type", "target_doc_id", "target_doc_no", "target_doc_line_id") and k not in SYSTEM)})
        expect("transit %s quantities are numbers" % r["id"], {k: isinstance(r.get(k), (int, float)) for k in ("received_qty", "open_qty", "transit_qty")}, {k: True for k in ("received_qty", "open_qty", "transit_qty")})
    print("     transit rows now %d, recorded %d (matched %d)" % (len(rows), len(old_rows), sum(1 for r in rows if r["id"] in old_by)))


def stored_pending_tests():
    doc = json.loads(load("Putaway/PutawayProcessWorkflow.json"))
    body = find(doc, "code_node_S8GL6e4o")["data"]["script"]["code"]
    stored = {"table_putaway_item": [{"line_index": 1, "pending_process_qty": 5, "item_name": "A"},
                                     {"line_index": 2, "pending_process_qty": 0, "item_name": "B"},
                                     {"line_index": 3, "pending_process_qty": 4}]}
    def case(label, rows, want_valid):
        got = run_js(body, {"workflowparams:allData": json.dumps({"table_putaway_item": rows}),
                            "node:get_node_C64LC1sr.data.data": json.dumps(stored)})
        expect("stored pending " + label, got, {"isValid": want_valid})
    case("within pending", [{"line_index": 1, "putaway_qty": 5, "pending_process_qty": 5, "is_split": "No", "target_location": "b1"}], 1)
    case("stale copy, line already put away", [{"line_index": 2, "putaway_qty": 3, "pending_process_qty": 3, "is_split": "No", "target_location": "b1"}], 0)
    case("split children over pending", [{"line_index": 3, "putaway_qty": 0, "pending_process_qty": 4, "is_split": "Yes", "parent_or_child": "Parent"},
                                         {"line_index": "3 - 1", "putaway_qty": 3, "pending_process_qty": 4, "is_split": "Yes", "parent_or_child": "Child", "target_location": "b1"},
                                         {"line_index": "3 - 2", "putaway_qty": 2, "pending_process_qty": 4, "is_split": "Yes", "parent_or_child": "Child", "target_location": "b2"}], 0)
    case("split children within pending", [{"line_index": 3, "putaway_qty": 0, "pending_process_qty": 4, "is_split": "Yes", "parent_or_child": "Parent"},
                                           {"line_index": "3 - 1", "putaway_qty": 3, "pending_process_qty": 4, "is_split": "Yes", "parent_or_child": "Child", "target_location": "b1"},
                                           {"line_index": "3 - 2", "putaway_qty": 1, "pending_process_qty": 4, "is_split": "Yes", "parent_or_child": "Child", "target_location": "b2"}], 1)
    case("stored as array shape", [{"line_index": 1, "putaway_qty": 5, "pending_process_qty": 5, "is_split": "No", "target_location": "b1"}], 1)


if __name__ == "__main__":
    loop_tests()
    stored_pending_tests()
    for rid in RUNS:
        putaway_reads(rid)
    print("failures:", test_guards.fails)
    sys.exit(1 if test_guards.fails else 0)
