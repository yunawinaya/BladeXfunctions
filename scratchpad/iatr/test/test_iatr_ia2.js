// IA_TRANSFER_REQUEST v8's rules (code/shared/iatr_ia2.js, RESERVED_REQUEST_PLAN.md Task 7), loaded after iatr_rules.js, iatr_ia.js and
// iatr_reserve.js the way the workflow's code nodes include them: a Created IA requests what RES-01 reserved (D1, D12, D13), refreshes
// from it (D4), replaces what is missing after a receipt (D6), reports a defect at the staging bin (D2); the claim winner.
//   node scratchpad/iatr/test/test_iatr_ia2.js   (IATR_IA2=<file> tests another copy: mutants_iatr_ia2.js)
const fs = require("fs");
const path = require("path");
const SHARED = path.join(__dirname, "..", "code", "shared");
const strip = (t) => t.split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const src = ["iatr_rules.js", "iatr_ia.js", "iatr_reserve.js"].map((f) => strip(fs.readFileSync(path.join(SHARED, f), "utf8")))
  .concat([strip(fs.readFileSync(process.env.IATR_IA2 || path.join(SHARED, "iatr_ia2.js"), "utf8"))]).join("\n");
const R = new Function(src + "\nreturn { iatrIaFp, iatrBasis, rrReqFp, rrLotLines, iatrDefectsOf, iatrDecide2, iatrWin2, IATR_OPS2, iatrSummary, rrLinesFromHolds };")();

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + String(JSON.stringify(got)).slice(0, 1500) + "\n  want " + String(JSON.stringify(want)).slice(0, 1500));
};

const IA = { id: "2113088440365826050", status: "Created", hold: "FULL", plant: "P1", org: "O1", no: "IA-2610-001", item_id: "FG", item_qty: "10", planned_output_qty: "10",
  bom_consumption_mode: "FLAT", source_bom_id: "BOM1" };
const pk = (bin, qty, o) => Object.assign({ material_id: "A", location_id: bin, storage_location_id: null, batch_id: null, balance_id: "BAL-" + bin, sm_quantity: qty,
  category: "Unrestricted", plant_id: "P1", organization_id: "O1", is_deleted: 0, expired_date: null, manufacturing_date: null, unrestricted_qty: 9, balance_quantity: 9 }, o || {});
const L = () => [
  { id: "11", item_selection: "A", item_name: "RM-A", quantity_uom: "77", requested_qty: "10", required_qty: "10", sc_ref_key: "A|77", line_index: "1",
    temp_qty_data: JSON.stringify([pk("W1", 6), pk("W2", 4)]), temp_hu_data: "" },
  { id: "12", item_selection: "B", item_name: "RM-B", quantity_uom: "77", requested_qty: "4", required_qty: null, sc_ref_key: "B|77", line_index: "2",
    temp_qty_data: JSON.stringify([pk("W1", 4, { material_id: "B", batch_id: "BT1", expired_date: "2027-01-31 00:00:00" })]), temp_hu_data: "" },
  { id: "13", item_selection: "LAB", item_name: "Labour", quantity_uom: "77", requested_qty: "1", required_qty: null, sc_ref_key: "", line_index: "3", temp_qty_data: "", temp_hu_data: "" },
];
const ITEMS = [{ id: "A", stock_control: 1, serial_number_management: 0, material_name: "RM-A", material_desc: "" },
  { id: "B", stock_control: 1, serial_number_management: 0, material_name: "RM-B", material_desc: "" }, { id: "LAB", stock_control: 0, serial_number_management: 0, material_name: "Labour" }];
const hold = (id, line, m, bin, qty, o) => Object.assign({ id: id, status: "Allocated", doc_line_id: line, material_id: m, bin_location: bin, batch_id: null,
  from_category: "Unrestricted", open_qty: String(qty), reserved_qty: String(qty), item_uom: "77", job_line_key: "" }, o || {});
