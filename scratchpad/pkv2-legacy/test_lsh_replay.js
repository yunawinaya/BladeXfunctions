// LSH's real 2,096-line Full Picking confirm (prod PICKING run 2109686904730554369, PI-20261013-1502) through PREPARE plan + COMMIT
// P1 merge: the same records, line statuses, Picking status and GD line picking_status as PICKING computed in that run.
const fs = require("fs");
const path = require("path");
const { run, eq, truthy, done } = require("./harness");

const CACHE = path.join(__dirname, "..", "lshcache", "run_2109686904730554369.json");
// snowflake ids as text: the trace stores them as bare numbers
const big = (txt) => txt.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"');
const row = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const params = JSON.parse(big(row.request_json_data)).request_json;
const nodes = {};
for (const n of JSON.parse(row.nodes_data)) if (n.node_id && n.response_json_data) nodes[n.node_id] = JSON.parse(big(n.response_json_data));
const stored = nodes.get_node_jEllcWiJ.data.data;
const oldRecords = nodes.code_node_oHIIKfiw.data.records;
const oldItems = nodes.code_node_Z5JH4g2u.data.updatedItems;
const oldGd = nodes.code_node_iES7iMKA.data.updatedGdLines;
const S = (v) => (v === undefined || v === null ? null : String(v));

const lineCols = ["id", "parent_id", "item_code", "item_name", "item_desc", "more_desc", "item_uom", "qty_to_pick", "pending_process_qty", "line_status", "gd_id", "gd_no", "gd_line_id", "so_id", "so_no",
  "so_line_id", "source_bin", "target_location", "batch_no", "target_batch", "handling_unit_id", "item_bundle_id", "row_type", "remark", "remark_2", "remark_3", "attachment"];
const sqlRow = (r, parent) => {
  const o = {};
  for (const c of lineCols) o[c] = c === "parent_id" ? S(parent) : c === "attachment" ? (r.attachment ? JSON.stringify(r.attachment) : null) : S(r[c]);
  return o;
};
const flat = stored.table_picking_items.flatMap((r) => [sqlRow(r, r.parent_id), ...(r.children || []).map((c) => sqlRow(c, r.id))]);
// the form's request (pkV2_onSave_Completed): every row with a picked quantity
const lines = params.allData.table_picking_items.filter((r) => Number(r.picked_qty) > 0).map((r) => ({ row_id: String(r.id), qty: Number(r.picked_qty), pick_uom: String(r.picking_uom || r.item_uom || ""),
  target_location_id: r.target_location ? String(r.target_location) : "", target_batch_id: r.target_batch ? String(r.target_batch) : "", remark: r.remark || "", remark_2: r.remark_2 || "", remark_3: r.remark_3 || "",
  attachment: Array.isArray(r.attachment) ? r.attachment : [] }));
