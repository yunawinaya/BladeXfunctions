// Picking V2 1c: PICKING_BULK_PREPARE's plan node (code/prepare_plan.js) against the deployed one (base/code_node_PPplan.js).
// A pick that moves nothing must plan exactly as before; the 1c cases must differ the way the plan says. Run with
// PLAN_JS=<base file> to see the 1c cases fail on the deployed node.
const fs = require("fs");
const path = require("path");
const { runBody, eq, done } = require("../../gdc/pkv2tools/harness.js");
const NEW = fs.readFileSync(process.env.PLAN_JS || path.join(__dirname, "..", "code", "prepare_plan.js"), "utf8");
const BASE = fs.readFileSync(path.join(__dirname, "..", "base", "code_node_PPplan.js"), "utf8");
const clone = (o) => JSON.parse(JSON.stringify(o));

const HDR = { id: "9001", to_id: "PI-1", to_status: "Created", is_deleted: 0, picking_after: "Goods Delivery", allow_full_picking: "0", setup_loading_bay: "0", is_loading_bay: "0",
  auto_completed_gd: "0", plant_id: "7001", gd_no_json: '["5001"]', so_no: "SO-1", delivery_no: "GD/1", packing_required: "0", auto_trigger_pkg: "0", packing_mode: "" };
const ROW = (id, o) => Object.assign({ id: id, row_type: "item", line_status: "Open", item_code: "6001", item_name: "Item " + id, item_desc: "", more_desc: "", pending_process_qty: 5,
  item_uom: "8001", source_bin: "4001", target_location: null, batch_no: "2001", target_batch: null, so_id: "1001", so_no: "SO-1", so_line_id: "1101", gd_id: "5001", gd_no: "GD/1",
  gd_line_id: "3" + id, handling_unit_id: null, remark: "", remark_2: "", remark_3: "", attachment: "[]", parent_id: null }, o || {});
const GDL = (id, o) => Object.assign({ id: id, goods_delivery_id: "5001", picking_status: "Created", gd_status: "Created", gd_qty: 5, material_name: "Item" }, o || {});
const ENTRY = (lines, op, moves) => ({ route: "GO", jobId: "70001", tenantId: "496474", organizationId: "1901545950162329602", pickingId: "9001", rowVersion: 3, dbNow: "2026-10-16 12:00:00",
  confirmedAt: "2026-10-16 12:00:00.000", request: Object.assign({ operation: op || "CONFIRM", picking_id: "9001", confirmed_by: "t", lines: lines, header_patch: {} }, moves === "absent" ? {} : { moves: moves === undefined ? 1 : moves }) });
const run = (code, sc) => runBody(code, { "node:code_node_PPentry.data": sc.entry, "node:sql_node_PPhdr.data": [sc.hdr], "node:sql_node_PPlines.data": sc.rows,
  "node:sql_node_PPgd.data": sc.gd, "node:sql_node_PPuom.data": sc.uom || [], "node:sql_node_PPpicked.data": sc.picked || [] }, "plan");
const sc0 = { entry: ENTRY([{ row_id: "11", qty: 2 }, { row_id: "12", qty: 5 }]), hdr: HDR, rows: [ROW("11"), ROW("12")], gd: [GDL("311"), GDL("312")] };
const KEYS = ["route", "jobRows", "needJobUpd", "readyRows", "needReady", "unlockRows", "needUnlock", "result_code", "result_message", "job_status", "recordCount", "touchedRows", "gdLineCount"];
const pickKeys = (o) => Object.fromEntries(KEYS.map((k) => [k, o[k]]));

// moves nothing: as before
for (const [label, sc] of [["two lines", sc0], ["PICK_ALL_REMAINING", Object.assign({}, sc0, { entry: ENTRY([], "PICK_ALL_REMAINING") })],
  ["sent empty targets", Object.assign({}, sc0, { entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "", target_batch_id: "" }]) })],
  ["Full Picking, no move", Object.assign({}, sc0, { hdr: Object.assign({}, HDR, { allow_full_picking: "1" }) })]]) {
  const a = pickKeys(run(BASE, clone(sc))), b = pickKeys(run(NEW, clone(sc)));
  if (label === "sent empty targets") { // classic (Z5JH4g2u) rebuilds the line from the stored row: a sent target lands on the record only
    const pb = JSON.parse(b.readyRows[0].prepared_payload);
    const own = (k) => Object.prototype.hasOwnProperty.call(pb.row_patch["11"], k) ? pb.row_patch["11"][k] : "absent";
    eq("no move: " + label + ": the line's stored target is left alone", [own("target_location"), own("target_batch")], ["absent", "absent"]);
  }
  eq("no move: " + label + ": as before", b, a);
}

