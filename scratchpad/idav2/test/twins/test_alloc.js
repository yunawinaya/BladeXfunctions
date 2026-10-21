// node scratchpad/idav2/test/twins/test_alloc.js - V2's receipt price (code/shared/price.js idaAllocate over idaUomOf base quantities) against
// the classic's own code_cost_alloc bodies run as the platform runs a code node (tokens replaced by the node data): v6 (base/ida_code, per
// LINE unit) and B's v7 (Item Disassembly/AsyncV2/IDA_SAVE.json, per BASE unit; skipped while not built). CONTRACT section 5: idaAllocate
// == v7 line for line (base and non-base UOM, a non-stock last line, the remainder, zero values, q8 residue, 2,000 lines); v6 == v7 on
// base-UOM lines and off by the conversion factor on a non-base one (the deliberate fix, user decision 3).
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const REPO = path.resolve(ROOT, "..", "..");
const P = require(path.join(ROOT, "code", "shared", "price.js"));
const V6 = fs.readFileSync(path.join(ROOT, "base", "ida_code", "code_cost_alloc.js"), "utf8");
const V7_FILE = path.join(REPO, "Item Disassembly", "AsyncV2", "IDA_SAVE.json");
let V7 = null;
if (fs.existsSync(V7_FILE)) {
  const find = (nodes) => {
    for (const n of nodes || []) {
      if (n.id === "code_cost_alloc") return n;
      const x = find(n.blocks);
      if (x) return x;
    }
    return null;
  };
  const n = find(JSON.parse(fs.readFileSync(V7_FILE, "utf8")).nodes);
  const sc = n && n.data && n.data.script;
  V7 = sc && typeof sc === "object" ? sc.code : typeof sc === "string" ? JSON.parse(sc).code : null;
}

// a code node as the platform runs it: every {{node:x.y}} token replaced by that value's JSON text, the body run as a function
function runNode(body, values) {
  const src = body.replace(/\{\{node:([A-Za-z0-9_.]+)\}\}/g, (m, k) => {
    if (!(k in values)) throw new Error("no value for " + k);
    return JSON.stringify(values[k]);
  });
  return new Function(src)();
}
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
let n = 0;
let fails = 0;
const check = (label, ok, detail) => {
  n++;
  if (!ok) fails++;
  console.log((ok ? "ok    " : "FAIL  ") + label + (ok || !detail ? "" : "  " + detail));
};

// one fixture: items { id: { based_uom, table_uom_conversion } }, lines [{ item_selection, total_quantity, quantity_uom }], issued value
function prices(fx) {
  const lines = fx.lines.map((l, i) => Object.assign({ issuing_plant: "7", organization_id: "8", location_id: "9", batch_number: "-", line_index: i + 1 }, l));
  const items = Object.entries(fx.items).map(([id, it]) => Object.assign({ id }, it));
  const values = { "code_fillback.data.allData": { issuing_operation_faci: "7", organization_id: "8", item_disassembly_date: "2026-10-21" },
    "search_items.data.data": items, "search_movements.data.data": fx.out.map((t) => ({ total_price: t })), "code_persisted.data": { stock_movement_no: "IDA-T" },
    "code_apply_batches.data.stock_movement": lines };
  const alloc = lines.map((l) => {
    const share = q8(l.total_quantity);
    return { share_qty: share, base_qty: P.idaUomOf(fx.items[l.item_selection], share, l.quantity_uom).baseQty };
  });
  const issued = fx.out.reduce((t, x) => t + (parseFloat(x) || 0), 0);
  return { v6: runNode(V6, values).receipts.map((r) => r.unit_price), v7: V7 ? runNode(V7, values).receipts.map((r) => r.unit_price) : null,
    ida: P.idaAllocate(issued, alloc).map((r) => r.unit_price), alloc };
}
const BASE = { based_uom: "900", table_uom_conversion: [{ alt_uom_id: "900", base_qty: 1 }] };
const BOXED = { based_uom: "900", table_uom_conversion: [{ alt_uom_id: "900", base_qty: 1 }, { alt_uom_id: "905", base_qty: 10 }] };
const FIX = {
  "base UOM, last-line remainder (IDA-2610-001: 10 over 5 / 5 / 2)": { items: { 11: BASE, 12: BASE, 13: BASE }, out: ["10.00000000"],
    lines: [{ item_selection: "11", total_quantity: 5 }, { item_selection: "12", total_quantity: 5 }, { item_selection: "13", total_quantity: 2 }] },
  "a non-base-UOM line (1 BOX = 10 base)": { items: { 11: BASE, 12: BOXED }, out: ["20"],
    lines: [{ item_selection: "11", total_quantity: 3, quantity_uom: "900" }, { item_selection: "12", total_quantity: 1, quantity_uom: "905" }] },
  "the non-base line last (it takes the remainder)": { items: { 11: BASE, 12: BOXED }, out: ["7.77"],
    lines: [{ item_selection: "12", total_quantity: 2, quantity_uom: "900" }, { item_selection: "11", total_quantity: 1 }, { item_selection: "12", total_quantity: 3, quantity_uom: "905" }] },
  "a non-stock last line (keeps its share, receives nothing)": { items: { 11: BASE, 14: { based_uom: "901", table_uom_conversion: [] } }, out: ["12.5", "0.5"],
    lines: [{ item_selection: "11", total_quantity: 4 }, { item_selection: "14", total_quantity: 1, quantity_uom: "901" }] },
  "zero issued value (711077's FIFO layers cost 0)": { items: { 11: BASE, 12: BASE }, out: ["0"], lines: [{ item_selection: "11", total_quantity: 1 }, { item_selection: "12", total_quantity: 2 }] },
  "q8 residue (0.1 + 0.2 shares)": { items: { 11: BASE, 12: BASE, 13: BOXED }, out: ["1.1", "2.2"],
    lines: [{ item_selection: "11", total_quantity: 0.1 }, { item_selection: "12", total_quantity: 0.2 }, { item_selection: "13", total_quantity: 0.30000000000000004, quantity_uom: "905" }] },
  "a UOM without a conversion row (1:1, as ADD and the engine)": { items: { 11: BASE }, out: ["9"], lines: [{ item_selection: "11", total_quantity: 3, quantity_uom: "777" }] },
};
let seed = 20261021;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const big = { items: { 11: BASE, 12: BOXED }, out: ["1234.5678"], lines: [] };
for (let i = 0; i < 2000; i++) big.lines.push({ item_selection: rnd() < 0.2 ? "12" : "11", total_quantity: q8(rnd() * 50 + 0.001), quantity_uom: rnd() < 0.2 ? "905" : "900" });
FIX["2,000 lines, random quantities, a fifth in BOX"] = big;

