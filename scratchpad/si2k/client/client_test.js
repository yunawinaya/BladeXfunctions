// SI form handlers, live (dev v387) vs patched, in a mock form runtime (adapted from scratchpad/pi2k/client/client_test.js):
// the final form model must be identical; reads, row-path writes, per-row UI calls and handler runs are counted.
// A row-path setData that changes a value fires that column's onChange (unit_price / si_discount / si_discount_uom_id /
// tax_percent -> SIcalculation, invoice_qty -> onChange_invoice_qty, si_tax_inclusive -> onChange_taxInclusive), as the
// platform does (memory: project_picking_load_onchange_storm). Two things the platform does that are not known for
// certain are run both ways, and the forms must match either way:
//   ARGS  what a column onChange receives: "A" { value, rowIndex } | "B" { value, rowIndex, row, field }
//   FMKEY whether rows written as a whole table get an fm_key: "rows" (top-level rows) | "none"
// Usage: node client_test.js [--quick]
"use strict";
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const QUICK = process.argv.includes("--quick");
const H = {
  old: {
    SIcalculation: read("base_SIcalculation.js"),
    onChange_invoice_qty: read("base_onChange_invoice_qty.js"),
    onRowRemove_item: read("base_onRowRemove_item.js"),
    onConfirm_batchAddItem: read("base_onConfirm_batchAddItem.js"),
    onChange_taxInclusive: read("base_onChange_taxInclusive.js"),
  },
  new: {
    SIcalculation: read("new_SIcalculation.js"),
    onChange_invoice_qty: read("base_onChange_invoice_qty.js"),
    onRowRemove_item: read("new_onRowRemove_item.js"),
    onConfirm_batchAddItem: read("new_onConfirm_batchAddItem.js"),
    onChange_taxInclusive: read("new_onChange_taxInclusive.js"),
  },
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
// the form is keyed state: the order keys were first written in is not part of it
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
};
const J = (v) => JSON.stringify(canon(v));
const ON_CHANGE = { unit_price: "SIcalculation", si_discount: "SIcalculation", si_discount_uom_id: "SIcalculation", tax_percent: "SIcalculation",
  invoice_qty: "onChange_invoice_qty", si_tax_inclusive: "onChange_taxInclusive" };

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

// filter trees as the handlers send them: branch(all/any) of leaves (in / equal / notEqual / isNull)
function matches(row, f) {
  if (!f) return true;
  if (f.type === "branch" || Array.isArray(f.children)) {
    const kids = f.children || [];
    return f.operator === "any" ? kids.some((c) => matches(row, c)) : kids.every((c) => matches(row, c));
  }
  const v = row[f.prop];
  const vals = (x) => (Array.isArray(x) ? x : [x]).map((y) => (y && typeof y === "object" ? String(y.id) : String(y)));
  switch (f.operator) {
    case "in":
      return Array.isArray(v) ? vals(v).some((x) => vals(f.value).includes(x)) : vals(f.value).includes(String(v));
    case "equal":
      return String(v) === String(f.value);
    case "notEqual":
      return String(v) !== String(f.value);
    case "isNull":
      return v === undefined || v === null || v === "";
    default:
      throw new Error("filter operator " + f.operator);
  }
}

