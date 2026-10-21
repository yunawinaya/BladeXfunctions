// RES-01 R5: a reverted completion of an IA that reserves (res01/code/shared/revert.js): a component issued from Reserved (its hold, closed
// at completion) comes back to the bucket its hold came from (this cycle's Delivered rows; review I3); any other component, and every IA
// that never reserved, as today (the category it left from)
//   node scratchpad/iasc/res01/test/test_revert.js
const path = require("path");
const C = require(path.join(process.env.HD_CODE || path.join(__dirname, "..", "code"), "shared", "revert.js"));
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
const items = [{ id: "C1", based_uom: EA, table_uom_conversion: [{ alt_uom_id: CTN, base_qty: 12 }] }];
const add = (cat, o) => Object.assign({ index: 1, material_id: "C1", quantity: 2, inventory_category: cat, location_id: "B1", batch_id: null }, o || {});
// this cycle's Delivered rows (CLOSE): what each hold's completion used, in the row's unit, and the bucket it was held from
const del = (id, cat, qty, o) => Object.assign({ id: id, material_id: "C1", bin_location: "B1", batch_id: null, from_category: cat, delivered_qty: String(qty), item_uom: EA }, o || {});
const cats = (out) => out.map((a) => [a.index, a.quantity, a.inventory_category]);
const BOUND = "2112800000000000100";
{
  const a = [add("Reserved", { index: 4, quantity: 3 }), add("Reserved", { index: 5, quantity: 2 }), add("Unrestricted", { index: 6 }), add("Blocked", { index: 7 })];
  eq("an IA that reserves: each return from Reserved goes back to the bucket its hold came from (review I3); the rest as issued",
    cats(C.resRevertAdds(a, "CLOSED", [del("2112800000000000201", "Unrestricted", 2), del("2112800000000000202", "Blocked", 3)], BOUND, items)),
    [[4, 3, "Blocked"], [5, 2, "Unrestricted"], [6, 2, "Unrestricted"], [7, 2, "Blocked"]]);
  eq("an IA that never reserved: as today", cats(C.resRevertAdds(a, "", [del("2112800000000000201", "Blocked", 5)], BOUND, items)),
    [[4, 3, "Reserved"], [5, 2, "Reserved"], [6, 2, "Unrestricted"], [7, 2, "Blocked"]]);
}
eq("one return covering two holds: split by bucket, the extra part a new index after the last",
  cats(C.resRevertAdds([add("Reserved", { index: 3, quantity: 5 })], "CLOSED", [del("2112800000000000201", "Unrestricted", 2), del("2112800000000000202", "Blocked", 3)], BOUND, items)),
  [[3, 2, "Unrestricted"], [4, 3, "Blocked"]]);
eq("more returned from Reserved than this cycle delivered: the rest back to Reserved, as it left",
  cats(C.resRevertAdds([add("Reserved", { index: 3, quantity: 4 })], "CLOSED", [del("2112800000000000201", "Unrestricted", 1)], BOUND, items)), [[3, 1, "Unrestricted"], [4, 3, "Reserved"]]);
eq("an earlier cycle's Delivered rows (id not above the bound) are not this completion's",
  cats(C.resRevertAdds([add("Reserved", { index: 3, quantity: 2 })], "CLOSED", [del("2112800000000000099", "Blocked", 2), del("2112800000000000201", "Unrestricted", 2)], BOUND, items)),
  [[3, 2, "Unrestricted"]]);
eq("a carton row: 1 CTN delivered = 12 EA back to its bucket",
  cats(C.resRevertAdds([add("Reserved", { index: 3, quantity: 12 })], "CLOSED", [del("2112800000000000201", "Blocked", 1, { item_uom: CTN })], BOUND, items)), [[3, 12, "Blocked"]]);
eq("another bin's or batch's rows never count", cats(C.resRevertAdds([add("Reserved", { index: 3 })], "CLOSED",
  [del("2112800000000000201", "Blocked", 2, { bin_location: "B2" }), del("2112800000000000202", "Blocked", 2, { batch_id: "T1" })], BOUND, items)), [[3, 2, "Reserved"]]);
eq("a handling-unit return (never held): as it left", cats(C.resRevertAdds([add("Reserved", { index: 3, handling_unit_id: "H1" })], "CLOSED",
  [del("2112800000000000201", "Unrestricted", 2)], BOUND, items)), [[3, 2, "Reserved"]]);
eq("nothing else changes", C.resRevertAdds([add("Reserved", { quantity: 3, unit_price: 1.5 })], "FULL", [del("2112800000000000201", "Unrestricted", 3)], BOUND, items)
  .map((a) => [a.quantity, a.unit_price, a.location_id]), [[3, 1.5, "B1"]]);
eq("not a list: an empty list", C.resRevertAdds(null, "FULL", [], BOUND, items), []);
// the cycle a revert undoes starts after the IA's last revert: its highest 'IA-R' movement, else the IA id (ids compared as text)
eq("bound: the highest IA-R movement id", C.resRevertBound([{ id: "2112800000000000300", transaction_type: "IA" }, { id: "2112800000000000150", transaction_type: "IA-R" },
  { id: "2112800000000000160", transaction_type: "IA-R" }, { id: "999", transaction_type: "IA-R" }], "2112800000000000001"), "2112800000000000160");
eq("bound: never reverted -> the IA id", C.resRevertBound([{ id: "2112800000000000300", transaction_type: "IA" }], "2112800000000000001"), "2112800000000000001");
eq("bound: no rows -> the IA id", C.resRevertBound(null, "2112800000000000001"), "2112800000000000001");
console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
