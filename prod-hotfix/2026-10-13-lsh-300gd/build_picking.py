#!/usr/bin/env python3
"""PICKING hotfix for LSH's 300-GD confirm (PI-20261013-1502). One file for prod and dev.

Base: dev's enabled PICKING (v149 = prod v77 + the 2026-10-12 safety net), checked against both databases
before anything is changed. Changes:

1. Full Picking sibling lookup. search_node_SiblingPickings was a search-node: `gd_no in [300 ids]` became
   300 JSON_CONTAINS ORs over every LSH Picking, LEFT JOINed with both subforms -> 30 s statement timeout.
   It becomes code_node_SibPrep + sql_node_SibRecs: only the sibling records of this run's GD lines.
   code_node_MNRecompute reads those rows, and skips the lines code_node_iES7iMKA already wrote with the
   same recount (on the 300-GD confirm: all 2,096 of them).
2. The Picking Plan twin: search_node_PpSiblings -> code_node_PpSibPrep + sql_node_PpSibRecs, read by
   code_node_AGoxWP7x.
3. GD headers. code_node_GdPlan routes every GD once; every header-only write goes in one update
   (update_node_GdPickHdr). The loop runs only for the GDs that need the GOODS_DELIVERY sub-workflow or a
   skip note, in GD order, and takes its GD from the loop item -- code_node_9rK80jNQ used to take the whole
   GD list on every pass (300 passes x 9 MB).
4. Packing creates in slices of 25 (code_node_PkSlices -> loop_PkCreates -> code_node_PkSlice ->
   add_node_LcxwYc7z).

Writes Picking/PickingProcessWorkflow.json and Picking/PickingProcessWorkflow.PROD.json (same content).
usage: python3 build_picking.py [--write]
"""
import copy, hashlib, json, os, random, string, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import sync_repo as sr  # noqa: E402  render() = Prettier of the minified JSON; apply_hunks(); normalize_changed_code()

MAIN = os.path.join(REPO, "Picking", "PickingProcessWorkflow.json")
PROD_MIRROR = os.path.join(REPO, "Picking", "PickingProcessWorkflow.PROD.json")
WF_ID = 2020683258347081730
SLICE = 25


