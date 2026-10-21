// test_revert_size_guard.js [workflow.json] [--mutate name]: GD_REVERT_COMPLETED on the workflow simulator. Over 500 lines (bundle
// rows counted) -> 400 with the line count, before the snapshot read, any write or GD_PROCESS_REVERT; 500 lines -> on to the
// snapshot read; a delivery that is not Completed keeps its own refusal first.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../gdc/pkv2tools/sim/engine.js");
const args = process.argv.slice(2);
const mutate = args.indexOf("--mutate") >= 0 ? args[args.indexOf("--mutate") + 1] : "";
const FILE = args.find((a) => a.endsWith(".json")) || __dirname + "/../../Goods Delivery/RevertCompletedGD/GDheadRevertWorkflow.json";
const MUT = { no_guard: ["'{{node:code_node_hrSizeGuard.data.tooBig}}' == '1'", "'0' == '1'"] };

function run(allData) {
  let text = fs.readFileSync(FILE, "utf8");
  if (mutate) { if (text.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant does not apply"); text = text.split(MUT[mutate][0]).join(MUT[mutate][1]); }
  const wf = JSON.parse(text);
  const calls = [];
  const e = new Engine({ dir: __dirname, db: { tenantId: "000000", update: (tb) => { calls.push("write " + tb); return 0; }, insert: (tb) => { calls.push("insert " + tb); return []; } },
    mocks: { sql: {}, read: { search_node_hrFindSnap: () => { calls.push("snapshot read"); return { data: [] }; } } } });
  e.load = (name) => { if (name !== "GD_REVERT_COMPLETED") { calls.push("child " + name); return { nodes: [] }; } return wf; };
  const r = e.run("GD_REVERT_COMPLETED", { allData, pageStatus: "Edit" });
  return { out: r.returned || {}, calls };
}
const gd = (n, extra) => Object.assign({ id: "2112173617561776130", delivery_no: "GD/TEST/1", gd_status: "Completed", plant_id: "1", organization_id: "1",
  table_gd: Array.from({ length: n }, (_, i) => ({ material_id: "9" + i, so_line_item_id: "8" + i, line_so_id: "7", gd_qty: 1 })) }, extra || {});
let n = 0, bad = 0;
const t = (name, f) => { try { f(); n++; console.log("ok", name); } catch (e) { bad++; console.log("FAIL", name, "-", String(e.message).split("\n")[0]); } };
t("501 lines -> 400 with the count; nothing read, written or called", () => {
  const r = run(gd(501));
  assert.strictEqual(r.out.code, "400");
  assert.strictEqual(r.out.message, "Goods Delivery GD/TEST/1 has 501 lines. Reverting a completed delivery supports at most 500 lines for now; please contact support.");
  assert.deepStrictEqual(r.calls, []);
});
t("500 lines -> past the guard (the snapshot is read next)", () => {
  const r = run(gd(500));
  assert.deepStrictEqual(r.calls, ["snapshot read"]);
  assert.ok(/No active snapshot/.test(r.out.message), r.out.message);
});
t("bundle rows count: 450 item lines + 51 bundle rows -> refused", () => {
  const g = gd(450);
  for (let i = 0; i < 51; i++) g.table_gd.push({ item_bundle_id: "B" + i, material_id: "", so_line_item_id: "6" + i, gd_qty: 1 });
  const r = run(g);
  assert.strictEqual(r.out.code, "400");
  assert.ok(/has 501 lines/.test(r.out.message), r.out.message);
});
t("not Completed keeps its own answer first, whatever the size", () => {
  const r = run(gd(600, { gd_status: "Created" }));
  assert.strictEqual(r.out.message, "Only Completed Goods Deliveries can be reverted");
});
console.log(n + " passed, " + bad + " failed" + (mutate ? " (mutant " + mutate + ")" : ""));
if (bad) process.exit(1);