const H = () => [hold("h1", "11", "A", "W1", 6), hold("h2", "11", "A", "W2", 4), hold("h3", "12", "B", "W1", 4, { batch_id: "BT1" })];
const SL = { id: "S1", plant: "P1", active: 1, name: "PROD" };
const BIN = { id: "BIN9", plant: "P1", sl: "S1", active: 1, name: "PROD-01" };
const ON = [{ organization_id: "O1", plant_id: "P1", transfer_request_enabled: 1, is_deleted: 0 }];
const OFF = [{ organization_id: "O1", plant_id: "P1", transfer_request_enabled: 0, is_deleted: 0 }];
const fpIa = (ia, lines) => R.iatrIaFp(R.iatrBasis(ia), lines);
const inp = (o) => Object.assign({ op: "CREATE", ia: IA, iaLines: L(), items: ITEMS, uoms: {}, holds: H(), reqs: [], named: null, sl: SL, bin: BIN, member: 1, org: "O1", rule: "R1",
  expectFp: fpIa(IA, L()), storage: "S1", binId: "BIN9", requiredDate: "2026-10-30", setupRows: ON, defects: null, now: "2026-10-30 12:00:00",
  uomNames: [{ id: "77", uom_name: "PCS" }], binNames: [{ id: "BIN9", name: "PROD-01" }], batchNos: [{ id: "BT1", batch_number: "B-001" }] }, o || {});
const D = (o) => R.iatrDecide2(inp(o));
const pick = (r) => [r.route, r.code];
const req = (id, status, o) => Object.assign({ id: id, no: "LOT-" + id.slice(-3), status: status, rev: "1", fp: "", sl: "S1", bin: "BIN9" }, o || {});

eq("the operations", R.IATR_OPS2, ["CREATE", "REFRESH", "REPLACE", "DEFECT", "CANCEL", "STATUS"]);

// ================================================================ CREATE (D1, D12)
let d = D({});
eq("CREATE from a Created IA: GO, one line per reserved stock line, for the reserved quantity", [pick(d), d.lineRows.map((l) => [l.source_ia_line_id, l.requested_qty, l.total_quantity])],
  [["GO", "200"], [["11", "10.00000000", "10.00000000"], ["12", "4.00000000", "4.00000000"]]]);
const p1 = JSON.parse(d.lineRows[0].temp_qty_data);
eq("  the picks start at the reservation, with the IA's own balance ids", p1.map((p) => [p.location_id, p.sm_quantity, p.balance_id, p.category, p.batch_id]),
  [["W1", 6, "BAL-W1", "Unrestricted", null], ["W2", 4, "BAL-W2", "Unrestricted", null]]);
const p2 = JSON.parse(d.lineRows[1].temp_qty_data);
eq("  a batch pick keeps its batch and dates", [p2[0].batch_id, p2[0].expired_date, p2[0].material_id], ["BT1", "2027-01-31 00:00:00", "B"]);
eq("  every line goes to the destination; its fingerprint RR1", [d.lineRows.every((l) => l.storage_location_id === "S1" && l.location_id === "BIN9"), /^RR1:2:[0-9a-f]{16}$/.test(d.fp)],
  [true, true]);
d = D({ holds: [hold("h1", "11", "A", "W1", 6)] });
eq("CREATE partial (D1): only what is reserved, the rest later", [pick(d), d.lineRows.map((l) => [l.source_ia_line_id, l.requested_qty]), d.skipped.map((x) => x.line)],
  [["GO", "200"], [["11", "6.00000000"]], ["12"]]);
eq("CREATE with nothing reserved -> 400", pick(D({ holds: [] })), ["ANSWER", "400"]);
eq("CREATE on a Draft IA -> 400 (nothing is reserved on a Draft)", pick(D({ ia: Object.assign({}, IA, { status: "Draft" }), expectFp: fpIa(Object.assign({}, IA, { status: "Draft" }), L()) })),
  ["ANSWER", "400"]);
