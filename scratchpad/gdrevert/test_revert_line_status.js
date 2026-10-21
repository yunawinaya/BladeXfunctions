// test_revert_line_status.js [--mutate name]: GD_REVERT_COMPLETED's code_node_hrComputeSoUpdates (Goods Delivery/RevertCompletedGD/
// GDheadRevertWorkflow.json = dev v16 = prod v9) never leaves an SO line without a status (BUG-20261020-024: an older version wrote
// "" when the revert left nothing delivered, and the cancel that followed carried it on). Placeholders are filled the way the
// platform injects them (JSON text); the node runs as written.
const fs = require("fs"), assert = require("assert");
const FILE = __dirname + "/../../Goods Delivery/RevertCompletedGD/GDheadRevertWorkflow.json";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = { old_blank: ['newLineStatus = "Issued";', 'newLineStatus = "";'] };

const wf = JSON.parse(fs.readFileSync(FILE, "utf8"));
let code = null;
(function find(n) {
  if (code) return;
  if (Array.isArray(n)) return n.forEach(find);
  if (n && typeof n === "object") {
    if (n.id === "code_node_hrComputeSoUpdates") code = n.data.script.code;
    Object.values(n).forEach(find);
  }
})(wf.nodes);
if (!code) throw new Error("code_node_hrComputeSoUpdates not found");
if (mutate) { if (code.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant does not apply"); code = code.split(MUT[mutate][0]).join(MUT[mutate][1]); }

function run(gdRows, soLines, soHeaders) {
  const tableData = gdRows.filter((r) => !(r.item_bundle_id && !r.material_id));
  const bundleParentLines = gdRows.filter((r) => r.item_bundle_id && !r.material_id);
  const filled = code
    .split("{{node:code_node_hrExtract.data.tableData}}").join(JSON.stringify(tableData))
    .split("{{node:code_node_hrExtract.data.bundleParentLines}}").join(JSON.stringify(bundleParentLines))
    .split("{{node:search_node_hrCurSoLines.data.data}}").join(JSON.stringify(soLines))
    .split("{{node:search_node_hrCurSoHdr.data.data}}").join(JSON.stringify(soHeaders));
  if (/\{\{/.test(filled)) throw new Error("unfilled placeholder: " + filled.match(/\{\{[^}]*\}\}/)[0]);
  return new Function(filled)();
}
const line = (id, so_quantity, delivered_qty, planned_qty, extra) => Object.assign({ id, so_quantity, delivered_qty, planned_qty, line_status: "Processing" }, extra || {});
const byId = (out) => Object.fromEntries(out.soLineUpdates.map((u) => [u.id, u]));
let n = 0, bad = 0;
const t = (name, f) => { try { f(); n++; console.log("ok", name); } catch (e) { bad++; console.log("FAIL", name, "-", String(e.message).split("\n")[0]); } };

t("the report's case: ordered 3, this GD delivered all 3 -> delivered 0, planned 3, line Issued, header Issued / Created", () => {
  const so = line("L1", 3, 3, 0, { line_status: "Completed" });
  const out = run([{ so_line_item_id: "L1", gd_qty: 3, material_id: "M1" }], [so], [{ id: "S1", table_so: [so] }]);
  assert.deepStrictEqual(byId(out).L1, { id: "L1", planned_qty: 3, delivered_qty: 0, outstanding_quantity: 3, line_status: "Issued" });
  assert.strictEqual(out.soHeaderUpdates[0].so_status, "Issued");
  assert.strictEqual(out.soHeaderUpdates[0].gd_status, "Created");
});
t("another delivery still covers part of the line -> Processing; header Processing / Partially Delivered", () => {
  const so = line("L1", 10, 7, 0);
  const out = run([{ so_line_item_id: "L1", gd_qty: 3, material_id: "M1" }], [so], [{ id: "S1", table_so: [so] }]);
  assert.strictEqual(byId(out).L1.line_status, "Processing");
  assert.strictEqual(byId(out).L1.delivered_qty, 4);
  assert.strictEqual(out.soHeaderUpdates[0].so_status, "Processing");
});
t("other deliveries still cover the whole line -> Completed", () => {
  const so = line("L1", 5, 8, 0, { line_status: "Completed" });
  const out = run([{ so_line_item_id: "L1", gd_qty: 3, material_id: "M1" }], [so], [{ id: "S1", table_so: [so] }]);
  assert.strictEqual(byId(out).L1.line_status, "Completed");
});
t("two delivery rows on one sales order line (a repeated item) -> their quantities add up, line Issued", () => {
  const so = line("L1", 5, 5, 0);
  const out = run([{ so_line_item_id: "L1", gd_qty: 2, material_id: "M1" }, { so_line_item_id: "L1", gd_qty: 3, material_id: "M1" }], [so], [{ id: "S1", table_so: [so] }]);
  assert.strictEqual(byId(out).L1.delivered_qty, 0);
  assert.strictEqual(byId(out).L1.line_status, "Issued");
});
t("an item bundle: the bundle's own line and its items' lines all get a status (the report's two bundle lines)", () => {
  const parent = line("P1", 1, 1, 0, { item_bundle_id: "B1", item_name: "", line_status: "Completed" });
  const c1 = line("C1", 2, 2, 0, { parent_id: "P1" }), c2 = line("C2", 3, 3, 0, { parent_id: "P1" });
  const out = run([{ so_line_item_id: "P1", gd_qty: 1, item_bundle_id: "B1", material_id: "" },
    { so_line_item_id: "C1", gd_qty: 2, material_id: "M1" }, { so_line_item_id: "C2", gd_qty: 3, material_id: "M2" }],
  [parent, c1, c2], [{ id: "S1", table_so: [Object.assign({}, parent, { children: [c1, c2] })] }]);
  const u = byId(out);
  assert.deepStrictEqual([u.P1.line_status, u.C1.line_status, u.C2.line_status], ["Issued", "Issued", "Issued"]);
  assert.strictEqual(u.P1.delivered_qty, 0);
  assert.strictEqual(out.soHeaderUpdates[0].fully_delivered, "0 / 2", "the bundle's own line is not counted as a line of the order");
});
t("every line the revert writes carries Issued, Processing or Completed (never blank)", () => {
  const lines = [line("A", 4, 4, 0), line("B", 4, 1, 0), line("C", 4, 9, 0), line("D", 0, 0, 0)];
  const out = run(lines.map((l, i) => ({ so_line_item_id: l.id, gd_qty: [4, 1, 2, 0][i], material_id: "M" + i })), lines, [{ id: "S1", table_so: lines }]);
  for (const u of out.soLineUpdates) assert.ok(["Issued", "Processing", "Completed"].indexOf(u.line_status) >= 0, u.id + ": " + JSON.stringify(u.line_status));
});
console.log(n + " passed, " + bad + " failed" + (mutate ? " (mutant " + mutate + ")" : ""));
if (bad) process.exit(1);