function makeForm(version, model, dbData, opts) {
  const st = { setDataCalls: 0, rowPathWrites: 0, ui: 0, uiPaths: 0, events: {}, reads: 0, docGets: 0, queue: [], fmSeq: 0 };
  const handlers = H[version];
  const db = {
    collection: (name) => {
      const q = { name, filters: null, lim: null, fields: null };
      const rowsOf = () => Object.values(dbData[name] || {});
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
        limit: (n) => {
          q.lim = n;
          return api;
        },
        get: async () => {
          st.reads++;
          let rows = rowsOf().filter((r) => (q.filters || []).every((f) => matches(r, f)));
          if (q.where) rows = rows.filter((r) => Object.entries(q.where).every(([k, v]) => String(r[k]) === String(v)));
          if (q.lim) rows = rows.slice(0, q.lim);
          if (q.fields) {
            const keep = new Set(String(q.fields).split(",").map((s) => s.trim()).concat(["id", "tenant_id"]));
            rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
          }
          return { data: rows.map(clone) };
        },
      };
      return api;
    },
  };
  const giveKeys = (rows) => {
    if (opts.fmkey === "none" || !Array.isArray(rows)) return;
    for (const r of rows) if (r && r.fm_key === undefined) r.fm_key = "fmk" + ++st.fmSeq;
  };
  const ctx = {
    getValues: () => clone(model),
    getValue: (p) => clone(getAt(model, p)),
    setData: (obj) => {
      st.setDataCalls++;
      for (const [k, v] of Object.entries(obj)) {
        const before = getAt(model, k);
        setAt(model, k, clone(v));
        if (k === "table_si") giveKeys(model.table_si);
        const m = k.match(/^table_si\.(\d+)\.([a-z_]+)$/);
        if (m) {
          st.rowPathWrites++;
          if (ON_CHANGE[m[2]] && JSON.stringify(before) !== JSON.stringify(v)) {
            const args = { value: clone(v), rowIndex: Number(m[1]) };
            if (opts.args === "B") {
              args.row = clone(model.table_si[Number(m[1])]);
              args.field = m[2];
            }
            st.queue.push([ON_CHANGE[m[2]], args]);
          }
        } else if (/^table_si\.\d+\.children\./.test(k)) {
          st.rowPathWrites++;
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
    closeDialog() {},
    showLoading() {},
    hideLoading() {},
    getComponent: () => null,
    $message: { warning() {}, error() {}, success() {} },
    $alert: async () => {},
    $confirm: async () => {},
    parentGenerateForm: { $alert: async () => {} },
  };
  st.inFlight = 0;
  async function run(name, args) {
    st.events[name] = (st.events[name] || 0) + 1;
    if (st.events[name] > 20000) throw new Error("event storm: " + name);
    const src = handlers[name];
    if (!src) return;
    const fn = new Function("db", "console", "setTimeout", "arguments_0", src.replace(/arguments\[0\]/g, "arguments_0"));
    st.inFlight++;
    try {
      // a timer of 2 s or more is the live SIcalculation's debug log (it holds the call's whole updates object): no effect on the form
      await fn.call(ctx, db, { log() {}, error() {}, warn() {} }, (f, ms) => (ms >= 2000 ? 0 : st.queue.push(["__timer", f])), args);
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    } finally {
      st.inFlight--;
    }
  }
  // until nothing is queued and no handler is running for 30 turns in a row: a timer may start an async loop it does not
  // hand back (onRowRemove_item does), and that loop's triggerEvent calls only show up as handlers running
  async function drain() {
    let idle = 0;
    for (let guard = 0; idle < 30 && guard < 2000000; guard++) {
      if (st.queue.length) {
        idle = 0;
        const [name, args] = st.queue.shift();
        if (name === "__timer") await args();
        else await run(name, args);
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
        continue;
      }
      idle = st.inFlight > 0 ? 0 : idle + 1;
      await new Promise((r) => setImmediate(r));
    }
  }
  return { st, run, drain, model };
}

// ---------------------------------------------------------------------------------------------------- fixtures
let seq = 2500000000000000000n;
const nid = () => (++seq).toString();
// A line as the form holds it after a batch add / load. Every 4th line has a discount (with its unit), a few have
// a discount and no unit (the calculation gives them "Amount"), every 3rd is taxed, every 6th tax-inclusive.
function siRow(i, o) {
  o = o || {};
  const r = {
    material_id: nid(), material_name: "Item " + i, invoice_qty: (i % 7) + 1, available_inv_qty: (i % 7) + 1,
    unit_price: o.priceStr ? String((((i % 5) + 1) * 2.5).toFixed(8)) : ((i % 5) + 1) * 2.5,
    si_discount: i % 4 === 0 ? 1 : 0, si_discount_uom_id: i % 8 === 0 ? "%" : i % 4 === 0 ? "Amount" : undefined,
    tax_percent: i % 3 === 0 ? 6 : 0, si_tax_inclusive: i % 6 === 0 ? 1 : 0, fm_key: "fm" + i,
    line_so_id: "2400000000000000001", line_so_no: "SO/1", so_line_id: nid(), line_gd_id: "2400000000000000002", line_gd_no: "GD/1", gd_line_id: nid(),
    custom_fields: { note: "n" + i },
  };
  if (i === 11 || i === 23) {
    r.si_discount = 2;
    delete r.si_discount_uom_id; // discount with no unit
  }
  if (i === 17) r.si_discount = 999; // more than the line is worth: cleared
  if (o.negative && i % 10 === 9) r.invoice_qty = -1;
  if (r.si_discount_uom_id === undefined) delete r.si_discount_uom_id;
  return r;
}
function table(n, o) {
  o = o || {};
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(siRow(i, o));
  if (o.bundles) {
    // a nested bundle, a flat one linked by parent_fm_key and by parent_id
    rows[1] = { material_name: "Bundle A", item_bundle_id: "2089258885490675714", invoice_qty: 2, available_inv_qty: 2, fm_key: "fmA", id: "2500000000000009001",
      line_so_id: "2400000000000000001", so_line_id: nid(), children: [siRow(9001), siRow(9002)] };
    rows[2] = { material_name: "Bundle B", item_bundle_id: "2089258885490675715", invoice_qty: 1, available_inv_qty: 1, fm_key: "fmB", id: "2500000000000009002",
      line_so_id: "2400000000000000001", so_line_id: nid() };
    rows[3] = Object.assign(siRow(9003), { item_bundle_id: "2089258885490675715", parent_fm_key: "fmB" });
    rows[4] = Object.assign(siRow(9004), { item_bundle_id: "2089258885490675715", parent_id: "2500000000000009002" });
  }
  return rows;
}
const header = (rows, extra) => Object.assign({ exchange_rate: 1, currency_code: "MYR", table_si: rows, invoice_subtotal: 0, si_status: "Draft",
  organization_id: "2400000000000000099", customer_id: "2400000000000000003", reference_type: "Document - GD" }, extra || {});

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "ok   " : "FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) failures++;
};
const VARIANTS = [{ args: "A", fmkey: "rows" }, { args: "B", fmkey: "rows" }, { args: "A", fmkey: "none" }, { args: "B", fmkey: "none" }];
// Batch Add writes rows that carry no fm_key yet. If the form did not key them, the live handler would price every
// keyless row as the current row of every call and storm (it does in this mock), so keyed rows are the only case.
const KEYED = [{ args: "A", fmkey: "rows" }, { args: "B", fmkey: "rows" }];
const stats = (st) => "reads " + st.reads + " (" + st.docGets + " one-line), setData " + st.setDataCalls + ", row-path writes " + st.rowPathWrites +
  ", UI calls " + st.ui + " (" + st.uiPaths + " paths), runs " + JSON.stringify(st.events);
const firstDiff = (a, b, p) => {
  if (J(a) === J(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], p + "." + k);
      if (d) return d;
    }
  }
  return p + ": " + JSON.stringify(a)?.slice(0, 120) + " vs " + JSON.stringify(b)?.slice(0, 120);
};

