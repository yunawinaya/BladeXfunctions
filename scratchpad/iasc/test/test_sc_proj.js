// node scratchpad/iasc/test/test_sc_proj.js - unit tests of scratchpad/iasc/code/shared/sc_proj.js (CONTRACT.md section 6)
const path = require("path");
const P = require(process.env.SC_PROJ || path.join(__dirname, "..", "code", "shared", "sc_proj.js"));

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
  }
};
const yes = (label, v) => eq(label, !!v, true);

const EA = "100";
const CTN = "200";
const BAG = "300";
const FG = "9";
const fg = { id: FG, based_uom: EA, table_uom_conversion: [{ alt_uom_id: CTN, alt_qty: 1, base_qty: 12, base_uom_id: EA }] };
const header = (extra) => Object.assign({ id: "50", so_no: "SO100", so_status: "Issued", organization_id: "7", customer_id: "c1", customer_name: "Cust", is_deleted: 0 }, extra || {});
const soLine = (extra) => Object.assign({ id: "51", sales_order_id: "50", item_name: FG, so_quantity: "100", so_item_uom: EA, delivered_qty: "0",
  outstanding_quantity: "999", line_status: "Issued", is_deleted: 0, line_index: 1 }, extra || {});
const ia = (id, status, qty, extra) => Object.assign({ id: id, no: "IA-" + id, status: status, item_id: FG, item_qty: String(qty), item_uom: EA,
  planned_output_qty: null, mode: "FLAT", is_deleted: 0 }, extra || {});
const proj = (input) => P.scProject(Object.assign({ line: soLine(), header: header(), fg: fg, ias: [], excludeIaId: "", iaItemId: FG, iaOrgId: "7",
  proposal: null, baseline: null, candidates: [] }, input));
const T = (r) => [r.totals.ordered, r.totals.delivered, r.totals.undelivered, r.totals.planned, r.totals.produced, r.totals.open, r.totals.suggestion];
const codes = (r) => r.warnings.map((w) => w.code);

// ---------------------------------------------------------------- contract section 11, step by step
eq("SO100, nothing linked: suggest 100", proj({}).totals.suggestion, 100);
eq("SC04 saved Draft60 -> suggest 40", proj({ ias: [ia("1", "Draft", 60)] }).totals.suggestion, 40);
eq("step 2 Draft60 + Draft40 -> 0", proj({ ias: [ia("1", "Draft", 60), ia("2", "Draft", 40)] }).totals.suggestion, 0);
let r = proj({ ias: [ia("1", "Completed", 50, { planned_output_qty: "60" }), ia("2", "Draft", 40)] });
eq("step 3 completed 50 of plan 60, Draft40: 100/0/100 planned 100 produced 50 open 40 suggest 10", T(r), [100, 0, 100, 100, 50, 40, 10]);
// BA handoff FIX-01: with both deliveries and linked production, nothing records which delivery came from which IA: the remaining
// demand lies between ordered - delivered - produced - open and ordered - max(delivered, produced) - open; only equal bounds are exact
r = proj({ line: soLine({ delivered_qty: "30" }), ias: [ia("1", "Completed", 50, { planned_output_qty: "60" }), ia("2", "Draft", 40)] });
eq("step 5 delivered 30 + produced 50: the overlap is unknown -> unavailable (0 to 10)", [T(r), r.totals.unavailable], [[100, 30, 70, 100, 50, 40, null], "OVERLAP"]);
r = proj({ line: soLine({ delivered_qty: "30" }), ias: [ia("1", "Completed", 50, { planned_output_qty: "60" }), ia("2", "Completed", 40)] });
eq("step 6 delivered 30 + produced 90: unavailable (0 to 10)", [T(r), r.totals.unavailable], [[100, 30, 70, 100, 90, 0, null], "OVERLAP"]);
r = proj({ line: soLine({ delivered_qty: "40" }), ias: [ia("1", "Completed", 30)] });
eq("BA example: delivered 40 (maybe unrelated stock) + produced 30 unused -> unavailable (30 to 60)", [r.totals.suggestion, r.totals.unavailable], [null, "OVERLAP"]);
r = proj({ line: soLine({ delivered_qty: "40" }) });
eq("delivered 40, nothing produced: exact 60", [r.totals.suggestion, r.totals.unavailable], [60, ""]);
r = proj({ ias: [ia("1", "Completed", 30), ia("2", "Draft", 20)] });
eq("produced 30, nothing delivered: exact 50", [r.totals.suggestion, r.totals.unavailable], [50, ""]);
r = proj({ line: soLine({ delivered_qty: "100" }), ias: [ia("1", "Completed", 30)] });
eq("delivered 100 + produced 30: both bounds 0 -> exact 0", [r.totals.suggestion, r.totals.unavailable], [0, ""]);
r = proj({ line: soLine({ delivered_qty: "100" }), ias: [ia("1", "Completed", 30)], proposal: { qty: 10, uomId: EA } });
eq("over the order whatever the overlap: excess at least 10", [r.totals.excess, r.totals.excessExact], [10, false]);
yes("EXCESS says 'at least' when the overlap is unknown", /by at least 10 /.test((r.warnings.find((w) => w.code === "EXCESS") || {}).text || ""));
r = proj({ line: soLine({ delivered_qty: "40" }), ias: [ia("1", "Completed", 30)], proposal: { qty: 10, uomId: EA } });
eq("unknown overlap, not certainly over: no excess", [r.totals.excess, (r.warnings.find((w) => w.code === "EXCESS") || null)], [0, null]);
r = proj({ line: soLine({ line_status: "Cancelled", delivered_qty: "40" }), ias: [ia("1", "Completed", 30)] });
eq("an inactive line: a genuine 0, not unavailable", [r.totals.suggestion, r.totals.unavailable], [0, ""]);
r = proj({ ias: [ia("1", "Draft", 60), ia("2", "Completed", 30, { planned_output_qty: "40" })] });
eq("SC13 Draft60 + 40/30 completed: planned 100 produced 30 open 60 suggest 10", T(r), [100, 0, 100, 100, 30, 60, 10]);

