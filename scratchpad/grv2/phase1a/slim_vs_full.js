// The patched PO_SAVE fed today's payload vs the slim payload (client/slim_payload.js), Add then Edit: the stored rows must
// match except table_uom_conversion (no longer sent, so stored NULL; nothing reads a PO line's copy).
// Usage: node slim_vs_full.js <template run json> <new wf json> <slim_payload.js>
"use strict";
const fs = require("fs");
const L = require("./lib.js");
const { Engine } = require("./engine.js");
const { World } = require("./world.js");

const [tplFile, newFile, slimFile] = process.argv.slice(2);
const NEW = JSON.parse(fs.readFileSync(newFile, "utf8"));
const slim = new Function(fs.readFileSync(slimFile, "utf8") + "\nreturn poSlimPayload;")();
const tpl = L.loadRun(tplFile).allData;
const clone = (x) => JSON.parse(JSON.stringify(x));
const ORG = "1900000000000000001";

function world(n) {
  const w = new World({ tenantId: "000000" });
  for (let i = 0; i < n; i++) {
    const id = String(1700000000000000000n + BigInt(i + 1));
    w.items[id] = { id: id, table_uom_conversion: [{ alt_uom_id: "1800000000000000001", base_qty: 1 }, { alt_uom_id: "1800000000000000002", base_qty: 12 }] };
  }
  return w;
}
function payload(n) {
  const tl = clone((tpl.table_po || [])[0] || {});
  const h = clone(tpl);
  for (const k of ["id", "linked_so_id"]) delete h[k];
  Object.assign(h, { page_status: "Add", po_status: "Issued", previous_status: "", purchase_order_no: "", purchase_order_no_type: "2000000000000000009",
    organization_id: ORG, po_plant: ORG, po_supplier_id: "1600000000000000001", preq_id: [], auto_pi: 0, create_pi: "No", draft_status: "<b>x</b>" });
  h.table_po = [];
  for (let i = 0; i < n; i++) {
    const l = clone(tl);
    for (const k of ["id", "children", "line_index", "line_status"]) delete l[k];
    let alt = JSON.stringify([{ alt_uom_id: "1800000000000000002", alt_qty: 1, base_qty: 12, base_uom_id: "1800000000000000001", purchase_unit_price: 30 }]);
    alt = JSON.stringify(JSON.stringify(alt));
    Object.assign(l, { fm_key: "fm" + i, item_id: String(1700000000000000000n + BigInt(i + 1)), quantity: i + 1, quantity_uom: "1800000000000000002", alt_uom: alt,
      table_uom_conversion: JSON.stringify([{ alt_uom_id: "1800000000000000002", base_qty: 12 }]), supplier_id: "stale", plant_id: "stale", organization_id: "stale" });
    h.table_po.push(l);
  }
  return h;
}
const state = (w) => {
  const s = w.snapshot();
  for (const po of Object.values(s.po)) for (const l of po.lines) delete l.table_uom_conversion;
  return JSON.stringify({ po: s.po, onorder: s.onorder });
};
let fails = 0;
for (const n of [3, 300]) {
  const wf = world(n);
  const ws = world(n);
  const p = payload(n);
  new Engine(NEW, wf, {}).run({ allData: clone(p) });
  new Engine(NEW, ws, {}).run({ allData: slim(clone(p)) });
  const same = state(wf) === state(ws);
  const nullConv = Object.values(ws.po)[0].lines.every((l) => l.table_uom_conversion === null);
  console.log((same && nullConv ? "ok   " : "FAIL ") + "Add " + n + " lines: same rows (table_uom_conversion NULL with the slim payload: " + nullConv + ")");
  if (!(same && nullConv)) fails++;
  // Edit of the stored PO, both ways
  const id = Object.keys(wf.po)[0];
  const e = clone(wf.readback(id));
  e.page_status = "Edit";
  e.previous_status = e.po_status;
  e.table_po.forEach((l) => (l.alt_uom = JSON.stringify(l.alt_uom)));
  new Engine(NEW, wf, {}).run({ allData: clone(e) });
  new Engine(NEW, ws, {}).run({ allData: slim(clone(e)) });
  const same2 = state(wf) === state(ws);
  console.log((same2 ? "ok   " : "FAIL ") + "Edit " + n + " lines: same rows");
  if (!same2) fails++;
  const alt = Object.values(ws.po)[0].lines[0].alt_uom;
  const one = typeof JSON.parse(alt) === "object";
  console.log((one ? "ok   " : "FAIL ") + "alt_uom stored as one JSON layer: " + alt.slice(0, 90));
  if (!one) fails++;
}
process.exit(fails ? 1 : 0);