const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
async function compare(label, setup, act, variants) {
  if (ONLY && !label.includes(ONLY)) return null;
  const out = {};
  const fixture = setup(); // one fixture, cloned into every run
  for (const variant of variants || VARIANTS) {
    const key = variant.args + "/" + variant.fmkey;
    const res = {};
    for (const v of ["old", "new"]) {
      const { model, db } = clone(fixture);
      const f = makeForm(v, model, db, variant);
      const t0 = Date.now();
      await act(f);
      await f.drain();
      res[v] = { model: clone(f.model), st: f.st, ms: Date.now() - t0 };
    }
    const same = J(res.old.model) === J(res.new.model);
    check(label + " [" + key + "]: same form", same, same ? "" : firstDiff(res.old.model, res.new.model, "form"));
    out[key] = res;
  }
  const r = out[Object.keys(out)[0]];
  console.log("      old: " + stats(r.old.st) + ", " + r.old.ms + " ms");
  console.log("      new: " + stats(r.new.st) + ", " + r.new.ms + " ms");
  return out;
}

// the user edits one cell: the cell holds the new value, then its onChange runs with what the platform passes
const edit = (row, col, value) => async (f) => {
  await f.run("SIcalculation", {});
  await f.drain();
  for (const k of Object.keys(f.st.events)) f.st.events[k] = 0;
  f.st.rowPathWrites = 0;
  f.st.setDataCalls = 0;
  setAt(f.model, "table_si." + row + "." + col, value);
  await f.run(ON_CHANGE[col], { value, rowIndex: row, row: clone(f.model.table_si[row]), field: col });
};

