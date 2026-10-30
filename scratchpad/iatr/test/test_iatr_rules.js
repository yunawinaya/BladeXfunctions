// IA -> Location Transfer Request (ENH-20261027-001): the shared rules (code/shared/iatr_rules.js) - the demand an IA asks
// for, its fingerprint, the dispatch check and the allowed moves of a request LOT.
//   node scratchpad/iatr/test/test_iatr_rules.js
const path = require("path");
const R = require(path.join(__dirname, "..", "code", "shared", "iatr_rules.js"));

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
};
const yes = (label, v) => eq(label, !!v, true);

const items = {
  A: { id: "A", material_name: "SFG-A", stock_control: 1, serial_number_management: 0 },
  B: { id: "B", material_name: "RM-B", stock_control: 1, serial_number_management: 0 },
  L: { id: "L", material_name: "LABOUR", stock_control: 0, serial_number_management: 0 },
  S: { id: "S", material_name: "SERIAL-S", stock_control: 1, serial_number_management: 1 },
};
const line = (id, item, o) => Object.assign({ id: id, item_selection: item, quantity_uom: "77", requested_qty: "0", required_qty: null, required_manual: "",
  total_quantity: "0", sc_ref_key: item + "|77", line_index: id }, o || {});

// ================================================================ demand (spec IA-LT-07)
let d = R.iatrDemand([line("11", "A", { requested_qty: "10" }), line("12", "B", { requested_qty: "4", required_qty: "6" }), line("13", "L", { requested_qty: "1" })], items);
eq("demand: required_qty first, else requested_qty; non-stock skipped; line ids kept", [d.ok, d.lines.map((l) => [l.source_ia_line_id, l.item_selection, l.quantity_uom, l.requested_qty, l.source_ref_key])],
  [true, [["11", "A", "77", 10, "A|77"], ["12", "B", "77", 6, "B|77"]]]);
d = R.iatrDemand([line("11", "A", { requested_qty: "10", required_qty: "0", required_manual: "1" }), line("12", "B", { requested_qty: "4" })], items);
eq("demand: an explicit zero requirement is excluded, not replaced by the BOM reference", d.lines.map((l) => l.source_ia_line_id), ["12"]);
d = R.iatrDemand([line("11", "A", { requested_qty: "0", total_quantity: "5" })], items);
eq("demand: a line with no requirement stops, naming it (never the picked quantity)", [d.ok, /line 11/.test(d.message), /SFG-A/.test(d.message)], [false, true, true]);
d = R.iatrDemand([line("11", "A", { required_qty: "-1" })], items);
eq("demand: a negative requirement stops", d.ok, false);
d = R.iatrDemand([line("11", "S", { requested_qty: "2" })], items);
eq("demand: a serial component stops (the background transfer cannot take serials)", [d.ok, /serial/i.test(d.message)], [false, true]);
d = R.iatrDemand([line("13", "L", { requested_qty: "1" })], items);
eq("demand: nothing to request stops", [d.ok, /nothing/i.test(d.message)], [false, true]);
d = R.iatrDemand([line("11", "A", { requested_qty: "2" }), line("12", "A", { requested_qty: "3" })], items);
eq("demand: the same item on two lines stays two lines", d.lines.map((l) => [l.source_ia_line_id, l.requested_qty]), [["11", 2], ["12", 3]]);
d = R.iatrDemand([line("11", "A", { requested_qty: "0.1" }), line("12", "B", { required_qty: "0.30000000000000004" })], items);
eq("demand: quantities at 8 decimals", d.lines.map((l) => l.requested_qty), [0.1, 0.3]);
d = R.iatrDemand([line("11", "A", { requested_qty: "1" }), line("12", "Z", { requested_qty: "1" })], items);
eq("demand: an item that cannot be read stops (never skipped)", [d.ok, /could not be read/.test(d.message)], [false, true]);

