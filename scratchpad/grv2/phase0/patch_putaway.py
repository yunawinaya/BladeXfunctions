"""Phase 0 guards + read fixes on the classic Putaway path (mobile keeps using it).
PUTAWAY_LOOP (Putaway/PutawayLoopWorkflow.json):
  - a Completed save of more than 500 lines is refused through the existing invalid path (before any write);
  - the lock gate also reads an open COMPLETE_PUTAWAY job of the TO and the TO's GR status: either one answers
    "The current putaway is under processing" (lockState 1, the text the mobile app retries on);
  - the lock gate compares the id unquoted (a quoted id against a bigint column goes through double);
  - the non-Completed save stops writing table_putaway_records from the payload (only PUTAWAY writes records);
  - the Add path reads the new TO's lines with limit 1000 (was 100; the 500 guard bounds it).
PUTAWAY (Putaway/PutawayProcessWorkflow.json):
  - the pending check also runs against the STORED pending quantity (a stale screen cannot post a line twice);
  - Item master and in-transit ledger reads become sql-nodes (no 100 / 1000 caps; the Item read no longer joins
    every Item subform), handed to their consumers in the search-node's own shape by bridge code nodes."""
from lib import absent, absent_num, code, find, json, load, replace_in_code, save, sql, walk

# ------------------------------------------------------------------------------------------------ PUTAWAY_LOOP
SIZE_OLD = """if (saveAs !== "Cancelled") {"""
SIZE_NEW = """// A Completed save of more than 500 lines is beyond this save (one stock call per line); refused before anything is written
if (saveAs === "Completed" && invalidMessage === "") {
  const lineCount = flattenPutawayRows(data.table_putaway_item).length;
  if (lineCount > 500) {
    invalidMessage = "This putaway has " + lineCount + " lines. Completing more than 500 lines at once is not supported here.";
  }
}

if (saveAs !== "Cancelled") {"""

LOCK_SQL = """SELECT p.id,
       p.to_status,
       COALESCE(p.is_processing, 0) AS is_processing,
       TIMESTAMPDIFF(
           SECOND,
           p.update_time,
           CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
       ) AS lock_age_sec,
       (SELECT COUNT(*)
          FROM gd_async_job j
         WHERE j.tenant_id = p.tenant_id
           AND j.command = 'COMPLETE_PUTAWAY'
           AND j.causation_id = CAST(p.id AS CHAR) COLLATE utf8mb4_general_ci
           AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND j.is_deleted = 0) AS open_jobs,
       (SELECT g.gr_status
          FROM goods_receiving g
         WHERE g.id = CAST(p.gr_no AS UNSIGNED)
           AND g.is_deleted = 0
         LIMIT 1) AS gr_status
FROM transfer_order_putaway p
WHERE p.id = {{node:code_node_kku8SAT9.data.lockId}}
  AND p.is_deleted = 0
LIMIT 1"""

DECIDE_OLD = """return {
  lockState,
  staleRecovered
}"""
DECIDE_NEW = """// A background job of this putaway (Putaway V2) or its Goods Receiving still being saved in the background holds it:
// the same answer as a live lock, so the mobile app keeps retrying
if (row && row.id && lockState !== 2 && (Number(row.open_jobs) > 0 || String(row.gr_status || "") === "Processing")) {
  lockState = 1;
  staleRecovered = 0;
}

return {
  lockState,
  staleRecovered
}"""


