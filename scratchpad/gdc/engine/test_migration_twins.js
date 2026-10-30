// node test_migration_twins.js [cases] — core.js's costing migration against classic SUBTRACT_INVENTORY_NEW's own nodes
// (code_node_oz7GGSQA one kind only, code_node_YqMfJIMz both kinds; the repo copy = prod since 10-26), run the way the platform
// runs a code node, on random rows of all four shapes. A category move (isMovingInv 1) takes nothing out of the costing rows, so
// the engine's rows after it are the migration itself. No precision rule: both keep 8 dp. Classic's "both" picks waRecords[0],
// the engine the newest WA row (user's choice 10-30), so a "both" case has one WA row.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { planBulk, q8 } = require("./core.js");

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../SubtractInventoryWorkflowNew.json"), "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) {
    for (const x of o) {
      const r = find(x, id);
      if (r) return r;
    }
  } else if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) {
      const r = find(v, id);
      if (r) return r;
    }
  }
  return null;
};
const classic = (id, ctx) => {
  const src = find(doc, id).data.script.code.replace(/\{\{(node|workflowparams):([^}]+)\}\}/g, (all, kind, ref) => {
    const v = kind === "workflowparams" ? ctx.params[ref] : ctx.nodes[ref];
    return v === undefined ? "null" : JSON.stringify(v);
  });
  return Function(src)();
};

const ORG = "100";
const PLANT = "200";
const MAT = "M1";
let seed = 20261030;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const qty = () => pick([0, 1, 2.5, 7, 12.125, 999999, 1000000.333]);
const cost = () => pick([0, 1, 2.25, 3.3333, 52, 0.0001]);

function oneCase(method, both) {
  const nF = method === "Weighted Average" || both ? 1 + Math.floor(rnd() * 4) : 0;
  const nW = method === "First In First Out" ? (both ? 1 : 1 + Math.floor(rnd() * 3)) : both ? 1 : 0;
  const fifo = [];
  for (let i = 0; i < nF; i++) {
    const q = qty();
    fifo.push({ id: "F" + i, material_id: MAT, plant_id: PLANT, organization_id: ORG, batch_id: null, fifo_sequence: String(i + 1), fifo_available_quantity: q, fifo_initial_quantity: q, fifo_cost_price: cost() });
  }
  const wa = [];
  for (let i = 0; i < nW; i++) wa.push({ id: "W" + i, material_id: MAT, plant_id: PLANT, organization_id: ORG, batch_id: null, wa_quantity: qty(), wa_cost_price: cost(), created_at: "2026-10-" + String(10 + i) + " 00:00:00" });
  const node = (fifo.length && wa.length) ? "code_node_YqMfJIMz" : "code_node_oz7GGSQA";
  const c = classic(node, {
    params: { plant_id: PLANT, organization_id: ORG, material_id: MAT, batch_id: null },
    nodes: { "code_node_wBfvXM2G.data.costingMethod": method, "search_node_NCi8U4My.data.data": fifo, "search_node_7bvv7f8g.data.data": wa },
  });
  const p = planBulk({
    migrateCosting: "ALL",
    items: { [MAT]: { id: MAT, stock_control: 1, based_uom: "U", material_costing_method: method, purchase_unit_price: 0, table_uom_conversion: [] } },
    itemBalances: [{ id: "B1", material_id: MAT, location_id: "L1", plant_id: PLANT, organization_id: ORG, unrestricted_qty: 0, reserved_qty: 1, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0, balance_quantity: 1 }],
    fifoLayers: JSON.parse(JSON.stringify(fifo)),
    waRows: JSON.parse(JSON.stringify(wa)),
    movements: [{ movement_key: "a", direction: "SUBTRACT", plant_id: PLANT, organization_id: ORG, material_id: MAT, quantity: 1, location_id: "L1", inventory_category: "Reserved", isMovingInv: 1 }],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  const retired = (t) => p.updates[t].filter((u) => u.after.is_deleted === 1).map((u) => u.id).sort();
  if (c.targetCosting === "WA") {
    assert.deepStrictEqual(retired("fifo"), c.idsToDelete.slice().sort());
    const got = c.targetRecord.id ? p.updates.wa.find((u) => u.id === c.targetRecord.id).after : p.creates.wa[0];
    assert.strictEqual(q8(got.wa_quantity), q8(c.targetRecord.wa_quantity));
    assert.strictEqual(q8(got.wa_cost_price), q8(c.targetRecord.wa_cost_price));
  } else {
    assert.strictEqual(c.targetCosting, "FIFO");
    assert.deepStrictEqual(retired("wa"), c.idsToDelete.slice().sort());
    const l = p.creates.fifo[0];
    assert.strictEqual(Number(l.fifo_sequence), Number(c.targetRecord.fifo_sequence));
    for (const k of ["fifo_cost_price", "fifo_initial_quantity", "fifo_available_quantity"]) assert.strictEqual(q8(l[k]), q8(c.targetRecord[k]), k);
  }
  return node;
}

const N = Number(process.argv[2] || 400);
const seen = {};
for (let i = 0; i < N; i++) {
  const method = pick(["Weighted Average", "First In First Out"]);
  const node = oneCase(method, rnd() < 0.5);
  seen[method + " / " + node] = (seen[method + " / " + node] || 0) + 1;
}
console.log(N + " random cases equal classic's own migration:", JSON.stringify(seen));