// a swap: MOVE, nothing written yet, the move block's inputs
{
  const sc = Object.assign({}, sc0, { entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "4002" }, { row_id: "12", qty: 5 }]) });
  const r = run(NEW, clone(sc));
  eq("swap: MOVE, no write", [r.route, r.needReady, r.needJobUpd, r.needUnlock], ["MOVE", "NO", "NO", "NO"]);
  eq("swap: the moved record", r.moveRecords.map((m) => [m.gd_line_id, m.source_bin, m.target_location, m.batch_no, m.target_batch, m.store_out_qty]), [["311", "4001", "4002", "2001", "2001", 2]]);
  eq("swap: SQL id lists", [r.moveGdLineIdsSql, r.moveBinIdsSql, r.moveBatchIdsSql, r.isLoadingBay], ["311", "4001,4002", "2001", 0]);
  eq("swap: GD line status after the pick", r.gdLineStatus, { "311": "In Progress", "312": "Completed" });
  eq("swap: every record prepared; the target on the record, not the line (as classic, live twin 2026-10-16)", [r.prepared.records.length, r.prepared.records.map((x) => x.target_location),
    "target_location" in r.prepared.row_patch["11"]], [2, ["4002", "4001"], false]);
}
// a batch swap only
eq("batch swap: MOVE", run(NEW, Object.assign({}, clone(sc0), { entry: ENTRY([{ row_id: "11", qty: 2, target_batch_id: "2002" }]) })).route, "MOVE");
// stage 1e (2026-10-27): Auto Complete GD without a loading bay is planned like any confirm; COMMIT P7 hands the deliveries it
// leaves fully picked to GD Complete V2 (the phone stays classic: SUBMIT)
eq("Auto Complete GD (no bay) is planned", run(NEW, Object.assign({}, clone(sc0), { hdr: Object.assign({}, HDR, { auto_completed_gd: "1" }) })).route, "OK");
eq("Auto Complete GD + a move is planned too", run(NEW, Object.assign({}, clone(sc0), { hdr: Object.assign({}, HDR, { auto_completed_gd: "1" }),
  entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "4002" }]) })).route, "MOVE");
// a stored target, PICK_ALL_REMAINING (list Auto Pick)
eq("stored target, Auto Pick: MOVE", run(NEW, Object.assign({}, clone(sc0), { entry: ENTRY([], "PICK_ALL_REMAINING"), rows: [ROW("11", { target_location: "4002" }), ROW("12")] })).route, "MOVE");
// Loading Bay
{
  const bay = Object.assign({}, HDR, { setup_loading_bay: "1" });
  const r1 = run(NEW, Object.assign({}, clone(sc0), { hdr: bay, entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "4009" }, { row_id: "12", qty: 5 }]) }));
  eq("bay: a line without a bay bin", [r1.route, r1.result_code, r1.result_message], ["FAIL", "PK_BAY_TARGET",
    "Loading Bay is enabled but Target Location is missing (or the same as the source bin) on these picked items: Item 12. Set a loading bay bin on every picked line before completing."]);
  eq("bay: FAILED releases the Picking", [r1.needJobUpd, r1.needUnlock], ["YES", "YES"]);
  const r2 = run(NEW, Object.assign({}, clone(sc0), { hdr: bay, entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "4009" }, { row_id: "12", qty: 5, target_location_id: "4009" }]) }));
  eq("bay: every line to a bay bin", [r2.route, r2.isLoadingBay, r2.moveRecords.length], ["MOVE", 1, 2]);
  const r3 = run(NEW, Object.assign({}, clone(sc0), { hdr: Object.assign({}, bay, { auto_completed_gd: "1" }) }));
  eq("bay + Auto Complete GD", [r3.result_code, r3.result_message], ["PK_BAY_AUTO_COMPLETE", "Picking Setup has both Loading Bay and Auto Complete GD enabled. Auto Complete GD skips the Created state that the loading bay move depends on, which would strand the reserved stock at the source bin. Please turn off Auto Complete GD."]);
  eq("bay: the Picking's own flag alone is not Loading Bay", run(NEW, Object.assign({}, clone(sc0), { hdr: Object.assign({}, HDR, { is_loading_bay: "1" }) })).route, "OK");
}
// what stays classic
eq("Full Picking + a move", run(NEW, Object.assign({}, clone(sc0), { hdr: Object.assign({}, HDR, { allow_full_picking: "1" }), entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "4002" }]) })).result_message,
  "Full Picking with a bin / batch move uses the classic save");
