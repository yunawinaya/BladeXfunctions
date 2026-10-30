// Reserved transfer requests (RESERVED_REQUEST_PLAN.md Task 1): the rule file code/shared/iatr_reserve.js - the setup switch,
// request lines from an IA's reservation, the dispatch swap, Receive (good / defect), cancel back, Report defect, the replacement
// gap and the staging rule (D11).
//   node scratchpad/iatr/test/test_iatr_reserve.js
const path = require("path");
const R = require(path.join(__dirname, "..", "code", "shared", "iatr_reserve.js"));

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
};

const items = {
  A: { id: "A", material_name: "RM-A", stock_control: 1, serial_number_management: 0, item_batch_management: 0 },
  B: { id: "B", material_name: "RM-B", stock_control: 1, serial_number_management: 0, item_batch_management: 1 },
  S: { id: "S", material_name: "MOTOR", stock_control: 1, serial_number_management: 1, item_batch_management: 0 },
  L: { id: "L", material_name: "LABOUR", stock_control: 0, serial_number_management: 0, item_batch_management: 0 },
};
const pick = (bin, qty, o) => Object.assign({ material_id: "", location_id: bin, batch_id: "", sm_quantity: qty, category: "Unrestricted" }, o || {});
const iaLine = (id, item, o) => Object.assign({ id: id, item_selection: item, item_name: items[item].material_name, quantity_uom: "EA", requested_qty: "10",
  required_qty: null, temp_qty_data: "[]", temp_hu_data: "" }, o || {});
const hold = (id, line, bin, qty, o) => Object.assign({ id: id, status: "Allocated", doc_line_id: line, material_id: "A", bin_location: bin, batch_id: "",
  from_category: "Unrestricted", open_qty: String(qty), reserved_qty: String(qty), item_uom: "EA", job_line_key: "" }, o || {});
const lotLine = (id, iaLineId, item, req, picks, o) => Object.assign({ id: id, source_ia_line_id: iaLineId, item_selection: item, quantity_uom: "EA",
  requested_qty: String(req), temp_qty_data: JSON.stringify(picks) }, o || {});
const dest = { iaId: "900", lotId: "700", location_id: "STG", storage_location_id: "SL1" };

// ================================================================ the setup switch (D12)
eq("setup: no row → off", R.rrSetupOn([], "ORG1"), false);
eq("setup: org row 1 → on", R.rrSetupOn([{ organization_id: "ORG1", plant_id: "P1", transfer_request_enabled: 1 }], "ORG1"), true);
eq("setup: another org's row → off", R.rrSetupOn([{ organization_id: "ORG2", plant_id: "P2", transfer_request_enabled: 1 }], "ORG1"), false);
eq("setup: org row 0 → off", R.rrSetupOn([{ organization_id: "ORG1", plant_id: "P1", transfer_request_enabled: 0 }], "ORG1"), false);

// ================================================================ request lines from the reservation (D1)
let r = R.rrLinesFromHolds([iaLine("11", "A")], [hold("h1", "11", "W1", 6)], items);
eq("lines from holds: partial hold → requested = held", r.lines.map((l) => [l.source_ia_line_id, l.requested_qty, l.picks.map((p) => [p.location_id, p.sm_quantity, p.hold_row_id])]),
  [["11", "6", [["W1", "6", "h1"]]]]);
r = R.rrLinesFromHolds([iaLine("11", "A"), iaLine("12", "S", { requested_qty: "1" })], [hold("h1", "11", "W1", 10)], items);
eq("lines from holds: serial line skipped with reason", [r.lines.map((l) => l.source_ia_line_id), r.skipped.map((s) => [s.line, /serial/i.test(s.reason)])],
  [["11"], [["12", true]]]);
r = R.rrLinesFromHolds([iaLine("11", "A"), iaLine("13", "L"), iaLine("14", "A")], [hold("h1", "11", "W1", 10), hold("h3", "13", "W1", 1, { material_id: "L" })], items);
eq("lines from holds: non-stock skipped even when held; nothing reserved skipped (replaced later)",
  [r.lines.map((l) => l.source_ia_line_id), r.skipped.map((s) => [s.line, /stock-controlled/.test(s.reason)])], [["11"], [["13", true], ["14", false]]]);
