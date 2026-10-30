// IA transfer request (ENH-20261027-001): the Item Assembly guard's shared rule (code/shared/iatr_guard.js), loaded the way the code
// nodes inline it (no module): the request read, the save's outcome, the decision, the picks of a received request.
//   node scratchpad/iasc/test/test_iatr_guard.js   (IATR_GUARD=<file> tests another copy: mutants_iatr_guard.js)
const fs = require("fs");
const path = require("path");
const FILE = process.env.IATR_GUARD || path.join(__dirname, "..", "code", "shared", "iatr_guard.js");
const src = fs.readFileSync(FILE, "utf8").split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const G = new Function(src + "\nreturn { IATRG_TEXT, iatrgS, iatrgId, iatrgParse, iatrgPicksOf, iatrgRequest, iatrgOutcome, iatrgDecide, iatrgPicks };")();

let n = 0;
let fails = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) === JSON.stringify(want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1500) + "\n  want " + JSON.stringify(want).slice(0, 1500));
};

const IA = "2113088440365826050";
const L1 = "2113088440449712130";
const L2 = "2113088440449712131";
const L3 = "2113088440449712132";
const BIN = "2018912822846582786";
// one above BIN: the same double (2^53 < 2e18, spacing 256), so only an exact (text) compare tells them apart
const NEIGHBOUR = "2018912822846582787";
const WH = "2018912822846583999";
const REQ = (o) => JSON.stringify(Object.assign({ id: "9000000000000000001", no: "LOT-R1", status: "Completed", bin: BIN, bin_name: "A1-01", lines: [L1, L2] }, o || {}));
const pick = (loc, qty, extra) => Object.assign({ material_id: "M", location_id: loc, batch_id: null, sm_quantity: qty === undefined ? 1 : qty, category: "Unrestricted" }, extra || {});
const line = (id, name, picks, extra) => Object.assign({ id: id, item_selection: "item-" + id.slice(-2), item_name: name, temp_qty_data: JSON.stringify(picks) }, extra || {});

// ---- ids and the JSON reader
eq("id: a string as it is (trimmed)", G.iatrgId(" " + BIN + " "), BIN);
eq("id: a safe number as text", G.iatrgId(42), "42");
eq("id: a number past 2^53 marked, never equal to its text", G.iatrgId(Number(BIN)).charAt(0), "?");
eq("id: a negative number marked", G.iatrgId(-1), "?-1");
eq("id: none = ''", [G.iatrgId(null), G.iatrgId(undefined)], ["", ""]);
eq("parse: bare 19-digit numbers stay exact text", G.iatrgParse('{"id":' + IA + ',"bin":' + BIN + ',"lines":[' + L1 + ',' + L2 + ']}'), { id: IA, bin: BIN, lines: [L1, L2] });
eq("parse: decimals and short numbers stay numbers, a quoted long number stays text", G.iatrgParse('{"q":1.5,"n":123456789012345,"no":"' + IA + '"}'),
  { q: 1.5, n: 123456789012345, no: IA });
eq("parse: not JSON = undefined", [G.iatrgParse("{not json"), G.iatrgParse(undefined)], [undefined, undefined]);
eq("parse: an object is taken as it is", G.iatrgParse({ a: 1 }), { a: 1 });

// ---- the picks of a line (the issue's: sm_quantity above 0)
eq("picks: JSON text, quantity above 0 only", G.iatrgPicksOf(line(L1, "X", [pick(BIN, 2), pick(WH, 0), pick(WH, "0.00"), pick(BIN, "0.5"), pick(WH, "abc")])).map((p) => [p.location_id, p.sm_quantity]),
  [[BIN, 2], [BIN, "0.5"]]);
eq("picks: an array as it is", G.iatrgPicksOf({ temp_qty_data: [pick(BIN, 1), null, 7] }).length, 1);
eq("picks: unreadable / blank / none = none", [G.iatrgPicksOf({ temp_qty_data: "[{" }), G.iatrgPicksOf({ temp_qty_data: "  " }), G.iatrgPicksOf({}), G.iatrgPicksOf(null)],
  [[], [], [], []]);