// ---------------------------------------------------------------- excess and the current IA
r = proj({ ias: [ia("1", "Draft", 60)], proposal: { qty: 50, uomId: EA } });
eq("SC05 proposal 50 next to Draft60: suggest 40, excess 10 (exact)", [r.totals.suggestion, r.totals.excess, r.totals.excessExact], [40, 10, true]);
yes("SC05 EXCESS says 'by 10' (exact)", /by 10 /.test((r.warnings.find((w) => w.code === "EXCESS") || {}).text || ""));
yes("SC05 excess warns", codes(r).indexOf("EXCESS") >= 0);
r = proj({ ias: [ia("1", "Draft", 60), ia("2", "Draft", 30)], excludeIaId: "2", proposal: { qty: 50, uomId: EA } });
eq("SC24 the current Draft counts once (its proposal, not its stored 30)", [r.totals.openOthers, r.totals.suggestion, r.totals.excess], [60, 40, 10]);
r = proj({ ias: [ia("1", "Completed", 50)], excludeIaId: "1" });
eq("a completed IA is never excluded", [r.totals.produced, r.totals.suggestion], [50, 50]);
r = proj({ ias: [ia("1", "Draft", 60)], proposal: { qty: 0, uomId: EA } });
eq("suggestion 0 stays 0 (SC06)", proj({ ias: [ia("1", "Draft", 100)] }).totals.suggestion, 0);
eq("no excess when covered exactly", proj({ ias: [ia("1", "Draft", 60)], proposal: { qty: 40, uomId: EA } }).totals.excess, 0);

// ---------------------------------------------------------------- status map
r = proj({ ias: [ia("1", "Processing", 20), ia("2", "Fully Posted", 30), ia("3", "Draft", 10, { is_deleted: 1 }), ia("4", "Weird", 5)] });
eq("Processing open, Fully Posted produced, deleted and unknown not counted", [r.totals.open, r.totals.produced], [20, 30]);
yes("unknown status warns", codes(r).indexOf("IA_STATUS_UNKNOWN") >= 0);
eq("ia roles", r.ias.map((x) => [x.id, x.role]), [["1", "open"], ["2", "produced"], ["3", "none"], ["4", "none"]]);
r = proj({ ias: [ia("1", "Draft", 6, { planned_output_qty: "10" })] });
eq("open Draft counts item_qty, planned shown", [r.totals.open, r.totals.planned], [6, 10]);

