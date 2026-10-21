// peek_cv.js <cache dir>: how the old search nodes of GD_Convert_SI / SO_Convert_SI present values (types of selected fields,
// document order vs id order, line order vs id order) across every cached run. Read-only over the cache.
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const cache = process.argv[2];
const files = fs.readdirSync(path.join(cache, "runs")).filter((x) => /_(GD|SO)_Convert_SI_\d+\.json$/.test(x));
const types = {};
const note = (k, v) => {
  const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  const s = t === "string" ? (/^-?\d{16,}$/.test(v) ? "str(bigint)" : /^-?\d+\.\d+$/.test(v) ? "str(decimal)" : /^-?\d+$/.test(v) ? "str(int)" : /^\d{4}-\d{2}-\d{2}/.test(v) ? "str(date)" : "str") : t;
  types[k] = types[k] || {};
  types[k][s] = (types[k][s] || 0) + 1;
};
let docOrder = { asc: 0, other: 0 }, lineOrder = { asc: 0, other: 0 };
const asc = (ids) => ids.every((x, i) => i === 0 || BigInt(ids[i - 1]) < BigInt(x));
const FIELDS = {
  search_node_Ivek0yYx: ["exchange_rate", "so_type", "id"],
  search_node_r3bnMaWy: ["so_item_price", "so_tax_percentage", "so_quantity", "invoice_qty", "id", "so_item_uom", "so_tax_preference", "payment_term_id", "sales_person_id", "so_tax_inclusive", "so_discount_uom"],
  search_node_bOF3TVA2: ["customer_credit_limit", "overdue_limit", "outstanding_balance", "overdue_inv_total_amount", "is_accurate", "exchange_rate", "so_id", "plant_id", "plant_name", "organization_id", "customer_name", "sales_person", "so_sales_person", "project_id", "so_payment_term", "gd_area_id", "so_area_id", "id"],
  lines: ["gd_qty", "so_line_item_id", "line_so_id", "custom_fields", "good_delivery_uom_id", "item_category_id", "material_id", "item_bundle_id", "customer_id", "area_id", "tariff_id", "project_id", "so_item_price", "so_tax_percentage", "so_quantity", "item_name", "item_id", "so_item_uom", "parent_id", "children"],
};
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(cache, "runs", f), "utf8"));
  const wf = f.includes("GD_Convert") ? "GD" : "SO";
  for (const x of L.parseJ(r.nodes_data) || []) {
    if (!x || !x.node_id || !FIELDS[x.node_id]) continue;
    const o = L.parseJ(x.response_json_data);
    const rows = o && o.data && Array.isArray(o.data.data) ? o.data.data : [];
    if (rows.length > 1 && rows.every((d) => d.id !== undefined)) asc(rows.map((d) => String(d.id))) ? docOrder.asc++ : docOrder.other++;
    for (const d of rows) {
      for (const k of FIELDS[x.node_id]) if (k in d) note(wf + "." + x.node_id.slice(-8) + "." + k, d[k]);
      for (const lk of ["table_gd", "table_so"]) {
        const ls = Array.isArray(d[lk]) ? d[lk] : [];
        if (ls.length > 1) asc(ls.map((l) => String(l.id))) ? lineOrder.asc++ : lineOrder.other++;
        for (const l of ls) {
          for (const k of FIELDS.lines) if (k in l) note(wf + "." + lk + "." + k, l[k]);
          for (const c of Array.isArray(l.children) ? l.children : []) for (const k of FIELDS.lines) if (k in c) note(wf + "." + lk + ".child." + k, c[k]);
        }
      }
    }
  }
}
console.log("doc order (id asc vs other):", JSON.stringify(docOrder), "| line order:", JSON.stringify(lineOrder));
for (const k of Object.keys(types).sort()) console.log(k.padEnd(60), JSON.stringify(types[k]));
