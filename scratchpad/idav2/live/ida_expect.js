// The values the engine STORES for an IDA completion, computed with INVENTORY_BULK_APPLY v10's own arithmetic (scratchpad/gdc/engine/core.js
// roundDec / q8 / fifoUnitPrice, required read-only; uomOf copied) and the tenant's number rules: recon_ida.py's exact per-row checks (I2, I4,
// M3 of the fix round) and test_kit.py's synthetic cases. One entry point on stdin: { op, precision, ... } -> JSON on stdout.
//   precision  rows of su_code_num_precision (scope 1 Inventory Price / Qty, scope 2 column rules) as plan_ida.js reads them
//   op "qty"   { moves: [{ item, quantity, material_uom }] } -> [{ quantity, base_qty (stored), base (core's u.baseQty), uom }]
//   op "in"    { lines: [{ method, unit | v6 { value, share }, purchase, item, quantity, material_uom } | { ..., base }] }
//              -> [{ unit_price, total_price, engine_unit, fifo_cost_price, fifo_qty, quantity, base_qty, base }]
//   op "wa"    { rows: before WA rows, receipts: [{ material_id, plant_id, organization_id, batch_id, base, engine_unit }] in R order }
//              -> { created: [{ material_id, batch_id, wa_quantity, wa_cost_price }], updated: { <id>: { wa_quantity, wa_cost_price } } }
//   op "out"   { layers: before FIFO rows of the source key(s), picks: [{ material_id, plant_id, organization_id, batch_id, item, quantity,
//              material_uom } | { ..., base }] } -> { picks: [{ unit_price, total_price }], layers: { <id>: fifo_available_quantity } }
//   op "store" { values: [[table, column, value]] } -> [stored value]
"use strict";
const fs = require("fs");
const path = require("path");
const { roundDec, q8, fifoUnitPrice } = require(path.resolve(__dirname, "..", "..", "gdc", "engine", "core.js"));

const s = (v) => (v === undefined || v === null ? "" : String(v));
const TABLE_OF = { "1902698977724317697": "item_balance", "1902718803880558594": "item_batch_balance", "1902947165008400386": "fifo_costing_history",
  "1902948453171433474": "wa_costing_method", "1902259348776800257": "inventory_movement", "1902719754154655746": "batch" };
const PRICE_COLUMNS = { unit_price: 1, total_price: 1, fifo_cost_price: 1, wa_cost_price: 1 };
const FIFO = "First In First Out";
const WA = "Weighted Average";
const FIXED = "Fixed Cost";

// code_node_IBplan's precision from the rule rows; rc = core.js rc(): the stored value of a computed one
function storer(rows) {
  const P = { price: null, qty: null, columns: {} };
  for (const r of rows || []) {
    const mode = Number(r.precision_rule);
    const dp = Number(r.decimal_places);
    const rule = Number(r.store_raw_value) === 1 || dp >= 8 ? { dp: null, mode } : { dp, mode };
    if (s(r.scope_type) === "2") {
      if (TABLE_OF[s(r.table_id)] && s(r.field_name)) P.columns[TABLE_OF[s(r.table_id)] + "." + s(r.field_name)] = rule;
    } else if (s(r.rule_key) === "Inventory Price") P.price = rule;
    else if (s(r.rule_key) === "Inventory Qty") P.qty = rule;
  }
  return (table, col, v) => {
    const r = Object.prototype.hasOwnProperty.call(P.columns, table + "." + col) ? P.columns[table + "." + col] : PRICE_COLUMNS[col] ? P.price : P.qty;
    return r && r.dp !== null && r.dp !== undefined ? roundDec(v, r.dp, r.mode) : q8(v);
  };
}

// core.js uomOf: the quantity in its UOM (q8) and the base quantity by the item's conversion row for that UOM
const uomOf = (item, m) => {
  const altQty = q8(parseFloat(m.quantity));
  let baseQty = altQty;
  const altUOM = m.material_uom || item.based_uom;
  const conv = Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion.find((c) => c.alt_uom_id === altUOM) : null;
  if (conv) baseQty = q8(altQty * conv.base_qty);
  return { altQty, baseQty, altUOM };
};
const baseOf = (l) => {
  if (l.item) return uomOf(l.item, l);
  const altQty = q8(l.quantity === undefined ? l.base : l.quantity);
  return { altQty, baseQty: l.base === undefined ? altQty : q8(l.base), altUOM: s(l.material_uom) };
};

function qtyRows(rc, moves) {
  return moves.map((m) => {
    const u = baseOf(m);
    return { quantity: rc("inventory_movement", "quantity", u.altQty), base_qty: rc("inventory_movement", "base_qty", u.baseQty), base: u.baseQty, uom: u.altUOM };
  });
}

// the ADD branch of core.js planBulk for transaction_type IDA: FIFO / WA take q8(sent), Fixed Cost q8(purchase_unit_price), any other
// method keeps the sent price; total = price x base qty; both q8, then stored at the rule (the movement row and the new FIFO layer)
function inRows(rc, lines) {
  return lines.map((l) => {
    const u = baseOf(l);
    const base = u.baseQty;
    const sent = l.v6 ? q8(l.v6.value / l.v6.share) : l.unit;
    let unit;
    let total;
    if (l.method === FIFO || l.method === WA) {
      unit = q8(sent);
      total = q8(unit * base);
    } else if (l.method === FIXED) {
      unit = q8(parseFloat(l.purchase || 0));
      total = q8(unit * base);
    } else {
      unit = sent;
      total = sent * base;
    }
    unit = q8(unit);
    total = q8(total);
    return { unit_price: rc("inventory_movement", "unit_price", unit), total_price: rc("inventory_movement", "total_price", total), engine_unit: unit,
      fifo_cost_price: rc("fifo_costing_history", "fifo_cost_price", unit), fifo_qty: rc("fifo_costing_history", "fifo_initial_quantity", base),
      quantity: rc("inventory_movement", "quantity", u.altQty), base_qty: rc("inventory_movement", "base_qty", base), base };
  });
}