// ================================================================ fingerprint (spec IA-LT-11: lines, items, units, requirements, BOM context,
// output basis, plant, destination)
const dl = R.iatrDemand([line("11", "A", { requested_qty: "10" }), line("12", "B", { requested_qty: "4" })], items).lines;
const basis = (o) => Object.assign({ plant: "P1", storage: "S1", bin: "BIN9", itemId: "FG", itemQty: "10", plannedQty: "10", mode: "FLAT", bomId: "BOM1" }, o || {});
const fp = R.iatrFingerprint(dl, basis());
yes("fingerprint: IR2 shape", /^IR2:2:[0-9a-f]{16}$/.test(fp));
eq("fingerprint: stable", R.iatrFingerprint(dl, basis()), fp);
yes("fingerprint: a quantity change shows", R.iatrFingerprint([dl[0], Object.assign({}, dl[1], { requested_qty: 5 })], basis()) !== fp);
yes("fingerprint: another bin shows", R.iatrFingerprint(dl, basis({ bin: "BIN8" })) !== fp);
yes("fingerprint: another storage location shows", R.iatrFingerprint(dl, basis({ storage: "S2" })) !== fp);
yes("fingerprint: another plant shows", R.iatrFingerprint(dl, basis({ plant: "P2" })) !== fp);
yes("fingerprint: another finished item shows", R.iatrFingerprint(dl, basis({ itemId: "FG2" })) !== fp);
yes("fingerprint: another output quantity shows", R.iatrFingerprint(dl, basis({ itemQty: "12" })) !== fp);
yes("fingerprint: another planned output shows", R.iatrFingerprint(dl, basis({ plannedQty: "12" })) !== fp);
yes("fingerprint: another BOM mode shows", R.iatrFingerprint(dl, basis({ mode: "STANDARD" })) !== fp);
yes("fingerprint: another BOM shows", R.iatrFingerprint(dl, basis({ bomId: "BOM2" })) !== fp);
yes("fingerprint: the line order does not matter (line ids identify)", R.iatrFingerprint([dl[1], dl[0]], basis()) === fp);
yes("fingerprint: a line id swap shows", R.iatrFingerprint([Object.assign({}, dl[0], { source_ia_line_id: "99" }), dl[1]], basis()) !== fp);
eq("fingerprint: quantities and blanks as stored or as typed are one basis", R.iatrFingerprint(dl, basis({ itemQty: 10, plannedQty: "10.00000000", mode: " FLAT " })), fp);
eq("fingerprint: no planned output, null or blank, is one basis", R.iatrFingerprint(dl, basis({ plannedQty: null })), R.iatrFingerprint(dl, basis({ plannedQty: "" })));
yes("fingerprint: no planned output differs from zero planned", R.iatrFingerprint(dl, basis({ plannedQty: "" })) !== R.iatrFingerprint(dl, basis({ plannedQty: "0" })));
yes("fingerprint: no basis at all still hashes (an unreadable IA never matches a real request)", /^IR2:2:/.test(R.iatrFingerprint(dl, null)));

// ================================================================ dispatch check (spec sections 7 / 10, U10 U12 U21 U25)
const stored = [
  { id: "501", item_selection: "A", quantity_uom: "77", requested_qty: "10", source_ia_line_id: "11", storage_location_id: "S1", location_id: "BIN9" },
  { id: "502", item_selection: "B", quantity_uom: "77", requested_qty: "4", source_ia_line_id: "12", storage_location_id: "S1", location_id: "BIN9" },
];
const pick = (qty, o) => Object.assign({ material_id: "A", location_id: "BIN1", batch_id: null, category: "Unrestricted", material_uom: "77", sm_quantity: qty, balance_id: "BL1" }, o || {});
const inc = (p1, p2, o) => [Object.assign({}, stored[0], { temp_qty_data: JSON.stringify(p1) }, (o || {})[0] || {}),
  Object.assign({}, stored[1], { temp_qty_data: JSON.stringify(p2) }, (o || {})[1] || {})];
