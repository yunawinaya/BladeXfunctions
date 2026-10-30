// node scratchpad/iasc/test/test_iatr_guard2.js - code/shared/iatr_guard2.js (RESERVED_REQUEST_PLAN.md Task 8: the IA guard for transfer
// requests from a reserved IA, D4 / D11), loaded after scratchpad/iatr/code/shared/iatr_reserve.js the way the patched nodes inline them:
// the read of all of the IA's requests, the decision per save outcome, the staging check. IATR_GUARD2=<file> tests another copy.
const fs = require("fs");
const path = require("path");
const strip = (t) => t.split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const RESERVE = path.join(__dirname, "..", "..", "iatr", "code", "shared", "iatr_reserve.js");
const src = strip(fs.readFileSync(RESERVE, "utf8")) + "\n" + strip(fs.readFileSync(process.env.IATR_GUARD2 || path.join(__dirname, "..", "code", "shared", "iatr_guard2.js"), "utf8"));
const G = new Function(src + "\nreturn { iatrg2Read, iatrg2Outcome, iatrg2Decide, iatrg2Staging, IATRG2_TEXT };")();

let n = 0;
let fails = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) === JSON.stringify(want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1200) + "\n  want " + JSON.stringify(want).slice(0, 1200));
};
const STG = "2018912822846582786";
const WH = "2018912822846583999";
const req = (id, status, o) => Object.assign({ id: id, no: "LOT-" + id.slice(-2), status: status, bin: STG, bin_name: "PROD-01" }, o || {});
const read = (reqs, items) => JSON.stringify({ reqs: reqs, items: items === undefined ? ITEMS : items });
const ITEMS = [{ id: "A", stock_control: 1, serial_number_management: 0 }, { id: "S", stock_control: 1, serial_number_management: 1 }, { id: "L", stock_control: 0, serial_number_management: 0 }];
const pk = (bin, qty, o) => Object.assign({ material_id: "A", location_id: bin, sm_quantity: qty }, o || {});
const line = (item, name, picks, o) => Object.assign({ item_selection: item, item_name: name, temp_qty_data: JSON.stringify(picks), temp_hu_data: "" }, o || {});
const dec = (reqs, outcome, stored) => G.iatrg2Decide(G.iatrg2Read(read(reqs)), outcome, stored || "Created");

// ---- the read
eq("read: NULL (not read, or no row) -> no requests", G.iatrg2Read(null), { bad: false, reqs: [], items: {} });
eq("read: every request kept, its staging bin; items by id", (() => {
  const r = G.iatrg2Read(read([req("2113300000000000001", "Cancelled"), req("2113300000000000002", "Completed")]));
  return [r.bad, r.reqs.map((x) => [x.id, x.status, x.bin, x.binName]), Object.keys(r.items)];
})(), [false, [["2113300000000000001", "Cancelled", STG, "PROD-01"], ["2113300000000000002", "Completed", STG, "PROD-01"]], ["A", "S", "L"]]);
eq("read: bare 19-digit numbers stay exact", G.iatrg2Read(read([req("2113300000000000001", "Completed")]).replace(/"(\d{19})"/g, "$1")).reqs[0].bin, STG);
eq("read: not JSON / not the shape / a request without an id -> bad", [G.iatrg2Read("{trunc").bad, G.iatrg2Read('{"reqs":{}}').bad, G.iatrg2Read('{"reqs":[{"status":"Requested"}]}').bad],
  [true, true, true]);
eq("read: empty lists (JSON null) -> none", G.iatrg2Read('{"reqs":null,"items":null}'), { bad: false, reqs: [], items: {} });

// ---- the outcome (code_fillback's)
eq("outcome", [G.iatrg2Outcome(false, false, "Draft"), G.iatrg2Outcome(true, true, "Draft"), G.iatrg2Outcome(true, false, "Created"), G.iatrg2Outcome(true, false, "Draft")],
  ["COMPLETED", "CREATED", "CREATED", "DRAFT"]);

