// LOT_V2_COMMIT L3_RESERVATION (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 5): the RR part's writes after the engine moved the
// stock - DISPATCH cancels the IA's released rows; RECEIVE / CANCEL_BACK insert its new rows (RES-01's columns), rewrite its lines'
// picks (the form's pick shape, today's balance ids, the staging picks of earlier requests kept, the dispatched ones dropped) and
// their stock summary; RECEIVE writes the transfer lines' defects. A resumed run writes nothing twice; the check passes only when
// every row / line is at its target. The reads are one-row SQL results ({ j: <json> }).
//   node scratchpad/iatr/test/test_lot_v2_l3r.js     (L3R_SRC=<file> loads another l3r.js)
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const H = require(path.join(REPO, "scratchpad", "smv2", "lib", "harness.js"));
const SM = path.join(REPO, "scratchpad", "smv2", "code");
const src = [path.join(SM, "shared", "lot_common.js"), path.join(SM, "shared", "fingerprint.js"), path.join(SM, "commit", "_common.js"),
  process.env.L3R_SRC || path.join(SM, "commit", "l3r.js")]
  .map((f) => fs.readFileSync(f, "utf8").replace(/\nconst res = __CALL__;[\s\S]*$/, "\n")).join("\n");
const F = new Function("console", src + "\nreturn { keys: typeof commitL3RKeys === 'function' ? commitL3RKeys : null, plan: typeof commitL3RPlan === 'function' ? commitL3RPlan : null, check: typeof commitL3RCheck === 'function' ? commitL3RCheck : null };")({ log() {} });
if (!F.keys || !F.plan || !F.check) {
  console.log("FAIL l3r.js defines commitL3RKeys / commitL3RPlan / commitL3RCheck");
  process.exit(1);
}
const LOT = "9100000000000000001";
const JOB = "9100000000000000002";
const IA = "9700000000000000001";
const PLANT = "1123598813738675202";
const ORG = "1123598813738675201";
const STG = "8800000000000000001";
const W1 = "8800000000000000002";
const W2 = "8800000000000000003";
const M1 = "7700000000000000001";
const M2 = "7700000000000000002";
const B1 = "6600000000000000001";
const UOM = "5500000000000000001";
const IAL1 = "9710000000000000001";
const IAL2 = "9710000000000000002";
const L1 = "9110000000000000001";
const L2 = "9110000000000000002";
const entry = () => ({ jobId: JOB, lotId: LOT, attempts: 0, rowVersion: 4, dbNow: "2026-10-29 12:00:00", jsAt: 0, lineCount: 2, unlockOk: "NO",
  prevStatus: "In Progress", partPrefix: "P|abcd1234|", leaseUntil: "2026-10-29 12:30:00", organizationId: ORG });
const part = (o) => [{ step_name: "P|abcd1234|RR|001", result_ref: JSON.stringify(o) }];
const J = (o) => [{ j: JSON.stringify(o) }];
const ia = { id: IA, no: "IA-2610-030", status: "Created", plant: PLANT, org: ORG };
const ctx = (o) => J(Object.assign({ now: "2026-10-29 20:00:00", ia: ia, lines: [], holds: [], lot: [],
  items: [{ id: M1, material_code: "RM-1", material_name: "Raw 1", material_desc: "d1" }, { id: M2, material_code: "RM-2", material_name: "Raw 2", material_desc: "" }],
  uoms: [{ id: UOM, uom_name: "PCS" }] }, o));
const bal = (id, m, loc, batch, u, b) => ({ id: id, material_id: m, location_id: loc, batch_id: batch || "", unrestricted_qty: u, balance_quantity: b });
const look = (o) => J(Object.assign({ bal: [bal("7001", M1, STG, "", "0", "5"), bal("7003", M1, W1, "", "4", "7")], bbal: [bal("7002", M2, STG, B1, "0", "3")],
  bins: [{ id: STG, name: "STG-01" }, { id: W1, name: "A1-01" }, { id: W2, name: "A1-02" }], batches: [{ id: B1, batch_number: "BAT-001" }] }, o));
