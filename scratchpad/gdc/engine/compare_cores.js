// node compare_cores.js <older core.js> <SUBTRACT|ADD> <fixtures.jsonl> [--layers]
// Plans every recorded SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW call (fetch_runs.py) through an older core.js and this one,
// with the rows that call read (as replay.js builds them), and counts the plans that are not identical.
// --layers: this core's run asks report_layers on the movement; the plans must still be identical apart from fifo_layers, and
// fifo_layers must add up: quantities to the base quantity, quantity x cost to total_price.
const fs = require("fs");
const path = require("path");
const older = require(path.resolve(process.argv[2]));
const newer = require("./core.js");

const kind = process.argv[3];
const file = process.argv[4];
const layers = process.argv.includes("--layers");
const node = (rec, id) => (rec.nodes[id] ? rec.nodes[id].data : undefined);
const rowsOf = (get) => {
  if (!get) return [];
  const d = get.data;
  if (Array.isArray(d)) return d;
  return d && Object.keys(d).length ? [d] : [];
};

function inputOf(rec) {
  const p = rec.params;
  const sub = kind === "SUBTRACT";
  const ids = sub
    ? { tc: "code_node_TC1cqaOy", item: "get_node_ZGsF9gxG", bal: "get_node_uaq6Z1ej", batch: "get_node_GjRiq3dT", fifo: "search_node_NCi8U4My", wa: "search_node_7bvv7f8g" }
    : { tc: "code_node_3XzQSsce", item: "get_node_MuNnpfmj", bal: "get_node_dzqHveJM", batch: "get_node_kePN6D3V", fifo: "search_node_lPUQktoS", wa: "search_node_EhZwGMYs" };
  const tc = node(rec, ids.tc);
  const itemData = (tc && tc.itemData) || p.itemData || (node(rec, ids.item) || {}).data;
  if (!itemData) return null;
  const fifoS = node(rec, ids.fifo);
  const waS = node(rec, ids.wa);
  if ((fifoS && fifoS.total > 0 && !(fifoS.data || []).length) || (waS && waS.total > 0 && !(waS.data || []).length)) return null;
  const gm = sub ? null : node(rec, "code_node_GMSJTmJr");
  const batchId = gm ? gm.batchId : p.batch_id;
  const newBatch = !sub && !!(p.batch_number !== "-" && p.batch_number && !p.batch_id);
  const keyed = (rows, extra) => rows.map((r) => Object.assign({}, r, { material_id: p.material_id, location_id: p.location_id, plant_id: p.plant_id, organization_id: p.organization_id }, extra || {}));
  const costRows = (s, batch) => ((s && s.data) || []).map((r) => Object.assign({}, r, { material_id: p.material_id, plant_id: p.plant_id, organization_id: p.organization_id }, batch === undefined ? {} : { batch_id: batch }));
  const items = {};
  items[String(p.material_id)] = itemData;
  return {
    operationKey: "R",
    items,
    itemBalances: keyed(rowsOf(node(rec, ids.bal))),
    batchBalances: batchId && !newBatch ? keyed(rowsOf(node(rec, ids.batch)), { batch_id: batchId }) : [],
    fifoLayers: costRows(fifoS, sub ? p.batch_id || null : newBatch ? null : batchId || null),
    waRows: costRows(waS, sub ? p.batch_id || null : undefined),
    movements: [Object.assign({}, p, { movement_key: "m", direction: kind })],
  };
}

const tally = {};
const bump = (k, rec, detail) => {
  tally[k] = tally[k] || { n: 0, ex: [] };
  tally[k].n++;
  if (detail !== undefined && tally[k].ex.length < 3) tally[k].ex.push({ id: rec.id, detail });
};
const strip = (plan) => JSON.parse(JSON.stringify(plan, (k, v) => (k === "fifo_layers" ? undefined : v)));

for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
  const rec = JSON.parse(line);
  const inp = inputOf(rec);
  if (!inp) {
    bump("skip (no item / trace cut)", rec);
    continue;
  }
  const a = older.planBulk(JSON.parse(JSON.stringify(inp)));
  const bi = JSON.parse(JSON.stringify(inp));
  if (layers) bi.movements[0].report_layers = true;
  const b = newer.planBulk(bi);
  if (JSON.stringify(strip(b)) !== JSON.stringify(a)) {
    bump("DIFFERENT", rec, { older: JSON.stringify(a).slice(0, 300), newer: JSON.stringify(b).slice(0, 300) });
    continue;
  }
  const r = b.ok ? b.results[0] : null;
  if (!layers || !r || !r.fifo_layers) {
    bump(layers && r && r.code === "200" && kind === "SUBTRACT" && r.fifo_layers === undefined ? "identical, no layers (not a FIFO draw)" : "identical", rec);
    continue;
  }
  const qty = r.fifo_layers.reduce((t, x) => t + x.quantity, 0);
  const value = r.fifo_layers.reduce((t, x) => t + x.quantity * x.cost, 0);
  const base = b.movements[0].base_qty;
  if (Math.abs(qty - base) > 1e-6) bump("LAYERS: quantity != base qty", rec, { qty, base });
  else if (Math.abs(value - r.total_price) > Math.max(1e-6, 1e-8 * base)) bump("LAYERS: value != total_price", rec, { value, total: r.total_price, base });
  else bump("identical + layers add up" + (r.fifo_layers.some((x) => x.uncovered) ? " (with an uncovered part)" : ""), rec);
}
console.log(kind, layers ? "with report_layers" : "as callers send it");
for (const k of Object.keys(tally).sort()) {
  console.log(String(tally[k].n).padStart(5), k);
  for (const e of tally[k].ex) console.log("       ", JSON.stringify(e).slice(0, 700));
}