// ---- the decision (D4)
const go = { refuse: false, code: "", message: "", picks: false };
eq("no request: every outcome goes on", [dec([], "DRAFT"), dec([], "CREATED"), dec([], "COMPLETED")], [go, go, go]);
eq("only Cancelled requests: as none", dec([req("2113300000000000001", "Cancelled")], "COMPLETED"), go);
for (const st of ["In Progress", "Processing"]) {
  for (const outcome of ["DRAFT", "CREATED", "COMPLETED"]) {
    const d = dec([req("2113300000000000001", st)], outcome);
    eq("save while in transit (" + st + ", " + outcome + ") -> IA_TR_TRANSIT", [d.refuse, d.code, d.message], [true, "IA_TR_TRANSIT", G.IATRG2_TEXT.transit("LOT-01", st)]);
  }
}
eq("a status the guard does not know: in transit (fail closed)", dec([req("2113300000000000001", "Draft")], "CREATED").code, "IA_TR_TRANSIT");
eq("Created is allowed before a request (Requested)", dec([req("2113300000000000001", "Requested")], "CREATED"), go);
eq("a Draft save while Requested goes on (the request then refreshes)", dec([req("2113300000000000001", "Requested")], "DRAFT"), go);
let d = dec([req("2113300000000000001", "Requested")], "COMPLETED");
eq("complete with a request open (Requested) -> IA_TR_OPEN", [d.refuse, d.code, d.message], [true, "IA_TR_OPEN", G.IATRG2_TEXT.open("LOT-01", "Requested")]);
d = dec([req("2113300000000000001", "Completed"), req("2113300000000000002", "Requested")], "COMPLETED");
eq("complete with a replacement still open -> IA_TR_OPEN, naming it", [d.code, /LOT-02/.test(d.message)], ["IA_TR_OPEN", true]);
eq("complete after a receipt, nothing open -> the staging check", dec([req("2113300000000000001", "Completed"), req("2113300000000000002", "Cancelled")], "COMPLETED"),
  { refuse: false, code: "", message: "", picks: true });
eq("Created after a receipt (a replacement's new reservation) -> no staging check", dec([req("2113300000000000001", "Completed")], "CREATED"), go);
eq("an IA already Completed / Fully Posted: its own guards answer", [dec([req("2113300000000000001", "In Progress")], "COMPLETED", "Completed"),
  dec([req("2113300000000000001", "In Progress")], "DRAFT", "Fully Posted")], [go, go]);
eq("an unreadable read: Created / Completed refused, Draft goes on", [G.iatrg2Decide(G.iatrg2Read("{trunc"), "COMPLETED", "Created").code,
  G.iatrg2Decide(G.iatrg2Read("{trunc"), "CREATED", "Created").code, G.iatrg2Decide(G.iatrg2Read("{trunc"), "DRAFT", "Created").refuse], ["IA_TR_UNREADABLE", "IA_TR_UNREADABLE", false]);

// ---- the staging check (D11)
const recv = G.iatrg2Read(read([req("2113300000000000001", "Completed")]));
const st = (lines, r, items) => G.iatrg2Staging(lines, r || recv, items);
eq("staging: every requestable line at the staging bin -> ok", st([line("A", "RM-A", [pk(STG, 2)])]), { ok: true, code: "", message: "" });
let s = st([line("A", "RM-A", [pk(STG, 2)]), line("A", "RM-A2", [pk(WH, 1)])]);
eq("a never-reserved line from the warehouse -> IA_TR_STAGING, naming the line and the bin", [s.ok, s.code, s.message],
  [false, "IA_TR_STAGING", G.IATRG2_TEXT.staging(2, "RM-A2", "PROD-01", "LOT-01")]);
eq("a serial line from the warehouse -> ok", st([line("A", "RM-A", [pk(STG, 2)]), line("S", "MOTOR", [pk(WH, 1, { material_id: "S" })])]).ok, true);
eq("a handling-unit line from the warehouse -> ok", st([line("A", "RM-A", [pk(WH, 1, { handling_unit_id: "77" })])]).ok, true);
eq("a non-stock line -> ok", st([line("L", "Labour", [])]).ok, true);
eq("a zero pick elsewhere is not a pick", st([line("A", "RM-A", [pk(STG, 2), pk(WH, 0)])]).ok, true);
eq("the items given (SUBMIT's own read) win over the read's", st([line("A", "RM-A", [pk(WH, 1)])], recv, { A: { id: "A", stock_control: 1, serial_number_management: 1 } }).ok, true);
eq("the newest received request's staging bin", st([line("A", "RM-A", [pk(WH, 1)])], G.iatrg2Read(read([req("2113300000000000001", "Completed", { bin: WH }),
  req("2113300000000000002", "Completed")]))).ok, false);
s = st([line("A", "RM-A", [pk(STG, 1)])], G.iatrg2Read(read([req("2113300000000000001", "Completed", { bin: null })])));
eq("a received request without a bin -> IA_TR_STAGING (it can't tell where), saying so", [s.code, s.message], ["IA_TR_STAGING", G.IATRG2_TEXT.noBin("LOT-01")]);

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