const row = (id, status, key) => ({ id: id, status: status, job_line_key: key || "" });
const ended = (r) => r.route === "END" && ((r.jobRows || [])[0] || {}).job_status;
const flat = (slices) => (slices || []).reduce((a, x) => a.concat(x.rows || []), []);
const iaLine = (id, m, picks) => ({ id: id, item_selection: m, quantity_uom: UOM, temp_qty_data: picks.length ? JSON.stringify(picks) : "", stock_summary: "old", total_quantity: "0" });
const whPick = (m, loc, batch, qty) => ({ material_id: m, location_id: loc, storage_location_id: null, batch_id: batch || null, balance_id: "6000", sm_quantity: qty, category: "Unrestricted",
  plant_id: PLANT, organization_id: ORG, is_deleted: 0, expired_date: null, manufacturing_date: null, unrestricted_qty: 9, balance_quantity: 9 });

// ---- DISPATCH
const disp = { kind: "DISPATCH", iaId: IA, cancelRows: ["881", "882"], marker: "IATR|" + JOB, countBins: [] };
let p = F.plan(entry(), part(disp), ctx({ holds: [row("881", "Allocated"), row("882", "Allocated")] }), []);
H.eq("dispatch: the IA's released rows Cancelled under the marker, nothing else written", [p.route, flat(p.cancelSlices), flat(p.addSlices), flat(p.iaSlices), flat(p.lotSlices)],
  ["GO", [{ id: "881", status: "Cancelled", job_line_key: disp.marker }, { id: "882", status: "Cancelled", job_line_key: disp.marker }], [], [], []]);
let c = F.check(entry(), ctx({ holds: [row("881", "Cancelled", disp.marker), row("882", "Cancelled", disp.marker)] }), p.expect);
H.eq("  check: both cancelled -> DONE as L3_RESERVATION (the step rows read keeps ^L[0-9]_)", [c.route, (c.stepRows || []).map((x) => x.step_name)], ["OK", ["L3_RESERVATION"]]);
p = F.plan(entry(), part(disp), ctx({ holds: [row("881", "Cancelled", disp.marker), row("882", "Allocated")] }), []);
H.eq("dispatch resumed: the row already cancelled is not written again", flat(p.cancelSlices).map((x) => x.id), ["882"]);
p = F.plan(entry(), part(disp), ctx({ holds: [row("881", "Delivered"), row("882", "Allocated")] }), []);
H.eq("dispatch: a row another process took -> REQUIRES_REVIEW", ended(p), "REQUIRES_REVIEW");
c = F.check(entry(), ctx({ holds: [row("881", "Cancelled", disp.marker), row("882", "Allocated")] }), F.plan(entry(), part(disp), ctx({ holds: [row("881", "Allocated"), row("882", "Allocated")] }), []).expect);
H.eq("  check: one still Allocated -> REQUIRES_REVIEW", ended(c), "REQUIRES_REVIEW");
const many = Array.from({ length: 251 }, (x, i) => String(1000 + i));
p = F.plan(entry(), part(Object.assign({}, disp, { cancelRows: many })), ctx({ holds: many.map((id) => row(id, "Allocated")) }), []);
H.eq("dispatch: 251 rows -> two write slices (250 + 1)", (p.cancelSlices || []).map((x) => x.rows.length), [250, 1]);
p = F.plan(entry(), part(Object.assign({}, disp, { iaId: "9700000000000000999" })), ctx({ holds: [row("881", "Allocated"), row("882", "Allocated")] }), []);
H.eq("dispatch: the part's Item Assembly is not the transfer's -> REQUIRES_REVIEW", ended(p), "REQUIRES_REVIEW");
H.eq("keys: a dispatch looks nothing up", F.keys(entry(), part(disp), ctx({})).need, "NO");
// the bins to count (the design's section 4, D9): a pick away from the reservation -> one DISPATCH entry in the request's log (rrSwapPlan's
// countBins: labels "<bin>" / "<bin> / <batch>"), written once per marker; the LOT form names them
const swapped = Object.assign({}, disp, { countBins: [{ line: 1, item: M1, pickedFrom: W2, reservedAt: [W1] }, { line: 2, item: M2, pickedFrom: W2 + " / " + B1, reservedAt: [W1 + " / " + B1] }] });
const oldLog = JSON.stringify([{ at: "2026-10-29 09:00:00", op: "CREATE", rev: 1 }]);
const held = () => [row("881", "Allocated"), row("882", "Allocated")];
p = F.plan(entry(), part(swapped), ctx({ holds: held(), log: oldLog }), []);
const logged = flat(p.logSlices);
H.eq("dispatch away from the reservation: the request's log gains one DISPATCH entry with the bins to count (ids), the rows cancelled as before",
  [logged.map((x) => x.id), JSON.parse((logged[0] || {}).request_log || "[]"), flat(p.cancelSlices).length], [[LOT], [{ at: "2026-10-29 09:00:00", op: "CREATE", rev: 1 },
    { at: "2026-10-29 20:00:00", op: "DISPATCH", marker: disp.marker, count: [{ item: M1, from: { bin: W2, batch: "" }, reserved: [{ bin: W1, batch: "" }] },
      { item: M2, from: { bin: W2, batch: B1 }, reserved: [{ bin: W1, batch: B1 }] }] }], 2]);