r = R.rrLinesFromHolds([iaLine("11", "A")], [hold("h1", "11", "W1", 4), hold("h2", "11", "W2", 3, { status: "Cancelled" })], items);
eq("lines from holds: only Allocated rows count", r.lines[0].requested_qty, "4");

// ================================================================ the dispatch swap
const holdsAt = [hold("h1", "11", "A1", 5), hold("h2", "11", "A2", 5)];
let s = R.rrSwapPlan([lotLine("L1", "11", "A", 10, [pick("A1", 5), pick("A2", 5)])], holdsAt, "OP1");
eq("swap: picks at the held keys → release + stage net, no countBins",
  [s.ok, s.release.map((m) => [m.location_id, m.quantity, m.from_category, m.to_category]), s.stage.map((m) => [m.location_id, m.quantity]), s.cancelRows, s.countBins],
  [true, [["A1", "5", "Reserved", "Unrestricted"], ["A2", "5", "Reserved", "Unrestricted"]], [["A1", "5"], ["A2", "5"]], ["h1", "h2"], []]);
s = R.rrSwapPlan([lotLine("L1", "11", "A", 10, [pick("A1", 3), pick("A3", 4), pick("A2", 3)])], holdsAt, "OP1");
eq("swap: two held keys, three picks", [s.ok, s.release.length, s.stage.length, s.countBins.map((c) => [c.line, c.pickedFrom, c.reservedAt])],
  [true, 2, 3, [[1, "A3", ["A1", "A2"]]]]);
s = R.rrSwapPlan([lotLine("L1", "11", "A", 10, [pick("A1", 5), pick("A2", 5)])], [hold("h1", "11", "A1", 5), hold("h2", "11", "A2", 3)], "OP1");
eq("swap: held < requested → IATR_HOLD_STALE", [s.ok, s.code, s.release.length], [false, "IATR_HOLD_STALE", 0]);
s = R.rrSwapPlan([lotLine("L1", "11", "A", 10, [pick("A1", 5), pick("A2", 4)])], holdsAt, "OP1");
eq("swap: picks ≠ requested → IATR_PICKS_SHORT", [s.ok, s.code], [false, "IATR_PICKS_SHORT"]);
eq("swap: the rows' marker names the operation", R.rrSwapPlan([lotLine("L1", "11", "A", 10, [pick("A1", 5), pick("A2", 5)])], holdsAt, "OP1").marker, "IATR|OP1");

// ================================================================ Receive (D5, D7, D10)
let v = R.rrReceivePlan([lotLine("L1", "11", "A", 10, [pick("A1", 5), pick("A2", 5)])], { L1: { good: "7", defect: "3", reason: "R1" } }, dest);
eq("receive plan: good 7 defect 3 → 7 Reserved + 3 Blocked + hold rows for 7",
  [v.ok, v.toReserved.map((m) => [m.location_id, m.quantity, m.from_category, m.to_category]), v.toBlocked.map((m) => [m.location_id, m.quantity, m.from_category, m.to_category]),
    v.newHoldRows.map((h) => [h.status, h.doc_id, h.doc_line_id, h.bin_location, h.open_qty, h.reserved_qty, h.from_category, h.job_line_key]),
    v.iaPicks["11"].map((p) => [p.location_id, p.sm_quantity]), v.lineDefects.map((d) => [d.id, d.defect_qty, d.defect_reason])],
  [true, [["STG", "7", "In Transit", "Reserved"]], [["STG", "3", "In Transit", "Blocked"]], [["Processing", "900", "11", "STG", "7", "7", "Unrestricted", "IATR|700|1"]],
    [["STG", "7"]], [["L1", "3", "R1"]]]);
