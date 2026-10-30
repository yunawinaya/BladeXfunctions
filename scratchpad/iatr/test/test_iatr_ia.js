// IA -> Location Transfer Request (ENH-20261027-001): the Item Assembly side's rules (code/shared/iatr_ia.js, loaded after
// iatr_rules.js the way the workflow's code nodes include them): the IA1 fingerprint, the requests of an IA, the request lines, the
// audit log, each operation's decision and the claim winner.
//   node scratchpad/iatr/test/test_iatr_ia.js   (IATR_IA=<file> tests another copy of iatr_ia.js: mutants_iatr_ia.js)
const fs = require("fs");
const path = require("path");
const SHARED = path.join(__dirname, "..", "code", "shared");
const strip = (t) => t.split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const src = strip(fs.readFileSync(path.join(SHARED, "iatr_rules.js"), "utf8")) + "\n" + strip(fs.readFileSync(process.env.IATR_IA || path.join(SHARED, "iatr_ia.js"), "utf8"));
const R = new Function(src + "\nreturn { iatrIaFp, iatrBasis, iatrNewest, iatrRequests, iatrLotLines, iatrLog, iatrDate, iatrDecide, iatrWin, iatrDemand, iatrFingerprint, IATR_LEASE_MS };")();

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1500) + "\n  want " + JSON.stringify(want).slice(0, 1500));
};
const yes = (label, v) => eq(label, !!v, true);

const IA = { id: "2113088440365826050", status: "Draft", hold: "", plant: "P1", org: "O1", no: "IA-2610-001", item_id: "FG", item_qty: "10", planned_output_qty: "10",
  bom_consumption_mode: "FLAT", source_bom_id: "BOM1" };
const L = () => [
  { id: "11", item_selection: "A", item_name: "SFG-A (IA)", quantity_uom: "77", requested_qty: "10", required_qty: null, sc_ref_key: "A|77", line_index: "1" },
  { id: "12", item_selection: "B", item_name: "RM-B", quantity_uom: "77", requested_qty: "4", required_qty: "6", sc_ref_key: "B|77", line_index: "2" },
  { id: "13", item_selection: "LAB", item_name: "Labour", quantity_uom: "77", requested_qty: "1", required_qty: null, sc_ref_key: "", line_index: "3" },
];
const ITEMS = [{ id: "A", stock_control: 1, serial_number_management: 0, material_name: "SFG-A", material_desc: "Sub-assembly A" },
  { id: "B", stock_control: 1, serial_number_management: 0, material_name: "RM-B", material_desc: "" }, { id: "LAB", stock_control: 0, serial_number_management: 0, material_name: "Labour" }];
const UOMS = { A: [{ id: "77", uom_name: "PCS" }], B: [{ id: "77", uom_name: "PCS" }, { id: "78", uom_name: "BOX" }] };
const SL = { id: "S1", plant: "P1", active: 1, name: "PROD" };
const BIN = { id: "BIN9", plant: "P1", sl: "S1", active: 1, name: "PROD-01" };
const fpIa = (ia, lines) => R.iatrIaFp(R.iatrBasis(ia), lines);
const inp = (o) => Object.assign({ op: "CREATE", ia: IA, iaLines: L(), items: ITEMS, uoms: UOMS, reqs: [], named: null, sl: SL, bin: BIN, member: 1, org: "O1", rule: "R1",
  expectFp: fpIa(IA, L()), storage: "S1", binId: "BIN9", requiredDate: "2026-10-30" }, o || {});
const itemMap = {};
for (const it of ITEMS) itemMap[it.id] = it;
const demand = R.iatrDemand(L(), itemMap).lines;
const fpReq = (ia, d, sl, bin) => R.iatrFingerprint(d, Object.assign(R.iatrBasis(ia), { storage: sl, bin: bin }));
const D = (o) => R.iatrDecide(inp(o));
const pick = (r) => [r.route, r.code];