const ctx = (o) => Object.assign({ iaStatus: "Draft", iaFp: "IR1:x", lotFp: "IR1:x" }, o || {});
let c = R.iatrDispatchCheck(stored, inc([pick(6), pick(4, { location_id: "BIN2" })], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: every line fully picked from other bins -> ok", [c.ok, c.code], [true, ""]);
c = R.iatrDispatchCheck(stored, inc([pick(6)], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: a short line blocks, naming it and the quantities", [c.ok, c.code, /SHORT|short/.test(c.message) || /6 of 10/.test(c.message)], [false, "IATR_NOT_FULL", true]);
c = R.iatrDispatchCheck(stored, inc([pick(11)], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: an excess blocks", [c.ok, c.code], [false, "IATR_NOT_FULL"]);
c = R.iatrDispatchCheck(stored, inc([], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: an empty line blocks (never left to auto-allocation)", [c.ok, c.code], [false, "IATR_NOT_FULL"]);
c = R.iatrDispatchCheck(stored, inc([pick(10, { location_id: "BIN9" })], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: a pick at the destination bin blocks", [c.ok, c.code], [false, "IATR_PICK_AT_DESTINATION"]);
c = R.iatrDispatchCheck(stored, inc([pick(10, { category: "Blocked" })], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: a Blocked pick blocks (production needs usable stock)", [c.ok, c.code], [false, "IATR_PICK_CATEGORY"]);
c = R.iatrDispatchCheck(stored, inc([pick(10, { handling_unit_id: "HU1" })], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: a handling-unit pick blocks", [c.ok, c.code], [false, "IATR_PICK_HU"]);
c = R.iatrDispatchCheck(stored, inc([pick(10, { material_uom: "78" })], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: a pick in another unit blocks", [c.ok, c.code], [false, "IATR_PICK_UOM"]);
c = R.iatrDispatchCheck(stored, inc([pick(10, { material_id: "B" })], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: a pick of another item blocks", [c.ok, c.code], [false, "IATR_PICK_ITEM"]);
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })], [{ requested_qty: "9" }]), ctx());
eq("dispatch: a changed requested quantity blocks", [c.ok, c.code], [false, "IATR_DEMAND_CHANGED"]);
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })], [{ location_id: "BIN8" }]), ctx());
eq("dispatch: a changed destination bin blocks", [c.ok, c.code], [false, "IATR_DEMAND_CHANGED"]);
c = R.iatrDispatchCheck(stored, [inc([pick(10)], [])[0]], ctx());
eq("dispatch: a removed line blocks", [c.ok, c.code], [false, "IATR_DEMAND_CHANGED"]);
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]).concat([Object.assign({}, stored[1], { id: "", temp_qty_data: "[]" })]), ctx());
eq("dispatch: an added line blocks", [c.ok, c.code], [false, "IATR_DEMAND_CHANGED"]);
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ iaFp: "IR1:y" }));
eq("dispatch: the IA's materials changed since the request -> refresh first", [c.ok, c.code, /refresh/i.test(c.message)], [false, "IATR_STALE", true]);
// the stored lines against the IA's demand now (a stale tab's Save Picks after a refresh writes the old lines back under the new fingerprint)
const now = (o) => [{ source_ia_line_id: "11", item_selection: "A", quantity_uom: "77", requested_qty: 10 }, Object.assign({ source_ia_line_id: "12", item_selection: "B",
  quantity_uom: "77", requested_qty: 4 }, o || {})];
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ demand: now() }));
eq("dispatch: the stored lines are the IA's demand now -> ok", [c.ok, c.code], [true, ""]);
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ demand: now({ requested_qty: 5 }) }));
eq("dispatch: a stored quantity the IA no longer asks for -> refresh first", [c.ok, c.code, /refresh/i.test(c.message)], [false, "IATR_LINES_STALE", true]);
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ demand: now({ source_ia_line_id: "13" }) }));
eq("dispatch: a stored line for another IA line -> refresh first", c.code, "IATR_LINES_STALE");
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ demand: now({ quantity_uom: "78" }) }));
eq("dispatch: another unit -> refresh first", c.code, "IATR_LINES_STALE");
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ demand: now().slice(0, 1) }));
eq("dispatch: a stored line the IA no longer has -> refresh first", c.code, "IATR_LINES_STALE");
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ demand: now().concat([{ source_ia_line_id: "14", item_selection: "B", quantity_uom: "77", requested_qty: 1 }]) }));
eq("dispatch: an IA line the request lacks -> refresh first", c.code, "IATR_LINES_STALE");
c = R.iatrDispatchCheck([stored[0], Object.assign({}, stored[1], { location_id: "BIN8" })], inc([pick(10)], [pick(4, { material_id: "B" })], [{}, { location_id: "BIN8" }]),
  ctx({ demand: now() }));