const withEntry = JSON.parse(logged[0].request_log);
p = F.plan(entry(), part(swapped), ctx({ holds: held(), log: JSON.stringify(withEntry) }), []);
H.eq("  resumed with the entry already there: not written again", flat(p.logSlices), []);
H.eq("  a dispatch from the reserved bins (no countBins): no log write", flat(F.plan(entry(), part(disp), ctx({ holds: held(), log: oldLog }), []).logSlices), []);
p = F.plan(entry(), part(swapped), ctx({ holds: held(), log: "" }), []);
H.eq("  an empty log: the entry alone", JSON.parse(flat(p.logSlices)[0].request_log).map((x) => x.op), ["DISPATCH"]);
p = F.plan(entry(), part(swapped), ctx({ holds: held(), log: "{broken" }), []);
H.eq("  an unreadable log kept as text, the entry after it", JSON.parse(flat(p.logSlices)[0].request_log).map((x) => [x.op, x.text || ""]), [["UNREADABLE", "{broken"], ["DISPATCH", ""]]);
const swapExpect = F.plan(entry(), part(swapped), ctx({ holds: held(), log: oldLog }), []).expect;
const cancelledRows = [row("881", "Cancelled", disp.marker), row("882", "Cancelled", disp.marker)];
c = F.check(entry(), ctx({ holds: cancelledRows, log: JSON.stringify(withEntry) }), swapExpect);
H.eq("  check: rows cancelled and the entry in the log -> DONE", c.route, "OK");
c = F.check(entry(), ctx({ holds: cancelledRows, log: oldLog }), swapExpect);
H.eq("  check: the entry missing -> REQUIRES_REVIEW", ended(c), "REQUIRES_REVIEW");
c = F.check(entry(), ctx({ holds: cancelledRows, log: oldLog }), F.plan(entry(), part(disp), ctx({ holds: held(), log: oldLog }), []).expect);
H.eq("  check: no bins to count -> the log not asked for", c.route, "OK");

// ---- RECEIVE
const nr = (k, line, m, bin, batch, qty) => ({ doc_type: "Item Assembly", status: "Processing", doc_id: IA, doc_line_id: line, material_id: m, bin_location: bin, batch_id: batch,
  item_uom: UOM, reserved_qty: qty, open_qty: qty, delivered_qty: "0", from_category: "Unrestricted", job_line_key: k });
const K1 = "IATR|" + LOT + "|1";
const K2 = "IATR|" + LOT + "|2";
const rec = { kind: "RECEIVE", iaId: IA, stagingBin: STG, newHoldRows: [nr(K1, IAL1, M1, STG, "", "2"), nr(K2, IAL2, M2, STG, B1, "1.5")],
  iaPicks: { [IAL1]: [{ material_id: M1, location_id: STG, batch_id: "", sm_quantity: "2", category: "Unrestricted", expired_date: null, manufacturing_date: null }],
    [IAL2]: [{ material_id: M2, location_id: STG, batch_id: B1, sm_quantity: "1.5", category: "Unrestricted", expired_date: "2027-01-31 00:00:00", manufacturing_date: null }] },
  lineDefects: [{ id: L1, defect_qty: "1", defect_reason: "R1", defect_detail: "" }, { id: L2, defect_qty: "0", defect_reason: "", defect_detail: "" }] };