eq("CREATE with the setup off -> 400 (D12)", pick(D({ setupRows: OFF })), ["ANSWER", "400"]);
eq("CREATE with no setup row -> 400 (off)", pick(D({ setupRows: [] })), ["ANSWER", "400"]);
eq("CREATE with unsaved changes -> 409", pick(D({ expectFp: "IA1:3:0000000000000000" })), ["ANSWER", "409"]);
eq("CREATE with a live request -> 200 existing, nothing written", [pick(D({ reqs: [req("2114000000000000701", "Requested")] })), D({ reqs: [req("2114000000000000701", "Requested")] }).result.existing],
  [["ANSWER", "200"], "YES"]);
eq("CREATE after a receipt -> 409 (Replace)", pick(D({ reqs: [req("2114000000000000701", "Completed")] })), ["ANSWER", "409"]);
eq("CREATE after a cancel: GO, replaces it", [pick(D({ reqs: [req("2114000000000000701", "Cancelled")] })), D({ reqs: [req("2114000000000000701", "Cancelled")] }).replacesId],
  [["GO", "200"], "2114000000000000701"]);
eq("CREATE to a bin of another storage location -> 400", pick(D({ bin: Object.assign({}, BIN, { sl: "S2" }) })), ["ANSWER", "400"]);
eq("CREATE without a valid date -> 400", pick(D({ requiredDate: "2026-02-30" })), ["ANSWER", "400"]);
eq("CREATE by someone not in the organisation -> 400", pick(D({ member: 0 })), ["ANSWER", "400"]);
d = D({ holds: H().concat([hold("h9", "11", "A", "BIN9", 2)]) });
eq("CREATE: a hold already at the destination bin is not requested", d.lineRows.map((l) => [l.source_ia_line_id, l.requested_qty]), [["11", "10.00000000"], ["12", "4.00000000"]]);

// ================================================================ REFRESH (D4)
const fp0 = D({}).fp;
const named = (o) => Object.assign({ id: "2114000000000000701", no: "LOT-701", status: "Requested", purpose: "IA_SUPPLY", source: IA.id, fp: fp0, rev: "1", log: "[]", org: "O1",
  sl: "S1", bin: "BIN9", lines: [], openJobs: 0, openTransit: 0 }, o || {});
eq("REFRESH, the reservation unchanged -> already", [pick(D({ op: "REFRESH", named: named() })), D({ op: "REFRESH", named: named() }).result.already], [["ANSWER", "200"], "YES"]);
d = D({ op: "REFRESH", named: named(), holds: [hold("h1", "11", "A", "W1", 6), hold("h3", "12", "B", "W1", 4, { batch_id: "BT1" })] });
eq("REFRESH after a hold change: GO, the lines and picks from the reservation now, rev + 1", [pick(d), d.lineRows.map((l) => [l.source_ia_line_id, l.requested_qty]), d.rev, d.fp !== fp0],
  [["GO", "200"], [["11", "6.00000000"], ["12", "4.00000000"]], 2, true]);
eq("REFRESH of a dispatched request -> 400", pick(D({ op: "REFRESH", named: named({ status: "In Progress" }) })), ["ANSWER", "400"]);
eq("REFRESH while a dispatch runs -> 409", pick(D({ op: "REFRESH", named: named({ openJobs: 1 }), holds: [hold("h1", "11", "A", "W1", 6)] })), ["ANSWER", "409"]);
eq("REFRESH of another IA's request -> 400", pick(D({ op: "REFRESH", named: named({ source: "999" }) })), ["ANSWER", "400"]);
// CANCEL (Task 10): the IA's link goes back to its newest received request (its list's column: the latest open or received request)
const recvd = req("2114000000000000700", "Completed");
d = D({ op: "CANCEL", named: named(), reqs: [named(), recvd] });
eq("CANCEL of a replacement, a received request before it: GO, the IA relinked to the received one", [d.route, d.relink],
  ["GO", { id: IA.id, transfer_request_id: recvd.id, transfer_request_no: recvd.no }]);