eq("dispatch: stored lines with two destinations -> refresh first", c.code, "IATR_LINES_STALE");
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ demand: null }));
eq("dispatch: no demand to compare (the IA's demand failed: its fingerprint already differs) -> not compared", c.ok, true);
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ iaStatus: "Completed" }));
eq("dispatch: the IA is no longer Draft", [c.ok, c.code], [false, "IATR_IA_STATUS"]);
c = R.iatrDispatchCheck(stored, inc([pick(10)], [pick(4, { material_id: "B" })]), ctx({ iaStatus: "" }));
eq("dispatch: the IA is gone", [c.ok, c.code], [false, "IATR_IA_STATUS"]);
c = R.iatrDispatchCheck(stored, [Object.assign({}, stored[0], { temp_qty_data: [pick(10)] }), Object.assign({}, stored[1], { temp_qty_data: [pick(4, { material_id: "B" })] })], ctx());
eq("dispatch: picks given as an array (not text) are read too", c.ok, true);
c = R.iatrDispatchCheck(stored, inc([pick(9.99999999), pick(0.00000001, { location_id: "BIN3" })], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: sums at 8 decimals (no float residue)", c.ok, true);
c = R.iatrDispatchCheck(stored, inc([pick(10), pick(0, { location_id: "BIN9" })], [pick(4, { material_id: "B" })]), ctx());
eq("dispatch: a zero entry is ignored", c.ok, true);

// ================================================================ transition table (the plan's allowed moves)
const T = (stored, saveAs, o) => R.iatrTransition(Object.assign({ stored: stored, storedPurpose: "IA_SUPPLY", saveAs: saveAs, hasStored: true, payloadPurpose: "", payloadStatus: stored }, o || {}));
eq("ordinary LOT: every move is NONE (untouched)", ["Draft", "In Progress"].map((s) => ["Draft", "In Progress", "Completed", "Cancelled"].map((a) => T(s, a, { storedPurpose: "" }).decision)),
  [["NONE", "NONE", "NONE", "NONE"], ["NONE", "NONE", "NONE", "NONE"]]);
eq("Add / Clone of an ordinary LOT: NONE", T("", "Draft", { hasStored: false, storedPurpose: "", payloadStatus: "Draft" }).decision, "NONE");
eq("Requested + Draft (Save Picks): SAVE", T("Requested", "Draft").decision, "SAVE");
eq("Requested + In Progress (Dispatch): DISPATCH", T("Requested", "In Progress").decision, "DISPATCH");
eq("Requested + Completed: REFUSE", T("Requested", "Completed").decision, "REFUSE");
eq("Requested + Cancelled: REFUSE, pointing at Cancel Request", [T("Requested", "Cancelled").decision, /Cancel Request/.test(T("Requested", "Cancelled").message)], ["REFUSE", true]);
eq("purpose In Progress + Completed (Receive): RECEIVE", T("In Progress", "Completed").decision, "RECEIVE");
eq("purpose In Progress + In Progress (edit): REFUSE", T("In Progress", "In Progress").decision, "REFUSE");
eq("purpose In Progress + Draft: REFUSE", T("In Progress", "Draft").decision, "REFUSE");
eq("purpose In Progress + Cancelled: CANCEL", T("In Progress", "Cancelled").decision, "CANCEL");
eq("purpose Completed / Cancelled + anything: REFUSE", ["Completed", "Cancelled"].map((s) => T(s, "Draft").decision), ["REFUSE", "REFUSE"]);
eq("a stored Requested without the purpose: REFUSE", T("Requested", "Draft", { storedPurpose: "" }).decision, "REFUSE");
eq("a stored Requested without the purpose, the payload claiming nothing (e.g. mobile): REFUSE", T("Requested", "Draft", { storedPurpose: "", payloadStatus: "" }).decision, "REFUSE");
eq("an Add / Clone carrying the purpose: REFUSE", T("", "Draft", { hasStored: false, storedPurpose: "", payloadPurpose: "IA_SUPPLY", payloadStatus: "Draft" }).decision, "REFUSE");
eq("an Add / Clone carrying Requested: REFUSE", T("", "Draft", { hasStored: false, storedPurpose: "", payloadStatus: "Requested" }).decision, "REFUSE");
eq("an ordinary stored LOT whose payload claims the purpose: REFUSE", T("Draft", "In Progress", { storedPurpose: "", payloadPurpose: "IA_SUPPLY", payloadStatus: "Draft" }).decision, "REFUSE");
eq("an ordinary stored Draft saved with status Requested in the payload: REFUSE", T("Draft", "Draft", { storedPurpose: "", payloadStatus: "Requested" }).decision, "REFUSE");
eq("a purpose LOT stored Processing: NONE (the busy guard answers)", T("Processing", "In Progress").decision, "NONE");
eq("purpose saved by its own form carrying the purpose: still decided by the stored row", T("Requested", "Draft", { payloadPurpose: "IA_SUPPLY" }).decision, "SAVE");

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