v = R.rrReceivePlan([lotLine("L1", "11", "A", 10, [pick("A1", 10)])], { L1: { good: "8", defect: "2", reason: "" } }, dest);
eq("receive plan: defect without reason → refused", [v.ok, v.code], [false, "IATR_DEFECT_REASON"]);
v = R.rrReceivePlan([lotLine("L1", "11", "A", 10, [pick("A1", 10)])], { L1: { good: "8", defect: "1", reason: "R1" } }, dest);
eq("receive plan: good+defect ≠ dispatched → refused", [v.ok, v.code], [false, "IATR_RECEIPT_INVALID"]);
v = R.rrReceivePlan([lotLine("L1", "11", "A", 10, [pick("A1", 10)])], {}, dest);
eq("receive plan: a line without a receipt → refused", [v.ok, v.code], [false, "IATR_RECEIPT_INVALID"]);
v = R.rrReceivePlan([lotLine("L1", "11", "A", 2, [pick("A1", 2)], { quantity_uom: "CTN" })], { L1: { good: "2", defect: "0" } }, dest);
eq("receive plan: CTN line, EA base", [v.toReserved.map((m) => [m.quantity, m.uom]), v.newHoldRows.map((h) => [h.open_qty, h.item_uom])], [[["2", "CTN"]], [["2", "CTN"]]]);
v = R.rrReceivePlan([lotLine("L1", "21", "B", 10, [pick("A1", 5, { batch_id: "B1" }), pick("A2", 5, { batch_id: "B2" })])],
  { L1: { batches: { B1: { good: "5", defect: "0" }, B2: { good: "3", defect: "2" } }, reason: "R2" } }, dest);
eq("receive plan: batch item defect in one of two batches → only that batch Blocked",
  [v.ok, v.toReserved.map((m) => [m.batch_id, m.quantity]), v.toBlocked.map((m) => [m.batch_id, m.quantity]), v.lineDefects.map((d) => [d.defect_qty, JSON.parse(d.defect_detail)])],
  [true, [["B1", "5"], ["B2", "3"]], [["B2", "2"]], [["2", { B2: "2" }]]]);
v = R.rrReceivePlan([lotLine("L1", "21", "B", 10, [pick("A1", 8, { batch_id: "B1" }), pick("A2", 2, { batch_id: "B2" })])], { L1: { good: "8", defect: "0" } }, dest);
eq("receive plan: a two-batch line without per-batch receipts → refused (even when the first batch alone adds up)", [v.ok, v.code], [false, "IATR_RECEIPT_INVALID"]);

// ================================================================ cancel back (D3)
const c = R.rrCancelBackPlan([lotLine("L1", "11", "A", 10, [pick("A1", 4), pick("A3", 6)])], dest);
eq("cancel back: to picked keys, Reserved, hold rows",
  [c.toReserved.map((m) => [m.location_id, m.quantity]), c.newHoldRows.map((h) => [h.bin_location, h.open_qty, h.status, h.job_line_key]), c.iaPicks["11"].map((p) => [p.location_id, p.sm_quantity])],
  [[["A1", "4"], ["A3", "6"]], [["A1", "4", "Processing", "IATR|700|1"], ["A3", "6", "Processing", "IATR|700|2"]], [["A1", "4"], ["A3", "6"]]]);

// ================================================================ Report defect (D2)
const atStg = [hold("h7", "11", "STG", 6)];
const iaAtStg = [iaLine("11", "A", { temp_qty_data: JSON.stringify([pick("STG", 6)]) })];
let d = R.rrDefectPlan(iaAtStg, atStg, "STG", { 11: { qty: "7", reason: "R1" } });
eq("defect plan: more than held → refused", [d.ok, d.code], [false, "IATR_DEFECT_TOO_MUCH"]);
d = R.rrDefectPlan(iaAtStg, atStg, "STG", { 11: { qty: "2", reason: "R1" } });
eq("defect plan: Reserved → Blocked at the staging bin, IA-D; the hold and the picks drop",
  [d.ok, d.moves.map((m) => [m.location_id, m.quantity, m.from_category, m.to_category, m.transaction_type]), d.holdChanges.map((h) => [h.id, h.open_qty, h.status]),
    d.iaPicks["11"].map((p) => [p.location_id, p.sm_quantity])],
  [true, [["STG", "2", "Reserved", "Blocked", "IA-D"]], [["h7", "4", "Allocated"]], [["STG", "4"]]]);
