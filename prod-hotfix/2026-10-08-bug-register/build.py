#!/usr/bin/env python3
"""Build the 2026-10-08 prod hotfix for the SUDU defect register (bug-list.md).

Re-fetches each workflow's ENABLED script from PROD, applies the patches below and writes
  <WF>.BASE.json  - exactly what prod runs (diff baseline, never deploy)
  <WF>.PROD.json  - BASE + patches (paste this into the designer)

Every replacement asserts its match count and every workflow asserts the enabled version it
was written against, so a drifted baseline fails loudly instead of patching the wrong text.

usage: python3 build.py [WF ...]      (default: all)
"""
import copy, hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DB = os.path.join(REPO, ".dbtools", "db")


# ---------------------------------------------------------------- fetch / write

def fetch(wid, env="--prod"):
    sql = (f"SELECT version_number, script_json FROM su_code_workflow_history "
           f"WHERE data_id={wid} AND status='enabled' ORDER BY version_number DESC LIMIT 1")
    out = subprocess.run([DB, env, "--json", sql], capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr.strip())
    row = json.loads(out.stdout)[0]
    return row["version_number"], json.loads(row["script_json"])


def stable_int(text, digits=12):
    """Deterministic numeric id; python's builtin string hashing is salted per process."""
    return int(hashlib.md5(text.encode()).hexdigest(), 16) % 10**digits


