// sc_main GAP (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 9, D6): a replacement's allocation, run by tr_main's Request Replacement on
// an editable Created IA - each line of the request's gap gets its missing quantity allocated as today, never from the staging bin; the
// line's picks stay (its own picks elsewhere count as taken); nothing is saved. Replaces test_sc_staging.js (B21 retired: the receipt
// moves the IA's picks to the staging bin). test_tr_reserve.js has one line, a staging bin that is the default bin, a short stock, a
// Draft and the retired STAGING op.
//   node scratchpad/iasc/client/test/test_sc_gap.js
const H = require("./harness");
const F = require("./fixture");
const { session, picks } = require("./session");
const { check, same } = H;

// the fixture's C1 has 100 in L0 and 50 in L1; C2 500 in L0 only: L1 plays the staging bin
const pk = (item, bin, qty) => ({ material_id: item, location_id: bin, balance_id: "B-" + bin, sm_quantity: qty, category: "Unrestricted" });
const line = (id, item, kept, o) => Object.assign({ id: id, item_selection: item, item_name: item, quantity_uom: F.EA, requested_qty: 20, required_qty: null,
  total_quantity: kept.reduce((n, p) => n + p.sm_quantity, 0), temp_qty_data: JSON.stringify(kept), temp_hu_data: "", stock_summary: "" }, o || {});
const ia = (lines, o) => F.header(Object.assign({ id: "4001", page_status: "Edit", item_assembly_status: "Created", stock_movement: lines }, o || {}));
const said = (s) => s.since(0).filter((t) => /\$message\.[a-z]+$/.test(t[0])).map((t) => t[0].replace(/^.*\$message\./, "") + ": " + t[1]);
const at = (row) => picks(row).map((p) => [p.location_id, p.sm_quantity]);
const wrote = (s, i, field) => s.since(0).some((t) => /setData$/.test(t[0]) && t[1] && Object.keys(t[1]).some((k) => k.indexOf("stock_movement." + i + "." + (field || "")) === 0));
const gap = (s, g, bin) => s.fire("sc_main", { scOp: "GAP", gap: g, bin: bin === undefined ? "L1" : bin });

(async () => {
  // two lines of the gap; a line not in it untouched
  let s = session(ia([line("5001", "C1", [pk("C1", "L1", 15)]), line("5002", "C2", [pk("C2", "L1", 30)]), line("5003", "C1", [pk("C1", "L1", 10)])]), { this: { isEdit: true } });
  await gap(s, [{ iaLineId: "5001", missing: "5" }, { iaLineId: "5002", missing: "10" }]);
  let v = s.v();
  check("GAP: each line's missing quantity from outside the staging bin, its staging picks kept", same([at(v.stock_movement[0]), at(v.stock_movement[1])],
    [[["L1", 15], ["L0", 5]], [["L1", 30], ["L0", 10]]]), [at(v.stock_movement[0]), at(v.stock_movement[1])]);
  check("  the totals = kept + allocated", same(v.stock_movement.map((l) => l.total_quantity), [20, 40, 10]), v.stock_movement.map((l) => l.total_quantity));
  check("  a line not in the gap not written", !wrote(s, 2));
  check("  said: save as Created, then Request Replacement", said(s).length === 1 && /^success: The missing materials are allocated outside the staging bin: save the Item Assembly as Created/.test(said(s)[0]),
    said(s));
  check("  its handling-unit picks not cleared (they stay the line's)", !wrote(s, 0, "temp_hu_data") && !wrote(s, 1, "temp_hu_data"));

  // the same material on two lines: each takes different stock; the rest named as short outside the staging bin
  s = session(ia([line("5001", "C1", [pk("C1", "L1", 1)]), line("5002", "C1", [pk("C1", "L1", 1)])]), { this: { isEdit: true } });
  await gap(s, [{ iaLineId: "5001", missing: "60" }, { iaLineId: "5002", missing: "60" }]);
  v = s.v();
  check("GAP: two lines of one material share L0's 100, never L1's 50", same([at(v.stock_movement[0]), at(v.stock_movement[1])], [[["L1", 1], ["L0", 60]], [["L1", 1], ["L0", 40]]]),
    [at(v.stock_movement[0]), at(v.stock_movement[1])]);
  check("  the shortfall said, outside the staging bin", said(s).length === 1 && /^warning: Not enough loose stock outside the staging bin for: C1 \(20\)/.test(said(s)[0]), said(s));

  // the line's own picks outside the staging bin count as taken (C2: 500 in L0, 495 of it already this line's)
  s = session(ia([line("5001", "C2", [pk("C2", "L1", 5), pk("C2", "L0", 495)])]), { this: { isEdit: true } });
  await gap(s, [{ iaLineId: "5001", missing: "10" }]);
  check("GAP: the line's own L0 picks count as taken: 5 more, not 10", same(at(s.v().stock_movement[0]), [["L1", 5], ["L0", 495], ["L0", 5]]), at(s.v().stock_movement[0]));

  // only the staging bin has it: nothing new, said
  s = session(ia([line("5001", "C2", [pk("C2", "L0", 15)])]), { this: { isEdit: true } });
  await gap(s, [{ iaLineId: "5001", missing: "5" }], "L0");
  check("GAP: stock only at the staging bin -> the picks as they were, the shortfall said", same(at(s.v().stock_movement[0]), [["L0", 15]]) &&
    said(s).some((m) => /^warning: Not enough loose stock outside the staging bin for: C2 \(5\)/.test(m)), [at(s.v().stock_movement[0]), said(s)]);

  // what the gap names that is not a line of this IA, or nothing missing: ignored
  s = session(ia([line("5001", "C1", [pk("C1", "L1", 15)])]), { this: { isEdit: true } });
  await gap(s, [{ iaLineId: "9999", missing: "5" }, { iaLineId: "5001", missing: "0" }, { iaLineId: "5001", missing: "-1" }, { iaLineId: "5001", missing: "x" }, null]);
  check("GAP: a line not on the IA, nothing missing, not a number -> no write, nothing said", !wrote(s, 0) && said(s).length === 0, said(s));

  // never on a viewed IA, a Completed one, or without the staging bin
  for (const [label, values, bin] of [["a viewed IA", ia([line("5001", "C1", [pk("C1", "L1", 15)])], { page_status: "View" }), "L1"],
    ["a Completed IA", ia([line("5001", "C1", [pk("C1", "L1", 15)])], { item_assembly_status: "Completed" }), "L1"],
    ["no staging bin", ia([line("5001", "C1", [pk("C1", "L1", 15)])]), ""]]) {
    s = session(values, { this: { isEdit: true } });
    await gap(s, [{ iaLineId: "5001", missing: "5" }], bin);
    check("GAP on " + label + ": nothing", !wrote(s, 0) && said(s).length === 0, said(s));
  }
  H.done("test_sc_gap");
})();
