// PI form handlers, live (dev v625) vs patched, in a mock form runtime: the final form model must be identical; reads,
// row-path writes and per-row UI calls are counted. A row-path setData that changes a value fires that column's onChange
// (order_unit_price / order_discount / discount_uom / tax_percent -> PIcalculation, invoice_qty -> onChange_invoice_qty), as the
// platform does (scratchpad memory: project_picking_load_onchange_storm). Usage: node client_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const H = {
  old: { PIcalculation: read("base_PIcalculation.js"), onConfirm_batchAddItem: read("base_onConfirm_batchAddItem.js"), onChange_invoice_qty: read("base_onChange_invoice_qty.js") },
  new: { PIcalculation: read("new_PIcalculation.js"), onConfirm_batchAddItem: read("new_onConfirm_batchAddItem.js"), onChange_invoice_qty: read("base_onChange_invoice_qty.js") },
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const ON_CHANGE = { order_unit_price: "PIcalculation", order_discount: "PIcalculation", discount_uom: "PIcalculation", tax_percent: "PIcalculation", invoice_qty: "onChange_invoice_qty" };

function getAt(obj, p) {
  return p.split(".").reduce((n, k) => (n == null ? undefined : n[k]), obj);
}
function setAt(obj, p, v) {
  const parts = p.split(".");
  let n = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (n[parts[i]] == null) n[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    n = n[parts[i]];
  }
  n[parts[parts.length - 1]] = v;
}

function makeForm(version, model, dbData) {
  const st = { setDataCalls: 0, rowPathWrites: 0, ui: 0, uiPaths: 0, events: {}, reads: 0, docGets: 0, queue: [] };
  const handlers = H[version];
  const db = {
    collection: (name) => {
      const q = { name, filters: null, fields: null };
      const api = {
        doc: (id) => ({
          get: async () => {
            st.reads++;
            st.docGets++;
            const row = (dbData[name] || {})[String(id)];
            return { data: row ? [clone(row)] : [] };
          },
        }),
        filter: (f) => {
          q.filters = f;
          return api;
        },
        where: (w) => {
          q.where = w;
          return api;
        },
        field: (f) => {
          q.fields = f;
          return api;
        },
        limit: () => api,
        get: async () => {
          st.reads++;
          const leaf = q.filters ? q.filters[0].children.find((c) => c.prop === "id" && c.operator === "in") : null;
          if (leaf) {
            const rows = leaf.value.map((id) => (dbData[name] || {})[String(id)]).filter(Boolean).map(clone);
            return { data: rows };
          }
          return { data: [] };
        },
      };
      return api;
    },
  };
  const ctx = {
    getValues: () => clone(model),
    getValue: (p) => clone(getAt(model, p)),
    setData: (obj) => {
      st.setDataCalls++;
      for (const [k, v] of Object.entries(obj)) {
        const before = getAt(model, k);
        setAt(model, k, clone(v));
        const m = k.match(/^table_pi\.(\d+)\.([a-z_]+)$/);
        if (m) {
          st.rowPathWrites++;
          if (ON_CHANGE[m[2]] && JSON.stringify(before) !== JSON.stringify(v)) st.queue.push([ON_CHANGE[m[2]], { value: v, rowIndex: Number(m[1]) }]);
        }
      }
      return Promise.resolve();
    },
    display: (p) => {
      st.ui++;
      st.uiPaths += Array.isArray(p) ? p.length : 1;
    },
    hide: (p) => {
      st.ui++;
      st.uiPaths += Array.isArray(p) ? p.length : 1;
    },
    disabled: (p) => {
      st.ui++;
      st.uiPaths += Array.isArray(p) ? p.length : 1;
    },
    triggerEvent: async (name, args) => run(name, args),
    showLoading() {},
    hideLoading() {},
    $message: { warning() {}, error() {}, success() {} },
    $alert: async () => {},
    $confirm: async () => {},
    parentGenerateForm: { $alert: async () => {} },
  };
  async function run(name, args) {
    st.events[name] = (st.events[name] || 0) + 1;
    if (st.events[name] > 5000) throw new Error("event storm: " + name);
    const src = handlers[name];
    if (!src) return;
    const fn = new Function("db", "console", "setTimeout", "arguments_0", src.replace(/arguments\[0\]/g, "arguments_0"));
    await fn.call(ctx, db, { log() {}, error() {}, warn() {} }, (f) => st.queue.push(["__timer", f]), args);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }
  async function drain() {
    for (let guard = 0; st.queue.length && guard < 100000; guard++) {
      const [name, args] = st.queue.shift();
      if (name === "__timer") await args();
      else await run(name, args);
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    }
  }
  return { st, run, drain, model };
}