// ================================================================ IA1 fingerprint (the screen's IA vs the stored one)
const f0 = fpIa(IA, L());
yes("IA1: shape", /^IA1:3:[0-9a-f]{16}$/.test(f0));
eq("IA1: line order does not matter", fpIa(IA, L().reverse()), f0);
eq("IA1: quantities as text, numbers or fixed decimals are one", fpIa(Object.assign({}, IA, { item_qty: 10 }), L().map((l) => Object.assign(l, { requested_qty: Number(l.requested_qty) }))), f0);
eq("IA1: a blank Required, null or empty, is one", fpIa(IA, L().map((l) => (l.id === "11" ? Object.assign(l, { required_qty: "" }) : l))), f0);
yes("IA1: a blank Required differs from an explicit 0", fpIa(IA, L().map((l) => (l.id === "11" ? Object.assign(l, { required_qty: "0" }) : l))) !== f0);
yes("IA1: a changed Required shows", fpIa(IA, L().map((l) => (l.id === "12" ? Object.assign(l, { required_qty: "7" }) : l))) !== f0);
yes("IA1: a changed BOM reference shows", fpIa(IA, L().map((l) => (l.id === "11" ? Object.assign(l, { requested_qty: "9" }) : l))) !== f0);
yes("IA1: an unsaved new line (no id) shows", fpIa(IA, L().concat([{ id: "", item_selection: "B", quantity_uom: "77", requested_qty: "1" }])) !== f0);
yes("IA1: a removed line shows", fpIa(IA, L().slice(0, 2)) !== f0);
yes("IA1: another unit shows", fpIa(IA, L().map((l) => (l.id === "12" ? Object.assign(l, { quantity_uom: "78" }) : l))) !== f0);
yes("IA1: another item shows", fpIa(IA, L().map((l) => (l.id === "12" ? Object.assign(l, { item_selection: "A" }) : l))) !== f0);
for (const [k, v] of [["plant", "P2"], ["item_id", "FG2"], ["item_qty", "11"], ["planned_output_qty", "11"], ["bom_consumption_mode", "STANDARD"], ["source_bom_id", "BOM2"]]) {
  yes("IA1: another header " + k + " shows", fpIa(Object.assign({}, IA, { [k]: v }), L()) !== f0);
}
eq("IA1: the mode trimmed", fpIa(Object.assign({}, IA, { bom_consumption_mode: " FLAT " }), L()), f0);

// ================================================================ requests of an IA, the log, the date
const reqs = [{ id: "2114000000000000003", no: "LOT-3", status: "Cancelled" }, { id: "999", no: "LOT-0", status: "Cancelled" },
  { id: "2114000000000000010", no: "LOT-10", status: "Requested" }, { id: "2114000000000000002", no: "LOT-2", status: "Completed" }];
const rq = R.iatrRequests(reqs);
eq("requests: newest first by snowflake id (length, then text)", rq.all.map((r) => r.no), ["LOT-10", "LOT-3", "LOT-2", "LOT-0"]);
eq("requests: the live one, the received one, the latest cancelled", [rq.live.no, rq.received.no, rq.cancelled.no, rq.latest.no], ["LOT-10", "LOT-2", "LOT-3", "LOT-10"]);
eq("requests: In Progress and Processing are live", ["In Progress", "Processing"].map((s) => R.iatrRequests([{ id: "1", status: s }]).live !== null), [true, true]);
eq("requests: none", [R.iatrRequests(null).live, R.iatrRequests([]).latest], [null, null]);
eq("log: an entry appended to the stored log", JSON.parse(R.iatrLog('[{"op":"CREATE"}]', { op: "REFRESH" })), [{ op: "CREATE" }, { op: "REFRESH" }]);
eq("log: an empty log", JSON.parse(R.iatrLog(null, { op: "CREATE" })), [{ op: "CREATE" }]);
eq("log: an unreadable log is kept, as text", JSON.parse(R.iatrLog("oops", { op: "CANCEL" })), [{ op: "UNREADABLE", text: "oops" }, { op: "CANCEL" }]);
eq("log: a non-array log is kept, as text", JSON.parse(R.iatrLog('{"a":1}', { op: "CANCEL" })), [{ op: "UNREADABLE", text: '{"a":1}' }, { op: "CANCEL" }]);
eq("date: YYYY-MM-DD only", ["2026-10-30", "2026-13-01", "30/10/2026", "", "2026-02-30x"].map(R.iatrDate), [true, false, false, false, false]);
eq("date: a real calendar day (the datetime column refuses the rest)", ["2026-02-30", "2026-02-28", "2028-02-29", "2027-02-29", "+002026-10-30", "2026-10-3"].map(R.iatrDate),
  [false, true, true, false, false, false]);

