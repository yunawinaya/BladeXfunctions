// node scratchpad/iasc/test/bulk_sc_bom.js [tenant] - sc_bom.js over every BOM of a dev tenant (fixture from pull_bom_fixture.py):
// STANDARD must equal today's explode (iaForm_onChange_assembledItem.js l.578-681, transcribed below as the oracle);
// FLAT "expand all" must resolve every root (or stop with a guard) and reports the largest results.
const fs = require("fs");
const os = require("os");
const path = require("path");
const B = require(process.env.SC_BOM || path.join(__dirname, "..", "code", "shared", "sc_bom.js"));

const TENANT = process.argv[2] || "711077";
const FIXTURE = path.join(os.homedir(), "Documents", "ASC-dev", "iasc-fixtures", "bom" + TENANT + ".json");
if (!fs.existsSync(FIXTURE)) {
  console.log("SKIP: no fixture " + FIXTURE + " (run python3 scratchpad/iasc/test/pull_bom_fixture.py " + TENANT + ")");
  process.exit(0);
}
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const items = {};
fx.items.forEach((it) => {
  items[it.id] = it;
});
const byParent = {};
fx.boms.forEach((b) => {
  (byParent[b.parent_material_code] = byParent[b.parent_material_code] || []).push(b);
});
const io = {
  readBoms: async (ids) => [].concat.apply([], ids.map((id) => byParent[id] || [])),
  readItems: async (ids) => ids.map((id) => items[id]).filter(Boolean),
};
// the live explode's row computation (oracle)
const today = (bom, itemQty) => {
  const subs = (bom.subform_sub_material || []).filter((s) => s.bom_material_code && s.consume_type !== "REF");
  const base = parseFloat(bom.parent_mat_base_quantity) || 0;
  return subs.map((sub) => {
    const item = items[sub.bom_material_code];
    const w = parseFloat(sub.sub_material_wastage) || 0;
    let q = parseFloat((itemQty / base) * (parseFloat(sub.sub_material_qty) || 0) * (1 + w / 100));
    if (item && item.serial_number_management === 1) q = Math.ceil(q);
    return [sub.bom_material_code, sub.sub_material_qty_uom || (item && item.based_uom) || "", Number(q.toFixed(8))];
  });
};

(async () => {
  const t0 = Date.now();
  const stats = { roots: 0, stdSame: 0, stdDiff: [], stdErr: {}, flatOk: 0, flatErr: {}, expanded: 0, maxRows: [0, ""], maxPaths: [0, ""], maxTicks: [0, ""], depthLimited: 0,
    maxSnapStd: [0, ""], maxSnapFlat: [0, ""] };
  // the snapshot is a form field: its JSON travels with every IA_SAVE / IA_V2_SUBMIT payload
  const size = (snap) => Buffer.byteLength(JSON.stringify(snap), "utf8");
  for (const bom of fx.boms) {
    if (!(bom.subform_sub_material || []).length) continue;
    const fg = items[bom.parent_material_code];
    if (!fg) continue;
    stats.roots++;
    for (const qty of [1, 3]) {
      const std = await B.scResolve({ mode: "STANDARD", itemId: bom.parent_material_code, itemUomId: fg.based_uom, outputQty: qty, fg: fg }, io);
      if (!std.ok) {
        stats.stdErr[std.code] = (stats.stdErr[std.code] || 0) + 1;
        continue;
      }
      const got = std.rows.map((r) => [r.item_selection, r.quantity_uom, r.requested_qty]);
      const want = today(B.scPickBom(byParent[bom.parent_material_code]), qty);
      if (qty === 1 && size(std.snapshot) > stats.maxSnapStd[0]) stats.maxSnapStd = [size(std.snapshot), bom.id];
      if (JSON.stringify(got) === JSON.stringify(want)) stats.stdSame++;
      else if (stats.stdDiff.length < 5) stats.stdDiff.push({ bom: bom.id, qty: qty, got: got.slice(0, 3), want: want.slice(0, 3) });
    }
    const probe = await B.scResolve({ mode: "FLAT", itemId: bom.parent_material_code, itemUomId: fg.based_uom, outputQty: 1, expand: [], fg: fg }, io);
    if (!probe.ok) {
      stats.flatErr[probe.code] = (stats.flatErr[probe.code] || 0) + 1;
      continue;
    }
    const ticks = probe.tree.filter((t) => t.expandable).map((t) => t.itemId);
    if (probe.tree.some((t) => /depth limit/.test(t.reason))) stats.depthLimited++;
    if (!ticks.length) continue;
    stats.expanded++;
    const flat = await B.scResolve({ mode: "FLAT", itemId: bom.parent_material_code, itemUomId: fg.based_uom, outputQty: 1, expand: ticks, fg: fg }, io);
    if (!flat.ok) {
      stats.flatErr[flat.code] = (stats.flatErr[flat.code] || 0) + 1;
      if (!stats["sample_" + flat.code]) stats["sample_" + flat.code] = bom.id + ": " + flat.message;
      continue;
    }
    stats.flatOk++;
    const paths = flat.snapshot.rows.reduce((n, r) => n + r.paths.length, 0);
    if (flat.rows.length > stats.maxRows[0]) stats.maxRows = [flat.rows.length, bom.id];
    if (paths > stats.maxPaths[0]) stats.maxPaths = [paths, bom.id];
    if (ticks.length > stats.maxTicks[0]) stats.maxTicks = [ticks.length, bom.id];
    if (size(flat.snapshot) > stats.maxSnapFlat[0]) stats.maxSnapFlat = [size(flat.snapshot), bom.id];
    const re = B.scRecompute(flat.snapshot, 1).map((x) => x.qty);
    if (JSON.stringify(re) !== JSON.stringify(flat.rows.map((r) => r.requested_qty))) stats.flatErr.RECOMPUTE_DIFF = (stats.flatErr.RECOMPUTE_DIFF || 0) + 1;
  }
  stats.seconds = (Date.now() - t0) / 1000;
  console.log(JSON.stringify(stats, null, 1));
  const bad = stats.stdDiff.length > 0 || stats.flatErr.RECOMPUTE_DIFF;
  console.log(bad ? "FAILED" : "ok - " + stats.roots + " roots");
  process.exit(bad ? 1 : 0);
})();
