"""Phase 1a: PO_SAVE at 2,000 lines, synchronous and lean (plan ~/.claude/plans/we-have-done-v2-sleepy-iverson.md).

Applied to the dev-IDENTICAL v39 copy in base/PO_SAVE.v39.json; writes "Purchase Order/POsaveWorkflow.json".

  1. one pre-save node (code_pre) instead of nine that each copied the payload; CHECK_REQUIRED_FIELD / VALIDATE_QUANTITY /
     CHECK_APPROVAL get only the fields they read; existing draft GR / PI = one projected sql-node
  2. Issue to an internal-trading supplier above 500 lines -> 400 before any write (SO_SAVE runs with every line)
  3. Fillback rebuilds the record from the payload once; on Edit the GR / PI owned line columns come from a fresh read
     (sql_po_owned) and outstanding is recomputed and clamped; alt_uom is kept as one JSON layer
  4. the saved PO is read back as a projected header (sql_po_head) instead of four whole-PO copies
  5. on-order: lines / items / existing rows = three parallel projected sql-nodes (node data; no Item subform join); writes
     in slices of <= 250
  6. get_po_full is read only on the internal-trading branch (it builds the SO from it)
Usage: python3 patch_po_save.py"""
import json
import os

from wf import (HERE, absent, body, code, end_error, find, if_, insert_after, insert_before, locate, loop, parallel, remove,
                repoint_all, replace_in_code, save, set_code, set_expr, set_filter_value, set_param, set_prop_value, sql)

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BASE = os.path.join(HERE, "base", "PO_SAVE.v39.json")
OUT = os.path.join(ROOT, "Purchase Order", "POsaveWorkflow.json")
FID = 1797100000001  # filter ids of the new if / loop nodes: 1797100000001..


def fid(n):
    return FID + 2 * n