eq("picks: bare 19-digit bins in the text stay exact", G.iatrgPicksOf({ temp_qty_data: '[{"location_id":' + NEIGHBOUR + ',"sm_quantity":1}]' })[0].location_id, NEIGHBOUR);

// ---- the request read
eq("request: no value = none", [G.iatrgRequest(null), G.iatrgRequest(undefined), G.iatrgRequest(""), G.iatrgRequest("  ")], [null, null, null, null]);
const r1 = G.iatrgRequest(REQ());
eq("request: its facts (ids as text, lines as a set)", r1, { bad: false, id: "9000000000000000001", no: "LOT-R1", status: "Completed", bin: BIN, binName: "A1-01",
  lines: { [L1]: true, [L2]: true } });
eq("request: an object (not text) reads the same", G.iatrgRequest(JSON.parse(REQ())), r1);
eq("request: bare 19-digit numbers read exactly", G.iatrgRequest('{"id":9000000000000000001,"no":"LOT-R1","status":"Completed","bin":' + BIN + ',"bin_name":"A1-01","lines":[' + L1 + "," + L2 + "]}"), r1);
eq("request: a Cancelled one = none", G.iatrgRequest(REQ({ status: "Cancelled" })), null);
eq("request: not JSON = bad", G.iatrgRequest("{truncated"), { bad: true });
eq("request: an array, a number, no id = bad", [G.iatrgRequest("[1]"), G.iatrgRequest("7"), G.iatrgRequest(REQ({ id: "" }))], [{ bad: true }, { bad: true }, { bad: true }]);
eq("request: lines not an array = bad", G.iatrgRequest(REQ({ lines: L1 })), { bad: true });
eq("request: no lines (null) = an empty set", G.iatrgRequest(REQ({ lines: null, bin: null, bin_name: null })).lines, {});
eq("request: blank line ids skipped, no bin = ''", G.iatrgRequest(REQ({ lines: ["", null, L3], bin: null })), { bad: false, id: "9000000000000000001", no: "LOT-R1",
  status: "Completed", bin: "", binName: "A1-01", lines: { [L3]: true } });

// ---- the outcome (code_fillback's rule)
eq("outcome: not the Draft path = a completion", [G.iatrgOutcome(false, false, "Draft"), G.iatrgOutcome(false, true, "Created")], ["COMPLETED", "COMPLETED"]);
eq("outcome: the Draft path asking Created = Created", G.iatrgOutcome(true, true, "Draft"), "CREATED");
eq("outcome: the Draft path of an IA stored Created = Created", G.iatrgOutcome(true, false, "Created"), "CREATED");
eq("outcome: the Draft path otherwise = Draft (exactly 'Created', as code_fillback compares)", [G.iatrgOutcome(true, false, "Draft"), G.iatrgOutcome(true, false, "created"),
  G.iatrgOutcome(true, false, "")], ["DRAFT", "DRAFT", "DRAFT"]);

