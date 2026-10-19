// Picking V2 1c: PICKING_BULK_PREPARE's move block, each node body run as the platform runs it (placeholders = JSON text):
// code_node_PPmove (move.js + prepare_move_tail.js), code_node_PPrpcheck, code_node_PPmoveplan, code_node_PPfinal,
// code_node_PPresult.
const fs = require("fs");
const path = require("path");
const { runBody, eq, done } = require("../../gdc/pkv2tools/harness.js");
const read = (f) => fs.readFileSync(path.join(process.env.CODE_DIR || path.join(__dirname, "..", "code"), f), "utf8");
const MOVE = read("move.js") + "\n" + read("prepare_move_tail.js");
const CHECK = read("prepare_rpcheck.js"), PLAN = read("prepare_moveplan.js"), FINAL = read("prepare_final.js"), RESULT = read("prepare_result.js");
const clone = (o) => JSON.parse(JSON.stringify(o));
// a node body's {{node:X...}} placeholders, each answered from map[X] (X.data.f -> map[X].f; a loop item -> map[X])
const inj = (code, map, extra) => {
  const v = Object.assign({}, extra || {});
  for (const m of code.matchAll(/\{\{node:([A-Za-z0-9_]+)((?:\.[A-Za-z0-9_]+)*)\}\}/g)) {
    const parts = m[2].split(".").filter(Boolean);
    if (parts[0] === "data") parts.shift();
    v["node:" + m[1] + m[2]] = parts.reduce((x, k) => (x === undefined || x === null ? undefined : x[k]), map[m[1]]);
  }
  return v;
};
const CELLS = (mv, gi, k) => JSON.parse(mv.gdCalls[gi].lines)[k].cells;

const ENTRY = { route: "GO", jobId: "70001", tenantId: "496474", organizationId: "1901545950162329602", pickingId: "9001", rowVersion: 3, dbNow: "2026-10-16 12:00:00" };
const E1 = { material_id: "6001", location_id: "4001", batch_id: "2001", gd_quantity: 5, unrestricted_qty: 5, plant_id: "7001", organization_id: "1901545950162329602", is_deleted: 0 };
const L = (id, gd, o) => Object.assign({ kind: "L", id: id, gd_id: gd, material_id: "6001", picking_status: "Created", temp_qty_data: JSON.stringify([E1]), view_stock: "Total: 5 PCS\n\nDETAILS:\n1. A-01: 5 PCS\n[Batch: B1]" }, o || {});
const ROWS = [L("311", "5001"), { kind: "B", id: "4001", plant_id: "7001", name: "A-01" }, { kind: "B", id: "4009", plant_id: "7001", name: "BAY-1" },
  { kind: "B", id: "4777", plant_id: "7999", name: "OTHER-PLANT" }, { kind: "T", id: "2001", material_id: "6001", plant_id: "7001", name: "B1" },
  { kind: "T", id: "2002", material_id: "6001", plant_id: "7001", name: "B2" }, { kind: "T", id: "2888", material_id: "6999", plant_id: "7001", name: "OTHER-ITEM" }];
const REC = (o) => Object.assign({ gd_line_id: "311", gd_id: "5001", source_bin: "4001", target_location: "4009", batch_no: "2001", target_batch: "2001", store_out_qty: 5, handling_unit_id: null,
  item_name: "Item A", item_code: "6001" }, o || {});
const PLANOUT = (recs, o) => Object.assign({ route: "MOVE", moveRecords: recs, isLoadingBay: 1, plantId: "7001", gdLineStatus: { "311": "Completed", "312": "In Progress" },
  prepared: { picking_no: "PI-1", records: [{}, {}] }, recordCount: 2, touchedRows: 2, gdLineCount: 2, result_message: "Picking processed successfully" }, o || {});
const move = (plan, rows) => runBody(MOVE, inj(MOVE, { code_node_PPentry: ENTRY, code_node_PPplan: plan, sql_node_PPmove: rows }, { "system:uuid": "a1b2c3d4-e5f6" }), "move");