// ---------------------------------------------------------------- UOM
r = proj({ ias: [ia("1", "Draft", 2, { item_uom: CTN })] });
eq("IA in CTN counts 24 EA", r.totals.open, 24);
eq("an IA row carries its own UOM (the page shows planned / actual in it)", r.ias.map((x) => [x.uomId, x.itemQty, x.qty]), [[CTN, 2, 24]]);
r = proj({ line: soLine({ so_item_uom: CTN, so_quantity: "10" }), ias: [ia("1", "Draft", 24)] });
eq("line in CTN: 24 EA = 2 CTN", [r.uomId, r.totals.open, r.totals.suggestion], [CTN, 2, 8]);
r = proj({ ias: [ia("1", "Draft", 2, { item_uom: BAG })] });
eq("unconvertible IA: incomplete, no suggestion", [r.totals.complete, r.totals.suggestion, r.totals.unavailable], [false, null, "UNCONVERTIBLE"]);
yes("unconvertible warns", codes(r).indexOf("UNCONVERTIBLE") >= 0);
eq("residue-free sums", proj({ ias: [ia("1", "Draft", 0.1), ia("2", "Draft", 0.2)] }).totals.open, 0.3);

// ---------------------------------------------------------------- demand and eligibility
yes("Issued line is eligible for a new link", proj({}).eligibleNew);
yes("Processing header is eligible", proj({ header: header({ so_status: "Processing" }) }).eligibleNew);
r = proj({ header: header({ so_status: "Completed" }), ias: [ia("1", "Draft", 10)] });
eq("force-completed header: no demand", [r.eligibleNew, r.totals.suggestion, codes(r).indexOf("SO_CLOSED") >= 0], [false, 0, true]);
eq("cancelled header", codes(proj({ header: header({ so_status: "Cancelled" }) })).indexOf("SO_CANCELLED") >= 0, true);
eq("void header", codes(proj({ header: header({ so_status: "Void" }) })).indexOf("SO_VOID") >= 0, true);
eq("draft header not eligible", [proj({ header: header({ so_status: "Draft" }) }).eligibleNew, codes(proj({ header: header({ so_status: "Draft" }) })).indexOf("SO_DRAFT") >= 0], [false, true]);
eq("completed line", [proj({ line: soLine({ line_status: "Completed" }) }).eligibleNew, codes(proj({ line: soLine({ line_status: "Completed" }) })).indexOf("LINE_COMPLETED") >= 0], [false, true]);
eq("cancelled line", codes(proj({ line: soLine({ line_status: "Cancelled" }) })).indexOf("LINE_CANCELLED") >= 0, true);
r = proj({ iaOrgId: "8" });
eq("other organisation not eligible", [r.eligibleNew, r.reason.length > 0], [false, true]);
r = proj({ iaItemId: "77" });
eq("other item not eligible + ITEM_CHANGED", [r.eligibleNew, codes(r).indexOf("ITEM_CHANGED") >= 0], [false, true]);
r = proj({ line: soLine({ is_deleted: 1 }), candidates: [{ id: "61", line_index: 2 }] });
eq("removed line: LINE_REMOVED with candidates", [r.eligibleNew, codes(r).indexOf("LINE_REMOVED") >= 0, r.candidates.length], [false, true, 1]);
r = proj({ line: null, ias: [ia("1", "Draft", 10)] });
eq("line not found: removed, no demand", [codes(r).indexOf("LINE_REMOVED") >= 0, r.totals.suggestion], [true, 0]);
r = proj({ header: header({ is_deleted: 1 }) });
eq("removed SO", [r.eligibleNew, codes(r).indexOf("SO_REMOVED") >= 0], [false, true]);
r = proj({ line: soLine({ delivered_qty: "130" }) });
eq("over-delivered: undelivered 0, suggest 0", [r.totals.undelivered, r.totals.suggestion], [0, 0]);
eq("outstanding_quantity never read", proj({ line: soLine({ outstanding_quantity: "0" }) }).totals.undelivered, 100);

