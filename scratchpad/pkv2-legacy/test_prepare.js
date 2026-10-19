// PICKING_BULK_PREPARE plan vs what PICKING really did on dev (GD/20261003/068, step 3: 3 lines picked).
const { run, eq, truthy, done, fixture } = require("./harness");

const S = (v) => (v === undefined || v === null ? null : String(v));
const stored = fixture("get_node_jEllcWiJ.response.json").data.data;
const setup = fixture("get_node_Uj1uV9PU.response.json").data.data;
const gdLinesFx = fixture("search_node_krPmTbfL.response.json").data.data;
const oldRecords = fixture("code_node_oHIIKfiw.response.json").data.records;
const oldItems = fixture("code_node_Z5JH4g2u.response.json").data.updatedItems;
const oldGdLines = fixture("code_node_iES7iMKA.response.json").data.updatedGdLines;

// stored lines as sql_node_PPlines returns them (flat, ids as text)
const lineCols = ["id", "parent_id", "item_code", "item_name", "item_desc", "more_desc", "item_uom", "qty_to_pick", "pending_process_qty", "line_status",
  "gd_id", "gd_no", "gd_line_id", "so_id", "so_no", "so_line_id", "source_bin", "target_location", "batch_no", "target_batch", "handling_unit_id",
  "item_bundle_id", "row_type", "remark", "remark_2", "remark_3", "attachment"];
const sqlRow = (r, parent) => {
  const o = {};
  for (const c of lineCols) o[c] = c === "parent_id" ? S(parent) : c === "attachment" ? (r.attachment ? JSON.stringify(r.attachment) : null) : S(r[c]);
  return o;
};
const flatLines = (tree) => tree.flatMap((r) => [sqlRow(r, r.parent_id), ...(r.children || []).map((c) => sqlRow(c, r.id))]);

const hdrRow = (over) => Object.assign({
  db_now: "2026-10-09 09:04:53", id: stored.id, to_id: stored.to_id, to_status: stored.to_status, is_deleted: "0", organization_id: stored.organization_id,
  plant_id: stored.plant_id, is_processing: "1", is_loading_bay: "0", ref_doc_type: stored.ref_doc_type, gd_no_json: JSON.stringify(stored.gd_no),
  delivery_no: stored.delivery_no, so_no: stored.so_no, picking_after: setup.picking_after, allow_full_picking: S(setup.allow_full_picking),
  auto_completed_gd: S(setup.auto_completed_gd), setup_loading_bay: null, packing_required: "1", auto_trigger_pkg: "1", packing_mode: "Basic",
}, over || {});
const gdRow = (l, over) => Object.assign({ id: S(l.id), goods_delivery_id: "2106273454887186434", picking_status: S(l.picking_status), gd_status: "Created" }, over || {});

const entry = (over) => Object.assign({
  route: "GO", jobId: "9001", pickingId: stored.id, organizationId: stored.organization_id, rowVersion: 2, dbNow: "2026-10-09 09:04:53",
  confirmedAt: "2026-10-09 17:04:53.529Z", request: { operation: "CONFIRM", confirmed_by: "admin", lines: [] },
}, over || {});

const plan = (ent, opts) => run("prepare/plan.js", {
  "node:code_node_PPentry.data": ent,
  "node:sql_node_PPhdr.data": [opts.hdr || hdrRow()],
  "node:sql_node_PPlines.data": opts.lines || flatLines(stored.table_picking_items),
  "node:sql_node_PPgd.data": opts.gd || gdLinesFx.map((l) => gdRow(l)),
  "node:sql_node_PPuom.data": opts.uom || [],
  "node:sql_node_PPpicked.data": opts.picked || [],
});
const payloadOf = (res) => JSON.parse(res.readyRows[0].prepared_payload);