// ---- code_node_PPmove
{
  const r = move(PLANOUT([REC()]), ROWS);
  eq("move: OK, one call", [r.route, r.gdCalls.length, r.gdCalls[0].gi, r.gdCalls[0].gd_id, r.gdCalls[0].line_ids], ["OK", 1, "000", "5001", ["311"]]);
  const cells = JSON.parse(r.gdCalls[0].lines)[0].cells;
  eq("move: the cells classic PICKING writes", [JSON.parse(cells.temp_qty_data)[0].location_id, JSON.parse(cells.prev_temp_qty_data)[0].location_id, cells.picking_status,
    cells.view_stock], ["4009", "4001", "Completed", "Total: 5 PCS\n\nDETAILS:\n1. BAY-1: 5 PCS\n[Batch: B1]"]);
  eq("move: ALC part", [r.needAlc, r.alcRows.length, r.alcRows[0].step_name, r.alcRows[0].job_id, r.alcRows[0].step_status], ["YES", 1, "MV|a1b2c3d4|ALC|000|001", "70001", "PAYLOAD"]);
  eq("move: ALC holds before and after", JSON.parse(r.alcRows[0].result_ref).map((l) => [l.id, JSON.parse(l.before_temp)[0].location_id, JSON.parse(l.temp_qty_data)[0].location_id]), [["311", "4001", "4009"]]);
}
eq("move: a bin of another plant", [move(PLANOUT([REC({ target_location: "4777" })]), ROWS).result_code, move(PLANOUT([REC({ target_location: "4777" })]), ROWS).route], ["PK_BAD_TARGET", "FAIL"]);
eq("move: an unknown bin", move(PLANOUT([REC({ target_location: "4555" })]), ROWS).result_code, "PK_BAD_TARGET");
eq("move: a batch of another item", move(PLANOUT([REC({ target_location: "4001", target_batch: "2888" })]), ROWS).result_code, "PK_BAD_TARGET");
eq("move: a batch swap", move(PLANOUT([REC({ target_location: "4001", target_batch: "2002" })]), ROWS).route, "OK");
eq("move: the delivery line is gone", move(PLANOUT([REC({ gd_line_id: "399" })]), ROWS).result_code, "PK_LINE_NOT_FOUND");
eq("move: nothing allocated at the source", move(PLANOUT([REC({ source_bin: "4002" })]), ROWS.concat([{ kind: "B", id: "4002", plant_id: "7001", name: "A-02" }])).result_code, "PK_MOVE_NO_ALLOCATION");
eq("move: a line already Completed moves nothing", move(PLANOUT([REC()]), [L("311", "5001", { picking_status: "Completed" })].concat(ROWS.slice(1))).route, "NONE");
{
  const r = move(PLANOUT([REC(), REC({ gd_line_id: "411", gd_id: "5002" })]), ROWS.concat([L("411", "5002")]));
  eq("move: two deliveries, two calls", r.gdCalls.map((c) => [c.gi, c.gd_id]), [["000", "5001"], ["001", "5002"]]);
}
// SUBMIT's refusals, again here (the deliveries may have changed since): one G row per moved delivery
const G = (o) => Object.assign({ kind: "G", id: "5001", gd_id: "5001", name: "GD/1", line_count: "3", linked: "0", other_job: "0" }, o || {});
eq("move: a G row within the limits", move(PLANOUT([REC()]), ROWS.concat([G()])).route, "OK");
eq("move: a moved delivery linked to internal trading", [move(PLANOUT([REC()]), ROWS.concat([G({ linked: "1" })])).result_code, move(PLANOUT([REC()]), ROWS.concat([G({ linked: "1" })])).result_message],
  ["PK_NOT_SUPPORTED", "Goods Delivery GD/1 is linked to internal trading: the classic save handles it"]);
eq("move: 26 moved deliveries", move(PLANOUT([REC()]), ROWS.concat(Array.from({ length: 26 }, (_, i) => G({ id: String(5001 + i), gd_id: String(5001 + i), name: "GD/" + i })))).result_message,
  "This confirmation moves stock on 26 deliveries; at most 25 can be saved together. Confirm it in smaller Pickings.");
eq("move: 501 moved-GD lines (classic's 500)", [move(PLANOUT([REC()]), ROWS.concat([G({ line_count: "300" }), G({ id: "5002", gd_id: "5002", name: "GD/2", line_count: "201" })])).result_code,
  move(PLANOUT([REC()]), ROWS.concat([G({ line_count: "300" }), G({ id: "5002", gd_id: "5002", name: "GD/2", line_count: "201" })])).result_message],
  ["PK_TOO_LARGE", "Moving picked stock to another bin or batch is not available yet above 500 delivery lines in one confirmation (these deliveries have 501). Nothing was saved."]);
eq("move: 500 moved-GD lines", move(PLANOUT([REC()]), ROWS.concat([G({ line_count: "500" })])).route, "OK");
eq("move: a moved delivery confirmed on another Picking", [move(PLANOUT([REC()]), ROWS.concat([G({ other_job: "1" })])).result_code, move(PLANOUT([REC()]), ROWS.concat([G({ other_job: "1" })])).result_message],
  ["PK_BUSY", "Goods Delivery GD/1 is being confirmed on another Picking in the background. Wait a moment, then try again."]);