// ================================================================ CREATE
let r = D();
eq("CREATE: goes on", pick(r), ["GO", "200"]);
eq("  the demand fingerprint (IR2) with the destination", r.fp, fpReq(IA, demand, "S1", "BIN9"));
eq("  revision 1, 2 lines (the labour line is not stock), nothing replaced", [r.rev, r.lines, r.replacesId], [1, 2, ""]);
eq("  the request lines", r.lineRows.map((l) => [l.item_selection, l.item_name, l.item_desc, l.quantity_uom, l.requested_qty, l.total_quantity, l.storage_location_id, l.location_id,
  l.source_ia_line_id, l.source_ref_key, l.line_index, l.uom_options.length, l.temp_qty_data, l.temp_hu_data, l.balance_id, l.stock_summary, l.organization_id, l.issuing_plant]),
[["A", "SFG-A (IA)", "Sub-assembly A", "77", "10.00000000", "0.00000000", "S1", "BIN9", "11", "A|77", "1", 1, "", "[]", "", "", "O1", "P1"],
  ["B", "RM-B", "", "77", "6.00000000", "0.00000000", "S1", "BIN9", "12", "B|77", "2", 2, "", "[]", "", "", "O1", "P1"]]);
eq("CREATE: not a member -> 400", pick(D({ member: 0 })), ["ANSWER", "400"]);
// the member read counts the user's departments in the organisation: admin@711077 is in the org and its plant (2, live 10-28)
eq("CREATE: a member through 2 departments -> goes on", pick(D({ member: 2 })), ["GO", "200"]);
// the membership is read for the request's organisation: an IA of another organisation is refused (spec IA-LT-09, security review 10-28)
eq("CREATE: a member of the request's organisation, an IA of another -> 400", pick(D({ org: "O2" })), ["ANSWER", "400"]);
eq("CREATE: no request organisation -> 400", pick(D({ org: "" })), ["ANSWER", "400"]);
eq("CREATE: no IA -> 400", pick(D({ ia: null })), ["ANSWER", "400"]);
for (const st of ["Created", "Processing", "Completed", "Cancelled"]) {
  r = D({ ia: Object.assign({}, IA, { status: st }), expectFp: fpIa(Object.assign({}, IA, { status: st }), L()) });
  eq("CREATE: an IA " + st + " -> 400, says Draft", [pick(r), /Draft/.test(r.message)], [["ANSWER", "400"], true]);
}
for (const h of ["RESERVING", "SHORT", "PARTIAL", "FULL"]) eq("CREATE: material hold " + h + " -> 400", pick(D({ ia: Object.assign({}, IA, { hold: h }) })), ["ANSWER", "400"]);
for (const h of ["", null, "NONE", "none", "CLOSED"]) eq("CREATE: material hold " + JSON.stringify(h) + " -> goes on", D({ ia: Object.assign({}, IA, { hold: h }) }).route, "GO");
eq("CREATE: no output quantity -> 400", pick(D({ ia: Object.assign({}, IA, { item_qty: "0" }), expectFp: fpIa(Object.assign({}, IA, { item_qty: "0" }), L()) })), ["ANSWER", "400"]);
r = D({ expectFp: fpIa(IA, L().map((l) => (l.id === "12" ? Object.assign(l, { required_qty: "7" }) : l))) });
eq("CREATE: the screen's IA differs from the stored one -> 409, save first", [pick(r), /unsaved/.test(r.message)], [["ANSWER", "409"], true]);
eq("CREATE: no fingerprint sent -> 409", pick(D({ expectFp: "" })), ["ANSWER", "409"]);
const noReq = L().map((l) => (l.id === "11" ? Object.assign(l, { requested_qty: "0" }) : l));
r = D({ iaLines: noReq, expectFp: fpIa(IA, noReq) });
eq("CREATE: a line without a requirement -> 400 naming it", [pick(r), /line 1/.test(r.message)], [["ANSWER", "400"], true]);
for (const st of ["Requested", "In Progress", "Processing"]) {
  r = D({ reqs: [{ id: "2114000000000000010", no: "LOT-10", status: st }] });
  eq("CREATE: a live request (" + st + ") -> 200, the existing request", [pick(r), r.result.existing, r.result.request.no], [["ANSWER", "200"], "YES", "LOT-10"]);
}
r = D({ reqs: [{ id: "2114000000000000002", no: "LOT-2", status: "Completed" }] });
eq("CREATE: a received request -> 409 (no second full request)", [pick(r), /received/.test(r.message)], [["ANSWER", "409"], true]);
r = D({ reqs: [{ id: "2114000000000000003", no: "LOT-3", status: "Cancelled" }, { id: "2114000000000000001", no: "LOT-1", status: "Cancelled" }] });
eq("CREATE: only cancelled requests -> goes on, replacing the latest", [r.route, r.replacesId], ["GO", "2114000000000000003"]);
for (const [why, o] of [["inactive", { active: 0 }], ["of another plant", { plant: "P2" }], ["of another storage location", { sl: "S2" }], ["not the chosen one", { id: "BIN8" }]]) {
  eq("CREATE: a bin " + why + " -> 400", pick(D({ bin: Object.assign({}, BIN, o) })), ["ANSWER", "400"]);
}
eq("CREATE: no bin -> 400", pick(D({ bin: null })), ["ANSWER", "400"]);
for (const [why, o] of [["inactive", { active: 0 }], ["of another plant", { plant: "P2" }], ["not the chosen one", { id: "S9" }]]) {
  eq("CREATE: a storage location " + why + " -> 400", pick(D({ sl: Object.assign({}, SL, o) })), ["ANSWER", "400"]);
}
eq("CREATE: no required date -> 400", pick(D({ requiredDate: "" })), ["ANSWER", "400"]);
eq("CREATE: a bad required date -> 400", pick(D({ requiredDate: "2026-10-32" })), ["ANSWER", "400"]);
eq("CREATE: no number rule -> 400", pick(D({ rule: "" })), ["ANSWER", "400"]);
eq("an unknown operation -> 400", pick(D({ op: "DELETE" })), ["ANSWER", "400"]);

