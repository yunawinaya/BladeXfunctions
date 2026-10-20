// test_revert_cost.js <workflow.json>: runs GD_PROCESS_REVERT's code_node_inConflictBatch from the given file against mock
// inputs and checks the unit_price each returned-stock movement carries (exact bin + handling unit, then batch, then item,
// else 0), for every shape the delivery-cost SQL result can take.
const fs = require("fs"), assert = require("assert");
const wf = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const code = find(wf, "code_node_inConflictBatch").data.script.code;
const GD = "2111000000000000001";
const res = (id, mat, batch, bin, hu, qty) => ({ id, target_gd_id: GD, status: "Delivered", delivered_qty: qty, reserved_qty: qty, material_id: mat, batch_id: batch, bin_location: bin, handling_unit_id: hu, item_uom: "U1", parent_no: "SO/1", doc_type: "Good Delivery", doc_id: GD, doc_no: "GD/1", doc_line_id: "L" + id });
const reserved = [
  res("r1", "M", "B1", "X", null, 2),  // exact (M, B1, X, loose)
  res("r2", "M", "B1", "X", "H", 1),   // exact (M, B1, X, H)
  res("r3", "M", "B1", "Y", null, 1),  // bin not delivered from -> batch B1
  res("r4", "M", "B2", "X", null, 1),  // batch not delivered -> item M
  res("r5", "N", null, "X", null, 3),  // item not delivered -> 0
];
const run = (dlvSubst) => {
  const subst = {
    "{{node:code_node_inParseSnap.data}}": JSON.stringify({ pre_pending_state: [], pre_on_reserved_gd_ids: reserved.map((r) => r.id), pre_picking_records: [], pre_pp_headers: [], pre_hu_state: { hus: [], lines: [] }, pp_restamp_map: {} }),
    "{{node:search_node_inCurReserved.data.data}}": JSON.stringify(reserved),
    "{{node:search_node_inCurPending.data.data}}": "[]",
    "{{node:search_node_inCurPicking.data.data}}": "[]",
    "{{node:search_node_inCurPpHdr.data.data}}": "[]",
    "{{node:search_node_inCurHu.data.data}}": "[]",
    "{{node:search_node_inCurHuLn.data.data}}": "[]",
    "{{node:sql_node_InItems.data}}": JSON.stringify([{ id: "M", stock_control: "1" }, { id: "N", stock_control: "1" }]),
    "{{workflowparams:tableData}}": "[]",
    "{{node:code_node_inExtract.data.docId}}": JSON.stringify(GD),
    "{{node:sql_node_inDlvCost.data}}": dlvSubst,
  };
  let src = code;
  for (const [k, v] of Object.entries(subst)) src = src.split(k).join(v);
  const left = src.match(/\{\{[^}]+\}\}/g);
  assert.ok(!left, "unsubstituted placeholders: " + left);
  const out = new Function(src)();
  assert.strictEqual(out.hasConflicts, 0);
  return Object.fromEntries(out.inventoryMovements.map((m, i) => [reserved.filter((r) => r.delivered_qty > 0)[i].id, m.unit_price]));
};
const rows = [
  { item: "M", b: "B1", bin: "X", hu: "0", tp: "10.00000000", bq: "2.00000000" }, // 5.00 a unit
  { item: "M", b: "B1", bin: "X", hu: "H", tp: "8.00000000", bq: "1.00000000" },  // 8.00 a unit from the handling unit
  { item: "M", b: "B3", bin: "X", hu: "0", tp: "3.00000000", bq: "1.00000000" },  // another batch of M: 3.00
];
let n = 0;
const ok = (name) => { n++; console.log("ok", name); };

let p = run(JSON.stringify(rows));
assert.deepStrictEqual(p.r1, 5, "exact loose bin");
assert.deepStrictEqual(p.r2, 8, "exact handling unit");
assert.deepStrictEqual(p.r3, 6, "batch fallback: B1 = (10 + 8) / 3");
assert.deepStrictEqual(p.r4, 5.25, "item fallback: M = (10 + 8 + 3) / 4");
assert.deepStrictEqual(p.r5, 0, "nothing delivered for N keeps 0");
ok("exact bin / handling unit, batch, item, none");

p = run(JSON.stringify(rows[0]));
assert.deepStrictEqual([p.r1, p.r2, p.r5], [5, 5, 0], "a single-row result handed over as an object");
ok("single-row result as an object");

for (const empty of ["", "null", "[]"]) {
  p = run(empty);
  assert.ok(Object.values(p).every((v) => v === 0), "empty result '" + empty + "' -> every price 0");
}
ok("empty result (blank / null / []) keeps 0, no crash");

p = run(JSON.stringify([{ item: "M", b: "B1", bin: "X", hu: "0", tp: "1", bq: "3" }]));
assert.strictEqual(p.r1, 0.33333333, "8-decimal rounding of a division");
ok("q8 rounding of tp / bq");
console.log(n + " passed");