const setup = nodes.get_node_Uj1uV9PU.data.data;
const res = run("prepare/plan.js", {
  "node:code_node_PPentry.data": { route: "GO", jobId: "77", pickingId: S(stored.id), organizationId: S(stored.organization_id), rowVersion: 1, dbNow: "2026-10-13 00:44:00",
    confirmedAt: oldRecords[0].confirmed_at, request: { operation: "CONFIRM", confirmed_by: oldRecords[0].confirmed_by, lines: lines } },
  "node:sql_node_PPhdr.data": [{ id: S(stored.id), to_id: stored.to_id, to_status: stored.to_status, is_deleted: "0", organization_id: S(stored.organization_id), plant_id: S(stored.plant_id),
    gd_no_json: JSON.stringify(stored.gd_no), delivery_no: stored.delivery_no, so_no: stored.so_no, picking_after: setup.picking_after, allow_full_picking: S(setup.allow_full_picking),
    auto_completed_gd: S(setup.auto_completed_gd), setup_loading_bay: S(setup.is_loading_bay), packing_required: "1", auto_trigger_pkg: "1", packing_mode: "Detail" }],
  "node:sql_node_PPlines.data": flat,
  // the GD lines as they were: every one on this Picking only, nothing picked anywhere before
  "node:sql_node_PPgd.data": oldGd.map((l) => ({ id: S(l.id), goods_delivery_id: S(l.goods_delivery_id), picking_status: "Created", gd_status: "Created", gd_qty: Number(l.gd_qty).toFixed(8), material_name: l.material_name || null })),
  "node:sql_node_PPuom.data": [],
  "node:sql_node_PPpicked.data": [],
});
eq("LSH confirm: READY_TO_COMMIT, 2,096 records", [res.route, res.recordCount], ["OK", 2096]);
const p = JSON.parse(res.readyRows[0].prepared_payload);
// confirmed_at: PICKING stamps each record with its own new Date() (ms apart); PREPARE stamps the confirmation once
const IGN = ["picking_item_id", "job_line_key", "attachment", "confirmed_at"];
const strip = (r) => { const o = {}; for (const k of Object.keys(r).sort()) if (!IGN.includes(k) && r[k] !== null && r[k] !== undefined && r[k] !== "") o[k] = String(r[k]); return o; };
const byRow = (recs, key) => { const m = {}; for (const r of recs) m[key(r)] = strip(r); return m; };
const newRecs = byRow(p.records, (r) => r.job_line_key.split("|")[1]);
const oldRecs = byRow(oldRecords, (r) => String(r.picking_item_id));
const recDiff = Object.keys(oldRecs).filter((k) => JSON.stringify(oldRecs[k]) !== JSON.stringify(newRecs[k]));
const stamps = oldRecords.map((r) => String(r.confirmed_at)).sort();
truthy("LSH confirm: one confirmed_at, inside PICKING's per-record range " + stamps[0] + " .. " + stamps[stamps.length - 1],
  new Set(p.records.map((r) => r.confirmed_at)).size === 1 && p.records[0].confirmed_at >= stamps[0] && p.records[0].confirmed_at <= stamps[stamps.length - 1]);
eq("LSH confirm: every record = PICKING's (all columns but the line key and the confirmed_at ms)", [Object.keys(newRecs).length, recDiff.length, recDiff.slice(0, 1).map((k) => [oldRecs[k], newRecs[k]])], [2096, 0, []]);
const oldFlat = {};
for (const it of oldItems.flatMap((r) => [r].concat(r.children || []))) oldFlat[String(it.id)] = [it.line_status, Number(it.pending_process_qty)];
const rowDiff = Object.keys(p.row_patch).filter((id) => JSON.stringify(oldFlat[id]) !== JSON.stringify([p.row_patch[id].line_status, p.row_patch[id].pending_process_qty]));
eq("LSH confirm: line status / pending of every row = PICKING's", [Object.keys(p.row_patch).length, rowDiff.length], [2096, 0]);
const oldStatus = {};
for (const l of oldGd) oldStatus[S(l.id)] = l.picking_status;
const gdDiff = p.gd_lines.filter((l) => oldStatus[l.id] !== l.picking_status);
eq("LSH confirm: GD line picking_status (Full Picking cumulative) = PICKING's", [p.gd_lines.length, gdDiff.length], [2096, 0]);
eq("LSH confirm: 300 GDs; Full Picking flagged in the payload", [p.gd_ids_all.length, p.full_picking], [300, 1]);
truthy("LSH confirm: payload " + Math.round(res.readyRows[0].prepared_payload.length / 1024) + " KB < 4 MB", res.readyRows[0].prepared_payload.length < 4 * 1024 * 1024);

const merged = run("commit/p1_merge.js", {
  "node:code_node_PCentry.data": { pickingId: S(stored.id) },
  "node:sql_node_PCpayload.data": [{ prepared_payload: res.readyRows[0].prepared_payload }],
  "node:get_node_PCp1get.data": { count: 1, data: stored },
});
eq("P1 merge: Picking status = PICKING's", [merged.route, merged.toStatus, merged.added], ["WRITE", nodes.code_node_Z5JH4g2u.data.toStatus, 2096]);
const mergedFlat = merged.pickRows[0].table_picking_items.flatMap((r) => [r].concat(r.children || []));
const itemDiff = mergedFlat.filter((it) => JSON.stringify(oldFlat[String(it.id)]) !== JSON.stringify([it.line_status, Number(it.pending_process_qty)]));
eq("P1 merge: every line's status / pending = PICKING's", [mergedFlat.length, itemDiff.length], [Object.keys(oldFlat).length, 0]);

done();