// ================================================================ REFRESH
const FP0 = fpReq(IA, demand, "S1", "BIN9");
const stored = (d) => d.map((x, i) => ({ id: "50" + i, item_selection: x.item_selection, quantity_uom: x.quantity_uom, requested_qty: x.requested_qty,
  source_ia_line_id: x.source_ia_line_id, storage_location_id: "S1", location_id: "BIN9", temp_qty_data: "" }));
const named = (o) => Object.assign({ id: "2114000000000000010", no: "LOT-10", status: "Requested", purpose: "IA_SUPPLY", source: IA.id, fp: FP0, rev: 1, log: "[]", sl: "S1",
  bin: "BIN9", lines: stored(demand), openJobs: 0, openTransit: 0 }, o || {});
const changed = L().map((l) => (l.id === "12" ? Object.assign(l, { required_qty: "8" }) : l));
const RF = (o) => D(Object.assign({ op: "REFRESH", iaLines: changed, expectFp: fpIa(IA, changed), named: named() }, o || {}));
r = RF();
const demand2 = R.iatrDemand(changed, itemMap).lines;
eq("REFRESH: the IA changed -> goes on", pick(r), ["GO", "200"]);
eq("  the new fingerprint at the request's destination, revision + 1, the request named", [r.fp, r.rev, r.lotId, r.lotNo], [fpReq(IA, demand2, "S1", "BIN9"), 2, "2114000000000000010", "LOT-10"]);
eq("  the new lines at the request's destination, nothing picked", r.lineRows.map((l) => [l.source_ia_line_id, l.requested_qty, l.storage_location_id, l.location_id, l.temp_qty_data]),
  [["11", "10.00000000", "S1", "BIN9", ""], ["12", "8.00000000", "S1", "BIN9", ""]]);