// ---------------------------------------------------------------- baseline warnings (IA06)
r = proj({ baseline: { v: 1, orderedQty: "120", uomId: EA } });
yes("reduced since linked", codes(r).indexOf("REDUCED") >= 0);
eq("not reduced", codes(proj({ baseline: { v: 1, orderedQty: "100", uomId: EA } })).indexOf("REDUCED"), -1);
yes("UOM changed since linked", codes(proj({ baseline: { v: 1, orderedQty: "10", uomId: CTN } })).indexOf("UOM_CHANGED") >= 0);
yes("warnings have text", proj({ baseline: { v: 1, orderedQty: "120", uomId: EA } }).warnings.every((w) => w.text.length > 10));
// the texts name the line by its SO number alone (no "SO SO/..."), and say nothing about where they are shown
const textOf = (res, code) => (res.warnings.find((w) => w.code === code) || {}).text || "";
r = proj({ baseline: { v: 1, orderedQty: "120", uomId: EA } });
yes("REDUCED reads '<SO no> line 1 was reduced'", textOf(r, "REDUCED").indexOf(r.warnings.length && header().so_no + " line 1 was reduced from 120 to 100") === 0, textOf(r, "REDUCED"));
yes("no warning starts with 'SO ' + the SO number", [proj({ baseline: { v: 1, orderedQty: "120", uomId: EA } }), proj({ line: soLine({ line_status: "Completed" }) }),
  proj({ ias: [ia("1", "Draft", 200)], proposal: { qty: 50, uomId: EA } })].every((x) => x.warnings.every((w) => w.text.indexOf("SO " + header().so_no) < 0)));
r = proj({ ias: [ia("1", "Draft", 2, { item_uom: BAG })] });
yes("UNCONVERTIBLE says the figures are incomplete, not 'below'", /: the figures are incomplete\.$/.test(textOf(r, "UNCONVERTIBLE")) && textOf(r, "UNCONVERTIBLE").indexOf("below") < 0,
  textOf(r, "UNCONVERTIBLE"));

// ---------------------------------------------------------------- sql-node row parsing
eq("spParseJ keeps 19-digit ids lossless", P.spParseJ('{"id": 2112147770507436034, "q": 1.5}'), { id: "2112147770507436034", q: 1.5 });
eq("spParseJ passes objects through", P.spParseJ({ a: 1 }), { a: 1 });
eq("spParseJ empty / broken -> null", [P.spParseJ(""), P.spParseJ("{bad")], [null, null]);
eq("spRows parses text and object j, drops the rest", P.spRows([{ j: '{"a":"1"}' }, { j: { b: 2 } }, { j: null }, null, { x: 1 }]), [{ a: "1" }, { b: 2 }]);
eq("spRows takes a single row", P.spRows({ j: '{"x":1}' }), [{ x: 1 }]);

// ---------------------------------------------------------------- candidates
const lines = [soLine({ id: "51" }), soLine({ id: "52", line_index: 2, so_quantity: "10" }), soLine({ id: "53", line_index: 3, line_status: "Completed" })];
const c = P.scCandidates({ rows: lines.map((l) => ({ line: l, header: header() })), ias: [Object.assign(ia("1", "Draft", 4), { source_so_line_id: "52" })],
  fg: fg, iaItemId: FG, iaOrgId: "7" });
eq("candidates: eligible lines with their suggestion", c.map((x) => [x.lineId, x.suggestion]), [["51", 100], ["52", 6]]);
const c2 = P.scCandidates({ rows: [{ line: soLine({ id: "54", delivered_qty: "40" }), header: header() }], ias: [Object.assign(ia("1", "Completed", 30), { source_so_line_id: "54" })],
  fg: fg, iaItemId: FG, iaOrgId: "7" });
eq("candidates: the same rule (delivered 40 + produced 30 -> no suggestion)", c2.map((x) => [x.lineId, x.suggestion]), [["54", null]]);

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