// ---- the decision
const go = { refuse: false, code: "", message: "", picks: false };
const live = (no, st) => "The materials of this Item Assembly are still being transferred (transfer request " + no + " is " + st + "): receive it first, or cancel it.";
for (const st of ["Requested", "In Progress", "Processing"]) {
  eq("decide: " + st + " + Created = refused", G.iatrgDecide(G.iatrgRequest(REQ({ status: st })), "CREATED", "Draft"),
    { refuse: true, code: "IA_TR_LIVE", message: live("LOT-R1", st), picks: false });
  eq("decide: " + st + " + Completed = refused", G.iatrgDecide(G.iatrgRequest(REQ({ status: st })), "COMPLETED", "Created").message, live("LOT-R1", st));
  eq("decide: " + st + " + Draft = nothing", G.iatrgDecide(G.iatrgRequest(REQ({ status: st })), "DRAFT", "Draft"), go);
}
eq("decide: a status it does not know = refused (fail closed)", G.iatrgDecide(G.iatrgRequest(REQ({ status: "Draft" })), "COMPLETED", "Draft").message, live("LOT-R1", "Draft"));
eq("decide: no status = refused 'without a status'", G.iatrgDecide(G.iatrgRequest(REQ({ status: null })), "COMPLETED", "Draft").message, live("LOT-R1", "without a status"));
eq("decide: no number = its id named", G.iatrgDecide(G.iatrgRequest(REQ({ status: "Requested", no: "" })), "CREATED", "Draft").message, live("9000000000000000001", "Requested"));
eq("decide: received with lines = go on, its picks checked", G.iatrgDecide(r1, "COMPLETED", "Draft"), { refuse: false, code: "", message: "", picks: true });
eq("decide: received + Created = its picks checked too", G.iatrgDecide(r1, "CREATED", "Created").picks, true);
eq("decide: received without lines = nothing to check", G.iatrgDecide(G.iatrgRequest(REQ({ lines: null })), "COMPLETED", "Draft"), go);
eq("decide: no request = nothing", [G.iatrgDecide(null, "COMPLETED", "Draft"), G.iatrgDecide(null, "CREATED", "Draft")], [go, go]);
eq("decide: an unreadable request + a completion = refused", G.iatrgDecide({ bad: true }, "COMPLETED", "Draft"),
  { refuse: true, code: "IA_TR_UNREADABLE", message: G.IATRG_TEXT.unreadable, picks: false });
eq("decide: an unreadable request + Draft = nothing", G.iatrgDecide({ bad: true }, "DRAFT", "Draft"), go);
eq("decide: an IA already Completed / Fully Posted = its own guards (nothing here)", [G.iatrgDecide(G.iatrgRequest(REQ({ status: "Requested" })), "COMPLETED", "Completed"),
  G.iatrgDecide({ bad: true }, "COMPLETED", "Fully Posted"), G.iatrgDecide(r1, "COMPLETED", " Completed ")], [go, go, go]);
eq("decide: another outcome = nothing", G.iatrgDecide(G.iatrgRequest(REQ({ status: "Requested" })), "", "Draft"), go);

// ---- the picks of a received request
const ok = { ok: true, code: "", message: "" };
const bad = (nLine, item, bin) => ({ ok: false, code: "IA_TR_PICK", message: "Line " + nLine + " (" + item + "): pick it from " + bin + ", where transfer request LOT-R1 delivered it." });
eq("picks: every pick of its lines at the destination = ok", G.iatrgPicks([line(L1, "Thrust Washer", [pick(BIN, 3)]), line(L2, "Press Rode", [pick(BIN, 1), pick(BIN, 2)])], r1), ok);
eq("picks: a pick elsewhere = refused, naming the line (its position), the item and the bin", G.iatrgPicks([line(L1, "Thrust Washer", [pick(BIN, 3)]),
  line(L2, "Press Rode", [pick(BIN, 1), pick(WH, 2)], { line_index: "9" })], r1), bad(2, "Press Rode", "A1-01"));