eq("CANCEL with nothing received: no relink", D({ op: "CANCEL", named: named(), reqs: [named(), req("2114000000000000699", "Cancelled")] }).relink, null);
eq("CANCEL, its IA deleted: no relink", D({ op: "CANCEL", ia: null, iaId: IA.id, named: named(), reqs: [named(), recvd] }).relink, null);
eq("REFRESH with the setup off still works (D13)", pick(D({ op: "REFRESH", named: named(), setupRows: OFF, holds: [hold("h1", "11", "A", "W1", 6)] })), ["GO", "200"]);

// ================================================================ REPLACE (D6)
const got = [req("2114000000000000701", "Completed", { log: '[{"op":"CREATE"}]' })];
const atStg = [hold("h7", "11", "A", "BIN9", 7, { job_line_key: "IATR|2114000000000000701|1" }), hold("h3", "12", "B", "BIN9", 4, { batch_id: "BT1", job_line_key: "IATR|2114000000000000701|2" })];
d = D({ op: "REPLACE", reqs: got, holds: atStg.concat([hold("h8", "11", "A", "W2", 3)]) });
eq("REPLACE after a receipt: GO, only the new reservation away from the staging bin, linked to the received request",
  [pick(d), d.lineRows.map((l) => [l.source_ia_line_id, l.requested_qty]), d.replacementForId], [["GO", "200"], [["11", "3.00000000"]], "2114000000000000701"]);
eq("REPLACE while the request is in transit -> 200 existing (one open request at a time)", pick(D({ op: "REPLACE", reqs: [req("2114000000000000701", "In Progress")] })),
  ["ANSWER", "200"]);
eq("REPLACE before a receipt (only a cancelled request) -> 400", pick(D({ op: "REPLACE", reqs: [req("2114000000000000701", "Cancelled")] })), ["ANSWER", "400"]);
eq("REPLACE with no request at all -> 400", pick(D({ op: "REPLACE", reqs: [] })), ["ANSWER", "400"]);
eq("REPLACE while a replacement is open -> 200 existing", pick(D({ op: "REPLACE", reqs: got.concat([req("2114000000000000702", "Requested")]) })), ["ANSWER", "200"]);
eq("REPLACE with nothing newly reserved -> 400", pick(D({ op: "REPLACE", reqs: got, holds: atStg })), ["ANSWER", "400"]);
eq("REPLACE to another bin than the received request's staging bin -> 400", pick(D({ op: "REPLACE", reqs: got, holds: atStg.concat([hold("h8", "11", "A", "W2", 3)]),
  bin: Object.assign({}, BIN, { id: "BIN8" }), binId: "BIN8" })), ["ANSWER", "400"]);
eq("REPLACE with the setup off still works (D13)", pick(D({ op: "REPLACE", reqs: got, holds: atStg.concat([hold("h8", "11", "A", "W2", 3)]), setupRows: OFF })), ["GO", "200"]);
eq("REPLACE after a receipt that followed a cancel: replaces nothing", D({ op: "REPLACE", reqs: [req("2114000000000000700", "Cancelled")].concat(got),
  holds: atStg.concat([hold("h8", "11", "A", "W2", 3)]) }).replacesId, "");
eq("REPLACE after a cancelled replacement: replaces it", D({ op: "REPLACE", reqs: got.concat([req("2114000000000000702", "Cancelled")]), holds: atStg.concat([hold("h8", "11", "A", "W2", 3)]) })
  .replacesId, "2114000000000000702");

// ================================================================ DEFECT (D2)
const stgLines = () => L().map((l) => (l.id === "11" ? Object.assign({}, l, { temp_qty_data: JSON.stringify([pk("BIN9", 7, { iatr_lot_id: "2114000000000000701" })]) })
  : l.id === "12" ? Object.assign({}, l, { temp_qty_data: JSON.stringify([pk("BIN9", 4, { material_id: "B", batch_id: "BT1" })]) }) : l));