def canon(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def write(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


# ---------------------------------------------------------------- node helpers

def find(d, nid):
    """-> (node, parent_list, index). Walks nodes/blocks only (filter leaves also carry ids)."""
    hit = []

    def walk(lst):
        for i, n in enumerate(lst):
            if isinstance(n, dict) and "type" in n and "data" in n:
                if n.get("id") == nid:
                    hit.append((n, lst, i))
                walk(n.get("blocks") or [])

    walk(d["nodes"])
    if len(hit) != 1:
        raise SystemExit(f"FAIL: node {nid} found {len(hit)} times")
    return hit[0]


def code_replace(d, nid, old, new, count=1):
    node = find(d, nid)[0]
    code = node["data"]["script"]["code"]
    n = code.count(old)
    if n != count:
        raise SystemExit(f"FAIL: {nid}: expected {count} match(es), found {n}\n--- old ---\n{old[:400]}")
    node["data"]["script"]["code"] = code.replace(old, new)


def key_spec(k):
    """'name' -> ('name', 'string'); ('name', 'array') stays as given."""
    return (k, "string") if isinstance(k, str) else k


def add_response_keys(d, nid, keys):
    rj = find(d, nid)[0]["data"]["response_json"]
    have = {r["name"] for r in rj}
    for name, bson in map(key_spec, keys):
        if name in have:
            raise SystemExit(f"FAIL: {nid} already declares {name}")
        rj.append({"key": f"hf{stable_int(nid + name, 6):06d}", "name": name, "title": name,
                   "description": "", "bsonType": bson, "isExpand": False})


def if_expression(d, nid, old, new):
    node = find(d, nid)[0]
    expr = node["data"]["expression"]
    if expr.get("code") != old:
        raise SystemExit(f"FAIL: {nid} expression is {expr.get('code')!r}, expected {old!r}")
    expr["code"] = new


def set_prop(d, nid, prop, old, new):
    lst = find(d, nid)[0]["data"]["props"]["list"]
    hits = [p for p in lst if p["prop"] == prop]
    if len(hits) != 1 or hits[0]["value"] != old:
        raise SystemExit(f"FAIL: {nid}.{prop} is {[p['value'] for p in hits]}, expected {old!r}")
    hits[0]["value"] = new


def insert_before(d, before_id, nodes):
    _, lst, i = find(d, before_id)
    lst[i:i] = nodes


def insert_after(d, after_id, nodes):
    _, lst, i = find(d, after_id)
    lst[i + 1:i + 1] = nodes


# ---------------------------------------------------------------- node builders

def code_node(nid, title, code, keys):
    return {"id": nid, "type": "code-node", "data": {
        "language": "javascript", "code": "", "timeout": 30000, "title": title,
        "isValidator": True, "nodeName": title, "name": title,
        "script": {"type": "javascript", "code": code},
        "response_json": [{"key": f"{nid[-6:]}{i:02d}", "name": k, "title": k, "description": "",
                           "bsonType": bson, "isExpand": False}
                          for i, (k, bson) in enumerate(map(key_spec, keys))]},
        "blocks": []}


def return_node(nid, code, message):
    return {"id": nid, "type": "return-node", "data": {
        "return_data": {}, "status_code": 200, "title": "Return Data", "isValidator": True,
        "nodeName": "Return Data", "name": "Return Data",
        "response_value": {"list": [
            {"prop": "code", "propLabel": "code", "operator": "", "operatorLabel": "",
             "valueType": "value", "valueTypeLabel": "", "value": code, "valueLabel": ""},
            {"prop": "message", "operator": "", "valueType": "value", "value": message,
             "valueLabel": "", "propLabel": "message"}]},
        "return_raw_data": 0}, "blocks": []}


# ================================================================ SI_SAVE  (BUG-002)

def patch_si_save(d):
    # The Draft downgrade (credit-limit failure on a Convert) must win over the un-downgraded entry.
    code_replace(d, "code_node_JoF0YVzG",
        "let entry = {{node:code_node_2Pxz18TD.data.table}} || {{node:code_node_QaPUxa3s.data.entry}} || {{node:code_node_Z0Tcxb1v.data.entry}}",
        "let entry = {{node:code_node_2Pxz18TD.data.table}} || {{node:code_node_Z0Tcxb1v.data.entry}} || {{node:code_node_QaPUxa3s.data.entry}}")
    code_replace(d, "code_node_Z0Tcxb1v",
        "entry.si_status = 'Draft'\nentry.posted_status = ''\n",
        "entry.si_status = 'Draft'\nentry.posted_status = ''\n"
        "// code_node_QdIIcL7J stamped the issued sentinel; a Draft takes a draft number.\n"
        "if (entry.sales_invoice_no === 'issued') entry.sales_invoice_no = 'draft'\n")


# ================================================================ GD_Convert_SI  (BUG-009)

def patch_gd_convert_si(d):
    code_replace(d, "code_node_6JxbETDC",
        "return {\n  message: 'Selected Goods Delivery(s) already has existing Sales Invoice and cannot be converted.'\n}",
        "// Callers that predate `source` omit it, so if_dup_auto reads this flag, never the raw param.\n"
        "const source = {{workflowparams:source}};\n\n"
        "return {\n  message: 'Selected Goods Delivery(s) already has existing Sales Invoice and cannot be converted.',\n"
        "  isAuto: source === 'auto' ? '1' : '0'\n}")
    add_response_keys(d, "code_node_6JxbETDC", ["isAuto"])
    if_expression(d, "if_dup_auto",
        "'{{workflowparams:source}}' == 'auto'",
        "'{{node:code_node_6JxbETDC.data.isAuto}}' == '1'")


# ================================================================ HANDLING_UNIT  (BUG-010)

def patch_handling_unit(d):
    code_replace(d, "code_node_Li3O7y4d",
        "  hu_status: finalHuStatus,\n",
        "  // An unload that empties the HU frees it, whatever status the caller sent.\n"
        "  hu_status: processType === \"unload\" && newItemCount === 0 ? \"Created\" : finalHuStatus,\n")


# ================================================================ SM_LOCATION_TRANSFER  (BUG-015)

def patch_lot(d):
    code_replace(d, "code_node_uht83Wzh",
        "  docDate: currentData.issue_date,\n};\n",
        "  docDate: currentData.issue_date,\n};\n\n"
        "// Reconcile adjusts stock this document already staged; a Draft never staged any.\n"
        "if ((initialData.stock_movement_status || currentData.stock_movement_status) !== \"In Progress\") {\n"
        "  return {\n"
        "    isDifferent: 0, movements: [], movementsLength: 0,\n"
        "    transitCreates: [], hasTransitCreates: 0,\n"
        "    transitUpdates: [], hasTransitUpdates: 0,\n"
        "    shortages: [], hasShortage: 0, materialIds: [],\n"
        "    plant_id: ctx.plantId, organization_id: ctx.orgId,\n"
        "    stock_movement_no: ctx.docNo, doc_date: ctx.docDate,\n"
        "  };\n"
        "}\n")


# ================================================================ PICKING_LOOP  (BUG-004)

def patch_picking_loop(d):
    code_replace(d, "code_node_LockDecide",
        "// 0 = free, take the lock   1 = held by a live run   2 = already Completed\n",
        "// 0 = free, take the lock   1 = held by a live run   2 = already Completed   3 = Cancelled\n")
    code_replace(d, "code_node_LockDecide",
        "  if (row.to_status === \"Completed\") {\n    lockState = 2;\n  } else if",
        "  if (row.to_status === \"Completed\") {\n    lockState = 2;\n"
        "  } else if (row.to_status === \"Cancelled\") {\n"
        "    // A device holding a stale copy must not complete a Picking its GD cancel already closed.\n"
        "    lockState = 3;\n  } else if")
    item = copy.deepcopy(find(d, "condition_or_item_Jo399j6h")[0])
    item["id"] = "condition_or_item_LockCancelled"
    item["data"].update({"title": "IF Cancelled", "nodeName": "IF Cancelled", "name": "IF Cancelled",
                         "__index": 3})
    leaf = item["data"]["filter"]["list"][0]
    leaf.update({"id": 1791000000001, "parentId": 1791000000000, "value": 3})
    item["blocks"] = [return_node("return_node_LockCancelled", "400",
                                  "The current picking has been cancelled")]
    insert_before(d, "condition_or_node_item_xpw2hikK", [item])


# ================================================================ PACKING_SAVE  (BUG-004, BUG-011)

def get_node(nid, title, source, collection_id, value):
    return {"id": nid, "type": "get-node", "data": {
        "table_id": {"source": source, "rules": {"collectionId": collection_id, "list": [{
            "id": stable_int(nid), "parentId": stable_int(nid) + 1, "isTop": True,
            "prop": "id", "operator": "in", "valueType": "field", "value": value, "type": "leaf",
            "level": 1, "propLabel": "主键ID", "valueLabel": "", "operatorLabel": "In"}]}},
        "condition": {}, "title": title, "isValidator": True, "nodeName": title, "name": title},
        "blocks": []}


def if_node(nid, title, expression, true_nodes, false_nodes=()):
    return {"id": nid, "type": "if", "data": {
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "condition_type": "Expression",
        "filter": {"list": [{"id": stable_int(nid), "parentId": 0, "isTop": True, "prop": "",
                             "operator": "", "valueType": "", "value": "", "type": "leaf", "level": 1}]},
        "expression": {"type": "javascript", "code": expression}},
        "blocks": [
            {"id": f"{nid}_t", "type": "ifBlock", "data": {"title": "true"}, "blocks": list(true_nodes)},
            {"id": f"{nid}_f", "type": "ifBlock", "data": {"title": "false"}, "blocks": list(false_nodes)}]}


def patch_packing_save(d):
    # BUG-004: a Packing of a cancelled GD must not complete (it re-saves and revives the GD).
    code_replace(d, "code_node_PkPickChk",
        "const gd = Array.isArray(raw) ? raw[0] : raw;\n",
        "const gd = Array.isArray(raw) ? raw[0] : raw;\n\n"
        "if (gd && gd.gd_status === \"Cancelled\") {\n"
        "  return {\n    notPicked: 1,\n"
        "    pickedMessage: \"Cannot complete packing: Goods Delivery \" + (gd.delivery_no || \"\") + \" is Cancelled.\",\n"
        "  };\n}\n")
    code_replace(d, "code_node_GKPcKOcF",
        "  shouldCallGdWorkflow: (gdData && gdData.id) ? 1 : 0,\n",
        "  // The call re-saves the GD as Created, which would revert a Cancelled or Completed GD.\n"
        "  shouldCallGdWorkflow: (gdData && gdData.id && gdData.gd_status === \"Created\") ? 1 : 0,\n")

    # BUG-011: a Completed save landing on a Packing another device already completed keeps
    # that device's HU rows instead of replacing table_hu with this payload's subset.
    prep = code_node("code_node_PkStoredPrep", "Stored Packing Check",
        "const entry = {{workflowparams:entry}} || {};\n"
        "const saveAs = {{workflowparams:saveAs}};\n\n"
        "return {\n"
        "  checkStored: saveAs === \"Completed\" && entry.id ? \"1\" : \"0\",\n"
        "  packingId: entry.id ? String(entry.id) : \"0\",\n"
        "};\n",
        ["checkStored", "packingId"])
    fetch_stored = if_node("if_PkStored", "IF Completing Saved Packing",
        "'{{node:code_node_PkStoredPrep.data.checkStored}}' == '1'",
        [get_node("get_node_PkStored", "Get Stored Packing", "Packing:Table:1993515601863524353",
                  "1993515601863524353", "{{node:code_node_PkStoredPrep.data.packingId}}")])
    insert_before(d, "code_node_7u6VSG8X", [prep, fetch_stored])
    code_replace(d, "code_node_7u6VSG8X",
        "const saveAs = {{workflowparams:saveAs}};\n\n",
        "const saveAs = {{workflowparams:saveAs}};\n\n"
        "// Two devices completing their own HUs on one Packing: keep the rows the first one saved.\n"
        "const storedRaw = {{node:get_node_PkStored.data.data}};\n"
        "const stored = (Array.isArray(storedRaw) ? storedRaw[0] : storedRaw) || null;\n"
        "if (saveAs === \"Completed\" && stored && stored.packing_status === \"Completed\") {\n"
        "  const incoming = new Set((entry.table_hu || []).map((r) => String(r.handling_unit_id || \"\")));\n"
        "  const kept = (stored.table_hu || []).filter(\n"
        "    (r) => r.handling_unit_id && !incoming.has(String(r.handling_unit_id)),\n"
        "  );\n"
        "  entry.table_hu = kept.concat(entry.table_hu || []);\n"
        "}\n\n")


# ================================================================ PICKING_PLAN  (BUG-016)

def patch_picking_plan(d):
    code_replace(d, "code_node_pp_gate",
        "const OFF = { blockEdit: 0, blockMessage: \"\" };\n",
        "const OFF = { blockEdit: 0, blockMessage: \"\" };\n\n"
        "// Completing releases the reservation beyond the picked qty; an open Picking would keep\n"
        "// picking against a plan whose reservation is already gone (CA-3759 / TA188810).\n"
        "if (saveAs === \"Completed\" && !isPicking) {\n"
        "  const openPickings = pickings.filter(\n"
        "    (p) => String(p.to_status || \"\") === \"Created\" || String(p.to_status || \"\") === \"In Progress\"\n"
        "  );\n"
        "  if (openPickings.length > 0) {\n"
        "    return {\n"
        "      blockEdit: 1,\n"
        "      blockMessage:\n"
        "        \"Picking \" + openPickings.map((p) => String(p.to_id || p.id)).join(\", \") +\n"
        "        \" is still open. Complete or cancel it before completing this Picking Plan.\",\n"
        "    };\n"
        "  }\n"
        "}\n")


# ================================================================ PICKING  (BUG-014, BUG-008, BUG-016)

def patch_picking(d):
    # BUG-014: unrounded remainders left a 4e-14 "ghost" entry at the source bin, which kept
    # GD_UNUSED_FN_NEW from migrating the reservation to the loading bay.
    code_replace(d, "code_node_Z5JH4g2u",
        "const newPendingQty = Math.max(0, (originalItem.pending_process_qty || 0) - pickedQty);",
        "const newPendingQty = Math.max(0, q8((originalItem.pending_process_qty || 0) - pickedQty));")
    code_replace(d, "code_node_iES7iMKA",
        "const gdLines = {{node:search_node_krPmTbfL.data.data}};\n",
        "// Computed remainders are rounded to the 8dp column scale so float residue never survives.\n"
        "const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));\n\n"
        "const gdLines = {{node:search_node_krPmTbfL.data.data}};\n")
    code_replace(d, "code_node_iES7iMKA",
        "if (pickedQty >= originalQuantity) {",
        "if (q8(pickedQty) >= q8(originalQuantity)) {")
    code_replace(d, "code_node_iES7iMKA",
        "const remainingQty = originalQuantity - pickedQty;",
        "const remainingQty = q8(originalQuantity - pickedQty);")
    code_replace(d, "code_node_iES7iMKA",
        "tempQtyDataArray = tempQtyDataArray.filter(entry => (entry.gd_quantity || 0) > 0);",
        "tempQtyDataArray = tempQtyDataArray.filter(entry => q8(entry.gd_quantity) > 0);")

    # BUG-008: never create an empty Packing or wipe an existing one's rows.
    code_replace(d, "code_node_gudzrvMQ",
        "  const existing = existingByGdId[p.gd_id] || null;\n\n",
        "  const existing = existingByGdId[p.gd_id] || null;\n\n"
        "  // No GD master, or nothing loose and no HU rows: a create would be empty, an update a wipe.\n"
        "  if (!gdById[p.gd_id] || ((p.table_item_source || []).length === 0 && newHuRows.length === 0)) continue;\n\n")
    code_replace(d, "code_node_pMVdQBEQ",
        "  if (r.item_bundle_id && !r.item_code) continue;\n\n  const qtyToPick",
        "  if (r.item_bundle_id && !r.item_code) continue;\n"
        "  if (r.line_status === \"Cancelled\") continue;\n\n  const qtyToPick")

    # BUG-016: the re-save hard-codes saveAs "Created", which reverted a force-completed plan.
    code_replace(d, "code_node_Qxtc1i6K",
        "const toDatas = {{node:search_node_cERaaVGY.data.data}} || [];\n",
        "// The re-save below is hard-coded saveAs \"Created\"; a finished plan must not be reopened by it.\n"
        "const toDatas = ({{node:search_node_cERaaVGY.data.data}} || []).filter(\n"
        "  (to) => to.to_status !== \"Completed\" && to.to_status !== \"Cancelled\"\n"
        ");\n")


# ================================================================ GOODS_DELIVERY  (BUG-001, -004, -005, -006, -016)

# Header roll-up shared by code_node_8pN1MyXz (completion gate) and code_node_PkMerge (write).
# "Lines that must be picked" is code_node_PkPickChk's rule in PACKING_SAVE.
ROLL_UP_JS = (
    "const rollUpPicking = (header, rows) => {\n"
    "  if (header !== \"Created\" && header !== \"In Progress\") return header;\n"
    "  const lines = (rows || [])\n"
    "    .flatMap((row) => [row, ...(Array.isArray(row.children) ? row.children : [])])\n"
    "    .filter((line) => line.material_id && line.picking_status !== \"Cancelled\" &&\n"
    "      (parseFloat(line.gd_qty) || 0) > 0);\n"
    "  return lines.length > 0 && lines.every((line) => line.picking_status === \"Completed\")\n"
    "    ? \"Completed\" : header;\n"
    "};\n")

PK_MERGE_JS = (
    "// Zone Pickings save the whole GD they read seconds earlier; a sibling that confirmed other\n"
    "// lines in between was being overwritten (GD-20260930-280, GD-20261001-294). Per line, keep\n"
    "// whichever of this payload and the just-read GD is further along.\n"
    "const allData = {{node:code_node_GKc0ALEe.data.allData}};\n"
    "const header = {{node:code_node_8pN1MyXz.data.picking_status}};\n"
    "const needMerge = {{node:code_node_8pN1MyXz.data.needMerge}};\n"
    "const freshRaw = {{node:get_node_PkMergeGd.data.data}};\n"
    "const fresh = (Array.isArray(freshRaw) ? freshRaw[0] : freshRaw) || null;\n\n"
    "const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));\n"
    "// code_node_GKc0ALEe's computed columns, for rows taken from the fresh read.\n"
    "const formatLine = (item) => ({\n"
    "  ...item,\n"
    "  gd_undelivered_qty: (Math.max(0, item.gd_undelivered_qty)),\n"
    "  packing_qty: q8((parseFloat(item.gd_qty) || 0) / (parseFloat(item.packing_conversion) || 1)),\n"
    "  net_weight: q8((parseFloat(item.gd_qty) || 0) * (parseFloat(item.weight_conversion) || 0)),\n"
    "});\n\n"
    "// The fields Picking writes to a GD line (update_node_JXfFIqqv, update_node_MNPicked).\n"
    "const PICKING_FIELDS = [\n"
    "  \"picking_status\", \"picked_qty\", \"picked_temp_qty_data\", \"picked_view_stock\",\n"
    "  \"temp_qty_data\", \"prev_temp_qty_data\", \"view_stock\", \"plan_qty\", \"plan_view_stock\",\n"
    "  \"plan_temp_qty_data\", \"is_force_complete\", \"gd_qty\", \"base_qty\", \"gd_delivered_qty\",\n"
    "  \"gd_undelivered_qty\",\n"
    "];\n"
    "const RANK = { Completed: 3, \"In Progress\": 2 };\n"
    "const rankOf = (row) => RANK[row.picking_status] || 1;\n"
    "// Only a stored line strictly further along replaces this payload's picking fields.\n"
    "const furtherAlong = (mine, stored) => {\n"
    "  if (!stored) return mine;\n"
    "  const ahead = rankOf(stored) !== rankOf(mine)\n"
    "    ? rankOf(stored) > rankOf(mine)\n"
    "    : q8(stored.picked_qty) > q8(mine.picked_qty);\n"
    "  if (!ahead) return mine;\n"
    "  const merged = { ...mine };\n"
    "  for (const k of PICKING_FIELDS) merged[k] = stored[k] === undefined ? null : stored[k];\n"
    "  return formatLine(merged);\n"
    "};\n\n"
    + ROLL_UP_JS +
    "\nlet tableGd = allData.table_gd || [];\n"
    "let pickingStatus = header;\n\n"
    "if (needMerge === \"1\" && fresh && Array.isArray(fresh.table_gd)) {\n"
    "  const freshById = {};\n"
    "  for (const row of fresh.table_gd) {\n"
    "    if (row.id) freshById[String(row.id)] = row;\n"
    "    for (const child of (Array.isArray(row.children) ? row.children : [])) {\n"
    "      if (child.id) freshById[String(child.id)] = child;\n"
    "    }\n"
    "  }\n"
    "  const seen = {};\n"
    "  const mergeRow = (row) => {\n"
    "    seen[String(row.id)] = true;\n"
    "    return furtherAlong(row, freshById[String(row.id)]);\n"
    "  };\n"
    "  tableGd = tableGd.map((row) => {\n"
    "    const merged = mergeRow(row);\n"
    "    return Array.isArray(row.children) ? { ...merged, children: row.children.map(mergeRow) } : merged;\n"
    "  });\n"
    "  // A row missing from the payload would be deleted by the subform write.\n"
    "  for (const row of fresh.table_gd) {\n"
    "    if (row.id && !seen[String(row.id)]) tableGd.push(formatLine(row));\n"
    "  }\n"
    "  pickingStatus = rollUpPicking(header, tableGd);\n"
    "}\n\n"
    "return {\n"
    "  table_gd: tableGd,\n"
    "  picking_status: pickingStatus,\n"
    "};\n")


def add_filter_leaf(d, nid, leaf):
    rules = find(d, nid)[0]["data"]["table_id"]["rules"]["list"]
    if len(rules) != 1 or rules[0].get("type") != "branch" or rules[0].get("operator") != "all":
        raise SystemExit(f"FAIL: {nid} filter is not a single 'all' branch")
    rules[0]["children"].append(dict(leaf, parentId=rules[0]["id"]))


def patch_goods_delivery(d):
    # BUG-004: a Cancelled GD is final (Packing / Picking re-saves with saveAs "Created" revived it).
    code_replace(d, "code_node_IyJHrBst",
        " Reverse the completion before cancelling.\"\n  };\n}\n",
        " Reverse the completion before cancelling.\"\n  };\n}\n\n"
        "// A Cancelled GD is final: Picking and Packing re-save it with saveAs \"Created\", which revived it.\n"
        "const storedGdRaw = {{node:get_node_xTRvHWB8.data.data}};\n"
        "const storedGd = (Array.isArray(storedGdRaw) ? storedGdRaw[0] : storedGdRaw) || {};\n"
        "if (pageStatus === \"Edit\" && (allData.gd_status === \"Cancelled\" || storedGd.gd_status === \"Cancelled\")) {\n"
        "  return {\n"
        "    allData: allData,\n"
        "    gd_status: allData.gd_status,\n"
        "    needCL: \"not required\",\n"
        "    clAutoOverride: \"0\",\n"
        "    picking_status: allData.picking_status,\n"
        "    packing_status: allData.packing_status,\n"
        "    needSOCleanUp: 0,\n"
        "    invalidData: 1,\n"
        "    invalidDataMessage: \"Goods Delivery \" + (allData.delivery_no || \"\") + \" is Cancelled and can no longer be changed.\"\n"
        "  };\n"
        "}\n")

    # BUG-005: roll the header up from the lines (to Completed only) and gate completion on it.
    code_replace(d, "code_node_8pN1MyXz",
        "return {\n  picking_status: picking_status,\n  auto_trigger_to: pickingSetup.auto_trigger_to\n}",
        "// A gate that returns before the write (credit block, packing required) left Picking's\n"
        "// roll-up unwritten, and a stale header sent fully-picked GDs into Force Complete.\n"
        + ROLL_UP_JS +
        "if (pickingSetup && isGDPP !== 1 && pickingSetup.picking_required === 1 && saveAs !== \"Cancelled\") {\n"
        "  picking_status = rollUpPicking(picking_status, {{node:code_node_IyJHrBst.data.allData.table_gd}});\n"
        "}\n\n"
        "const isForceComplete = {{workflowparams:isForceComplete}};\n"
        "const forced = isForceComplete === \"Yes\" || isForceComplete === 1 || isForceComplete === \"1\";\n\n"
        "return {\n  picking_status: picking_status,\n  auto_trigger_to: pickingSetup.auto_trigger_to,\n"
        "  needMerge: String({{workflowparams:isPicking}} || \"\") === \"Yes\" && saveAs === \"Created\" && !forced ? \"1\" : \"0\"\n}")
    add_response_keys(d, "code_node_8pN1MyXz", ["needMerge"])
    if_expression(d, "if_DDiEWnn5",
        "'{{workflowparams:allData.picking_status}}' != 'Completed'",
        "'{{node:code_node_8pN1MyXz.data.picking_status}}' != 'Completed'")

    # BUG-001: re-read the GD right before the write and merge per line (see PK_MERGE_JS).
    insert_before(d, "update_node_elLmtlLm", [
        if_node("if_PkMergeGd", "IF Picking Merge",
                "'{{node:code_node_8pN1MyXz.data.needMerge}}' == '1'",
                [get_node("get_node_PkMergeGd", "Get Current GD (Picking Merge)",
                          "Goods Delivery:Table:1902054888473481218", "1902054888473481218",
                          "{{node:code_node_IyJHrBst.data.allData.id}}")]),
        code_node("code_node_PkMerge", "Merge Picking Progress", PK_MERGE_JS,
                  [("table_gd", "array"), ("picking_status", "string")]),
    ])
    set_prop(d, "update_node_elLmtlLm", "table_gd",
             "{{node:code_node_GKc0ALEe.data.allData.table_gd}}", "{{node:code_node_PkMerge.data.table_gd}}")
    set_prop(d, "update_node_elLmtlLm", "picking_status",
             "{{node:code_node_8pN1MyXz.data.picking_status}}", "{{node:code_node_PkMerge.data.picking_status}}")

    # BUG-006: Force Complete must not touch Cancelled Pickings or lines.
    add_filter_leaf(d, "get_node_oU2TK3ms", {
        "id": 1791000000011, "isTop": False, "prop": "to_status", "operator": "notEqual",
        "valueType": "value", "value": "Cancelled", "type": "leaf", "level": 2,
        "propLabel": "Transfer Order Status", "valueLabel": "", "operatorLabel": "Not Equal"})
    code_replace(d, "code_node_UiubQSk5",
        "    if (pickingLineItem.gd_id === data.id) {\n",
        "    if (pickingLineItem.gd_id === data.id && pickingLineItem.line_status !== \"Cancelled\") {\n")

    # BUG-016: a GD built from a Picking Plan whose reservation was released fails at creation.
    code_replace(d, "code_node_QtyCheckBatch",
        "    if (isGDPP === 1 && saveAs === \"Completed\") {\n"
        "      projectedPlannedQty = plannedQty - currentGdQty;\n"
        "    } else if",
        "    if (isGDPP === 1 && saveAs === \"Completed\") {\n"
        "      projectedPlannedQty = plannedQty - currentGdQty;\n"
        "    } else if (isGDPP === 1 && saveAs === \"Created\") {\n"
        "      // Completion consumes the plan's reservation; if it is already released, say so now.\n"
        "      projectedPlannedQty = plannedQty - currentGdQty;\n"
        "    } else if")
    code_replace(d, "code_node_QtyCheckBatch",
        "      rowMessage = `Row ${rowIndex} with Item ${itemLabel} validation failed: planned quantity would become negative (${projectedPlannedQty.toFixed(3)}). Please contact support.`;\n",
        "      rowMessage = isGDPP === 1 && saveAs === \"Created\"\n"
        "        ? `Row ${rowIndex} with Item ${itemLabel} validation failed: the Sales Order line has only ${plannedQty} reserved for this delivery's ${currentGdQty}. The Picking Plan's reservation was released; contact support before delivering.`\n"
        "        : `Row ${rowIndex} with Item ${itemLabel} validation failed: planned quantity would become negative (${projectedPlannedQty.toFixed(3)}). Please contact support.`;\n")


# ================================================================ GD_UNUSED_FN_NEW  (BUG-014)

def patch_gd_unused_fn_new(d):
    # detectBinHuMigrations: a reservation only migrated when NOTHING was left at its old
    # bin/HU, so a partial pick to the loading bay (1019 of 1019.33) - or a float ghost left
    # behind - fell through to a fresh Unrestricted allocation at the bay and failed preflight.
    code_replace(d, "code_node_b71wypDJ",
        "    const unmatchedOld = oldRecs.filter((r) => !newEntries.some((e) => tupleMatch(r, e)));\n"
        "    const unmatchedNew = newEntries.filter((e) => !oldRecs.some((r) => tupleMatch(r, e)));\n"
        "    if (unmatchedOld.length === 0 || unmatchedNew.length === 0) continue;\n",
        "    // A float residue left at the old bin (4.09e-14 on DO-FG2610-012) is not stock there.\n"
        "    const liveNew = newEntries.filter((e) => q8(e.group.totalQty || 0) > 0);\n"
        "    const unmatchedNew = liveNew.filter((e) => !oldRecs.some((r) => tupleMatch(r, e)));\n"
        "    if (unmatchedNew.length === 0) continue;\n\n"
        "    // What each old record can give up: all of it when its bin/HU holds nothing now, else\n"
        "    // the surplus over what its bin/HU still holds. Fully-vacated records go first, as before.\n"
        "    const tupleKey = (bin, hu) => String(bin || \"\") + \"|\" + String(hu || \"\");\n"
        "    const newAtTuple = new Map();\n"
        "    for (const e of liveNew) {\n"
        "      const k = tupleKey(e.binLocation, e.handlingUnitId);\n"
        "      newAtTuple.set(k, q8((newAtTuple.get(k) || 0) + q8(e.group.totalQty || 0)));\n"
        "    }\n"
        "    const oldAtTuple = new Map();\n"
        "    for (const r of oldRecs) {\n"
        "      const k = tupleKey(r.bin_location, r.handling_unit_id);\n"
        "      if (!oldAtTuple.has(k)) oldAtTuple.set(k, []);\n"
        "      oldAtTuple.get(k).push(r);\n"
        "    }\n"
        "    const migratable = new Map();\n"
        "    const unmatchedOld = [];\n"
        "    const surplusOld = [];\n"
        "    for (const [k, recs] of oldAtTuple) {\n"
        "      const held = newAtTuple.get(k) || 0;\n"
        "      let surplus = q8(recs.reduce((s, r) => s + q8(r.reserved_qty || 0), 0) - held);\n"
        "      for (const r of recs) {\n"
        "        if (surplus <= 0) break;\n"
        "        const give = q8(Math.min(q8(r.reserved_qty || 0), surplus));\n"
        "        if (give <= 0) continue;\n"
        "        migratable.set(r, give);\n"
        "        (held > 0 ? surplusOld : unmatchedOld).push(r);\n"
        "        surplus = q8(surplus - give);\n"
        "      }\n"
        "    }\n"
        "    const sourceRecs = unmatchedOld.concat(surplusOld);\n"
        "    if (sourceRecs.length === 0) continue;\n")
    code_replace(d, "code_node_b71wypDJ",
        "    for (const oldRec of unmatchedOld) {\n      let oldRemaining = q8(oldRec.reserved_qty || 0);\n",
        "    for (const oldRec of sourceRecs) {\n      let oldRemaining = migratable.get(oldRec) || 0;\n")


# ================================================================ registry

WORKFLOWS = {
    # name: (workflow id, enabled version patched against, patch fn)
    "SI_SAVE": (2029040374929154050, 81, patch_si_save),
    "GD_Convert_SI": (2070069049332416514, 21, patch_gd_convert_si),
    "HANDLING_UNIT": (2037062451509002241, 35, patch_handling_unit),
    "SM_LOCATION_TRANSFER": (2013133675374927874, 65, patch_lot),
    "PICKING_LOOP": (2021065804251615233, 84, patch_picking_loop),
    "PACKING_SAVE": (1994279909883895810, 28, patch_packing_save),
    "PICKING_PLAN": (2021431201147527170, 63, patch_picking_plan),
    "PICKING": (2020683258347081730, 72, patch_picking),
    "GOODS_DELIVERY": (2017151544868491265, 172, patch_goods_delivery),
    "GD_UNUSED_FN_NEW": (2032273338771128322, 52, patch_gd_unused_fn_new),
}


def main(names):
    for name in names:
        wid, expected, fn = WORKFLOWS[name]
        version, base = fetch(wid)
        if version != expected:
            raise SystemExit(f"FAIL: {name} prod enabled is v{version}, patches written for v{expected}")
        patched = copy.deepcopy(base)
        fn(patched)
        write(os.path.join(HERE, f"{name}.BASE.json"), base)
        write(os.path.join(HERE, f"{name}.PROD.json"), patched)
        # The same PROD file may go to dev only while dev still runs exactly the prod baseline.
        dev_version, dev = fetch(wid, "--dev")
        parity = ("dev == prod baseline -> same file is safe for dev" if canon(dev) == canon(base)
                  else f"dev v{dev_version} DIFFERS -> do NOT paste into dev")
        print(f"{name}: prod v{version} patched | {parity}")


if __name__ == "__main__":
    main(sys.argv[1:] or list(WORKFLOWS))
