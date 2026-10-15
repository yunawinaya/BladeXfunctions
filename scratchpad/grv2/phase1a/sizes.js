// Node data per PO_SAVE run (the nodes_data the platform keeps: request + response of every node a later placeholder reads),
// OLD workflow + today's payload vs NEW workflow + the slim payload, Issue on Add and on Edit, at 500 / 1,000 / 2,000 lines.
// Column bytes = estimate x 1.25 (calibrate.js: the engine's estimate is 0.90-0.95 of the recorded text, and the column
// escapes that text, x1.16). Usage: node sizes.js <template run json> <old wf> <new wf> <slim_payload.js>
"use strict";
const fs = require("fs");
const L = require("./lib.js");
const { Engine } = require("./engine.js");
const { World } = require("./world.js");

const [tplFile, oldFile, newFile, slimFile] = process.argv.slice(2);
const OLD = JSON.parse(fs.readFileSync(oldFile, "utf8"));
const NEW = JSON.parse(fs.readFileSync(newFile, "utf8"));
const slim = new Function(fs.readFileSync(slimFile, "utf8") + "\nreturn poSlimPayload;")();
const tpl = L.loadRun(tplFile).allData;
const clone = (x) => JSON.parse(JSON.stringify(x));
const ORG = "1900000000000000001";
const CAL = 1.25;

// an item's UOM row as the Item master holds it (33 keys), as the form copies it into alt_uom
const uomRow = (alt, base) => ({ sales_default_uom: 1, over_delivery_tolerance: 0, over_receive_tolerance: 0, purchase_max_price: 20, min_purchase_qty: 0,
  id: "2065339736801521665", mat_purchase_tax_id: "2068931560927592449", sales_unit_price: 24, item_barcode: "", max_purchase_qty: 0, base_qty: base,
  purchase_default_uom: 1, mat_sales_tax_id: "2068931560927592449", purchase_unit_price: 7, purchase_min_price: 5, purchase_tax_percent: 10,
  sales_price_5: 0, sales_max_price: 0, sales_tariff_id: "", sales_price_6: 0, sales_price_3: 0, sales_price_4: 0, base_uom_id: "1800000000000000001",
  sales_price_1: 0, min_sales_qty: 0, text_b4j8h211: "", sales_price_2: 0, sales_tax_percent: 10, max_sales_qty: 0, sales_min_price: 0, alt_qty: 1,
  purchase_tariff_id: "", alt_uom_id: alt });
const altUom = (layers) => {
  let v = JSON.stringify([uomRow("1800000000000000001", 1), uomRow("1800000000000000002", 12)]);
  for (let i = 1; i < layers; i++) v = JSON.stringify(v);
  return v;
};

function world(n) {
  const w = new World({ tenantId: "000000" });
  for (let i = 0; i < n; i++) {
    const id = String(1700000000000000000n + BigInt(i + 1));
    w.items[id] = { id: id, table_uom_conversion: [uomRow("1800000000000000001", 1), uomRow("1800000000000000002", 12)] };
  }
  // the Item search-node also returns the other ten subforms (price tiers, packing, ...): padded to the 2.8 KB average
  // of the recorded dev search_items rows (p90 4.6 KB; a price-tier-heavy tenant is larger)
  w.itemPadBytes = 1200;
  return w;
}

function payload(n) {
  const tl = clone((tpl.table_po || [])[0] || {});
  const h = clone(tpl);
  for (const k of ["id", "create_time", "update_time", "create_user", "update_user", "create_dept", "linked_so_id"]) delete h[k];
  Object.assign(h, { page_status: "Add", po_status: "Issued", previous_status: "", purchase_order_no: "", purchase_order_no_type: "2000000000000000009",
    organization_id: ORG, po_plant: ORG, po_supplier_id: "1600000000000000001", preq_id: [], auto_pi: 0, create_pi: "No", approval_condition: {} });
  h.table_po = [];
  for (let i = 0; i < n; i++) {
    const l = clone(tl);
    for (const k of ["id", "children", "line_index", "line_status"]) delete l[k];
    Object.assign(l, { fm_key: "fm" + i, item_id: String(1700000000000000000n + BigInt(i + 1)), item_name: "ITEM-" + i, item_desc: "Item description " + i,
      quantity: (i % 7) + 1, quantity_uom: "1800000000000000001", unit_price: 2.5, alt_uom: altUom(2),
      table_uom_conversion: "", received_qty: 0, created_received_qty: 0, invoice_qty: 0 });
    h.table_po.push(l);
  }
  return h;
}

function editPayload(w, poId) {
  const rb = clone(w.readback(poId));
  rb.page_status = "Edit";
  rb.previous_status = rb.po_status;
  rb.table_po.forEach((l, i) => {
    l.fm_key = "e" + i;
    if (l.alt_uom) l.alt_uom = JSON.stringify(l.alt_uom);
  });
  return rb;
}

const total = (r) => Object.values(r.sizes).reduce((s, x) => s + x.in + x.out, 0);
const mb = (b) => (b / 1048576).toFixed(1);
const rows = [];
for (const n of [500, 1000, 2000]) {
  const p = payload(n);
  const wo = world(n);
  const ro = new Engine(OLD, wo, {}).run({ allData: clone(p) });
  const wn = world(n);
  const rn = new Engine(NEW, wn, { maxRowsPerWrite: 250 }).run({ allData: slim(clone(p)) });
  const lineBytesOld = JSON.stringify(p.table_po).length;
  const lineBytesNew = JSON.stringify(slim(clone(p)).table_po).length;
  rows.push({ label: "Issue (Add) " + n, old: total(ro), new: total(rn), lo: lineBytesOld, ln: lineBytesNew, ro, rn });
  // Edit of what each version saved
  const eo = editPayload(wo, Object.keys(wo.po)[0]);
  const en = slim(editPayload(wn, Object.keys(wn.po)[0]));
  const ro2 = new Engine(OLD, wo, {}).run({ allData: eo });
  const rn2 = new Engine(NEW, wn, { maxRowsPerWrite: 250 }).run({ allData: en });
  rows.push({ label: "Issue (Edit) " + n, old: total(ro2), new: total(rn2), lo: JSON.stringify(eo.table_po).length, ln: JSON.stringify(en.table_po).length, ro: ro2, rn: rn2 });
}
console.log("label".padEnd(20), "OLD MB".padStart(8), "(copies)".padStart(9), "NEW MB".padStart(8), "(copies)".padStart(9), " payload line array OLD / NEW");
for (const r of rows)
  console.log(r.label.padEnd(20), mb(r.old * CAL).padStart(8), ("(" + (r.old / r.lo).toFixed(1) + ")").padStart(9), mb(r.new * CAL).padStart(8),
    ("(" + (r.new / r.ln).toFixed(1) + ")").padStart(9), "  " + mb(r.lo) + " / " + mb(r.ln) + " MB");
// where the bytes go at 2,000 lines
for (const r of rows.filter((x) => /2000/.test(x.label))) {
  for (const [name, res] of [["OLD", r.ro], ["NEW", r.rn]]) {
    const top = Object.entries(res.sizes).map(([k, v]) => [k, v.in + v.out]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(r.label, name, top.map(([k, v]) => k + " " + mb(v * CAL)).join(", "));
  }
}
fs.writeFileSync(process.env.SIZES_OUT || "/dev/null", JSON.stringify(rows.map((r) => ({ label: r.label, old: r.old, new: r.new, lo: r.lo, ln: r.ln,
  oldNodes: r.ro.sizes, newNodes: r.rn.sizes })), null, 1));