// an earlier request's staging pick on line 1 stays; the dispatched warehouse picks go
const earlier = Object.assign(whPick(M1, STG, "", 1), { balance_id: "7001", iatr_lot_id: "9100000000000000999" });
const lines = [iaLine(IAL1, M1, [earlier, whPick(M1, W1, "", 2)]), iaLine(IAL2, M2, [whPick(M2, W2, B1, 1.5)])];
const lot = [{ id: L1, defect_qty: null, defect_reason: "", defect_detail: "" }, { id: L2, defect_qty: null, defect_reason: "", defect_detail: "" }];
const kx = F.keys(entry(), part(rec), ctx({ lines: lines }));
H.eq("keys: the new picks' items, every final pick's bin and batch, the IA's plant", [kx.need, kx.mats.split(",").sort(), kx.locs, kx.batches, kx.plant],
  ["YES", [M1, M2].sort(), STG, B1, PLANT]);
const kbad = F.keys(entry(), part(Object.assign({}, rec, { iaPicks: { [IAL1]: [{ material_id: "1 OR 1=1", location_id: STG, batch_id: "", sm_quantity: "2" }] } })), ctx({ lines: lines }));
H.eq("  a value that is not an id never reaches the SQL", kbad.mats, "0");
p = F.plan(entry(), part(rec), ctx({ lines: lines, lot: lot }), look({}));
const adds = flat(p.addSlices);
H.eq("receive: the new rows carry RES-01's columns (Allocated, the IA's number and plant, the item's text, now; no batch = null; decimals as text)",
  adds.map((r) => [r.job_line_key, r.status, r.doc_no, r.plant_id, r.organization_id, r.batch_id, r.open_qty, r.reserved_qty, r.delivered_qty, r.reserved_date, r.item_code, r.item_name,
    r.item_desc, r.parent_id, r.parent_no, r.parent_line_id, r.target_gd_id, r.source_reserved_id, r.from_category, r.doc_type]),
  [[K1, "Allocated", "IA-2610-030", PLANT, ORG, null, "2.00000000", "2.00000000", "0.00000000", "2026-10-29 20:00:00", "RM-1", "Raw 1", "d1", "", "", "", "", "", "Unrestricted", "Item Assembly"],
    [K2, "Allocated", "IA-2610-030", PLANT, ORG, B1, "1.50000000", "1.50000000", "0.00000000", "2026-10-29 20:00:00", "RM-2", "Raw 2", "", "", "", "", "", "", "Unrestricted", "Item Assembly"]]);
H.eq("  every row has the 25 columns of IA_HOLD's add", adds.map((r) => Object.keys(r).length), [25, 25]);
const iaRows = flat(p.iaSlices);
const picks1 = JSON.parse(iaRows[0].temp_qty_data);
H.eq("  line 1: the earlier request's staging pick kept, the dispatched warehouse pick dropped, this request's pick added (tagged)",
  picks1.map((x) => [x.location_id, x.sm_quantity, x.balance_id, x.iatr_lot_id || ""]), [[STG, 1, "7001", "9100000000000000999"], [STG, 2, "7001", LOT]]);
H.eq("  the new pick has the form's shape (today's balance; numbers; no batch = null)", Object.keys(picks1[1]),
  ["material_id", "location_id", "storage_location_id", "batch_id", "balance_id", "sm_quantity", "category", "plant_id", "organization_id", "is_deleted", "expired_date",
    "manufacturing_date", "unrestricted_qty", "balance_quantity", "iatr_lot_id"]);
H.eq("    values", [picks1[1].storage_location_id, picks1[1].batch_id, picks1[1].category, picks1[1].plant_id, picks1[1].organization_id, picks1[1].is_deleted, picks1[1].unrestricted_qty,
  picks1[1].balance_quantity], [null, null, "Unrestricted", PLANT, ORG, 0, 0, 5]);
