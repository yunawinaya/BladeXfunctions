// augment.js <reads.json> <out.json>: adds a synthetic OPEN Packing to a GD's PREPARE reads (test/run_reads.py) so the plan and the
// COMMIT simulation cover X4K / X4H: the Packing (Created) with the GD's two item lines, a generated box H1 holding one item and a
// nested box H2, a pending row (no box), a 'locked' box H3 (real stock, released only), the source row of H2. Nothing is written.
const fs = require("fs");
const [inFile, outFile] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(inFile, "utf8"));
const J = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (x) => (x[0] === '"' ? x : '"' + x + '"')));
const hdr = J(S.hdr[0].j);
const lines = S.lines.map((r) => J(r.j));
const gd = String(hdr.id), no = String(hdr.delivery_no);
const PK = "9100000000000000001", H1 = "9100000000000000011", H2 = "9100000000000000012", H3 = "9100000000000000013";
const l0 = lines[0];
const td = [{ line_index: 0, item_id: String(l0.material_id), total_quantity: 3, bin_location: "5", gd_no: no },
  { type: "nested_hu", nested_hu_id: H2, children: [{ item_id: String(l0.material_id), total_quantity: 1, gd_no: no }] }];
const row = (k, o) => ({ k: k, j: JSON.stringify(o) });
S.pack = [
  row("H", { id: PK, packing_no: "PACK/TEST/0001", packing_status: "Created", gd_status: null, gd_id: gd, gd_no: no, lock_session: "", lock_user: "", lock_live: "0" }),
  ...lines.map((l, i) => row("L", { id: "91000000000000001" + (20 + i), packing_id: PK, gd_id: gd, gd_no: no, line_status: "Fully Picked", remaining_qty: "0.00000000" })),
  row("S", { id: "9100000000000000030", packing_id: PK, gd_id: gd, gd_no: no, handling_unit_id: H2, hu_status: "Completed", row_type: "header" }),
  row("U", { id: "9100000000000000041", packing_id: PK, hu_row_type: "generated", handling_unit_id: H1, handling_no: "HU/T1", hu_status: "Completed", item_count: 2,
    total_quantity: "3.00000000", parent_hu_id: "", temp_data: JSON.stringify(td), storage_location_id: "4", location_id: "5", hu_quantity: 1, hu_uom: "6", hu_material_id: "7", hu_type: "Carton Box", remark: "" }),
  row("U", { id: "9100000000000000042", packing_id: PK, hu_row_type: "generated", handling_unit_id: "", handling_no: "Auto-generated number", hu_status: "Packed", item_count: 1, total_quantity: "2.00000000", parent_hu_id: "", temp_data: "[]" }),
  row("U", { id: "9100000000000000043", packing_id: PK, hu_row_type: "locked", handling_unit_id: H3, handling_no: "HU/T3", hu_status: "Completed", item_count: 1, total_quantity: "4.00000000", parent_hu_id: "", temp_data: "[]" }),
];
S.box = [
  row("HU", { id: H1, handling_no: "HU/T1", hu_status: "Packed", packing_id: PK, parent_hu_id: "", total_quantity: "3.00000000", item_count: 1 }),
  row("HU", { id: H2, handling_no: "HU/T2", hu_status: "Packed", packing_id: "", parent_hu_id: H1, total_quantity: "1.00000000", item_count: 1 }),
  row("HU", { id: H3, handling_no: "HU/T3", hu_status: "Packed", packing_id: PK, parent_hu_id: "", total_quantity: "4.00000000", item_count: 1 }),
  row("HI", { id: "9100000000000000051", handling_unit_id: H1, material_id: String(l0.material_id), balance_id: "8", batch_id: null, quantity: "3.00000000", material_uom: "6", location_id: "5" }),
  row("HI", { id: "9100000000000000052", handling_unit_id: H2, material_id: String(l0.material_id), balance_id: "8", batch_id: null, quantity: "1.00000000", material_uom: "6", location_id: "5" }),
  row("HI", { id: "9100000000000000053", handling_unit_id: H3, material_id: String(l0.material_id), balance_id: "8", batch_id: null, quantity: "4.00000000", material_uom: "6", location_id: "5" }),
];
fs.writeFileSync(outFile, JSON.stringify(S));
console.log("augmented: Packing", PK, "boxes", H1, H2, H3);