eq("picks: the first line off it", G.iatrgPicks([line(L2, "Press Rode", [pick(WH, 1)]), line(L1, "Thrust Washer", [pick(WH, 1)])], r1), bad(1, "Press Rode", "A1-01"));
eq("picks: a line the request did not supply is free", G.iatrgPicks([line(L3, "Dispenser", [pick(WH, 5)]), line(L1, "Thrust Washer", [pick(BIN, 1)])], r1), ok);
eq("picks: a new line (no id) is free", G.iatrgPicks([line("", "New", [pick(WH, 5)])], r1), ok);
eq("picks: a zero pick elsewhere is not a pick", G.iatrgPicks([line(L1, "Thrust Washer", [pick(BIN, 3), pick(WH, 0)])], r1), ok);
eq("picks: a line with no pick passes here", G.iatrgPicks([line(L1, "Thrust Washer", [])], r1), ok);
eq("picks: a pick without a bin = refused", G.iatrgPicks([line(L1, "Thrust Washer", [pick(null, 1)])], r1), bad(1, "Thrust Washer", "A1-01"));
eq("picks: the neighbouring 19-digit bin (bare numbers in the text) = refused", G.iatrgPicks([{ id: L1, item_name: "Thrust Washer",
  temp_qty_data: '[{"location_id":' + NEIGHBOUR + ',"sm_quantity":1}]' }], r1), bad(1, "Thrust Washer", "A1-01"));
eq("picks: the destination as a bare number in the text = ok", G.iatrgPicks([{ id: L1, item_name: "T", temp_qty_data: '[{"location_id":' + BIN + ',"sm_quantity":1}]' }], r1), ok);
eq("picks: no item name = its item", G.iatrgPicks([line(L1, "", [pick(WH, 1)])], r1), bad(1, "item-30", "A1-01"));
eq("picks: no bin name = the bin's id", G.iatrgPicks([line(L1, "T", [pick(WH, 1)])], G.iatrgRequest(REQ({ bin_name: "" }))), bad(1, "T", BIN));
eq("picks: no destination = refused (fail closed)", G.iatrgPicks([line(L1, "T", [pick("", 1)])], G.iatrgRequest(REQ({ bin: null, bin_name: null }))),
  bad(1, "T", "its destination bin"));
eq("picks: no request number = its id", G.iatrgPicks([line(L1, "T", [pick(WH, 1)])], G.iatrgRequest(REQ({ no: "" }))).message,
  "Line 1 (T): pick it from A1-01, where transfer request 9000000000000000001 delivered it.");
eq("picks: an id like 'constructor' is not a request line", G.iatrgPicks([line("constructor", "T", [pick(WH, 1)]), line("toString", "T", [pick(WH, 1)])], r1), ok);
eq("picks: a line's id as a padded text still matches", G.iatrgPicks([line(" " + L1 + " ", "T", [pick(WH, 1)])], r1).ok, false);
eq("picks: no lines = ok", [G.iatrgPicks(null, r1), G.iatrgPicks("x", r1), G.iatrgPicks([null, 3], r1)], [ok, ok, ok]);

// ---- end to end as the nodes chain it: read -> decide -> picks
const e2e = (column, outcome, stored, lines) => {
  const req = G.iatrgRequest(column);
  const d = G.iatrgDecide(req, outcome, stored);
  if (d.refuse) return d.code;
  return d.picks ? G.iatrgPicks(lines, req).code || "GO" : "GO";
};
const at = [line(L1, "T", [pick(BIN, 1)])];
const off = [line(L1, "T", [pick(WH, 1)])];
eq("e2e: a Draft save with a live request, picks elsewhere = GO", e2e(REQ({ status: "Requested" }), "DRAFT", "Draft", off), "GO");
eq("e2e: Created / Completed with a live request = IA_TR_LIVE", [e2e(REQ({ status: "Requested" }), "CREATED", "Draft", at), e2e(REQ({ status: "In Progress" }), "COMPLETED", "Created", at)],
  ["IA_TR_LIVE", "IA_TR_LIVE"]);
eq("e2e: received + picks at the destination = GO; elsewhere = IA_TR_PICK", [e2e(REQ(), "COMPLETED", "Draft", at), e2e(REQ(), "COMPLETED", "Draft", off)], ["GO", "IA_TR_PICK"]);
eq("e2e: only a Cancelled request = GO (today's)", e2e(REQ({ status: "Cancelled" }), "COMPLETED", "Draft", off), "GO");
eq("e2e: no request = GO", e2e(null, "COMPLETED", "Draft", off), "GO");

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