// core.js newestWa: created_at descending, ties keep the read order
const newest = (rows) => rows.slice().sort((a, b) => (a.created_at && b.created_at ? new Date(b.created_at) - new Date(a.created_at) : 0))[0];

// the WA branch of the ADD: a batch receipt always makes the batch's own row; a non-batch receipt re-averages the newest row of the material
// (ANY batch) at the plant + organization - (wc x wq + price x base) / (wq + base) - or makes the first one
function waRows(rc, before, receipts, nowText) {
  const rows = (before || []).map((r) => Object.assign({}, r, { id: s(r.id), batch_id: s(r.batch_id) === "0" ? "" : s(r.batch_id) }));
  const created = [];
  const updated = {};
  for (const m of receipts) {
    const base = Number(m.base);
    if (s(m.batch_id)) {
      const row = { id: "new:" + created.length, material_id: s(m.material_id), plant_id: s(m.plant_id), organization_id: s(m.organization_id), batch_id: s(m.batch_id),
        wa_quantity: rc("wa_costing_method", "wa_quantity", base), wa_cost_price: rc("wa_costing_method", "wa_cost_price", m.engine_unit), created_at: nowText };
      rows.push(row);
      created.push(row);
      continue;
    }
    const any = rows.filter((r) => s(r.material_id) === s(m.material_id) && s(r.plant_id) === s(m.plant_id) && s(r.organization_id) === s(m.organization_id));
    if (any.length) {
      const latest = newest(any);
      const wc = q8(latest.wa_cost_price);
      const wq = q8(latest.wa_quantity);
      const nq = q8(wq + base);
      latest.wa_cost_price = rc("wa_costing_method", "wa_cost_price", q8((wc * wq + m.engine_unit * base) / nq));
      latest.wa_quantity = rc("wa_costing_method", "wa_quantity", nq);
      if (latest.id.indexOf("new:") !== 0) updated[latest.id] = { wa_quantity: latest.wa_quantity, wa_cost_price: latest.wa_cost_price };
    } else {
      const row = { id: "new:" + created.length, material_id: s(m.material_id), plant_id: s(m.plant_id), organization_id: s(m.organization_id), batch_id: "",
        wa_quantity: rc("wa_costing_method", "wa_quantity", base), wa_cost_price: rc("wa_costing_method", "wa_cost_price", m.engine_unit), created_at: nowText };
      rows.push(row);
      created.push(row);
    }
  }
  return { created: created.map((r) => ({ material_id: r.material_id, batch_id: r.batch_id, wa_quantity: r.wa_quantity, wa_cost_price: r.wa_cost_price })), updated };
}

// the SUBTRACT branch for a FIFO source: the price over the layers it would use (fifoUnitPrice), then the layers consumed in sequence
function outRows(rc, layers, picks) {
  const rows = (layers || []).map((r) => Object.assign({}, r, { id: s(r.id), batch_id: s(r.batch_id) === "0" ? "" : s(r.batch_id), fifo_sequence: Number(r.fifo_sequence || 0),
    fifo_available_quantity: Number(r.fifo_available_quantity || 0), fifo_cost_price: Number(r.fifo_cost_price || 0) }));
  const after = {};
  const out = picks.map((p) => {
    const mine = rows.filter((r) => s(r.material_id) === s(p.material_id) && s(r.plant_id) === s(p.plant_id) && s(r.organization_id) === s(p.organization_id)
      && r.batch_id === s(p.batch_id));
    const base = baseOf(p).baseQty;
    const price = fifoUnitPrice(mine, base);
    const total = q8(price * base);
    let remaining = q8(base);
    for (const layer of mine.slice().sort((a, b) => (a.fifo_sequence || 0) - (b.fifo_sequence || 0))) {
      if (remaining <= 0) break;
      const avail = q8(layer.fifo_available_quantity || 0);
      if (avail <= 0) continue;
      const take = Math.min(remaining, avail);
      layer.fifo_available_quantity = rc("fifo_costing_history", "fifo_available_quantity", avail - take);
      after[layer.id] = layer.fifo_available_quantity;
      remaining = q8(remaining - take);
    }
    return { unit_price: rc("inventory_movement", "unit_price", price), total_price: rc("inventory_movement", "total_price", total) };
  });
  return { picks: out, layers: after };
}

function run(p) {
  const rc = storer(p.precision);
  if (p.op === "qty") return qtyRows(rc, p.moves);
  if (p.op === "in") return inRows(rc, p.lines);
  if (p.op === "wa") return waRows(rc, p.rows, p.receipts, p.nowText || "2999-12-31 00:00:00");
  if (p.op === "out") return outRows(rc, p.layers, p.picks);
  if (p.op === "store") return (p.values || []).map(([t, c, v]) => rc(t, c, v));
  throw new Error("unknown op " + p.op);
}

if (require.main === module) console.log(JSON.stringify(run(JSON.parse(fs.readFileSync(0, "utf8")))));
module.exports = { storer, uomOf, qtyRows, inRows, waRows, outRows, run };