console.log("v7 code_cost_alloc: " + (V7 ? "Item Disassembly/AsyncV2/IDA_SAVE.json" : "NOT BUILT - the v7 checks are skipped"));
for (const [name, fx] of Object.entries(FIX)) {
  const r = prices(fx);
  const nonBase = r.alloc.some((a) => a.base_qty !== a.share_qty);
  if (r.v7) check(name + ": idaAllocate == v7 code_cost_alloc, line for line", JSON.stringify(r.ida) === JSON.stringify(r.v7), JSON.stringify({ ida: r.ida.slice(0, 4), v7: r.v7.slice(0, 4) }));
  if (!nonBase) check(name + ": v6 == idaAllocate (base UOM only)", JSON.stringify(r.v6) === JSON.stringify(r.ida), JSON.stringify({ ida: r.ida, v6: r.v6 }));
  else {
    const off = r.alloc.map((a, i) => (a.base_qty !== a.share_qty ? Math.abs(q8(r.v6[i] * a.share_qty / a.base_qty) - r.ida[i]) <= 1e-8 * Math.max(1, a.share_qty) : r.v6[i] === r.ida[i]));
    check(name + ": v6 differs only on the non-base lines, by the conversion factor", off.every(Boolean), JSON.stringify({ ida: r.ida.slice(0, 4), v6: r.v6.slice(0, 4) }));
  }
}
// the recorded classic completions (dev): idaAllocate reproduces their stored IN prices
const rec = prices(FIX["base UOM, last-line remainder (IDA-2610-001: 10 over 5 / 5 / 2)"]);
check("IDA-2610-001: 0.83333333 x 3 (recorded IN rows)", JSON.stringify(rec.ida) === JSON.stringify([0.83333333, 0.83333333, 0.83333333]), JSON.stringify(rec.ida));
const r3 = prices({ items: { 1: BASE, 2: BASE, 3: BASE, 4: BASE }, out: ["20"], lines: [{ item_selection: "1", total_quantity: 10 }, { item_selection: "2", total_quantity: 10 },
  { item_selection: "3", total_quantity: 4 }, { item_selection: "4", total_quantity: 1 }] });
check("IDA-2610-003: 0.8 x 4 (recorded IN rows)", JSON.stringify(r3.ida) === JSON.stringify([0.8, 0.8, 0.8, 0.8]), JSON.stringify(r3.ida));
console.log(`${n - fails}/${n} checks passed`);
process.exit(fails ? 1 : 0);