def putaway_loop():
    rel = "Putaway/PutawayLoopWorkflow.json"
    text = load(rel)
    doc = json.loads(text)
    pick = find(doc, "code_node_kku8SAT9")
    assert "more than 500 lines" not in pick["data"]["script"]["code"], "already patched"
    replace_in_code(pick, SIZE_OLD, SIZE_NEW)

    gate = find(doc, "sql_node_LockGate")
    assert "open_jobs" not in gate["data"]["script"]["code"], "already patched"
    gate["data"]["script"]["code"] = LOCK_SQL
    names = [r["name"] for r in gate["data"]["response_json"]]
    assert names == ["id", "to_status", "is_processing", "lock_age_sec"], names
    for key, name in (("plg1jobs", "open_jobs"), ("plg2grst", "gr_status")):
        gate["data"]["response_json"].append({"key": key, "name": name, "title": name, "description": "", "bsonType": "string",
                                              "isExpand": False, "children": []})
    replace_in_code(find(doc, "code_node_LockDecide"), DECIDE_OLD, DECIDE_NEW)

    upd = find(doc, "update_node_YJRu1B3c")
    props = upd["data"]["props"]["list"]
    assert [p["prop"] for p in props].count("table_putaway_records") == 1
    upd["data"]["props"]["list"] = [p for p in props if p["prop"] != "table_putaway_records"]

    search = find(doc, "search_node_hrs91pu9")
    assert search["data"]["limit"] == 100
    search["data"]["limit"] = 1000
    save(rel, doc, text)
    print("patched", rel)


# ------------------------------------------------------------------------------------------------ PUTAWAY
STORED_OLD = """const isValid = errors.length === 0 ? 1 : 0;"""
STORED_NEW = """// The stored lines decide what is still pending: a stale screen (a mobile copy opened before another confirmation)
// must not post a line twice. Quantities are grouped the way code_node_KbJLkjP8 applies them ("<line> - <n>" split
// children count against their line).
const storedRaw = [{{node:get_node_C64LC1sr.data.data}}][0];
const stored = Array.isArray(storedRaw) ? storedRaw[0] || {} : storedRaw || {};
// lines that share a line_index count together (code_node_KbJLkjP8 reduces every one of them)
const storedPending = {};
const storedName = {};
for (const row of flattenPutawayRows(stored.table_putaway_item)) {
  const k = String(row.line_index);
  storedPending[k] = (storedPending[k] || 0) + (parseFloat(row.pending_process_qty) || 0);
  if (!storedName[k] && row.item_name) storedName[k] = row.item_name;
}
const claimed = {};
for (const item of items) {
  if (item.line_status === 'Cancelled') continue;
  if (item.parent_or_child === 'Parent' && item.is_split === 'Yes') continue;
  if (isBundleParentRow(item)) continue;
  const qty = parseFloat(item.putaway_qty) || 0;
  if (qty <= 0) continue;
  const lineIndex = String(item.line_index);
  const key = lineIndex.includes(' - ') ? lineIndex.split(' - ')[0] : lineIndex;
  claimed[key] = (claimed[key] || 0) + qty;
}
for (const key of Object.keys(claimed)) {
  if (storedPending[key] === undefined) continue;
  const pending = storedPending[key];
  if (claimed[key] - pending > 0.0005) {
    errors.push(
      `Putaway quantity (${claimed[key]}) cannot be greater than the pending quantity (${pending}) of line ${key}${storedName[key] ? ' (' + storedName[key] + ')' : ''} - it may already have been put away; please reload the putaway.`
    );
  }
}

const isValid = errors.length === 0 ? 1 : 0;"""

KEYS_JS = """// Digits-only keys for the Item and in-transit reads below (interpolated into SQL)
const DIG = /^[0-9]{1,20}$/;
const codes = [{{node:code_node_qfSZO0bi.data.uniqueItemCodes}}][0] || [];
const ids = [];
for (const c of Array.isArray(codes) ? codes : []) {
  const s = String(c === null || c === undefined ? "" : c).trim();
  if (DIG.test(s) && !ids.includes(s)) ids.push(s);
}
const grId = String([{{node:code_node_qfSZO0bi.data.grId}}][0] || "").trim();
const orgId = String([{{node:code_node_qfSZO0bi.data.organizationId}}][0] || "").trim();
return {
  itemIdsCsv: ids.length ? ids.join(",") : "0",
  grId: DIG.test(grId) ? grId : "0",
  orgId: DIG.test(orgId) ? orgId : "0",
};"""