// ---------------------------------------------------------------------------------------------------- fixtures
let seq = 2500000000000000000n;
const nid = () => (++seq).toString();
function piRow(i, opts) {
  opts = opts || {};
  const r = {
    material_id: nid(), material_name: "Item " + i, invoice_qty: (i % 7) + 1, order_unit_price: opts.priceStr ? String(((i % 5) + 1) * 2.5) : ((i % 5) + 1) * 2.5,
    order_discount: i % 4 === 0 ? 1 : 0, discount_uom: i % 8 === 0 ? "%" : i % 4 === 0 ? "Amount" : undefined, tax_percent: i % 3 === 0 ? 6 : 0,
    tax_inclusive: i % 6 === 0 ? 1 : 0, fm_key: "fm" + i, line_po_id: "2400000000000000001", po_line_id: nid(),
  };
  if (r.discount_uom === undefined) delete r.discount_uom;
  return r;
}
function table(n, opts) {
  opts = opts || {};
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(piRow(i, opts));
  if (opts.bundles) {
    // a nested bundle and a flat one
    rows[1] = { material_name: "Bundle A", item_bundle_id: "2089258885490675714", invoice_qty: 2, fm_key: "fmA", id: "2500000000000009001",
      children: [piRow(9001), piRow(9002)] };
    rows[2] = { material_name: "Bundle B", item_bundle_id: "2089258885490675715", invoice_qty: 1, fm_key: "fmB", id: "2500000000000009002" };
    rows[3] = Object.assign(piRow(9003), { item_bundle_id: "2089258885490675715", parent_fm_key: "fmB" });
    rows[4] = Object.assign(piRow(9004), { item_bundle_id: "2089258885490675715", parent_id: "2500000000000009002" });
  }
  return rows;
}
const header = (rows) => ({ exchange_rate: 1, currency_code: "MYR", table_pi: rows, invoice_subtotal: 0, pi_status: "Draft" });

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "ok   " : "FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) failures++;
};

async function calcCase(label, rows, edit) {
  const out = {};
  for (const v of ["old", "new"]) {
    const f = makeForm(v, header(clone(rows)), {});
    await f.run("PIcalculation", {});
    await f.drain();
    const settled = clone(f.model);
    const first = Object.assign({}, f.st);
    let afterEdit = null;
    if (edit) {
      // the user changes one row's price: the cell holds the new value, then its onChange runs
      f.st.rowPathWrites = 0;
      f.st.events = {};
      setAt(f.model, "table_pi." + edit.row + "." + edit.col, edit.value);
      await f.run(ON_CHANGE[edit.col], { value: edit.value, rowIndex: edit.row });
      await f.drain();
      afterEdit = { model: clone(f.model), writes: f.st.rowPathWrites, events: clone(f.st.events) };
    }
    out[v] = { settled, first, afterEdit };
  }
  check(label + ": same form after the calculation", JSON.stringify(out.old.settled) === JSON.stringify(out.new.settled));
  console.log("      first run: row-path writes " + out.old.first.rowPathWrites + " -> " + out.new.first.rowPathWrites + ", events " +
    JSON.stringify(out.old.first.events) + " -> " + JSON.stringify(out.new.first.events) + ", UI calls " + out.old.first.ui + " -> " + out.new.first.ui);
  if (edit) {
    check(label + ": same form after editing row " + edit.row + " " + edit.col, JSON.stringify(out.old.afterEdit.model) === JSON.stringify(out.new.afterEdit.model));
    console.log("      the edit: row-path writes " + out.old.afterEdit.writes + " -> " + out.new.afterEdit.writes + ", events " +
      JSON.stringify(out.old.afterEdit.events) + " -> " + JSON.stringify(out.new.afterEdit.events));
  }
}

