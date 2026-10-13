// GD list Convert to Picking: buildConsumedQtyMap (ConvertToPicking.js) and getConsumedTotals
// (SplitPickingAssigneeConfirm.js), the git HEAD version vs the working copy, on one fake transfer_order table.
// usage: node test_convert_picking_client.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { execSync } = require("child_process");

const REPO = path.join(__dirname, "..", "..");
const DIR = "Bulk Actions/Sales & Distribution/Goods Delivery/";
const head = (f) => execSync(`git show "HEAD:${DIR}${f}"`, { cwd: REPO, encoding: "utf8" });
const work = (f) => fs.readFileSync(path.join(REPO, DIR, f), "utf8");
// Everything before the trailing IIFE: the file's function definitions.
const defs = (src) => src.slice(0, src.lastIndexOf("\n(async () => {"));

const PICKINGS = [
  { id: "P1", to_status: "Completed", gd_no: ["g2"],
    table_picking_records: [
      { gd_line_id: "L1", source_bin: "B1", batch_no: "X", handling_unit_id: null, store_out_qty: 3 },
      { gd_line_id: "L2", source_bin: "B2", batch_no: null, handling_unit_id: "H1", store_out_qty: 1.5 },
      { gd_line_id: "L2", source_bin: "B2", batch_no: null, handling_unit_id: "H1", store_out_qty: 2, line_status: "Cancelled" }],
    table_picking_items: [{ gd_line_id: "L1", source_bin: "B1", qty_to_pick: 99 }] },
  { id: "P2", to_status: "In Progress", gd_no: ["g2"],
    table_picking_items: [
      { gd_line_id: "L1", source_bin: "B1", batch_no: "X", qty_to_pick: 4 },
      { gd_line_id: "L1", source_bin: "B9", item_batch_id: "Y", qty_to_pick: 1 },
      { gd_line_id: "L3", row_type: "header", qty_to_pick: 50 },
      { gd_line_id: "L3", line_status: "Cancelled", qty_to_pick: 7 }],
    table_picking_records: [{ gd_line_id: "L1", source_bin: "B1", store_out_qty: 77 }] },
  { id: "P3", to_status: "Cancelled", gd_no: ["g2"], table_picking_items: [{ gd_line_id: "L1", qty_to_pick: 5 }] },
  { id: "P4", to_status: "Created", gd_no: ["g2", "g3"],
    table_picking_items: [{ gd_line_id: "L5", source_bin: "B5", qty_to_pick: 6 }, { gd_line_id: "L3", source_bin: "B3", qty_to_pick: 2 }] },
];

const makeDb = (failFor) => {
  const log = { reads: [], inFlight: 0, maxInFlight: 0 };
  const db = {
    collection: (name) => ({
      where: (cond) => {
        let fields = null;
        const q = {
          field: (f) => { fields = f.split(","); return q; },
          get: async () => {
            assert.strictEqual(name, "transfer_order");
            log.reads.push({ gd: cond.gd_no, fields });
            log.inFlight += 1;
            log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
            await new Promise((r) => setTimeout(r, 2));
            log.inFlight -= 1;
            if (failFor && cond.gd_no === failFor) throw new Error("statement timeout");
            const rows = PICKINGS.filter((p) => p.gd_no.includes(cond.gd_no)).map((p) => {
              if (!fields) return JSON.parse(JSON.stringify(p));
              const out = {};
              for (const f of fields) if (p[f] !== undefined) out[f] = JSON.parse(JSON.stringify(p[f]));
              return out;
            });
            return { data: rows };
          },
        };
        return q;
      },
    }),
  };
  return { db, log };
};

const load = (src, names, db) =>
  new Function("db", `${defs(src)}\nreturn { ${names.join(", ")} };`)(db);

(async () => {
  const gds = ["g1", "g2", "g3"];
  for (const [file, fn] of [["ConvertToPicking.js", "buildConsumedQtyMap"], ["SplitPickingAssigneeConfirm.js", "getConsumedTotals"]]) {
    const before = makeDb();
    const after = makeDb();
    const oldOut = await load(head(file), [fn], before.db)[fn](gds);
    const newOut = await load(work(file), [fn], after.db)[fn](gds);
    // HEAD counts P4 (it covers g2 and g3) twice: L5 and L3 doubled. Now once; everything else unchanged.
    const once = JSON.parse(JSON.stringify(oldOut));
    if (fn === "buildConsumedQtyMap") { once.L5["B5_no-batch_no-hu"] /= 2; once.L3["B3_no-batch_no-hu"] /= 2; }
    else { once.L5 /= 2; once.L3 /= 2; }
    assert.deepStrictEqual(newOut, once);
    assert.ok(after.log.reads.every((r) => !(r.fields || []).includes("table_picking_items") || !(r.fields || []).includes("table_picking_records")));
    assert.ok(before.log.reads.some((r) => !r.fields || (r.fields.includes("table_picking_items") && r.fields.includes("table_picking_records"))));
    assert.strictEqual(after.log.reads.filter((r) => r.gd === "g1").length, 1); // no Pickings: one status read
    console.log(`  ${fn}: as HEAD, except the Picking shared by g2 and g3 counted once (${JSON.stringify(newOut)}); no read joins both subforms; g1 read once`);
  }

  // 40 GDs: at most 6 GDs in flight, each with up to 2 subform reads at once (HEAD sends all 40 at once).
  const many = Array.from({ length: 40 }, (_, i) => (i % 2 ? "g2" : "g" + (10 + i)));
  const before = makeDb();
  const after = makeDb();
  await load(head("ConvertToPicking.js"), ["buildConsumedQtyMap"], before.db).buildConsumedQtyMap(many);
  await load(work("ConvertToPicking.js"), ["buildConsumedQtyMap"], after.db).buildConsumedQtyMap(many);
  assert.ok(after.log.maxInFlight <= 12, after.log.maxInFlight);
  console.log(`  concurrency: HEAD ${before.log.maxInFlight} reads at once, now ${after.log.maxInFlight}`);

  // A failed read: HEAD counts the GD as nothing picked; now the conversion stops with a message.
  const failing = makeDb("g2");
  const headOut = await load(head("ConvertToPicking.js"), ["buildConsumedQtyMap"], failing.db).buildConsumedQtyMap(gds);
  assert.ok(!headOut.L1, "HEAD silently drops g2");
  await assert.rejects(load(work("ConvertToPicking.js"), ["buildConsumedQtyMap"], makeDb("g2").db).buildConsumedQtyMap(gds));

  const alerts = [];
  let converted = false;
  const page = {
    getComponent: () => ({ $refs: { crud: { tableSelect: [{ id: "g2", organization_id: "o", table_gd: [] }], clearSelection() {} } } }),
    showLoading() {}, hideLoading() {},
    $alert: async (msg, title) => { alerts.push(title); },
    $confirm: async () => { converted = true; },
    openDialog: async () => { converted = true; },
    setData: async () => {},
    $message: { error: () => {} },
  };
  const fdb = makeDb("g2").db;
  const realCollection = fdb.collection;
  fdb.collection = (name) => (name === "picking_setup"
    ? { where: () => ({ get: async () => ({ data: [{ allow_full_picking: 1 }] }) }) }
    : realCollection(name));
  global.db = fdb;
  new Function(work("ConvertToPicking.js")).call(page);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(alerts, ["Conversion Not Started"]);
  assert.strictEqual(converted, false);
  console.log("  a failed read: HEAD treats the GD as unpicked; now the convert stops with 'Conversion Not Started'");
  console.log("all passed");
})().catch((e) => { console.error(e); process.exit(1); });
