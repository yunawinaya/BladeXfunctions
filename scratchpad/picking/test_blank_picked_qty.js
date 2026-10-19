// test_blank_picked_qty.js: PICKING's two record builders (code_node_oHIIKfiw, the GD branch; code_node_Q3hWck9R, the
// Picking Plan branch) treat a line sent with a blank picked_qty (missing / null / "") as NOT picked, the way Picking V2
// and the Add path read it. It used to fall back to qty_to_pick: the web form's untouched lines were recorded as picked in
// full (prod 900938, 27 lines). Runs the nodes out of Picking/PickingProcessWorkflow.json with their placeholders rendered.
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../";
const doc = JSON.parse(fs.readFileSync(R + "Picking/PickingProcessWorkflow.json", "utf8"));
const nodes = (d) => { const out = []; const walk = (l) => { for (const n of l || []) { out.push(n); walk(n.blocks); } }; walk(d.nodes); return out; };
const node = (id) => nodes(doc).filter((n) => n.id === id)[0];
const run = (n, values) => {
  const body = n.data.script.code.replace(/\{\{([^}]+)\}\}/g, (m, k) => { if (!(k in values)) throw new Error(n.id + ": no value for " + k); return JSON.stringify(values[k]); });
  return new Function(body)();
};
const BUILDERS = { GD: "code_node_oHIIKfiw", PP: "code_node_Q3hWck9R" };

const line = (k, x) => Object.assign({ id: "row" + k, item_code: "item" + k, item_name: "Item " + k, item_uom: "uom", qty_to_pick: 3, pending_process_qty: 3,
  source_bin: "bin1", gd_id: "gd1", gd_line_id: "gdl" + k, so_id: "so1", so_line_id: "sol" + k, line_status: "Open" }, x);
const records = (branch, items, opts) => {
  const o = opts || {};
  const stored = { table_picking_items: items.map((i) => ({ id: i.id, gd_id: i.gd_id, line_status: "Open", pending_process_qty: i.pending_process_qty })), table_picking_records: [] };
  const values = new Proxy({}, {
    has: () => true,
    get: (t, k) => {
      if (k === "workflowparams:allData") return { gd_no: ["gd1"], delivery_no: "GD/1", so_no: "SO/1", table_picking_items: items };
      if (k === "workflowparams:isForceComplete") return o.force ? 1 : null;
      if (k === "workflowparams:confirmed_by") return "tester";
      if (/^node:get_node_[A-Za-z0-9]+\.data\.data$/.test(k)) return stored;
      throw new Error(BUILDERS[branch] + ": unexpected placeholder " + k);
    },
  });
  return run(node(BUILDERS[branch]), values);
};
const qtys = (r) => r.records.map((x) => [x.picking_item_id, x.store_out_qty]);

let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };
for (const b of Object.keys(BUILDERS)) {
  it(b + ": picked_qty missing -> not picked", () => {
    const l = line(1); delete l.picked_qty;
    assert.deepStrictEqual(qtys(records(b, [l])), []);
  });
  it(b + ": picked_qty null -> not picked", () => assert.deepStrictEqual(qtys(records(b, [line(1, { picked_qty: null })])), []));
  it(b + ": picked_qty \"\" -> not picked", () => assert.deepStrictEqual(qtys(records(b, [line(1, { picked_qty: "" })])), []));
  it(b + ": picked_qty 0 -> not picked", () => assert.deepStrictEqual(qtys(records(b, [line(1, { picked_qty: 0 })])), []));
  it(b + ": picked_qty 2 -> a record of 2", () => assert.deepStrictEqual(qtys(records(b, [line(1, { picked_qty: 2 })])), [["row1", 2]]));
  it(b + ": picked_qty \"2\" -> a record of 2", () => assert.deepStrictEqual(qtys(records(b, [line(1, { picked_qty: "2" })])), [["row1", 2]]));
  it(b + ": one line typed, one left blank -> only the typed line, and a numeric total", () => {
    const blank = line(2); delete blank.picked_qty;
    const r = records(b, [line(1, { picked_qty: 1 }), blank, line(3, { picked_qty: "" })]);
    assert.deepStrictEqual(qtys(r), [["row1", 1]]);
    assert.strictEqual(r.totalPickedQuantity, 1);
  });
  it(b + ": mobile locations still decide the quantity", () => {
    const r = records(b, [line(1, { picked_qty: 2, _mobile_locations: [{ location_id: "bin1", allocated_quantity: 2 }] })]);
    assert.deepStrictEqual(qtys(r), [["row1", 2]]);
  });
}
// only the GD branch reads isForceComplete; the Picking Plan builder has no force-complete path
it("GD: force complete still writes no records, even for a typed line", () => assert.deepStrictEqual(qtys(records("GD", [line(1, { picked_qty: 2 })], { force: true })), []));

// the GD branch's status step (code_node_Z5JH4g2u) after this session's records: a line picked in an EARLIER session and
// sent blank now keeps In Progress (it used to drop to Open: only this session's picks were counted)
const statuses = (stored, items) => {
  const recs = records("GD", items).records;
  const values = { "node:get_node_jEllcWiJ.data.data": { table_picking_items: stored, table_picking_records: [] },
    "workflowparams:allData": { gd_no: ["gd1"], table_picking_items: items }, "node:code_node_oHIIKfiw.data.records": recs,
    "workflowparams:isForceComplete": null, "node:get_node_Uj1uV9PU.data.data.allow_full_picking": 0 };
  const r = run(node("code_node_Z5JH4g2u"), values);
  return r.updatedItems.map((x) => [x.id, x.line_status, x.pending_process_qty]).concat([["to_status", r.toStatus]]);
};
const st = (k, qty, pending, status) => ({ id: "row" + k, gd_id: "gd1", gd_line_id: "gdl" + k, qty_to_pick: qty, pending_process_qty: pending, line_status: status });
it("GD status: a line picked earlier and sent blank stays In Progress, pending kept", () => {
  const blank = line(1, { qty_to_pick: 3, pending_process_qty: 2 }); delete blank.picked_qty;
  assert.deepStrictEqual(statuses([st(1, 3, 2, "In Progress")], [blank]), [["row1", "In Progress", 2], ["to_status", "In Progress"]]);
});
it("GD status: a line never picked and sent blank stays Open", () => {
  const blank = line(1); delete blank.picked_qty;
  assert.deepStrictEqual(statuses([st(1, 3, 3, "Open")], [blank]), [["row1", "Open", 3], ["to_status", "Open"]]);
});
it("GD status: picked now -> In Progress / Completed as before", () => {
  assert.deepStrictEqual(statuses([st(1, 3, 3, "Open"), st(2, 3, 3, "Open")], [line(1, { picked_qty: 1 }), line(2, { picked_qty: 3 })]),
    [["row1", "In Progress", 2], ["row2", "Completed", 0], ["to_status", "In Progress"]]);
});
console.log((n - failed) + "/" + n + " passed");
process.exit(failed ? 1 : 0);