ITEMS_SQL = """SELECT JSON_OBJECT(
         'id', CAST(i.id AS CHAR),
         'based_uom', CAST(i.based_uom AS CHAR),
         'item_batch_management', i.item_batch_management,
         'material_costing_method', i.material_costing_method,
         'table_uom_conversion', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR),
                                                                           'base_qty', u.base_qty))
                                             FROM item_mji552rc_sub u
                                            WHERE u.Item_id = i.id
                                              AND u.is_deleted = 0), JSON_ARRAY())
       ) AS j
  FROM item i
 WHERE i.tenant_id = '{{system:tenantId}}'
   AND i.id IN ({{node:code_node_PwKeys.data.itemIdsCsv}})
   AND i.is_deleted = 0"""

ITEMS_JS = """// The Item fields the movement builder reads, in the search-node's shape (ids as strings, numbers as numbers, NULL and empty values left out)
const parse = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
  }
};
const raw = [{{node:sql_node_PwItems.data}}][0] || [];
const items = [];
for (const r of Array.isArray(raw) ? raw : [raw]) {
  const o = parse(r && r.j !== undefined ? r.j : r);
  if (!o || !o.id) continue;
  const conv = parse(o.table_uom_conversion);
  o.table_uom_conversion = (Array.isArray(conv) ? conv : []).map((c) => ({
    alt_uom_id: c.alt_uom_id === null || c.alt_uom_id === undefined ? c.alt_uom_id : String(c.alt_uom_id),
    base_qty: c.base_qty === null || c.base_qty === undefined ? c.base_qty : Number(c.base_qty),
  }));
  if (o.item_batch_management !== null && o.item_batch_management !== undefined) o.item_batch_management = Number(o.item_batch_management);
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === "") delete o[k];
  items.push(o);
}
return { items };"""

TRANSIT_SQL = """SELECT JSON_OBJECT(
         'id', CAST(t.id AS CHAR), 'doc_type', t.doc_type, 'doc_id', t.doc_id, 'doc_no', t.doc_no,
         'doc_line_id', t.doc_line_id, 'line_no', t.line_no, 'parent_id', t.parent_id, 'parent_no', t.parent_no,
         'parent_line_id', t.parent_line_id, 'material_id', CAST(t.material_id AS CHAR), 'item_code', t.item_code,
         'item_name', t.item_name, 'item_desc', t.item_desc, 'item_uom', CAST(t.item_uom AS CHAR),
         'batch_id', CAST(t.batch_id AS CHAR), 'handling_unit_id', t.handling_unit_id,
         'plant_id', CAST(t.plant_id AS CHAR), 'organization_id', t.organization_id,
         'transit_bin', CAST(t.transit_bin AS CHAR), 'from_plant_id', CAST(t.from_plant_id AS CHAR),
         'from_bin', CAST(t.from_bin AS CHAR), 'from_category', t.from_category,
         'to_plant_id', CAST(t.to_plant_id AS CHAR), 'to_bin', CAST(t.to_bin AS CHAR), 'to_category', t.to_category,
         'transit_qty', t.transit_qty, 'received_qty', t.received_qty, 'open_qty', t.open_qty, 'status', t.status,
         'transit_date', DATE_FORMAT(t.transit_date, '%Y-%m-%d %H:%i:%s'),
         'received_date', DATE_FORMAT(t.received_date, '%Y-%m-%d %H:%i:%s'), 'remark', t.remark,
         'target_doc_type', t.target_doc_type, 'target_doc_id', t.target_doc_id, 'target_doc_no', t.target_doc_no,
         'target_doc_line_id', t.target_doc_line_id, 'source_transit_id', t.source_transit_id
       ) AS j
  FROM in_transit_detail t
 WHERE t.tenant_id = '{{system:tenantId}}'
   AND t.doc_id = '{{node:code_node_PwKeys.data.grId}}'
   AND t.organization_id = '{{node:code_node_PwKeys.data.orgId}}'
   AND t.is_deleted = 0
 ORDER BY t.id"""