r = RF({ iaLines: L(), expectFp: fpIa(IA, L()) });
eq("REFRESH: nothing changed -> 200, already matches, no write", [pick(r), r.result.already], [["ANSWER", "200"], "YES"]);
r = RF({ iaLines: L(), expectFp: fpIa(IA, L()), named: named({ lines: stored(demand).map((l, i) => (i ? Object.assign(l, { requested_qty: 4 }) : l)) }) });
eq("REFRESH: the fingerprint matches but the stored lines don't (a stale tab saved older lines) -> goes on", r.route, "GO");
eq("REFRESH: a request of another IA -> 400", pick(RF({ named: named({ source: "9" }) })), ["ANSWER", "400"]);
eq("REFRESH: an ordinary transfer -> 400", pick(RF({ named: named({ purpose: "" }) })), ["ANSWER", "400"]);
eq("REFRESH: no request -> 400", pick(RF({ named: null })), ["ANSWER", "400"]);
for (const st of ["In Progress", "Completed", "Cancelled", "Processing"]) eq("REFRESH: a request " + st + " -> 400", pick(RF({ named: named({ status: st }) })), ["ANSWER", "400"]);
eq("REFRESH: an open background job -> 409", pick(RF({ named: named({ openJobs: 1 }) })), ["ANSWER", "409"]);
eq("REFRESH: open In Transit rows -> 409", pick(RF({ named: named({ openTransit: 2 }) })), ["ANSWER", "409"]);
eq("REFRESH: the IA no longer Draft -> 400", pick(RF({ ia: Object.assign({}, IA, { status: "Created" }) })), ["ANSWER", "400"]);
eq("REFRESH: the screen's IA is not the stored one -> 409", pick(RF({ expectFp: fpIa(IA, L()) })), ["ANSWER", "409"]);