d = R.rrDefectPlan(iaAtStg, atStg, "STG", { 11: { qty: "1", reason: "" } });
eq("defect plan: without a reason → refused", [d.ok, d.code], [false, "IATR_DEFECT_REASON"]);

// ================================================================ the replacement gap and the staging rule (D11)
const reqs = [{ id: "700", status: "Completed", lines: [{ source_ia_line_id: "11", requested_qty: "6" }] }];
const g = R.rrGap([iaLine("11", "A"), iaLine("12", "A", { requested_qty: "4" }), iaLine("13", "S", { requested_qty: "1" })], [hold("h7", "11", "STG", 6)], reqs, items);
eq("gap: never-reserved line counted; serial line not", g, [{ iaLineId: "11", missing: "4" }, { iaLineId: "12", missing: "4" }]);
const g2 = R.rrGap([iaLine("11", "A")], [], [{ id: "701", status: "In Progress", lines: [{ source_ia_line_id: "11", requested_qty: "10" }] }], items);
eq("gap: what is in transit is not missing", g2, []);
const lines = [iaLine("11", "A", { temp_qty_data: JSON.stringify([pick("STG", 6)]) }), iaLine("12", "A", { temp_qty_data: JSON.stringify([pick("W9", 4)]) })];
let k = R.rrStagingCheck(lines, reqs, items, "STG");
eq("staging check: never-reserved line picked from warehouse → refused", [k.ok, k.line], [false, 2]);
k = R.rrStagingCheck([lines[0], iaLine("13", "S", { requested_qty: "1", temp_qty_data: JSON.stringify([pick("W9", 1)]) })], reqs, items, "STG");
eq("staging check: serial line from warehouse → ok", k.ok, true);
k = R.rrStagingCheck(lines, [{ id: "700", status: "Cancelled", lines: [] }], items, "STG");
eq("staging check: only cancelled requests → no rule", k.ok, true);

// ================================================================ a replacement: the IA's holds at the staging bin stay where they are (D6)
const repHolds = [hold("h7", "11", "STG", 6, { job_line_key: "IATR|700|1" }), hold("h8", "11", "W2", 4)];
r = R.rrLinesFromHolds([iaLine("11", "A")], repHolds, items, "STG");
eq("lines: a hold already at the staging bin is not requested again", r.lines.map((l) => [l.requested_qty, l.picks.map((p) => p.hold_row_id)]), [["4", ["h8"]]]);
s = R.rrSwapPlan([lotLine("L2", "11", "A", 4, [pick("W3", 4)], { location_id: "STG" })], repHolds, "OP2");
eq("swap: a replacement releases only the holds away from its destination bin", [s.ok, s.cancelRows, s.release.map((m) => [m.location_id, m.quantity])], [true, ["h8"], [["W2", "4"]]]);

// ================================================================ the batch dates travel with the picks (IA_SAVE / IA V2 copy them into the movement)
const dated = { expired_date: "2027-01-31 00:00:00", manufacturing_date: "2026-01-01 00:00:00" };
v = R.rrReceivePlan([lotLine("L1", "21", "B", 5, [pick("A1", 5, Object.assign({ batch_id: "B1" }, dated))])], { L1: { good: "5", defect: "0" } }, dest);
eq("receive plan: a batch pick keeps its dates", [v.iaPicks["21"][0].expired_date, v.iaPicks["21"][0].manufacturing_date], [dated.expired_date, dated.manufacturing_date]);
v = R.rrReceivePlan([lotLine("L1", "11", "A", 5, [pick("A1", 5)])], { L1: { good: "5", defect: "0" } }, dest);
eq("  a pick without dates: null", [v.iaPicks["11"][0].expired_date, v.iaPicks["11"][0].manufacturing_date], [null, null]);
const cd = R.rrCancelBackPlan([lotLine("L1", "21", "B", 5, [pick("A1", 5, Object.assign({ batch_id: "B1" }, dated))])], dest);
eq("cancel back: a batch pick keeps its dates", [cd.iaPicks["21"][0].expired_date, cd.iaPicks["21"][0].manufacturing_date], [dated.expired_date, dated.manufacturing_date]);

