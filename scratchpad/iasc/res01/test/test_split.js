// RES-01 R4: the completion split (res01/code/shared/split.js, used by IA_SAVE's code_node_RESsplit and IA_V2_PREPARE's plan): each pick
// split by the IA's own Allocated holds of its line + material + bin + batch + category, in pick order: the held part from Reserved, the
// rest as picked; a reservation still running -> busy
//   node scratchpad/iasc/res01/test/test_split.js
const path = require("path");
const C = require(path.join(process.env.HD_CODE || path.join(__dirname, "..", "code"), "shared", "split.js"));
let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 900) + "\n  want " + JSON.stringify(want).slice(0, 900));
  }
};
const EA = "77";
const CTN = "78";
const items = [{ id: "C1", based_uom: EA, table_uom_conversion: [{ alt_uom_id: CTN, base_qty: 12 }] }, { id: "C2", based_uom: EA, table_uom_conversion: [] }];
const pk = (bin, qty, o) => Object.assign({ material_id: "C1", location_id: bin, batch_id: null, sm_quantity: qty, category: "Unrestricted" }, o || {});
const line = (id, item, uom, picks) => ({ id: id, item_selection: item, quantity_uom: uom, temp_qty_data: JSON.stringify(picks), line_index: 1 });
const row = (line, mat, bin, qty, o) => Object.assign({ id: "R" + line + bin, status: "Allocated", doc_line_id: line, material_id: mat, bin_location: bin, batch_id: null,
  from_category: "Unrestricted", open_qty: String(qty), item_uom: EA }, o || {});
const picksOf = (r, i) => JSON.parse(r.lines[i].temp_qty_data).map((p) => [p.location_id, p.category, p.sm_quantity]);
{
  const r = C.resSplitLines([line("L1", "C1", EA, [pk("B1", 3), pk("B1", 2), pk("B2", 4, { category: "Blocked" })])],
    { rows: [row("L1", "C1", "B1", 4), row("L1", "C1", "B2", 1, { from_category: "Blocked" })], live: 0 }, items);
  eq("held 4 at B1 over two picks (3, then 1 of 2), held 1 Blocked at B2", [r.busy, picksOf(r, 0)],
    [false, [["B1", "Reserved", 3], ["B1", "Reserved", 1], ["B1", "Unrestricted", 1], ["B2", "Reserved", 1], ["B2", "Blocked", 3]]]);
}
{
  const r = C.resSplitLines([line("L1", "C1", CTN, [pk("B1", 2)])], { rows: [row("L1", "C1", "B1", 12)], live: 0 }, items);
  eq("a carton line: 12 EA held = 1 CTN from Reserved, 1 CTN as picked", picksOf(r, 0), [["B1", "Reserved", 1], ["B1", "Unrestricted", 1]]);
}
{
  const r = C.resSplitLines([line("L1", "C1", EA, [pk("B1", 2)]), line("L2", "C1", EA, [pk("B1", 2)])], { rows: [row("L2", "C1", "B1", 2)], live: 0 }, items);
  eq("a hold belongs to its line: L1 as picked, L2 from Reserved", [picksOf(r, 0), picksOf(r, 1)], [[["B1", "Unrestricted", 2]], [["B1", "Reserved", 2]]]);
}
{
  const hu = C.resSplitLines([line("L1", "C1", EA, [pk("B1", 2, { handling_unit_id: "H1" })])], { rows: [row("L1", "C1", "B1", 2)], live: 0 }, items);
  eq("a handling-unit pick: never from Reserved", picksOf(hu, 0), [["B1", "Unrestricted", 2]]);
  const other = C.resSplitLines([line("L1", "C1", EA, [pk("B1", 2)])], { rows: [row("L1", "C1", "B1", 2, { status: "Cancelled" })], live: 0 }, items);
  eq("only Allocated holds count", picksOf(other, 0), [["B1", "Unrestricted", 2]]);
}
{
  // review M1: what the split took from Reserved, in base units per line + material + bin + batch + category (CLOSE delivers by it)
  const r = C.resSplitLines([line("L1", "C1", CTN, [pk("B1", 2)]), line("L2", "C1", EA, [pk("B1", 3), pk("B2", 1, { category: "Blocked" })])],
    { rows: [row("L1", "C1", "B1", 12), row("L2", "C1", "B1", 2), row("L2", "C1", "B2", 1, { from_category: "Blocked" })], live: 0 }, items);
  eq("used: base units taken from Reserved per line + material + bin + batch + category", r.used,
    { "L1|C1|B1||Unrestricted": 12, "L2|C1|B1||Unrestricted": 2, "L2|C1|B2||Blocked": 1 });
  eq("used: nothing held -> nothing used", C.resSplitLines([line("L1", "C1", EA, [pk("B1", 2)])], { rows: [], live: 0 }, items).used, {});
}
{
  eq("a live hold ticket: busy", C.resSplitLines([], { rows: [], live: 1 }, items).busy, true);
  eq("a hold in flight (Processing / Releasing): busy", [C.resSplitLines([], { rows: [row("L1", "C1", "B1", 1, { status: "Processing" })], live: 0 }, items).busy,
    C.resSplitLines([], { rows: [row("L1", "C1", "B1", 1, { status: "Releasing" })], live: 0 }, items).busy], [true, true]);
  eq("no read: busy (never issue as if nothing were held)", C.resSplitLines([], null, items).busy, true);
}
console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