eq("a moved line in an HU", run(NEW, Object.assign({}, clone(sc0), { rows: [ROW("11", { handling_unit_id: "9901" }), ROW("12")], entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "4002" }]) })).result_code,
  "PK_NOT_SUPPORTED");
// a job SUBMIT's switches did not clear for moves (moves 0, or a 1b job without the stamp): 1b's refusals, before anything is written
for (const moves of [0, "absent"]) {
  const swap = run(NEW, Object.assign({}, clone(sc0), { entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "4002" }], "CONFIRM", moves) }));
  eq("not cleared (" + moves + "): a swap -> 1b's refusal", [swap.route, swap.result_code, swap.result_message, swap.needUnlock],
    ["FAIL", "PK_NOT_SUPPORTED", "line Item 11 moves stock to another bin or batch: not handled by the background save yet", "YES"]);
  const auto = run(NEW, Object.assign({}, clone(sc0), { entry: ENTRY([], "PICK_ALL_REMAINING", moves), rows: [ROW("11", { target_location: "4002" }), ROW("12")] }));
  eq("not cleared (" + moves + "): a stored target on Auto Pick -> refused", [auto.route, auto.result_code], ["FAIL", "PK_NOT_SUPPORTED"]);
  for (const [label, hdr] of [["the setup", { setup_loading_bay: "1" }], ["the Picking's own flag", { is_loading_bay: "1" }], ["bay + Auto Complete GD", { setup_loading_bay: "1", auto_completed_gd: "1" }]]) {
    const r = run(NEW, Object.assign({}, clone(sc0), { hdr: Object.assign({}, HDR, hdr), entry: ENTRY([{ row_id: "11", qty: 2, target_location_id: "4009" }], "CONFIRM", moves) }));
    eq("not cleared (" + moves + "): Loading Bay on " + label + " -> 1b's refusal", [r.route, r.result_code, r.result_message], ["FAIL", "PK_NOT_SUPPORTED", "Loading Bay is on: not handled by the background save yet"]);
  }
  eq("not cleared (" + moves + "): no move plans as before", pickKeys(run(NEW, Object.assign({}, clone(sc0), { entry: ENTRY([{ row_id: "11", qty: 2 }], "CONFIRM", moves) }))),
    pickKeys(run(BASE, Object.assign({}, clone(sc0), { entry: ENTRY([{ row_id: "11", qty: 2 }], "CONFIRM", moves) }))));
}
// BUG-20261016-023: a stored pending's float residue is not a clamp; computed quantities are q8
{
  const r = run(NEW, Object.assign({}, clone(sc0), { rows: [ROW("11", { pending_process_qty: 32.94999999 }), ROW("12")], entry: ENTRY([{ row_id: "11", qty: 32.95 }]) }));
  const p = JSON.parse(r.readyRows[0].prepared_payload);
  eq("residue: no clamp, the line closes", [p.clamped.length, p.records[0].store_out_qty, p.row_patch["11"].line_status, p.row_patch["11"].pending_process_qty], [0, 32.94999999, "Completed", 0]);
  const r2 = run(NEW, Object.assign({}, clone(sc0), { rows: [ROW("11", { pending_process_qty: 3 }), ROW("12")], entry: ENTRY([{ row_id: "11", qty: 4 }]) }));
  eq("a real over-pick is still clamped", JSON.parse(r2.readyRows[0].prepared_payload).clamped.map((c) => [c.requested, c.allowed]), [[4, 3]]);
  const r3 = run(NEW, Object.assign({}, clone(sc0), { uom: [{ item_id: "6001", based_uom: "8001", alt_uom_id: "8003", base_qty: 0.33333333 }], entry: ENTRY([{ row_id: "11", qty: 1, pick_uom: "8003" }]) }));
  eq("q8: an alternate-unit pick keeps 8 decimals", JSON.parse(r3.readyRows[0].prepared_payload).records[0].store_out_qty, 0.33333333);
}
done();