// ================================================================ the dispatch check of a Created IA's request (SUBMIT, before the job)
const reqLine = (o) => lotLine("L1", "11", "A", 6, [pick("W1", 6, { material_id: "A" })], Object.assign({ location_id: "STG", storage_location_id: "SL1", quantity_uom: "EA" }, o || {}));
let dc = R.rrDispatchCheck([reqLine()], [reqLine()], [hold("h1", "11", "W1", 6)]);
eq("dispatch check: as stored, picked in full, the reservation as requested -> ok", dc, { ok: true, code: "", message: "" });
eq("dispatch check: the reservation short -> IATR_HOLD_STALE", R.rrDispatchCheck([reqLine()], [reqLine()], [hold("h1", "11", "W1", 5)]).code, "IATR_HOLD_STALE");
eq("dispatch check: picked short -> IATR_PICKS_SHORT", R.rrDispatchCheck([reqLine()], [reqLine({ temp_qty_data: JSON.stringify([pick("W1", 5, { material_id: "A" })]) })],
  [hold("h1", "11", "W1", 6)]).code, "IATR_PICKS_SHORT");
eq("dispatch check: a requested quantity changed -> IATR_DEMAND_CHANGED", R.rrDispatchCheck([reqLine()], [reqLine({ requested_qty: "5" })], [hold("h1", "11", "W1", 6)]).code,
  "IATR_DEMAND_CHANGED");
eq("dispatch check: the destination changed -> IATR_DEMAND_CHANGED", R.rrDispatchCheck([reqLine()], [reqLine({ location_id: "STG2" })], [hold("h1", "11", "W1", 6)]).code,
  "IATR_DEMAND_CHANGED");
eq("dispatch check: a stored line missing from the payload -> IATR_DEMAND_CHANGED", R.rrDispatchCheck([reqLine(), reqLine({ id: "L2", source_ia_line_id: "12" })], [reqLine()],
  [hold("h1", "11", "W1", 6)]).code, "IATR_DEMAND_CHANGED");
eq("dispatch check: no stored line -> IATR_DEMAND_CHANGED", R.rrDispatchCheck([], [reqLine()], [hold("h1", "11", "W1", 6)]).code, "IATR_DEMAND_CHANGED");
const badPick = (o) => R.rrDispatchCheck([reqLine()], [reqLine({ temp_qty_data: JSON.stringify([pick("W1", 6, Object.assign({ material_id: "A" }, o))]) })], [hold("h1", "11", "W1", 6)]).code;
eq("dispatch check: a pick's item, unit, HU, category, bin", [badPick({ material_id: "B" }), badPick({ material_uom: "CTN" }), badPick({ handling_unit_id: "77" }),
  badPick({ category: "Blocked" }), badPick({ location_id: "STG" })], ["IATR_PICK_ITEM", "IATR_PICK_UOM", "IATR_PICK_HU", "IATR_PICK_CATEGORY", "IATR_PICK_AT_DESTINATION"]);
eq("dispatch check: a replacement - the hold at the staging bin is not counted", R.rrDispatchCheck([reqLine()], [reqLine()], [hold("h1", "11", "W1", 6), hold("h9", "11", "STG", 4)]).ok, true);

// ================================================================ the Receive's receipts as SUBMIT stores them for PREPARE
eq("receipts: one per stored line, quantities as text, the reason as text, per batch when given", R.rrReceiptsOf([{ id: "L1" }, { id: "L2" }, { id: "L3" }],
  { L1: { good: 2.5, defect: "0.5", reason: " R1 " }, L2: { batches: { B1: { good: "1", defect: 0 } }, junk: "x" }, L9: { good: "1" } }),
  { L1: { good: "2.5", defect: "0.5", reason: "R1" }, L2: { good: "0", defect: "0", reason: "", batches: { B1: { good: "1", defect: "0" } } } });
eq("receipts: not an object -> none", [R.rrReceiptsOf([{ id: "L1" }], null), R.rrReceiptsOf([{ id: "L1" }], ["x"])], [{}, {}]);

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