// ---------- 1. the recorded step-3 pick: the three lines the picker confirmed, 1 each
const picked = oldRecords.map((r) => ({ row_id: r.picking_item_id, qty: r.picked_qty_alt, pick_uom: r.picked_uom, remark: r.remark, remark_2: r.remark_2, remark_3: r.remark_3, target_location_id: r.target_location, target_batch_id: r.target_batch }));
let res = plan(entry({ request: { operation: "CONFIRM", confirmed_by: "admin", lines: picked } }), {});
eq("step3: READY_TO_COMMIT", [res.route, res.job_status, res.needReady, res.needJobUpd, res.needUnlock], ["OK", "READY_TO_COMMIT", "YES", "NO", "NO"]);
let p = payloadOf(res);
const IGN = ["picking_item_id", "job_line_key", "attachment"];
// the trace drops null fields, so a null on either side counts as absent
const strip = (r) => { const o = {}; for (const k of Object.keys(r).sort()) if (!IGN.includes(k) && r[k] !== null && r[k] !== undefined) o[k] = String(r[k]); return o; };
eq("step3: records = PICKING's (every column but the line key)", p.records.map(strip), oldRecords.map(strip));
eq("step3: job_line_key", p.records.map((r) => r.job_line_key), oldRecords.map((r) => "9001|" + r.picking_item_id + "|0"));
const oldTouched = {};
for (const it of oldItems) if (oldRecords.some((r) => r.picking_item_id === it.id)) oldTouched[it.id] = { line_status: it.line_status, pending_process_qty: it.pending_process_qty, attachment: it.attachment };
const newTouched = {};
for (const id of Object.keys(p.row_patch)) newTouched[id] = { line_status: p.row_patch[id].line_status, pending_process_qty: p.row_patch[id].pending_process_qty, attachment: p.row_patch[id].attachment };
eq("step3: line status / pending / attachment of the picked lines = PICKING's", newTouched, oldTouched);
eq("step3: picked_qty reset on the picked lines (fix)", Object.values(p.row_patch).map((x) => x.picked_qty), [0, 0, 0]);
eq("step3: GD line picking_status = PICKING's", p.gd_lines, oldGdLines.map((l) => ({ id: l.id, picking_status: l.picking_status })));
eq("step3: gd ids, message", [p.gd_ids, p.gd_ids_all, p.result_message], [["2106273454887186434"], ["2106273454887186434"], "Picking processed successfully"]);
eq("step3: snapshot", p.snapshot.rows[oldRecords[0].picking_item_id], { pending: 1, status: "Open" });

// ---------- 2. the list action on the same Picking: every open line in full (the 1,997 left after step 3)
const after = JSON.parse(JSON.stringify(stored.table_picking_items));
for (const it of after) if (oldTouched[it.id]) Object.assign(it, { line_status: "Completed", pending_process_qty: 0 });
res = plan(entry({ request: { operation: "PICK_ALL_REMAINING", confirmed_by: "admin" } }), { lines: flatLines(after), gd: [] });
p = payloadOf(res);
eq("pick-all: 1,997 records, 1,997 lines Completed", [res.route, p.records.length, Object.values(p.row_patch).filter((x) => x.line_status === "Completed").length], ["OK", 1997, 1997]);
truthy("pick-all: payload size " + Math.round(res.readyRows[0].prepared_payload.length / 1024) + " KB < 4 MB", res.readyRows[0].prepared_payload.length < 4 * 1024 * 1024);

// ---------- 3. alternate Pick UOM: 2 BOX of 12 against an order line in PCS
const one = (over) => Object.assign({ id: "L1", item_code: "IT", item_name: "Widget", item_uom: "PCS", qty_to_pick: "30", pending_process_qty: "30", line_status: "Open",
  gd_id: "G1", gd_no: "GD/1", gd_line_id: "GL1", so_id: "S1", so_no: "SO/1", so_line_id: "SL1", source_bin: "B1", row_type: "item" }, over || {});
const uom = [{ item_id: "IT", based_uom: "PCS", alt_uom_id: "BOX", base_qty: "12" }];
const gd1 = [{ id: "GL1", goods_delivery_id: "G1", picking_status: "Created", gd_status: "Created" }];
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 2, pick_uom: "BOX" }] } }), { lines: [one()], gd: gd1, uom: uom });
p = payloadOf(res);
eq("uom: 2 BOX -> 24 PCS, picked_qty_alt 2 BOX, In Progress, pending 6", [p.records[0].store_out_qty, p.records[0].picked_qty_alt, p.records[0].picked_uom, p.row_patch.L1.line_status, p.row_patch.L1.pending_process_qty, p.gd_lines[0].picking_status], [24, 2, "BOX", "In Progress", 6, "In Progress"]);

// ---------- 4. clamp: 3 BOX = 36 PCS against 30 pending -> 30 PCS, 2.5 BOX, and the message names it
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 3, pick_uom: "BOX" }] } }), { lines: [one()], gd: gd1, uom: uom });
p = payloadOf(res);
eq("clamp: 30 / 2.5 / Completed", [p.records[0].store_out_qty, p.records[0].picked_qty_alt, p.row_patch.L1.line_status, p.row_patch.L1.pending_process_qty], [30, 2.5, "Completed", 0]);
eq("clamp: message", p.result_message, "Picking processed successfully. 1 line(s) were reduced because the stock had already been picked: Widget 36" + String.fromCharCode(8594) + "30. Check the document before picking again.");

