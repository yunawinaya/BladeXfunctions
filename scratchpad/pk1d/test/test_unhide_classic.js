// test_unhide_classic.js [PickingProcessWorkflow.json]: classic PICKING's Packing builder (code_node_gudzrvMQ), run from the
// workflow file as built. A GD's save-time Packing shell is kept hidden (HIDDEN, default Processing) until something is picked;
// the confirm that fills it must make it visible (packingsToUnhide -> packing_status Created). Any other status is never
// written. Exit 0 only if every case holds.
const fs = require("fs");
const HIDDEN = process.env.HIDDEN || "Processing";
const file = process.argv[2] || __dirname + "/../../../Picking/PickingProcessWorkflow.json";
const w = JSON.parse(fs.readFileSync(file, "utf8"));
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
const code = find(w, "code_node_gudzrvMQ").data.script.code;
const holders = [...new Set(code.match(/\{\{[^}]+\}\}/g))];
const run = (existingStatus) => {
  const vals = {
    "node:code_node_pMVdQBEQ.data.packingDataList": [{ gd_id: "G1", gd_no: "GD/1", plant_id: "P", organization_id: "O", huItemsPartial: [],
      table_item_source: [{ gd_line_id: "L1", bin_location: "B1", batch_no: "", picked_qty: 1, line_status: "Fully Picked" }] }],
    "node:search_node_mUPqqQph.data.data": [],
    "node:search_node_i5v6z7Hu.data.data": [],
    "node:search_node_c7BtNx91.data.data": [{ id: "G1", delivery_no: "GD/1" }],
    "node:search_node_FXknErTg.data.data": [{ id: "PK1", gd_id: "G1", packing_status: existingStatus, table_item_source: [], table_hu_source: [] }],
  };
  const names = holders.map((_, i) => "__p" + i);
  let body = code;
  holders.forEach((h, i) => { body = body.split(h).join(names[i]); });
  const args = holders.map((h) => {
    const k = h.slice(2, -2);
    if (!(k in vals)) throw new Error("test has no value for " + h);
    return JSON.parse(JSON.stringify(vals[k]));
  });
  const r = new Function(...names, body)(...args);
  return [r.hasUpdates, r.hasUnhide, (r.packingsToUnhide || []).map((x) => [x.id, x.packing_status])];
};
const cases = [
  ["the hidden shell is refreshed and made visible", run(HIDDEN), [1, 1, [["PK1", "Created"]]]],
  ["a visible Created Packing: refreshed, status untouched", run("Created"), [1, 0, []]],
  ["a Packing being packed (In Progress): refreshed, status untouched", run("In Progress"), [1, 0, []]],
];
let ok = true;
for (const [name, got, want] of cases) {
  const g = JSON.stringify(got), x = JSON.stringify(want), pass = g === x;
  ok = ok && pass;
  console.log((pass ? "ok   " : "FAIL ") + name + ": " + g + (pass ? "" : "  (want " + x + ")"));
}
console.log(ok ? cases.length + "/" + cases.length + " passed" : "un-hide classic test FAILED");
process.exit(ok ? 0 : 1);