const defect = (defects, o) => D(Object.assign({ op: "DEFECT", reqs: got, holds: atStg, iaLines: stgLines(), defects: defects }, o || {}));
d = defect({ 11: { qty: "2", reason: "Damaged" } });
eq("DEFECT: GO, Reserved -> Blocked at the staging bin (IA-D), the hold and the picks drop", [pick(d), d.defect.moves.map((m) => [m.location_id, m.quantity, m.from_category, m.to_category]),
  d.defect.holdChanges.map((h) => [h.id, h.open_qty, h.status]), JSON.parse(d.iaRows[0].temp_qty_data).map((p) => [p.location_id, p.sm_quantity])],
  [["GO", "200"], [["BIN9", "2", "Reserved", "Blocked"]], [["h7", "5", "Allocated"]], [["BIN9", 5]]]);
eq("  the IA line's total and stock summary follow", [d.iaRows[0].total_quantity, d.iaRows[0].stock_summary.split("\n")[0]], ["5.00000000", "Total: 5 PCS"]);
eq("  the engine pairs: SUBTRACT Reserved + ADD Blocked, IA-D under the IA number, priced from the subtract", d.movements.map((m) => [m.movement_key, m.direction, m.inventory_category,
  m.transaction_type, m.trx_no, m.quantity, m.isMovingInv, m.unit_price_from || ""]),
  [["D1", "SUBTRACT", "Reserved", "IA-D", "IA-2610-001/D", 2, 1, ""], ["D1.2", "ADD", "Blocked", "IA-D", "IA-2610-001/D", 2, 1, "D1"]]);
eq("  the received request's log gains the defect (its earlier entries kept)", [JSON.parse(d.logRow.request_log).map((e) => e.op), JSON.parse(d.logRow.request_log).slice(-1)[0].defects],
  [["CREATE", "DEFECT"], { 11: { qty: "2", reason: "Damaged" } }]);
eq("DEFECT more than held at the staging bin -> 400", pick(defect({ 11: { qty: "8", reason: "Damaged" } })), ["ANSWER", "400"]);
eq("DEFECT of nothing (every quantity 0) -> 400, no engine call", pick(defect({ 11: { qty: "0", reason: "" } })), ["ANSWER", "400"]);
eq("DEFECT without a reason -> 400", pick(defect({ 11: { qty: "1", reason: "" } })), ["ANSWER", "400"]);
eq("DEFECT before any receipt -> 400", pick(defect({ 11: { qty: "1", reason: "Damaged" } }, { reqs: [req("2114000000000000701", "In Progress")] })), ["ANSWER", "400"]);
eq("DEFECT with the setup off still works (D13)", pick(defect({ 11: { qty: "1", reason: "Damaged" } }, { setupRows: OFF })), ["GO", "200"]);
d = defect({ 12: { batches: { BT1: "1" }, reason: "Wet" } });
eq("DEFECT of a batch: that batch's hold and pick", [pick(d), d.defect.moves.map((m) => [m.batch_id, m.quantity]), d.movements[0].batch_id], [["GO", "200"], [["BT1", "1"]], "BT1"]);
eq("defects: the payload's shape", [R.iatrDefectsOf('{"11":{"qty":"2","reason":" Damaged "}}'), R.iatrDefectsOf("[1]").ok, R.iatrDefectsOf('{"x":{"qty":1}}').ok,
  R.iatrDefectsOf('{"11":{"qty":"-1","reason":"R"}}').ok, R.iatrDefectsOf('{"11":{"batches":{"B1":"1"},"reason":"R"}}').ok, R.iatrDefectsOf("{}").ok,
  R.iatrDefectsOf('{"11":{"qty":"1","reason":"' + "x".repeat(256) + '"}}').ok],
  [{ ok: true, defects: { 11: { reason: "Damaged", qty: "2" } } }, false, false, false, false, false, false]);

// ================================================================ STATUS
let s = D({ op: "STATUS", reqs: got, holds: atStg }).result;
eq("STATUS: the current request, the history, the setup, what may be done", [s.request.id, s.history.length, s.setup_on, s.can_create, s.can_replace, s.staging],
  ["2114000000000000701", 1, "YES", "NO", "YES", { sl: "S1", bin: "BIN9" }]);