// ---------- 5. nothing left: the line was picked out meanwhile -> FAILED, lock released
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 5 }] } }), { lines: [one({ pending_process_qty: "0", line_status: "Completed" })], gd: gd1 });
eq("nothing left: FAILED + unlock", [res.route, res.result_code, res.jobRows[0].job_status, res.unlockRows], ["FAIL", "PK_NOTHING_LEFT", "FAILED", [{ id: stored.id, is_processing: 0 }]]);

// ---------- 6. an untouched In Progress line keeps its status (old path wrote it back as Open)
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 30 }] } }), { lines: [one(), one({ id: "L2", gd_line_id: "GL1", pending_process_qty: "10", line_status: "In Progress" })], gd: gd1 });
p = payloadOf(res);
eq("untouched line not patched; GD line In Progress (L2 still open)", [Object.keys(p.row_patch), p.gd_lines[0].picking_status], [["L1"], "In Progress"]);

// ---------- 7. bundle: finishing one item while the other is short is refused
const bundle = [
  { id: "BP", item_bundle_id: "BUN", item_name: "Gift Set", qty_to_pick: "1", pending_process_qty: "1", line_status: "Open", gd_id: "G1", gd_line_id: "GLB", row_type: "item" },
  one({ id: "K1", parent_id: "BP", item_bundle_id: "BUN", item_name: "Mug", pending_process_qty: "2", gd_line_id: "GLK1" }),
  one({ id: "K2", parent_id: "BP", item_bundle_id: "BUN", item_name: "Spoon", pending_process_qty: "2", gd_line_id: "GLK2" }),
];
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "K1", qty: 2 }, { row_id: "K2", qty: 1 }] } }), { lines: bundle, gd: gd1 });
eq("bundle short -> FAILED with the old message", [res.route, res.result_code, res.result_message], ["FAIL", "PK_BUNDLE_SHORT", "An item bundle must be picked in full. Short: Gift Set / Spoon: picked 1 of 2. Pick every item of the bundle to its full quantity, or none of them."]);
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "K1", qty: 1 }, { row_id: "K2", qty: 1 }] } }), { lines: bundle, gd: gd1 });
eq("bundle: part of every item is fine (nothing finished)", res.route, "OK");
res = plan(entry({ request: { operation: "PICK_ALL_REMAINING" } }), { lines: bundle, gd: gd1 });
p = payloadOf(res);
eq("bundle pick-all: no record for the bundle row", p.records.map((r) => r.job_line_key), ["9001|K1|0", "9001|K2|0"]);

// ---------- 8. refusals before anything is written
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 1 }] } }), { lines: [one()], gd: [Object.assign({}, gd1[0], { gd_status: "Cancelled" })] });
eq("cancelled GD -> FAILED", [res.route, res.result_code], ["FAIL", "PK_GD_CLOSED"]);
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 1, target_location_id: "B9" }] } }), { lines: [one()], gd: gd1 });
eq("bin move -> FAILED (stage 1c)", [res.route, res.result_code], ["FAIL", "PK_NOT_SUPPORTED"]);
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 1 }] } }), { lines: [one()], gd: gd1, hdr: hdrRow({ auto_completed_gd: "1" }) });
eq("auto-complete GD -> FAILED (stage 1e)", [res.route, res.result_code], ["FAIL", "PK_NOT_SUPPORTED"]);
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 1 }] } }), { lines: [one()], gd: gd1, hdr: hdrRow({ picking_after: null }) });
eq("no picking setup row -> the GD branch, as PICKING", res.route, "OK");
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "NOPE", qty: 1 }] } }), { lines: [one()], gd: gd1 });
eq("unknown row -> FAILED", [res.route, res.result_code], ["FAIL", "PK_LINE_NOT_FOUND"]);
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 1 }, { row_id: "L1", qty: 1 }] } }), { lines: [one()], gd: gd1 });
eq("row sent twice -> FAILED", res.result_code, "PK_INVALID_REQUEST");
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 1 }] } }), { lines: [one()], gd: gd1, hdr: hdrRow({ to_status: "Completed" }) });
eq("completed Picking -> FAILED", res.result_code, "PK_STATUS");
res = plan(entry({ request: { operation: "CONFIRM", lines: [{ row_id: "L1", qty: 1 }], header_patch: { remarks: "r1", di_driver_name: "Ali", to_status: "Completed", table_picking_items: [] } } }), { lines: [one()], gd: gd1 });
eq("header patch: whitelisted fields only", payloadOf(res).header_patch, { remarks: "r1", di_driver_name: "Ali" });
res = plan(entry({ route: "FAIL", result_code: "PK_INVALID_REQUEST", result_message: "bad json" }), { lines: [one()], gd: gd1 });
eq("entry failure -> FAILED + unlock", [res.route, res.result_message, res.needUnlock], ["FAIL", "bad json", "YES"]);

done();