def patch(doc):
    absent(doc, "code_pre", "sql_draft_grpi", "if_it_size", "sql_po_owned", "if_po_snap", "get_po_snap", "sql_po_head", "po_par_oo",
           "sql_oo_lines", "sql_oo_items", "sql_onorder", "loop_oo_add", "loop_oo_update", "loop_oo_delete")
    assert str(FID) not in json.dumps(doc)

    # ---------------------------------------------------------------- 1. pre-save checks in one node
    assert doc["nodes"][0]["type"] == "start-node"
    doc["nodes"][1:1] = [code("code_pre", "Pre-save Checks (one pass)", body("pre.js"), [
        ("p1a01doc", "docNo", "string"), ("p1a02drf", "draftRequiredFields", "string"), ("p1a03dre", "draftRequiredEntry", "string"),
        ("p1a04rqf", "requiredFields", "string"), ("p1a05rqe", "requiredEntry", "string"), ("p1a06lit", "lineItem", "string"),
        ("p1a07itf", "itemFields", "string"), ("p1a08qtf", "quantityFields", "string"), ("p1a09cnt", "lineCount", "int"),
        ("p1a10svd", "savedLines", "int"), ("p1a11pic", "piConfirm", "any"), ("p1a12pig", "piGateOut", "any"),
        ("p1a13apd", "approvalData", "any"), ("p1a14min", "minPriceResult", "string"), ("p1a15max", "maxPriceResult", "string"),
        ("p1a16msg", "priceMessage", "string"), ("p1a17ids", "itemIdCsv", "string"), ("p1a18pid", "poIdSql", "string")])]

    # Draft branch
    remove(doc, "code_draft_check_doc_no")
    remove(doc, "code_draft_required")
    w = find(doc, "wf_draft_check_required")
    set_param(w, "entry", "{{node:code_draft_required.data.data}}", "{{node:code_pre.data.draftRequiredEntry}}")
    set_param(w, "required_fields", "{{node:code_draft_required.data.required_fields}}", "{{node:code_pre.data.draftRequiredFields}}")

    # Issued branch
    remove(doc, "code_check_doc_no")
    remove(doc, "code_required")
    w = find(doc, "wf_check_required")
    set_param(w, "entry", "{{node:code_required.data.data}}", "{{node:code_pre.data.requiredEntry}}")
    set_param(w, "required_fields", "{{node:code_required.data.required_fields}}", "{{node:code_pre.data.requiredFields}}")
    remove(doc, "code_map_validate_qty")
    w = find(doc, "wf_validate_qty")
    set_param(w, "lineItem", "{{node:code_map_validate_qty.data.lineItem}}", "{{node:code_pre.data.lineItem}}")
    set_param(w, "itemFields", "{{node:code_map_validate_qty.data.itemFields}}", "{{node:code_pre.data.itemFields}}")
    set_param(w, "quantityFields", "{{node:code_map_validate_qty.data.quantityFields}}", "{{node:code_pre.data.quantityFields}}")
    remove(doc, "code_filter_lines")
    remove(doc, "code_count_lines")
    set_expr(find(doc, "if_empty_lines"), "{{node:code_count_lines.data.length}} == 0", "{{node:code_pre.data.lineCount}} == 0")
    remove(doc, "code_direct_pi_zero")
    set_expr(find(doc, "if_direct_pi_zero"), "{{node:code_direct_pi_zero.data.piConfirm}} != 0", "{{node:code_pre.data.piConfirm}} != 0")
    e = find(doc, "end_direct_pi_zero")
    assert e["data"]["response_value"]["list"][0]["value"] == "{{node:code_direct_pi_zero.data.gateOut}}"
    e["data"]["response_value"]["list"][0]["value"] = "{{node:code_pre.data.piGateOut}}"

    # existing draft GR / PI: one projected read (numbers only) instead of two whole-document searches
    insert_before(doc, "cond_all_check", [sql("sql_draft_grpi", "Get Draft GR / PI Numbers", body("sql_draft_grpi.sql"),
                                              [("p1a20knd", "kind", "string"), ("p1a21dno", "doc_no", "string")])])
    remove(doc, "cond_all_check")
    set_code(find(doc, "code_map_err"), body("map_err.js"))

    remove(doc, "code_map_approval_data")
    w = find(doc, "wf_check_approval")
    set_param(w, "data", "{{node:code_map_approval_data.data.poData}}", "{{node:code_pre.data.approvalData}}")
    c = find(doc, "cond_price_min")
    set_expr(c, "'{{node:code_map_approval_data.data.poData.min_price_result}}' == 'failed'", "'{{node:code_pre.data.minPriceResult}}' == 'failed'")
    leaf = c["data"]["filter"]["list"][0]
    assert leaf["prop"] == "node.code_map_approval_data.data.poData"
    leaf["prop"] = "node.code_pre.data.minPriceResult"
    leaf["propLabel"] = "Min Price Result"
    c = find(doc, "cond_price_max")
    set_expr(c, "'{{node:code_map_approval_data.data.poData.max_price_result}}' == 'failed'", "'{{node:code_pre.data.maxPriceResult}}' == 'failed'")
    for nid in ("end_price_min_402", "end_price_max_402"):
        e = find(doc, nid)
        assert e["data"]["msg"]["code"] == "{{node:code_map_approval_data.data.message}}"
        e["data"]["msg"]["code"] = "{{node:code_pre.data.priceMessage}}"

    # ---------------------------------------------------------------- 2. internal trading above 500 lines -> 400 before any write
    c = find(doc, "code_its_pre")
    replace_in_code(c, """return {
  isInternal: isInternal,""", """// The linked Sales Order is created / updated by SO_SAVE in this same run with every line: above 500 lines the issue
// stops here, before anything is written (SO_SAVE at 2,000 lines is a separate plan).
const savedLines = Number({{node:code_pre.data.savedLines}}) || 0;
const sizeBlock = (isInternal || isLinked) && savedLines > 500;
return {
  sizeBlock: sizeBlock ? "YES" : "NO",
  sizeMsg: "This purchase order has " + savedLines + " lines. Issuing it to an internal trading supplier creates a linked Sales Order, " +
    "which supports at most 500 lines. Please split it into smaller purchase orders.",
  isInternal: isInternal,""")
    c["data"]["response_json"] += [
        {"key": "k_sizeBlock", "name": "sizeBlock", "title": "", "description": "", "bsonType": "string", "isExpand": False, "children": []},
        {"key": "k_sizeMsg", "name": "sizeMsg", "title": "", "description": "", "bsonType": "string", "isExpand": False, "children": []}]
    insert_after(doc, "code_its_pre", [if_("if_it_size", "IF internal trading above 500 lines", "'{{node:code_its_pre.data.sizeBlock}}' == 'YES'",
                                           fid(0), [end_error("end_it_size_400", 400, "{{node:code_its_pre.data.sizeMsg}}")])])

    # ---------------------------------------------------------------- 3. fillback from the payload + GR / PI owned columns from a fresh read
    insert_before(doc, "code_fillback", [sql("sql_po_owned", "Get Stored Line Quantities (GR / PI owned)", body("sql_po_owned.sql"), [
        ("p1a30id", "id", "string"), ("p1a31rcv", "received_qty", "string"), ("p1a32crq", "created_received_qty", "string"),
        ("p1a33inv", "invoice_qty", "string"), ("p1a34ret", "return_quantity", "string"), ("p1a35crt", "created_return_qty", "string"),
        ("p1a36lst", "line_status", "string"), ("p1a37hps", "head_po_status", "string")])])
    # Edit never writes the header columns other flows own (Add Data still initialises them): GR's statuses, PI's statuses
    upd = find(doc, "update_po")["data"]["props"]["list"]
    owned = ["gr_status", "partially_received", "fully_received", "pi_status", "pi_posted_status"]
    assert all(sum(1 for c in upd if c["prop"] == o) == 1 for o in owned)
    upd[:] = [c for c in upd if c["prop"] not in owned]
    # a PO Goods Receiving moved to Processing / Completed stays one: on-order + PREQ follow-up runs for those too
    set_expr(find(doc, "if_issued_downstream"), "'{{node:code_resolve_latest.data.poData.po_status}}' == 'Issued'",
             "'{{node:code_resolve_latest.data.poData.po_status}}' == 'Issued' || '{{node:code_resolve_latest.data.poData.po_status}}' == 'Processing'"
             " || '{{node:code_resolve_latest.data.poData.po_status}}' == 'Completed'")
    f = find(doc, "code_fillback")
    set_code(f, body("fillback.js"))
    assert [r["name"] for r in f["data"]["response_json"]] == ["entry"]
    item_ids_decl = json.loads(json.dumps(find(doc, "code_map_item_ids")["data"]["response_json"]))
    assert [r["name"] for r in item_ids_decl] == ["itemIDs"]
    f["data"]["response_json"] += item_ids_decl
    remove(doc, "get_one_po")
    remove(doc, "code_map_item_ids")
    set_param(find(doc, "wf_txn_date"), "itemIDs", "{{node:code_map_item_ids.data.itemIDs}}", "{{node:code_fillback.data.itemIDs}}")

    # ---------------------------------------------------------------- 4. the saved PO: its id, then one projected header read
    g = find(doc, "code_get_latest")
    set_code(g, body("get_latest.js"))
    g["data"]["response_json"].append({"key": "p1a40pid", "name": "poIdSql", "title": "poIdSql", "description": "", "bsonType": "string",
                                       "isExpand": False, "children": []})
    # approval: the record CHECK_APPROVAL's flow re-issues is the one saved above (Add Data's row, or an Edit read back)
    snap = json.loads(json.dumps(find(doc, "get_po_approved")))
    snap["id"] = "get_po_snap"
    for k in ("title", "nodeName", "name"):
        snap["data"][k] = "Get PO Snapshot (approval)"
    leaf = snap["data"]["table_id"]["rules"]["list"][0]
    assert leaf["value"] == "{{node:code_get_latest.data.poData.id}}"
    leaf["value"] = "{{workflowparams:allData.id}}"
    leaf["id"], leaf["parentId"] = fid(1), fid(1) + 1
    insert_before(doc, "slot_po_approval", [if_("if_po_snap", "IF Edit (read the saved PO back)",
                                                "'{{workflowparams:allData.page_status}}' != 'Add' && '{{workflowparams:allData.page_status}}' != 'Clone'",
                                                fid(2), [snap])])
    m = find(doc, "code_map_updated_po")
    replace_in_code(m, "let latestPOData = {{node:code_get_latest.data.poData}};",
                    """// The PO as saved above: Add Data's row (Add / Clone), else read back (Edit)
const addedRaw = {{node:add_po.data}};
const snapRaw = {{node:get_po_snap.data.data}};
let latestPOData = {{workflowparams:allData.page_status}} == 'Add' || {{workflowparams:allData.page_status}} == 'Clone'
  ? (Array.isArray(addedRaw) ? addedRaw[0] : addedRaw)
  : (Array.isArray(snapRaw) ? snapRaw[0] : snapRaw);""")
    remove(doc, "get_po_approved")
    insert_before(doc, "code_resolve_latest", [sql("sql_po_head", "Get PO Header", body("sql_po_head.sql"), [
        ("p1a50id", "id", "string"), ("p1a51no", "purchase_order_no", "string"), ("p1a52st", "po_status", "string"),
        ("p1a53pl", "po_plant", "string"), ("p1a54org", "organization_id", "string"), ("p1a55sup", "po_supplier_id", "string"),
        ("p1a56prq", "preq_id_json", "string"), ("p1a57tot", "po_total", "string"), ("p1a58api", "auto_pi", "string"),
        ("p1a59cpi", "create_pi", "string")])])
    r = find(doc, "code_resolve_latest")
    set_code(r, body("resolve_latest.js"))
    r["data"]["response_json"] += [
        {"key": "p1a60pid", "name": "poIdSql", "title": "poIdSql", "description": "", "bsonType": "string", "isExpand": False, "children": []},
        {"key": "p1a61org", "name": "orgSql", "title": "orgSql", "description": "", "bsonType": "string", "isExpand": False, "children": []},
        {"key": "p1a62hex", "name": "poNoHex", "title": "poNoHex", "description": "", "bsonType": "string", "isExpand": False, "children": []}]

    # ---------------------------------------------------------------- 5. on-order: three parallel projected reads, writes in slices
    get_po_full = remove(doc, "get_po_full")
    remove(doc, "code_oo_item_ids")
    remove(doc, "search_items")
    remove(doc, "search_onorder")
    lines_sql = sql("sql_oo_lines", "Get On Order Lines", body("sql_oo_lines.sql"), [
        ("p1a70id", "id", "string"), ("p1a71itm", "item_id", "string"), ("p1a72qty", "quantity", "string"), ("p1a73uom", "quantity_uom", "string"),
        ("p1a74prq", "preq_id", "string"), ("p1a75prl", "preq_line_id", "string"), ("p1a76par", "parent_id", "string")])
    items_sql = sql("sql_oo_items", "Get On Order Items (UOM conversion)", body("sql_oo_items.sql"), [
        ("p1a77id", "id", "string"), ("p1a78uom", "uom_json", "string")])
    onorder_sql = sql("sql_onorder", "Get Existing On Order", body("sql_onorder.sql"), [
        ("p1a80id", "id", "string"), ("p1a81po", "po_id", "string"), ("p1a82pol", "po_line_id", "string"), ("p1a83mat", "material_id", "string"),
        ("p1a84no", "purchase_order_number", "string"), ("p1a85ln", "purchase_order_line", "string"), ("p1a86rcv", "received_qty", "string")])
    insert_before(doc, "code_onorder_diff", [parallel("po_par_oo", "On Order Reads", [
        ("po_cai_oo_lines", "PO Lines", [lines_sql]), ("po_cai_oo_items", "Items", [items_sql]), ("po_cai_oo_rows", "On Order", [onorder_sql])])])
    d = find(doc, "code_onorder_diff")
    set_code(d, body("onorder_diff.js"))
    old_keys = {r["name"]: r for r in d["data"]["response_json"]}
    assert set(old_keys) == {"toAdd", "toUpdate", "toDelete", "hasAdds", "hasUpdates", "hasDeletes", "hasPreq"}
    d["data"]["response_json"] = [
        {"key": "p1a90add", "name": "addSlices", "title": "addSlices", "description": "", "bsonType": "any", "isExpand": False, "children": []},
        {"key": "p1a91upd", "name": "updateSlices", "title": "updateSlices", "description": "", "bsonType": "any", "isExpand": False, "children": []},
        {"key": "p1a92del", "name": "deleteSlices", "title": "deleteSlices", "description": "", "bsonType": "any", "isExpand": False, "children": []},
        old_keys["hasAdds"], old_keys["hasUpdates"], old_keys["hasDeletes"], old_keys["hasPreq"]]

    slice_out = lambda p: [(p + "rw", "rows", "any"), (p + "ct", "count", "int")]
    for kind, slices_key, write_id, n in (("add", "addSlices", "add_onorder", 3), ("update", "updateSlices", "update_onorder", 5),
                                          ("delete", "deleteSlices", "delete_onorder", 7)):
        loop_id = "loop_oo_" + kind
        slice_id = "code_oo_%s_slice" % kind
        if_id = "if_onorder_" + kind
        block = find(doc, if_id)["blocks"][0]
        assert block["type"] == "ifBlock" and block["data"]["title"] == "true"
        writes = block["blocks"]
        if kind == "delete":
            assert [x["id"] for x in writes] == ["search_onorder_orphans", "delete_onorder"]
            set_filter_value(writes[0], "id", "{{node:code_onorder_diff.data.toDelete.id}}", "{{node:code_oo_delete_slice.data.rows.id}}")
        else:
            assert [x["id"] for x in writes] == [write_id]
            assert repoint_all(writes[0], "{{node:code_onorder_diff.data.%s." % ("toAdd" if kind == "add" else "toUpdate"),
                               "{{node:%s.data.rows." % slice_id) > 0
        block["blocks"] = [loop(loop_id, "Write On Order in slices of <= 250 (%s)" % kind, "{{node:code_onorder_diff.data.%s}}" % slices_key, fid(n),
                                [code(slice_id, "On Order %s slice" % kind, body("oo_%s_slice.js" % kind), slice_out("p1a%s" % kind[:3]))] + writes)]

    # PREQ: header preq ids + the PO's top-level lines from the projected read
    set_filter_value(find(doc, "search_preq"), "id", "{{node:get_po_full.data.data.preq_id}}", "{{node:code_resolve_latest.data.poData.preq_id}}")
    p = find(doc, "code_map_preq")
    replace_in_code(p, "const poID = {{node:get_po_full.data.data.id}};", "const poID = {{node:code_resolve_latest.data.poData.id}};")
    replace_in_code(p, "const poLineItem = {{node:get_po_full.data.data.table_po}} || [];",
                    """// The PO's top-level lines (Get On Order Lines; bundle items are nested under their row in the read-back)
const poLineItem = ([{{node:sql_oo_lines.data}}][0] || []).filter((r) => !r.parent_id).map((r) => ({
  id: r.id == null ? undefined : String(r.id),
  preq_line_id: r.preq_line_id == null ? undefined : String(r.preq_line_id),
  quantity: r.quantity == null ? undefined : Number(r.quantity),
}));""")
    its = find(doc, "get_its")
    set_filter_value(its, "buyer_org_id", "{{node:get_po_full.data.data.organization_id}}", "{{node:code_resolve_latest.data.poData.organization_id}}")
    set_filter_value(its, "buyer_supplier_id", "{{node:get_po_full.data.data.po_supplier_id}}", "{{node:code_resolve_latest.data.poData.po_supplier_id}}")

    # ---------------------------------------------------------------- 6. the whole PO is read only where the SO is built from it
    assert get_po_full["data"]["table_id"]["rules"]["list"][0]["value"] == "{{node:code_resolve_latest.data.poData.id}}"
    lst, i = locate(doc, "po_par_so_fetch")
    lst.insert(i, get_po_full)
    return doc


if __name__ == "__main__":
    with open(BASE, encoding="utf-8") as fh:
        text = fh.read()
    doc = patch(json.loads(text))
    save(OUT, doc, text)
    print("patched", OUT)