// Batch Add "Document - GD": the delivery's lines, each with its order line on the order-line collection
function gdSelection(n, o) {
  o = o || {};
  const soLines = {};
  const gdLines = [];
  for (let i = 0; i < n; i++) {
    const sl = { id: nid(), so_item_price: ((i % 5) + 1) * 2.5, so_discount: i % 4 === 0 ? 1 : 0, so_discount_uom: i % 4 === 0 ? "Amount" : undefined,
      so_tax_preference: "2400000000000000077", so_tax_percentage: i % 3 === 0 ? 6 : 0, so_tax_inclusive: 0 };
    if (sl.so_discount_uom === undefined) delete sl.so_discount_uom;
    soLines[sl.id] = sl;
    gdLines.push({ id: nid(), material_id: nid(), material_name: "Item " + i, gd_material_desc: "d" + i, line_so_no: "SO/1", line_so_id: "2400000000000000001",
      so_line_item_id: sl.id, gd_order_quantity: 5, good_delivery_uom_id: "2400000000000000098", gd_qty: 5, invoice_qty: i % 9 === 0 ? 5 : 0,
      item_category_id: "2400000000000000097", tariff_id: "2400000000000000096", custom_fields: { g: i }, further_description: "f" + i });
  }
  if (o.bundles) {
    // a bundle row with its items nested, and one with flat items after it
    const bl = { id: nid(), so_item_price: 0, so_tax_percentage: 0 };
    soLines[bl.id] = bl;
    const kid = (j) => {
      const s = { id: nid(), so_item_price: 3, so_discount: 0, so_tax_percentage: 6, so_tax_inclusive: 0 };
      soLines[s.id] = s;
      return { id: nid(), material_id: nid(), material_name: "Kid " + j, line_so_id: "2400000000000000001", so_line_item_id: s.id, gd_qty: 2, invoice_qty: 0,
        item_bundle_id: "2089258885490675714" };
    };
    gdLines[1] = { id: nid(), material_name: "Bundle A", item_bundle_id: "2089258885490675714", line_so_id: "2400000000000000001", so_line_item_id: bl.id,
      gd_qty: 1, invoice_qty: 0, children: [kid(1), kid(2)] };
    const bl2 = { id: nid(), so_item_price: 0, so_tax_percentage: 0 };
    soLines[bl2.id] = bl2;
    gdLines[2] = { id: "2500000000000019002", material_name: "Bundle B", item_bundle_id: "2089258885490675715", line_so_id: "2400000000000000001",
      so_line_item_id: bl2.id, gd_qty: 1, invoice_qty: 0 };
    gdLines[3] = Object.assign(kid(3), { item_bundle_id: "2089258885490675715", parent_id: "2500000000000019002" });
    gdLines[4] = Object.assign(kid(4), { item_bundle_id: "2089258885490675715" });
  }
  const sel = [{ goods_delivery_id: "2400000000000000002", goods_delivery_number: "GD/1", customer_id: "2400000000000000003",
    sales_order_id: [{ id: "2400000000000000001" }], table_gd: gdLines }];
  const db = { sales_order_axszx8cj_sub: soLines, sales_order: { "2400000000000000001": { id: "2400000000000000001", so_type: "Credit" } }, sales_invoice: {},
    sales_return_setup: {}, document_linkage: {} };
  return { sel, db };
}

// Batch Add "Item - GD": picked lines; a bundle line's items are read back off its delivery
function itemGdSelection(n) {
  const soLines = {};
  const gdId = "2400000000000000002";
  const docLines = [];
  const sel = [];
  for (let i = 0; i < n; i++) {
    const s = { id: nid(), so_item_price: 4, so_discount: 0, so_tax_percentage: 6, so_tax_inclusive: 0 };
    soLines[s.id] = s;
    const bundleLine = { id: nid(), material_name: "Bundle " + i, item_bundle_id: "20892588854906757" + (10 + i), so_line_item_id: s.id, gd_qty: 1 };
    const kids = [0, 1].map((j) => {
      const ks = { id: nid(), so_item_price: 2, so_discount: 0, so_tax_percentage: 6, so_tax_inclusive: 0 };
      soLines[ks.id] = ks;
      return { id: nid(), material_id: nid(), material_name: "Kid " + i + "." + j, item_bundle_id: bundleLine.item_bundle_id, so_line_item_id: ks.id,
        line_so_id: "2400000000000000001", gd_qty: 2, invoice_qty: 0, parent_id: bundleLine.id };
    });
    docLines.push(bundleLine, ...kids);
    sel.push({ goods_delivery_line_id: bundleLine.id, item: { id: "", material_name: "Bundle " + i }, customer: { id: "2400000000000000003" }, delivered_qty: 1,
      invoiced_qty: 0, so_line_item: s, goods_delivery_number: "GD/1", sales_order_id: [{ id: "2400000000000000001" }], goods_delivery_id: gdId, uom: "u",
      line_so_no: "SO/1", line_so_id: "2400000000000000001", item_bundle_id: bundleLine.item_bundle_id, children: [] });
  }
  const db = { sales_order_axszx8cj_sub: soLines, goods_delivery: { [gdId]: { id: gdId, table_gd: docLines } },
    sales_order: { "2400000000000000001": { id: "2400000000000000001", so_type: "Credit" } }, sales_invoice: {}, sales_return_setup: {}, document_linkage: {} };
  return { sel, db };
}