H.eq("  line 1: total and the form's stock summary", [iaRows[0].id, iaRows[0].total_quantity, iaRows[0].stock_summary],
  [IAL1, "3.00000000", "Total: 3 PCS\n\nDETAILS:\n1. STG-01: 1 PCS (UNR)\n2. STG-01: 2 PCS (UNR)"]);
const picks2 = JSON.parse(iaRows[1].temp_qty_data);
H.eq("  line 2 (batch): the batch's balance and dates; the summary names the batch", [picks2.map((x) => [x.balance_id, x.batch_id, x.sm_quantity, x.expired_date]), iaRows[1].stock_summary],
  [[["7002", B1, 1.5, "2027-01-31 00:00:00"]], "Total: 1.5 PCS\n\nDETAILS:\n1. STG-01: 1.5 PCS (UNR)\n[BAT-001]"]);
H.eq("  the transfer lines' defects (defect_qty as text); a line without a defect, already 0, is not written", flat(p.lotSlices),
  [{ id: L1, defect_qty: "1.00000000", defect_reason: "R1", defect_detail: "" }]);
H.eq("  counts", p.counts, { cancel: 0, add: 2, ia: 2, lot: 1, log: 0, link: 0 });
// resumed after every write
const backLines = lines.map((l) => Object.assign({}, l, iaRows.filter((x) => x.id === l.id)[0] || {}));
const backHolds = [row("883", "Allocated", K1), row("884", "Allocated", K2)];
const backLot = lot.map((l) => flat(p.lotSlices).filter((x) => x.id === l.id)[0] || l);
const p2 = F.plan(entry(), part(rec), ctx({ lines: backLines, holds: backHolds, lot: backLot }), look({}));
H.eq("receive resumed after its writes: nothing written twice", [p2.route, flat(p2.addSlices).length, flat(p2.iaSlices).length, flat(p2.lotSlices).length], ["GO", 0, 0, 0]);
c = F.check(entry(), ctx({ lines: backLines, holds: backHolds, lot: backLot }), p.expect);
H.eq("  check: rows once each, picks / summary / defects at their targets -> DONE", c.route, "OK");
c = F.check(entry(), ctx({ lines: backLines, holds: backHolds.slice(0, 1), lot: backLot }), p.expect);
H.eq("  check: a row missing -> REQUIRES_REVIEW", ended(c), "REQUIRES_REVIEW");
c = F.check(entry(), ctx({ lines: lines, holds: backHolds, lot: backLot }), p.expect);
H.eq("  check: a line without its new picks -> REQUIRES_REVIEW", ended(c), "REQUIRES_REVIEW");
const stale = backLines.map((l) => Object.assign({}, l, { stock_summary: "old" }));
const p3 = F.plan(entry(), part(rec), ctx({ lines: stale, holds: backHolds, lot: backLot }), look({}));
H.eq("receive: picks at target but the summary stale -> the lines written again with the summary", flat(p3.iaSlices).map((x) => [x.id, x.stock_summary === "old"]),
  [[IAL1, false], [IAL2, false]]);
p = F.plan(entry(), part(rec), ctx({ lines: lines, lot: lot }), look({ bal: [bal("", M1, STG, "", "0", "5")] }));
H.eq("receive: a balance row without an id -> REQUIRES_REVIEW", ended(p), "REQUIRES_REVIEW");
p = F.plan(entry(), part(rec), ctx({ lines: lines, lot: lot }), look({ bbal: [] }));
H.eq("receive: no balance row for a new pick -> REQUIRES_REVIEW", ended(p), "REQUIRES_REVIEW");
p = F.plan(entry(), part(rec), ctx({ lines: lines, lot: lot, holds: [row("883", "Allocated", K1), row("885", "Allocated", K1)] }), look({}));
H.eq("receive: a key written twice -> REQUIRES_REVIEW", ended(p), "REQUIRES_REVIEW");
p = F.plan(entry(), part(rec), ctx({ lines: lines.slice(0, 1), lot: lot }), look({}));
H.eq("receive: an Item Assembly line not read -> REQUIRES_REVIEW", ended(p), "REQUIRES_REVIEW");