// ================================================================ CANCEL
const CN = (o) => D(Object.assign({ op: "CANCEL", named: named(), expectFp: "" }, o || {}));
r = CN();
eq("CANCEL: a Requested request -> goes on", [pick(r), r.lotId, r.lotNo], [["GO", "200"], "2114000000000000010", "LOT-10"]);
eq("CANCEL: whatever the IA's status (the request is production's)", CN({ ia: Object.assign({}, IA, { status: "Completed" }) }).route, "GO");
r = CN({ named: named({ status: "Cancelled" }) });
eq("CANCEL: already cancelled -> 200, no write", [pick(r), r.result.already], [["ANSWER", "200"], "YES"]);
r = CN({ named: named({ status: "In Progress" }) });
eq("CANCEL: a dispatched request -> 400, cancelled from the Location Transfer list", [pick(r), /Location Transfer list/.test(r.message)], [["ANSWER", "400"], true]);
eq("CANCEL: Processing -> 400", pick(CN({ named: named({ status: "Processing" }) })), ["ANSWER", "400"]);
eq("CANCEL: an open background job -> 409", pick(CN({ named: named({ openJobs: 1 }) })), ["ANSWER", "409"]);
eq("CANCEL: open In Transit rows -> 409", pick(CN({ named: named({ openTransit: 1 }) })), ["ANSWER", "409"]);
eq("CANCEL: a request of another IA -> 400", pick(CN({ named: named({ source: "9" }) })), ["ANSWER", "400"]);
eq("CANCEL: not a member -> 400", pick(CN({ member: 0 })), ["ANSWER", "400"]);
eq("CANCEL: a member through 2 departments -> goes on", CN({ member: 2 }).route, "GO");
eq("CANCEL: an IA of another organisation -> 400", pick(CN({ org: "O2" })), ["ANSWER", "400"]);
// the user, 10-29: an IA deleted with its request live (the mobile delete does not ask) - the request can still be cancelled (state only), by a
// user of the request's own organisation; nothing else works without the IA
const orphan = (o) => CN(Object.assign({ ia: null, iaId: IA.id, named: named({ org: "O1" }) }, o || {}));
r = orphan();
eq("CANCEL, its IA deleted: a Requested request -> goes on", [pick(r), r.lotId], [["GO", "200"], "2114000000000000010"]);
eq("CANCEL, its IA deleted: a request of another organisation -> 400", pick(orphan({ named: named({ org: "O2" }) })), ["ANSWER", "400"]);
eq("CANCEL, its IA deleted: the request's organisation unknown -> 400", pick(orphan({ named: named({ org: "" }) })), ["ANSWER", "400"]);
eq("CANCEL, its IA deleted: a request of another IA -> 400", pick(orphan({ iaId: "9" })), ["ANSWER", "400"]);
eq("CANCEL, its IA deleted: a dispatched request -> 400 (cancelled from the list)", pick(orphan({ named: named({ org: "O1", status: "In Progress" }) })), ["ANSWER", "400"]);
eq("CANCEL, its IA deleted: not a member -> 400", pick(orphan({ member: 0 })), ["ANSWER", "400"]);
eq("CANCEL, its IA deleted: no request named -> 400", pick(orphan({ named: null })), ["ANSWER", "400"]);
for (const op of ["CREATE", "REFRESH", "STATUS"]) eq(op + ", its IA deleted: not found", [pick(D({ op: op, ia: null, iaId: IA.id, named: named({ org: "O1" }) })), /not found/.test(D({ op: op, ia: null }).message)], [["ANSWER", "400"], true]);

// ================================================================ STATUS
const ST = (o) => D(Object.assign({ op: "STATUS", expectFp: "" }, o || {}));
r = ST({ reqs: [named()] });
eq("STATUS: a Requested request, the IA unchanged -> not stale, no new request", [pick(r), r.result.request.no, r.result.request.stale, r.result.can_create],
  [["ANSWER", "200"], "LOT-10", "NO", "NO"]);
r = ST({ reqs: [named()], iaLines: changed });
eq("STATUS: the IA changed -> stale", r.result.request.stale, "YES");
r = ST({ reqs: [named({ sl: "S2" })] });
eq("STATUS: stale against the request's own destination", r.result.request.stale, "YES");
r = ST({ reqs: [named()], iaLines: noReq });
eq("STATUS: the IA's demand no longer valid -> stale", r.result.request.stale, "YES");
r = ST({ reqs: [named({ status: "In Progress" })], iaLines: changed });
eq("STATUS: a dispatched request is never stale (it can't be refreshed)", r.result.request.stale, "NO");
r = ST({ reqs: [named({ status: "Completed" })] });
// the user, 10-29: a received request's IA re-picks from the staging bin by itself - the answer names that destination
eq("STATUS: the request's staging storage location and bin", [r.result.request.sl, r.result.request.bin], ["S1", "BIN9"]);
r = ST({ reqs: [] });
eq("STATUS: no request -> can create", [r.result.request, r.result.can_create, r.result.history], [null, "YES", []]);
r = ST({ reqs: [named({ status: "Cancelled" }), named({ id: "2114000000000000020", no: "LOT-20", status: "Cancelled" })] });
eq("STATUS: only cancelled -> the latest shown, can create", [r.result.request.no, r.result.can_create, r.result.history.map((h) => h.no)], ["LOT-20", "YES", ["LOT-20", "LOT-10"]]);
r = ST({ reqs: [named({ status: "Completed" }), named({ id: "2114000000000000020", no: "LOT-20", status: "Cancelled" })] });
eq("STATUS: a received request shown before a newer cancelled one, no new request", [r.result.request.no, r.result.can_create], ["LOT-10", "NO"]);
eq("STATUS: not a member -> 400", pick(ST({ member: 0 })), ["ANSWER", "400"]);
eq("STATUS: a member through 2 departments -> answered", pick(ST({ reqs: [named()], member: 2 })), ["ANSWER", "200"]);
eq("STATUS: an IA of another organisation -> 400, its requests not shown", [pick(ST({ reqs: [named()], org: "O2" })), ST({ reqs: [named()], org: "O2" }).result],
  [["ANSWER", "400"], {}]);