async function batchCase(label, n) {
  const po = {};
  const grLines = [];
  for (let i = 0; i < n; i++) {
    const pl = { id: nid(), discount: i % 4 === 0 ? 1 : 0, discount_uom: "Amount", tax_percent: i % 3 === 0 ? 6 : 0, tax_preference: "2400000000000000077",
      tax_inclusive: 0, unit_price: 2.5, custom_fields_va4w0xz3: { x: "po" + i } };
    po[pl.id] = pl;
    grLines.push({ id: nid(), item_id: nid(), item_name: "Item " + i, received_qty: 5, invoice_qty: 0, po_line_item_id: pl.id, line_po_id: "2400000000000000001",
      line_po_no: "PO/1", unit_price: 2.5, item_uom: "2400000000000000099", ordered_qty: 5, parent_or_child: i % 50 === 7 ? "Split-Parent" : "Parent",
      custom_fields_d7o7rdkd: { y: "gr" + i } });
  }
  const sel = [{ goods_receiving_id: "2400000000000000002", goods_receiving_number: "GR/1", supplier_id: "2400000000000000003", purchase_order_id: [{ id: "2400000000000000001" }],
    table_gr: grLines }];
  const grRows = {};
  for (const l of grLines) grRows[l.id] = l;
  const data = { purchase_order_2ukyuanr_sub: po, goods_receiving_eg6l4ywi_sub: grRows, purchase_invoice: {}, goods_receiving: {}, purchase_order: {} };
  const out = {};
  for (const v of ["old", "new"]) {
    const f = makeForm(v, header([]), data);
    f.model.supplier_name = "2400000000000000003";
    await f.run("onConfirm_batchAddItem", { itemArray: clone(sel), referenceType: "Document - GR" });
    await f.drain();
    out[v] = { model: clone(f.model), st: f.st };
  }
  check(label + ": same form after Batch Add (Document - GR)", JSON.stringify(out.old.model) === JSON.stringify(out.new.model),
    out.old.model.table_pi.length + " lines");
  console.log("      reads " + out.old.st.reads + " (" + out.old.st.docGets + " one-line gets) -> " + out.new.st.reads + " (" + out.new.st.docGets + "), UI calls " +
    out.old.st.ui + " -> " + out.new.st.ui + ", row-path writes " + out.old.st.rowPathWrites + " -> " + out.new.st.rowPathWrites + ", events " +
    JSON.stringify(out.old.st.events) + " -> " + JSON.stringify(out.new.st.events));
}

(async () => {
  await calcCase("calc 20 lines", table(20), { row: 5, col: "order_unit_price", value: 9.75 });
  await calcCase("calc 20 lines, bundles", table(20, { bundles: true }), { row: 6, col: "order_discount", value: 2 });
  await calcCase("calc 20 lines, prices as text", table(20, { priceStr: true }), { row: 0, col: "tax_percent", value: 10 });
  await calcCase("calc 2,000 lines", table(2000), { row: 1500, col: "order_unit_price", value: 3.25 });
  await calcCase("calc 2,000 lines, bundles", table(2000, { bundles: true }), { row: 1999, col: "invoice_qty", value: 4 });
  await batchCase("batch add 30", 30);
  await batchCase("batch add 2,000", 2000);
  console.log("client checks failures:", failures);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