// ---- CANCEL_BACK: rows + picks at the picked bins, the staging picks of an earlier request kept, no defects
const cb = { kind: "CANCEL_BACK", iaId: IA, stagingBin: STG, newHoldRows: [nr(K1, IAL1, M1, W1, "", "2")],
  iaPicks: { [IAL1]: [{ material_id: M1, location_id: W1, batch_id: "", sm_quantity: "2", category: "Unrestricted", expired_date: null, manufacturing_date: null }] } };
p = F.plan(entry(), part(cb), ctx({ lines: [iaLine(IAL1, M1, [earlier, whPick(M1, W2, "", 2)])] }), look({}));
const cbRow = flat(p.iaSlices)[0];
H.eq("keys (cancel back): the kept staging pick's bin is looked up too (its name in the summary)",
  F.keys(entry(), part(cb), ctx({ lines: [iaLine(IAL1, M1, [earlier, whPick(M1, W2, "", 2)])] })).locs.split(",").sort(), [STG, W1].sort());
H.eq("cancel back: the row at the picked bin, the line's picks there (earlier staging pick kept), its summary, no defect write",
  [flat(p.addSlices).map((r) => [r.bin_location, r.status]), JSON.parse(cbRow.temp_qty_data).map((x) => [x.location_id, x.balance_id]), cbRow.stock_summary, flat(p.lotSlices)],
  [[[W1, "Allocated"]], [[STG, "7001"], [W1, "7003"]], "Total: 3 PCS\n\nDETAILS:\n1. STG-01: 1 PCS (UNR)\n2. A1-01: 2 PCS (UNR)", []]);
// a cancelled replacement gives the IA's link (its list's Transfer Request column: the latest open or received request) back to the
// received request (Task 10; IA_TRANSFER_REQUEST's CANCEL does the same before a dispatch)
const RECV = "9100000000000000000";
const cbCtx = (link, recv) => ctx({ ia: Object.assign({}, ia, { link: link }), recv: recv === undefined ? { id: RECV, no: "LOT-20261030/0006" } : recv,
  lines: [iaLine(IAL1, M1, [earlier, whPick(M1, W2, "", 2)])] });
p = F.plan(entry(), part(cb), cbCtx(LOT), look({}));
H.eq("cancel back of a replacement (the IA linked to it), a received request before it: the IA relinked to that one", [flat(p.linkSlices), p.counts.link],
  [[{ id: IA, transfer_request_id: RECV, transfer_request_no: "LOT-20261030/0006" }], 1]);
H.eq("  resumed after the write (linked to the received one): not written again", flat(F.plan(entry(), part(cb), cbCtx(RECV), look({})).linkSlices), []);
H.eq("  nothing received before it: the link kept", flat(F.plan(entry(), part(cb), cbCtx(LOT, null), look({})).linkSlices), []);
H.eq("  the IA linked to another request: left alone", flat(F.plan(entry(), part(cb), cbCtx("9100000000000000099"), look({})).linkSlices), []);
H.eq("  a receipt never relinks", flat(F.plan(entry(), part(rec), ctx({ ia: Object.assign({}, ia, { link: LOT }), recv: { id: RECV, no: "LOT-6" }, lines: lines, lot: lot }),
  look({})).linkSlices), []);
const cbExpect = F.plan(entry(), part(cb), cbCtx(LOT), look({})).expect;
const cbDone = (link) => J({ now: "x", ia: Object.assign({}, ia, { link: link }), holds: [row("1", "Allocated", K1)], lines: [Object.assign(iaLine(IAL1, M1, []),
  { temp_qty_data: cbRow.temp_qty_data, stock_summary: cbRow.stock_summary })], lot: [] });
H.eq("  check: relinked -> DONE; still on the cancelled one -> REQUIRES_REVIEW", [F.check(entry(), cbDone(RECV), cbExpect).route, ended(F.check(entry(), cbDone(LOT), cbExpect))],
  ["OK", "REQUIRES_REVIEW"]);
H.eq("an unreadable RR part -> REQUIRES_REVIEW", ended(F.plan(entry(), [], ctx({}), [])), "REQUIRES_REVIEW");
H.done();