TRANSIT_JS = """// Every in-transit row of this Goods Receiving (all statuses: the matcher needs the closed ones to refuse double
// consumption), in the search-node's shape: decimals as numbers, ids as strings, NULL and empty values left out
const parse = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
  }
};
const raw = [{{node:sql_node_PwTransit.data}}][0] || [];
const rows = [];
for (const r of Array.isArray(raw) ? raw : [raw]) {
  const o = parse(r && r.j !== undefined ? r.j : r);
  if (!o || !o.id) continue;
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === "") delete o[k];
  for (const k of ["transit_qty", "received_qty", "open_qty", "line_no"]) if (o[k] !== undefined) o[k] = Number(o[k]);
  rows.push(o);
}
return { rows };"""


def items_response(name, key):
    return [{"key": key, "name": name, "title": name, "description": "", "bsonType": "array", "isExpand": True,
             "children": [{"key": key + "i", "name": "items", "title": "", "description": "", "bsonType": "any", "isExpand": False,
                           "isArrayItem": True, "children": []}]}]


def putaway():
    rel = "Putaway/PutawayProcessWorkflow.json"
    text = load(rel)
    doc = json.loads(text)
    absent(doc, "code_node_PwKeys", "sql_node_PwItems", "code_node_PwItems", "sql_node_PwTransit", "code_node_PwTransit")
    absent_num(doc, 1798100000031)
    replace_in_code(find(doc, "code_node_S8GL6e4o"), STORED_OLD, STORED_NEW)

    par = find(doc, "condition_all_ITfetch")
    branches = {b["id"]: b for b in par["blocks"]}
    assert [n["id"] for n in branches["condition_all_item_ITfa"]["blocks"]] == ["search_node_6yzlT81I"]
    assert [n["id"] for n in branches["condition_all_item_ITfb"]["blocks"]] == ["search_node_ITopen"]
    items_code = code("code_node_PwItems", "Item master rows (search-node shape)", ITEMS_JS, [])
    items_code["data"]["response_json"] = items_response("items", "pwi1itms")
    transit_code = code("code_node_PwTransit", "In-transit rows (search-node shape)", TRANSIT_JS, [])
    transit_code["data"]["response_json"] = items_response("rows", "pwt1rows")
    branches["condition_all_item_ITfa"]["blocks"] = [
        sql("sql_node_PwItems", "Get Items (UOM conversions)", ITEMS_SQL, [("pwi2j", "j")]), items_code]
    branches["condition_all_item_ITfb"]["blocks"] = [
        sql("sql_node_PwTransit", "Get In Transit Rows (all statuses)", TRANSIT_SQL, [("pwt2j", "j")]), transit_code]

    top = doc["nodes"]
    at = next(i for i, n in enumerate(top) if n["id"] == "condition_all_ITfetch")
    top.insert(at, code("code_node_PwKeys", "Keys for the Item and in-transit reads (digits only)", KEYS_JS,
                        [("pwk1ids", "itemIdsCsv"), ("pwk2gr", "grId"), ("pwk3org", "orgId")]))

    replace_in_code(find(doc, "code_node_M7XzDZ48"), "{{node:search_node_6yzlT81I.data.data}}", "{{node:code_node_PwItems.data.items}}")
    replace_in_code(find(doc, "code_node_ITmatch"), "{{node:search_node_ITopen.data.data}}", "{{node:code_node_PwTransit.data.rows}}")
    left = []
    walk(doc, lambda n: left.append(n.get("id")) if "search_node_6yzlT81I" in json.dumps(n.get("data", "")) or "search_node_ITopen" in json.dumps(n.get("data", "")) else None)
    assert not left, "still referenced by " + str(left)
    save(rel, doc, text)
    print("patched", rel)


if __name__ == "__main__":
    putaway_loop()
    putaway()