eq("  the gap after a receipt (demand - reserved, D11): line 11 lacks 3", s.gap, [{ iaLineId: "11", missing: "3" }]);
eq("  nothing reserved away from the staging bin yet: no replacement to send", s.replace_ready, "NO");
s = D({ op: "STATUS", reqs: got, holds: atStg.concat([hold("h8", "11", "A", "W2", 3)]) }).result;
eq("STATUS after the missing quantity is reserved (a Created save): the replacement can be sent, nothing missing", [s.replace_ready, s.gap], ["YES", []]);
eq("STATUS with a replacement open: nothing to send", D({ op: "STATUS", reqs: got.concat([req("2114000000000000702", "Requested")]),
  holds: atStg.concat([hold("h8", "11", "A", "W2", 3)]) }).result.replace_ready, "NO");
s = D({ op: "STATUS", reqs: [req("2114000000000000701", "Requested", { fp: fp0 })] }).result;
eq("STATUS of a Requested request, the reservation unchanged -> not stale", [s.request.stale, s.can_create], ["NO", "NO"]);
s = D({ op: "STATUS", reqs: [req("2114000000000000701", "Requested", { fp: fp0 })], holds: [hold("h1", "11", "A", "W1", 6)] }).result;
eq("  the reservation changed -> stale (refresh)", s.request.stale, "YES");
s = D({ op: "STATUS", setupRows: OFF }).result;
eq("STATUS with the setup off and no request: may not create", [s.setup_on, s.can_create, s.request], ["NO", "NO", null]);

// ================================================================ the claim winner
const NOW = "2026-10-30 12:00:00";
const claim = (id, name, at) => ({ id: id, name: name, started_at: at || NOW });
const st = (o) => Object.assign({ claims: [claim("c1", "CLAIM|4")], status: "Created", reqs: [], openJobs: 0, now: NOW }, o || {});
eq("win: ours, the IA still Created", R.iatrWin2("CREATE", "CLAIM|4", st(), "0").route, "WIN");
eq("win: the IA no longer Created -> LOSE", R.iatrWin2("CREATE", "CLAIM|4", st({ status: "Completed" }), "0").route, "LOSE");
eq("win: a request appeared meanwhile -> LOSE (CREATE, REPLACE)", [R.iatrWin2("CREATE", "CLAIM|4", st({ reqs: [{ id: "9", status: "Requested" }] }), "0").route,
  R.iatrWin2("REPLACE", "CLAIM|4", st({ reqs: [{ id: "8", status: "Completed" }, { id: "9", status: "Requested" }] }), "0").route], ["LOSE", "LOSE"]);
eq("win: REPLACE needs its receipt still there", R.iatrWin2("REPLACE", "CLAIM|4", st({ reqs: [] }), "0").route, "LOSE");
eq("win: an older live claim -> LOSE", R.iatrWin2("CREATE", "CLAIM|4", st({ claims: [claim("c0", "CLAIM|3"), claim("c1", "CLAIM|4")] }), "0").route, "LOSE");
eq("win: REFRESH, the named request no longer Requested -> LOSE", R.iatrWin2("REFRESH", "CLAIM|4", st({ reqs: [{ id: "7", status: "In Progress" }] }), "7").route, "LOSE");
eq("win: CANCEL of an IA that is Completed still goes on (state only)", R.iatrWin2("CANCEL", "CLAIM|4", st({ status: "Completed", reqs: [{ id: "7", status: "Requested" }] }), "7").route, "WIN");

// ================================================================ the summary (the IA form's scAllocate format)
eq("summary", R.iatrSummary([pk("BIN9", 5), pk("BIN9", 1.5, { batch_id: "BT1" })], "PCS", { BIN9: "PROD-01" }, { BT1: "B-001" }),
  "Total: 6.5 PCS\n\nDETAILS:\n1. PROD-01: 5 PCS (UNR)\n2. PROD-01: 1.5 PCS (UNR)\n[B-001]");

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