// ---- code_node_PPrpcheck (one loop item)
const MV = move(PLANOUT([REC()]), ROWS);
const RP = (o) => Object.assign({ route: "PLANNED", code: "200", message: "", gd_id: "5001", gd_no: "GD/1", line_count: 3, gdl_inserts: 0, gdl_deletes: 0, reorder: [],
  gdl_patches: [{ id: "311", cells: { temp_qty_data: CELLS(MV, 0, 0).temp_qty_data, view_stock: CELLS(MV, 0, 0).view_stock, customer_id: "x" } }],
  movements: [{ movement_key: "M1", direction: "SUBTRACT", inventory_category: "Reserved" }, { movement_key: "M2", direction: "ADD", inventory_category: "Reserved" },
    { movement_key: "M3", direction: "SUBTRACT", inventory_category: "Unrestricted" }, { movement_key: "M3.2", direction: "ADD", inventory_category: "Reserved", unit_price_from: "M3" }],
  res_updates: [{ id: "8001", before: { status: "Allocated" }, after: { status: "Cancelled" } }], res_creates: [{ status: "Allocated", bin_location: "4009" }] }, o || {});
const check = (rp) => runBody(CHECK, inj(CHECK, { code_node_PPentry: ENTRY, loop_PPreplan: MV.gdCalls[0], workflow_node_PPreplan: rp, code_node_PPmove: MV }), "check");
{
  const r = check(RP());
  eq("check: OK", r.verdict, "OK");
  eq("check: part rows", r.partRows.map((p) => p.step_name), ["MV|a1b2c3d4|VRD|000|001", "MV|a1b2c3d4|ENG|000|001", "MV|a1b2c3d4|RES|000|001"]);
  eq("check: movement keys unique in the job, unit_price_from too", JSON.parse(r.partRows[1].result_ref).map((m) => [m.movement_key, m.unit_price_from || ""]),
    [["G000.M1", ""], ["G000.M2", ""], ["G000.M3", ""], ["G000.M3.2", "G000.M3"]]);
  eq("check: creates keyed", JSON.parse(r.partRows[2].result_ref).creates.map((c) => c.job_line_key), ["70001|R|000.1"]);
}
eq("check: not planned", check(RP({ route: "NOT_ELIGIBLE", code: "GR_SERIAL", message: "Goods Delivery GD/1 has serial-numbered items: the classic save handles them" })).verdict,
  "Goods Delivery GD/1 has serial-numbered items: the classic save handles them");
eq("check: not planned: a verdict row only", check(RP({ route: "STOP" })).partRows.map((p) => p.step_name.split("|")[2]), ["VRD"]);
eq("check: a line inserted", check(RP({ gdl_inserts: 1 })).verdict, "the re-plan would add or remove delivery lines");
eq("check: reorder", check(RP({ reorder: [{ material_id: "6001" }] })).verdict, "the re-plan would change reorder tracking");
eq("check: another allocation", check(RP({ gdl_patches: [{ id: "311", cells: { temp_qty_data: "[]", view_stock: CELLS(MV, 0, 0).view_stock } }] })).verdict,
  "the re-plan disagrees with the new allocation of line 311");
eq("check: the re-plan changes the allocation of a line this pick does not move: refused (M3)",
  check(RP({ gdl_patches: RP().gdl_patches.concat([{ id: "399", cells: { temp_qty_data: "[{}]" } }]) })).verdict, "the re-plan would change the allocation of line 399, which this pick does not move");
eq("check: another line's re-stamped cell (not its allocation) is ignored, as on prod (return_qty)",
  check(RP({ gdl_patches: RP().gdl_patches.concat([{ id: "399", cells: { return_qty: 0 } }]) })).verdict, "OK");