// ================================================================ the claim winner
const NOW = "2026-10-28 12:00:00";
const st = (claims, o) => Object.assign({ now: NOW, claims: claims, status: "Draft", reqs: [], openJobs: 0 }, o || {});
const cl = (nm, at, id) => ({ id: id || nm, name: nm, started_at: at || NOW });
eq("win: ours is the only live claim", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|3")]), "").route, "WIN");
eq("win: a lower live claim wins", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|2", "2026-10-28 11:59:00"), cl("CLAIM|3")]), "").route, "LOSE");
eq("win: a lower claim past the lease is a dead run", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|2", "2026-10-28 11:49:59"), cl("CLAIM|3")]), "").route, "WIN");
eq("win: claim numbers compare as numbers (10 after 9)", R.iatrWin("CREATE", "CLAIM|10", st([cl("CLAIM|9"), cl("CLAIM|10")]), "").route, "LOSE");
eq("win: our claim not read back -> lose", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|2")]), "").route, "LOSE");
eq("win: CREATE, the IA no longer Draft -> lose", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|3")], { status: "Created" }), "").route, "LOSE");
eq("win: CREATE, a live request appeared -> lose", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|3")], { reqs: [{ id: "5", status: "Requested" }] }), "").route, "LOSE");
eq("win: CREATE, a received request appeared -> lose", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|3")], { reqs: [{ id: "5", status: "Completed" }] }), "").route, "LOSE");
eq("win: CREATE, only cancelled requests -> win", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|3")], { reqs: [{ id: "5", status: "Cancelled" }] }), "").route, "WIN");
const rs = [{ id: "5", status: "Requested" }];
eq("win: REFRESH, the request still Requested -> win", R.iatrWin("REFRESH", "CLAIM|3", st([cl("CLAIM|3")], { reqs: rs }), "5").route, "WIN");
eq("win: REFRESH, dispatched meanwhile -> lose", R.iatrWin("REFRESH", "CLAIM|3", st([cl("CLAIM|3")], { reqs: [{ id: "5", status: "Processing" }] }), "5").route, "LOSE");
eq("win: REFRESH, a job opened meanwhile -> lose", R.iatrWin("REFRESH", "CLAIM|3", st([cl("CLAIM|3")], { reqs: rs, openJobs: 1 }), "5").route, "LOSE");
eq("win: REFRESH, the IA no longer Draft -> lose", R.iatrWin("REFRESH", "CLAIM|3", st([cl("CLAIM|3")], { reqs: rs, status: "Completed" }), "5").route, "LOSE");
eq("win: CANCEL, whatever the IA's status", R.iatrWin("CANCEL", "CLAIM|3", st([cl("CLAIM|3")], { reqs: rs, status: "Completed" }), "5").route, "WIN");
eq("win: CANCEL, the request gone -> lose", R.iatrWin("CANCEL", "CLAIM|3", st([cl("CLAIM|3")], { reqs: [] }), "5").route, "LOSE");
eq("win: the winner's claim id", R.iatrWin("CREATE", "CLAIM|3", st([cl("CLAIM|3", NOW, "77")]), "").claimId, "77");

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