def canon(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def enabled(env):
    out = subprocess.run([os.path.join(REPO, ".dbtools", "db"), env, "--json",
                          f"SELECT version_number, script_json FROM su_code_workflow_history WHERE data_id={WF_ID} "
                          "AND status='enabled' ORDER BY version_number DESC LIMIT 1"], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(out.stderr[-400:])
    row = json.loads(out.stdout)[0]
    return row["version_number"], json.loads(row["script_json"])


# ---------------------------------------------------------------- node helpers

def locate(wf, nid):
    """-> (the list holding the node, its index)."""
    hit = []

    def walk(lst):
        for i, n in enumerate(lst):
            if isinstance(n, dict) and "type" in n and "data" in n:
                if n["id"] == nid:
                    hit.append((lst, i))
                walk(n.get("blocks") or [])

    walk(wf["nodes"])
    assert len(hit) == 1, (nid, len(hit))
    return hit[0]


def node(wf, nid):
    lst, i = locate(wf, nid)
    return lst[i]


def remove(wf, nid):
    lst, i = locate(wf, nid)
    return lst.pop(i)


def replace_code(wf, nid, old, new):
    n = node(wf, nid)
    code = n["data"]["script"]["code"]
    assert code.count(old) == 1, (nid, code.count(old), old[:80])
    n["data"]["script"]["code"] = code.replace(old, new)


class Ids:
    """Fresh response_json keys (8 chars) and filter ids, unique in the file."""

    def __init__(self, wf):
        self.keys = set()
        self.nums = set()

        def walk(o):
            if isinstance(o, dict):
                if isinstance(o.get("key"), str):
                    self.keys.add(o["key"])
                for k in ("id", "parentId"):
                    if isinstance(o.get(k), int):
                        self.nums.add(o[k])
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)

        walk(wf)
        self.rng = random.Random("lsh-300gd-picking")
        self.next_num = 1792000000001

    def key(self):
        while True:
            k = "".join(self.rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in self.keys:
                self.keys.add(k)
                return k

    def num(self):
        while self.next_num in self.nums:
            self.next_num += 1
        self.nums.add(self.next_num)
        self.next_num += 1
        return self.next_num - 1


def resp(ids, name, bson, items=False):
    out = {"key": ids.key(), "name": name, "title": name, "description": "", "bsonType": bson,
           "isExpand": items, "children": []}
    if items:
        out["children"] = [{"key": ids.key(), "name": "items", "title": "", "description": "", "bsonType": "any",
                            "isExpand": False, "isArrayItem": True, "children": []}]
    return out


def code_node(ids, nid, title, code, outputs):
    return {"id": nid, "type": "code-node", "data": {
        "language": "javascript", "code": "", "timeout": 30000, "title": title, "isValidator": True,
        "nodeName": title, "name": title, "script": {"type": "javascript", "code": code},
        "response_json": [resp(ids, name, bson, bson == "array") for name, bson in outputs]}, "blocks": []}


def sql_node(ids, nid, title, sql, columns):
    return {"id": nid, "type": "sql-node", "data": {
        "database_id": "", "sql": "", "params": {}, "title": title, "isValidator": True, "nodeName": title,
        "name": title, "script": {"type": "sql", "code": sql},
        "response_json": [resp(ids, c, "string") for c in columns]}, "blocks": []}


def flag_if(ids, nid, title, prop, true_blocks):
    leaf = {"id": ids.num(), "parentId": ids.num(), "isTop": True, "prop": prop, "operator": "numberEqual",
            "valueType": "value", "value": 1, "type": "leaf", "level": 1, "propLabel": prop.rsplit(".", 1)[-1],
            "valueLabel": "", "operatorLabel": "Equal"}
    return {"id": nid, "type": "if", "data": {
        "title": title, "isValidator": True, "nodeName": title, "name": title, "condition_type": "ConditionRule",
        "expression": {"type": "javascript", "code": ""}, "filter": {"list": [leaf]}},
        "blocks": [{"id": nid + "T", "type": "ifBlock", "data": {"title": "true"}, "blocks": list(true_blocks)},
                   {"id": nid + "F", "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}


def set_route_filter(wf, nid, value):
    [leaf] = node(wf, nid)["data"]["filter"]["list"]
    assert leaf["prop"] == "node.code_node_GdRoute.data.route" and leaf["value"] == value, leaf
    leaf["prop"] = "node.code_node_9rK80jNQ.data.route"


# ---------------------------------------------------------------- 1. Full Picking sibling lookup

PREP_JS = """// The sibling query below takes these as text: digits only.
const digits = (v) => (/^[0-9]{1,20}$/.test(String(v == null ? "" : v)) ? String(v) : "");
const csv = (list) => [...new Set((list || []).map(digits).filter(Boolean))].join(",");
const _opd = {{node:get_node_jEllcWiJ.data.data}};
const picking = (Array.isArray(_opd) ? _opd[0] : _opd) || {};
return {
  orgId: digits(picking.organization_id) || "0",
  ownId: digits({{node:code_node_UDOp8D9x.data.id}}) || "0",
  %s: csv({{node:%s}}),
  %s: csv({{node:%s}}),
};
"""

SIB_SQL = """SELECT CAST(r.transfer_order_id AS CHAR) AS sibling_id,
       CAST(r.{line_col} AS CHAR) AS {line_col},
       r.store_out_qty,
       CAST(r.source_bin AS CHAR) AS source_bin,
       CAST(r.target_location AS CHAR) AS target_location,
       CAST(r.batch_no AS CHAR) AS batch_no,
       CAST(r.target_batch AS CHAR) AS target_batch,
       CAST(r.handling_unit_id AS CHAR) AS handling_unit_id
FROM transfer_order t
JOIN transfer_order_vrqs3cmr_sub r
  ON r.transfer_order_id = t.id AND r.tenant_id = t.tenant_id AND r.is_deleted = 0
JOIN JSON_TABLE(CONCAT('[', '{{{{node:{prep}.data.{line_csv}}}}}', ']'),
                '$[*]' COLUMNS (lid BIGINT PATH '$')) l ON l.lid = r.{line_col}
WHERE t.organization_id = '{{{{node:{prep}.data.orgId}}}}'
  AND t.is_deleted = 0{status}
  AND t.id <> {{{{node:{prep}.data.ownId}}}}
  AND (JSON_OVERLAPS(t.{doc_col}, CAST(CONCAT('[', '{{{{node:{prep}.data.{doc_csv}}}}}', ']') AS JSON))
       OR JSON_OVERLAPS(t.{doc_col}, (SELECT JSON_ARRAYAGG(CAST(d.id AS CHAR))
                                    FROM JSON_TABLE(CONCAT('[', '{{{{node:{prep}.data.{doc_csv}}}}}', ']'),
                                                    '$[*]' COLUMNS (id BIGINT PATH '$')) d)))"""

SIB_COLUMNS = ["sibling_id", "{line_col}", "store_out_qty", "source_bin", "target_location", "batch_no",
               "target_batch", "handling_unit_id"]


def sibling_nodes(ids, prep_id, sql_id, title, doc_col, line_col, doc_src, line_src, doc_csv, line_csv, status=""):
    prep = code_node(ids, prep_id, title + ": ids for the query", PREP_JS % (doc_csv, doc_src, line_csv, line_src),
                     [("orgId", "string"), ("ownId", "string"), (doc_csv, "string"), (line_csv, "string")])
    sql = SIB_SQL.format(prep=prep_id, doc_col=doc_col, line_col=line_col, doc_csv=doc_csv, line_csv=line_csv,
                         status=status)
    cols = [c.format(line_col=line_col) for c in SIB_COLUMNS]
    return prep, sql_node(ids, sql_id, title, sql, cols)


MN_READ_OLD = "const siblings = {{node:search_node_SiblingPickings.data.data}} || [];\n"
MN_READ_NEW = ("const _sib = {{node:sql_node_SibRecs.data}};\n"
               "const siblingRecords = Array.isArray(_sib) ? _sib : _sib ? [_sib] : [];\n")
MN_LOOP_OLD = """for (const sib of siblings) {
  if (String(sib.id || "") === ownId) continue;
  const recs = Array.isArray(sib.table_picking_records) ? sib.table_picking_records : [];
  for (const r of recs) addRecord(r);
}
"""
MN_LOOP_NEW = """for (const r of siblingRecords) {
  if (String(r.sibling_id || "") === ownId) continue;
  addRecord(r);
}
"""
MN_KEY_OLD = """  return (locId || 'no-location') + '_' + b + '_' + (huId || 'no_hu');
};
"""
MN_KEY_NEW = MN_KEY_OLD + """
// iES7iMKA already wrote every line; a line whose recount equals what it wrote needs no second write.
const writtenById = {};
for (const w of ({{node:code_node_iES7iMKA.data.updatedGdLines}} || [])) writtenById[String(w.id)] = w;
const qtyByKey = (entries) => {
  const out = {};
  for (const e of entries || []) {
    const q = Math.round((parseFloat(e.gd_quantity) || 0) * 1000);
    if (q <= 0) continue;
    const k = mergeKey(e.location_id, e.batch_id, e.handling_unit_id);
    out[k] = (out[k] || 0) + q;
  }
  return out;
};
const sameAsWritten = (id, entries, total, status) => {
  const w = writtenById[String(id)];
  if (!w || w.picking_status !== status) return false;
  if (Math.round((parseFloat(w.picked_qty) || 0) * 1000) !== Math.round(total * 1000)) return false;
  let written;
  try {
    written = typeof w.picked_temp_qty_data === 'string' ? JSON.parse(w.picked_temp_qty_data) : w.picked_temp_qty_data;
  } catch (e) {
    return false;
  }
  const a = qtyByKey(written);
  const b = qtyByKey(entries);
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
};
"""
MN_PUSH_OLD = """  updatedLines.push({
    id: lineItem.id,
    picked_qty: totalPickedQty,"""
MN_PUSH_NEW = """  if (sameAsWritten(lineItem.id, mergedPicked, totalPickedQty, pickingStatus)) continue;

""" + MN_PUSH_OLD


def patch_siblings(wf, ids):
    lst, i = locate(wf, "search_node_SiblingPickings")
    prep, sql = sibling_nodes(ids, "code_node_SibPrep", "sql_node_SibRecs", "Sibling Picking Records",
                              "gd_no", "gd_line_id", "code_node_oHIIKfiw.data.gdIds",
                              "code_node_oHIIKfiw.data.gdLineIds", "gdIdCsv", "lineIdCsv")
    lst[i:i + 1] = [prep, sql]
    replace_code(wf, "code_node_MNRecompute", MN_READ_OLD, MN_READ_NEW)
    replace_code(wf, "code_node_MNRecompute", MN_LOOP_OLD, MN_LOOP_NEW)
    replace_code(wf, "code_node_MNRecompute", MN_KEY_OLD, MN_KEY_NEW)
    replace_code(wf, "code_node_MNRecompute", MN_PUSH_OLD, MN_PUSH_NEW)


# ---------------------------------------------------------------- 2. Picking Plan twin

PP_LOOP_OLD = """for (const sib of ({{node:search_node_PpSiblings.data.data}} || [])) {
  if (String(sib.id || "") === __ownId) continue;
  // A deleted or cancelled Picking's records are not picks. The search-node is
  // believed to filter is_deleted (only 8 of 635 nodes in this repo filter it by
  // hand), but a Picking's records live in a JSON column on the parent and survive
  // the delete -- PK-03472-DEL still carries its two rows at is_deleted 0. Guard
  // here rather than depend on that.
  if (Number(sib.is_deleted) === 1) continue;
  if (sib.to_status === "Cancelled") continue;
  const recs = Array.isArray(sib.table_picking_records) ? sib.table_picking_records : [];
  for (const r of recs) {
    if (Number(r.is_deleted) === 1) continue;
    __addRec(r);
  }
}
"""
PP_LOOP_NEW = """// A deleted or cancelled Picking's records are not picks: sql_node_PpSibRecs leaves them out.
const __sib = {{node:sql_node_PpSibRecs.data}};
for (const r of (Array.isArray(__sib) ? __sib : __sib ? [__sib] : [])) {
  if (String(r.sibling_id || "") === __ownId) continue;
  __addRec(r);
}
"""


def patch_pp_siblings(wf, ids):
    lst, i = locate(wf, "search_node_PpSiblings")
    prep, sql = sibling_nodes(ids, "code_node_PpSibPrep", "sql_node_PpSibRecs", "Sibling Picking Records (PP)",
                              "to_no", "to_line_id", "code_node_Q3hWck9R.data.toIds",
                              "code_node_Q3hWck9R.data.toLineIds", "toIdCsv", "toLineIdCsv",
                              status="\n  AND COALESCE(t.to_status, '') <> 'Cancelled'")
    lst[i:i + 1] = [prep, sql]
    replace_code(wf, "code_node_AGoxWP7x", PP_LOOP_OLD, PP_LOOP_NEW)


# ---------------------------------------------------------------- 3. GD headers

GD_PLAN_JS = """// Routes every GD once. A normal pick changes only the GD header picking_status: those go in one write below,
// rolled up exactly as GOODS_DELIVERY's code_node_PkMerge does. Only a full re-save (this pick moved stock or
// force-completed; refused above 500 lines before any write), an auto-complete (skipped above 500 lines) or a
// skip note goes through the per-GD loop.
const MAX_SYNC_GD_LINES = 500;
const gdDatas = {{node:code_node_B3E0xodz.data.updatedGdDatas}} || [];
const setupRaw = {{node:get_node_Uj1uV9PU.data.data}};
const setup = (Array.isArray(setupRaw) ? setupRaw[0] : setupRaw) || {};
const lineCounts = {{node:code_node_SizeGuard.data.lineCounts}} || {};
const needFullSave = Number({{node:code_node_SizeGuard.data.needFullSave}} || 0) === 1;

// Verbatim from GOODS_DELIVERY code_node_PkMerge.
const rollUpPicking = (header, rows) => {
  if (header !== "Created" && header !== "In Progress") return header;
  const lines = (rows || [])
    .flatMap((row) => [row, ...(Array.isArray(row.children) ? row.children : [])])
    .filter((line) => line.material_id && line.picking_status !== "Cancelled" &&
      (parseFloat(line.gd_qty) || 0) > 0);
  return lines.length > 0 && lines.every((line) => line.picking_status === "Completed")
    ? "Completed" : header;
};

const statusRows = [];
const loopItems = [];
for (const gd of gdDatas) {
  const pickingStatus = gd.picking_status || "";
  const gdId = String(gd.id || "");
  const lineCount = Number(lineCounts[gdId] || 0);
  if (gd.gd_status === "Cancelled") {
    loopItems.push({ gd, route: "SKIP", failCode: "400", failMessage: "the Goods Delivery is cancelled" });
  } else if (pickingStatus === "Completed" && Number(setup.auto_completed_gd || 0) === 1) {
    if (lineCount > MAX_SYNC_GD_LINES) {
      loopItems.push({
        gd,
        route: "SKIP",
        failCode: "200",
        failMessage: lineCount + " lines is above the " + MAX_SYNC_GD_LINES +
          "-line limit for completing it automatically; complete it from the Goods Delivery",
      });
    } else {
      loopItems.push({ gd, route: "COMPLETE" });
    }
  } else if (needFullSave) {
    loopItems.push({ gd, route: "CREATED" });
  } else {
    statusRows.push({ id: gdId, picking_status: rollUpPicking(pickingStatus, gd.table_gd) });
  }
}

return {
  statusRows,
  hasStatusRows: statusRows.length > 0 ? 1 : 0,
  loopItems,
  hasLoopItems: loopItems.length > 0 ? 1 : 0,
};
"""

GD_ITEM_OLD = """const gdDatas = {{node:code_node_B3E0xodz.data.updatedGdDatas}};
const currentIndexRaw = {{node:get_cache_node_3lCsEcVi.data}};
const index = currentIndexRaw ? parseInt(currentIndexRaw, 10) : 0;

const gdData = gdDatas[index];
const pickingStatus = gdData.picking_status;

return {
  gdData,
  pickingStatus,
  index,
  nextIndex: index + 1,
  docNo: gdData.delivery_no || gdData.id || "",
}"""
GD_ITEM_NEW = """// One GD per pass, from the loop item (routed by code_node_GdPlan).
const item = {{node:loop_zRdd7yAf}} || {};
const gdData = item.gd || {};

return {
  gdData,
  pickingStatus: gdData.picking_status,
  route: item.route || "",
  failCode: item.failCode || "",
  failMessage: item.failMessage || "",
  docNo: gdData.delivery_no || gdData.id || "",
}"""


def patch_gd_loop(wf, ids):
    # every header-only write in one update, before the loop
    hdr = remove(wf, "update_node_GdPickHdr")
    [leaf] = hdr["data"]["table_id"]["rules"]["list"]
    assert leaf["value"] == "{{node:code_node_GdRoute.data.gdId}}"
    leaf["value"] = "{{node:code_node_GdPlan.data.statusRows.id}}"
    [prop] = hdr["data"]["props"]["list"]
    assert prop["value"] == "{{node:code_node_GdRoute.data.headerStatus}}"
    prop["value"] = "{{node:code_node_GdPlan.data.statusRows.picking_status}}"
    hdr["data"]["props"]["list"] = [
        {"prop": "id", "valueType": "field", "value": "{{node:code_node_GdPlan.data.statusRows.id}}",
         "operator": "", "valueLabel": "", "propLabel": "主键ID"}, prop]
    for t in ("title", "nodeName", "name"):
        hdr["data"][t] = "Update GD Picking Status (headers only)"

    # the old per-pass route node goes; its STATUS branch moved above, its skip branch moves up one level
    status_if = remove(wf, "if_GdRouteStatus")
    assert [b["id"] for b in status_if["blocks"]] == ["if_block_GdStatusT", "if_block_GdStatusF"]
    assert status_if["blocks"][0]["blocks"] == []  # update_node_GdPickHdr was taken out above
    skip_nodes = status_if["blocks"][1]["blocks"]
    assert [n["id"] for n in skip_nodes] == ["get_cache_GdFailC", "code_node_GdFailC", "set_cache_GdFailC"]
    created_false = node(wf, "if_block_GdCreatedF")
    assert created_false["blocks"] == []
    created_false["blocks"] = skip_nodes
    replace_code(wf, "code_node_GdFailC", "code: {{node:code_node_GdRoute.data.failCode}} || \"400\",",
                 "code: {{node:code_node_9rK80jNQ.data.failCode}} || \"400\",")
    replace_code(wf, "code_node_GdFailC", "message: {{node:code_node_GdRoute.data.failMessage}} || \"\"",
                 "message: {{node:code_node_9rK80jNQ.data.failMessage}} || \"\"")
    remove(wf, "code_node_GdRoute")
    set_route_filter(wf, "if_9oBTzuRX", "COMPLETE")
    set_route_filter(wf, "if_GdRouteCreated", "CREATED")

    # the loop: no index cache, its GD from the loop item
    for nid in ("set_cache_node_1R9hW1Qo", "get_cache_node_3lCsEcVi", "set_cache_node_1NfOiMrn"):
        remove(wf, nid)
    replace_code(wf, "code_node_9rK80jNQ", GD_ITEM_OLD, GD_ITEM_NEW)
    item = node(wf, "code_node_9rK80jNQ")
    rj = item["data"]["response_json"]
    assert [r["name"] for r in rj] == ["gdData", "pickingStatus", "index", "nextIndex", "docNo"]
    item["data"]["response_json"] = rj[:2] + [resp(ids, n, "string") for n in ("route", "failCode", "failMessage")] + rj[4:]

    lst, i = locate(wf, "loop_zRdd7yAf")
    loop = lst[i]
    assert loop["data"]["loopSeletVar"]["code"] == "{{node:code_node_B3E0xodz.data.updatedGdDatas}}"
    loop["data"]["loopSeletVar"]["code"] = "{{node:code_node_GdPlan.data.loopItems}}"
    lst[i] = flag_if(ids, "if_GdLoopItems", "IF GDs Need The GD Workflow", "node.code_node_GdPlan.data.hasLoopItems",
                     [loop])

    lst, i = locate(wf, "code_node_B3E0xodz")
    plan = code_node(ids, "code_node_GdPlan", "GD Plan: header-only updates, the rest through the loop",
                     GD_PLAN_JS, [("statusRows", "array"), ("hasStatusRows", "int"), ("loopItems", "array"),
                                  ("hasLoopItems", "int")])
    lst[i + 1:i + 1] = [plan, flag_if(ids, "if_GdStatusRows", "IF Header-Only Updates",
                                      "node.code_node_GdPlan.data.hasStatusRows", [hdr])]


# ---------------------------------------------------------------- 4. Packing creates in slices

SLICES_JS = """// At most %d Packings per add-node call (one Picking of 300 GDs made 300 in one call).
const list = {{node:code_node_gudzrvMQ.data.packingDataList}} || [];
const slices = [];
for (let i = 0; i < list.length; i += %d) slices.push({ rows: list.slice(i, i + %d) });
return { slices };
""" % (SLICE, SLICE, SLICE)

SLICE_JS = """const slice = {{node:loop_PkCreates}} || {};
return { rows: slice.rows || [] };
"""


def patch_packing(wf, ids):
    lst, i = locate(wf, "add_node_LcxwYc7z")
    add = lst[i]
    src = json.dumps(add, ensure_ascii=False)
    n_refs = src.count("{{node:code_node_gudzrvMQ.data.packingDataList.")
    assert n_refs == 29, n_refs  # 16 fields + 13 Delivery Info fields
    add = json.loads(src.replace("{{node:code_node_gudzrvMQ.data.packingDataList.", "{{node:code_node_PkSlice.data.rows."))
    loop_tpl = copy.deepcopy(node(wf, "loop_PackingUpdates"))
    loop = {"id": "loop_PkCreates", "type": "loop", "data": loop_tpl["data"], "blocks": [
        code_node(ids, "code_node_PkSlice", "Packing Slice", SLICE_JS, [("rows", "array")]), add]}
    for t in ("title", "nodeName", "name"):
        loop["data"][t] = "Loop Packing Creates (%d per call)" % SLICE
    loop["data"]["loopSeletVar"]["code"] = "{{node:code_node_PkSlices.data.slices}}"
    [leaf] = loop["data"]["loopSeletSource"]["datasource"]["rules"]["list"]
    leaf["id"], leaf["parentId"] = ids.num(), ids.num()
    lst[i:i + 1] = [code_node(ids, "code_node_PkSlices", "Packing Slices", SLICES_JS, [("slices", "array")]), loop]
    return n_refs


# ---------------------------------------------------------------- build

def build(base):
    wf = copy.deepcopy(base)
    ids = Ids(wf)
    patch_siblings(wf, ids)
    patch_pp_siblings(wf, ids)
    patch_gd_loop(wf, ids)
    n_refs = patch_packing(wf, ids)
    return wf, n_refs


# Hand-expanded in the repo file, and restructured here anyway: these take the rendered layout first.
NORMALIZE = ("set_cache_node_1R9hW1Qo", "set_cache_GdFailInit", "loop_zRdd7yAf")


def render_onto(raw, base, target, normalize=NORMALIZE):
    sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-picking-packing-race"))
    from sync_picking_repo import object_spans
    raw = sr.normalize_changed_code(raw, base, target)
    old = sr.render(base)
    raw_spans, old_spans = object_spans(raw), object_spans(old)
    for nid in sorted(normalize, key=lambda n: -raw_spans[n][0][0]):  # back to front keeps earlier offsets valid
        (rs, re_), = raw_spans[nid]
        (os_, oe), = old_spans[nid]
        assert json.loads(raw[rs:re_]) == json.loads(old[os_:oe]), nid
        raw = raw[:rs] + old[os_:oe] + raw[re_:]
    out, err = sr.apply_hunks(raw, old, sr.render(target))
    if out is None:
        raise SystemExit("the rendered diff does not apply onto the repo file: " + err)
    assert canon(json.loads(out)) == canon(target), "patched text does not parse to the target"
    return out


def main(write):
    raw = open(MAIN, encoding="utf-8").read()
    base = json.loads(raw)
    dev_v, dev = enabled("--dev")
    prod_v, prod = enabled("--prod")
    assert canon(base) == canon(dev), f"repo file is not dev's enabled v{dev_v}: fetch it first"
    assert canon(json.load(open(PROD_MIRROR, encoding="utf-8"))) == canon(prod), f"prod moved past the mirror: v{prod_v}"
    print(f"base = dev v{dev_v} (= repo file); prod v{prod_v} (= the .PROD mirror)")

    target, n_refs = build(base)
    text = render_onto(raw, base, target)
    print(f"built: add-node payload refs re-pointed: {n_refs}")
    if write:
        open(MAIN, "w", encoding="utf-8").write(text)
        open(PROD_MIRROR, "w", encoding="utf-8").write(text)
        print("wrote", os.path.relpath(MAIN, REPO), "and", os.path.relpath(PROD_MIRROR, REPO))
    else:
        out = os.path.join(os.environ.get("TMPDIR", "/tmp"), "PickingProcessWorkflow.built.json")
        open(out, "w", encoding="utf-8").write(text)
        print("dry run, wrote", out)
    return target


if __name__ == "__main__":
    main("--write" in sys.argv)