// ---- code_node_PPmoveplan (the parts as the add-node wrote them, read back in step order)
const plan = (rows, mv) => runBody(PLAN, inj(PLAN, { code_node_PPentry: ENTRY, code_node_PPmove: mv || MV, sql_node_PPmvparts: rows }), "plan");
const sorted = (rows) => rows.slice().sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
{
  const r = plan(sorted(check(RP()).partRows));
  eq("plan: OK", [r.route, r.needEngine, r.operationKey, r.movements.length, r.counts.reservation_updates, r.counts.reservation_creates], ["OK", "YES", "PKM|70001", 4, 1, 1]);
  eq("plan: a missing verdict", plan([]).result_code, "PK_REPLAN");
  eq("plan: a failed verdict", plan(sorted(check(RP({ route: "STOP", message: "x happened" })).partRows)).result_message, "Goods Delivery GD/1: x happened");
  const two = move(PLANOUT([REC(), REC({ gd_line_id: "411", gd_id: "5002" })]), ROWS.concat([L("411", "5002")]));
  const c0 = runBody(CHECK, inj(CHECK, { code_node_PPentry: ENTRY, loop_PPreplan: two.gdCalls[0], workflow_node_PPreplan: RP({ gdl_patches: [{ id: "311", cells: { temp_qty_data: CELLS(two, 0, 0).temp_qty_data, view_stock: CELLS(two, 0, 0).view_stock } }] }), code_node_PPmove: two }), "c0");
  const c1 = runBody(CHECK, inj(CHECK, { code_node_PPentry: ENTRY, loop_PPreplan: two.gdCalls[1], workflow_node_PPreplan: RP({ gd_id: "5002", gd_no: "GD/2", gdl_patches: [{ id: "411", cells: { temp_qty_data: CELLS(two, 1, 0).temp_qty_data, view_stock: CELLS(two, 1, 0).view_stock } }] }), code_node_PPmove: two }), "c1");
  eq("plan: a reservation planned by two deliveries", plan(sorted(c0.partRows.concat(c1.partRows)), two).result_message,
    "reservation 8001 would be changed by two deliveries at once (GD/1, GD/2); confirm them separately");
  const noMove = plan(sorted(check(RP({ movements: [] })).partRows));
  eq("plan: reservations only (SO Pending): no engine call", [noMove.route, noMove.needEngine], ["OK", "NO"]);
}

// ---- code_node_PPfinal
const OKPLAN = plan(sorted(check(RP()).partRows));
const fin = (planOut, mv, mp, eng) => runBody(FINAL, inj(FINAL, { code_node_PPentry: ENTRY, code_node_PPplan: planOut, code_node_PPmove: mv, code_node_PPmoveplan: mp, workflow_node_PPengine: eng }), "final");
{
  const r = fin(PLANOUT([REC()]), MV, OKPLAN, { code: "200", result_code: "PLANNED" });
  const p = JSON.parse(r.readyRows[0].prepared_payload);
  eq("final: READY with the move", [r.route, r.needReady, r.needJobUpd, r.needUnlock, p.move.nonce, p.move.operation_key, p.move.has_movements, p.move.gd_ids],
    ["OK", "YES", "NO", "NO", "a1b2c3d4", "PKM|70001", 1, ["5001"]]);
  eq("final: the ready row", [r.readyRows[0].job_status, r.readyRows[0].row_version, r.readyRows[0].line_count], ["READY_TO_COMMIT", 4, 2]);
  const f1 = fin(PLANOUT([REC()]), MV, OKPLAN, { code: "400", result_code: "INSUFFICIENT", message: "Item A: 3 available, 5 needed" });
  eq("final: no free stock", [f1.route, f1.result_code, f1.needJobUpd, f1.needUnlock, f1.unlockRows], ["FAIL", "PK_STOCK_INSUFFICIENT", "YES", "YES", [{ id: "9001", is_processing: 0 }]]);
  eq("final: a failed move", fin(PLANOUT([REC()]), Object.assign({}, MV, { route: "FAIL", result_code: "PK_BAD_TARGET", result_message: "m" }), null, null).result_code, "PK_BAD_TARGET");
  eq("final: a failed re-plan", fin(PLANOUT([REC()]), MV, Object.assign({}, OKPLAN, { route: "FAIL", result_code: "PK_REPLAN", result_message: "m" }), null).result_code, "PK_REPLAN");
  const none = fin(PLANOUT([REC()]), Object.assign({}, MV, { route: "NONE" }), "", "");
  eq("final: nothing moves: READY without a move", [none.route, "move" in JSON.parse(none.readyRows[0].prepared_payload)], ["OK", false]);
  const noEng = fin(PLANOUT([REC()]), MV, Object.assign({}, OKPLAN, { needEngine: "NO" }), "");
  eq("final: reservations only", JSON.parse(noEng.readyRows[0].prepared_payload).move.has_movements, 0);
}

// ---- code_node_PPresult
{
  const guard = { jobId: "70001" };
  const rv = (planOut, back, finOut) => runBody(RESULT, inj(RESULT, { code_node_PPguard: guard, code_node_PPentry: ENTRY, code_node_PPplan: planOut, sql_node_PPback: back, code_node_PPfinal: finOut }), "result");
  const f = fin(PLANOUT([REC()]), MV, OKPLAN, { code: "400", result_code: "INSUFFICIENT", message: "no stock" });
  eq("result: the final node answers a move", [rv(PLANOUT([REC()]), [{ id: "70001", job_status: "FAILED" }], f).result_code], ["PK_STOCK_INSUFFICIENT"]);
  eq("result: without a move, the plan answers (the final node never ran)", rv({ route: "OK", result_message: "Picking processed successfully", recordCount: 1 }, [{ id: "70001", job_status: "READY_TO_COMMIT" }], null).result_message,
    "Picking processed successfully");
}
done();