module.exports = { makeForm, header, table, gdSelection, itemGdSelection, clone, setAt, firstDiff, J };

if (require.main === module) (async () => {
  const N = QUICK ? 300 : 2000;
  // ---- the calculation: a full pass, then one edited cell
  await compare("calc 20 lines, edit price", () => ({ model: header(table(20)), db: {} }), edit(5, "unit_price", 9.75));
  await compare("calc 20 lines, bundles, edit discount", () => ({ model: header(table(20, { bundles: true })), db: {} }), edit(6, "si_discount", 2));
  await compare("calc 20 lines, prices as text, edit tax", () => ({ model: header(table(20, { priceStr: true })), db: {} }), edit(0, "tax_percent", 10));
  await compare("calc 20 lines, credit lines, edit qty", () => ({ model: header(table(20, { negative: true })), db: {} }), edit(9, "invoice_qty", -2));
  await compare("calc 20 lines, bundles, edit bundle qty", () => ({ model: header(table(20, { bundles: true })), db: {} }), edit(2, "invoice_qty", 1));
  await compare("calc " + N + " lines, edit price", () => ({ model: header(table(N)), db: {} }), edit(N - 500, "unit_price", 3.25));
  await compare("calc " + N + " lines, bundles, edit qty", () => ({ model: header(table(N, { bundles: true })), db: {} }), edit(N - 1, "invoice_qty", 4));

  // ---- removing a row: every remaining row is priced as the current row, in turn
  const removeRow = (k) => async (f) => {
    f.model.table_si.splice(k, 1);
    await f.run("onRowRemove_item", {});
  };
  await compare("remove a row, 20 lines", () => ({ model: header(table(20)), db: {} }), removeRow(4));
  await compare("remove a row, 20 lines, bundles", () => ({ model: header(table(20, { bundles: true })), db: {} }), removeRow(7));
  await compare("remove a row, 20 lines, prices as text + credit lines", () => ({ model: header(table(20, { priceStr: true, negative: true })), db: {} }), removeRow(0));
  await compare("remove a row, " + N + " lines", () => ({ model: header(table(N)), db: {} }), removeRow(10));

  // ---- the tax-inclusive switch on an AutoCount organisation
  const taxSwitch = (r) => async (f) => {
    setAt(f.model, "table_si." + r + ".si_tax_inclusive", 1);
    await f.run("onChange_taxInclusive", { value: 1, row: clone(f.model.table_si[r]), rowIndex: r });
  };
  await compare("tax inclusive switch, 20 lines, bundles", () => ({ model: header(table(20, { bundles: true }), { acc_integration_type: "AutoCount Accounting" }), db: {} }), taxSwitch(5));
  await compare("tax inclusive switch, 20 lines, other accounting", () => ({ model: header(table(20)), db: {} }), taxSwitch(5));
  await compare("tax inclusive switch, " + N + " lines", () => ({ model: header(table(N), { acc_integration_type: "AutoCount Accounting" }), db: {} }), taxSwitch(7));

  // ---- Batch Add
  const batch = (selFn, refType, existing) => () => {
    const { sel, db } = selFn();
    const model = header(existing ? existing() : [], { reference_type: existing ? refType : undefined });
    model.__sel = sel;
    return { model, db };
  };
  const confirm = (refType) => async (f) => {
    const sel = f.model.__sel;
    delete f.model.__sel;
    await f.run("onConfirm_batchAddItem", { itemArray: clone(sel), referenceType: refType });
  };
  await compare("batch add Document - GD, 30 lines", batch(() => gdSelection(30), "Document - GD"), confirm("Document - GD"), KEYED);
  await compare("batch add Document - GD, 30 lines, bundles", batch(() => gdSelection(30, { bundles: true }), "Document - GD"), confirm("Document - GD"), KEYED);
  await compare("batch add Document - GD, 30 lines onto 12 existing", batch(() => gdSelection(30), "Document - GD", () => table(12, { priceStr: true })),
    confirm("Document - GD"), KEYED);
  await compare("batch add Item - GD, 6 bundle lines", batch(() => itemGdSelection(6), "Item - GD"), confirm("Item - GD"), KEYED);
  await compare("batch add Document - GD, " + N + " lines", batch(() => gdSelection(N), "Document - GD"), confirm("Document - GD"), KEYED);
  await compare("batch add Document - GD, " + N + " lines onto 200 existing", batch(() => gdSelection(N), "Document - GD", () => table(200)), confirm("Document - GD"),
    [{ args: "B", fmkey: "rows" }]);

  console.log("client checks failures:", failures);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
