// In-memory world for SI_SAVE v83 / v84 replays: the sales orders and goods deliveries a run read (header + flat line rows,
// parent_id on a bundle's items), the stored invoice, and every other read the run recorded. Old search / get nodes are answered
// from the recorded outputs (the platform's own shape); the v84 sql-nodes from the same rows as JSON text per row. Writes to the
// orders and deliveries land on the line rows: v83's whole table_so / table_gd through the header (a key a line went back without
// is stored as NULL), v84's per-line updates through the line collections.
"use strict";

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const keep = (o) => {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== undefined && v !== "") r[k] = clone(v);
  return r;
};
const ids = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(String);
const sqlIds = (text, after) => {
  const i = text.indexOf(after);
  if (i < 0) throw new Error("ids not found after " + after);
  const m = text.slice(i + after.length).match(/^\s*\(([0-9,\s]*)\)/) || text.slice(i + after.length).match(/^\s*=\s*([0-9]+)/);
  if (!m) throw new Error("no id list: " + text.slice(i, i + 80));
  return m[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "0");
};
const tenantOf = (text) => {
  const m = text.match(/tenant_id = '([^']*)'/);
  return m ? m[1] : null;
};
const num8 = (v) => (v === undefined || v === null || v === "" ? null : Math.round((parseFloat(v) || 0) * 1e8) / 1e8);

class World {
  // rec: node id -> the `data` part of the recorded response (what {{node:X.data...}} reads)
  constructor(rec, opts) {
    opts = opts || {};
    this.rec = rec || {};
    this.tenantId = opts.tenantId || "000000";
    this.seq = BigInt(opts.seed || "2300000000000000000");
    this.so = {};
    this.gd = {};
    this.si = {};
    this.deleted = [];
    this.calls = [];
    this.readArgs = [];
    this.cache = {};
    this.numberSeq = 0;
    const self = this;
    const fromRec = (nid, fallback) => (args) => {
      self.readArgs.push({ node: nid, args: clone(args) });
      return self.rec[nid] !== undefined ? clone(self.rec[nid]) : fallback;
    };
    const searchDocs = (store, lineKey) => (a) => {
      const rows = ids(a.id).filter((id) => store[id]).map((id) => self.shape(store[id], lineKey));
      return { total: rows.length, count: rows.length, data: rows };
    };
    this.read = {
      search_node_NDKdFanY: searchDocs(this.so, "table_so"),
      search_node_lTy219I0: searchDocs(this.gd, "table_gd"),
      get_node_siSrSetup1: fromRec("get_node_siSrSetup1", { count: 0, data: {} }),
      search_si_sopo: fromRec("search_si_sopo", { total: 0, count: 0, data: [] }),
      search_si_its: fromRec("search_si_its", { total: 0, count: 0, data: [] }),
      search_si_gdgr: fromRec("search_si_gdgr", { total: 0, count: 0, data: [] }),
      get_node_fcE2I4vj: (a) => {
        self.readArgs.push({ node: "get_node_fcE2I4vj", args: clone(a) });
        const id = ids(a.id)[0];
        return id && self.si[id] ? { count: 1, data: clone(self.si[id]) } : { count: 0, data: {} };
      },
      search_node_I3e7ZpkH: fromRec("search_node_I3e7ZpkH", { total: 0, count: 0, data: [] }),
      get_node_oLOE8Qt7: fromRec("get_node_oLOE8Qt7", { count: 0, data: {} }),
      get_node_auG34VOC: fromRec("get_node_auG34VOC", { count: 1, data: { id: "2026901594941353999" } }),
      get_node_Jcmd2YdP: fromRec("get_node_Jcmd2YdP", { count: 1, data: { id: "2026901594941353998", customer_currency_id: "MYR" } }),
      get_node_PsZEEuNO: fromRec("get_node_PsZEEuNO", { count: 1, data: { id: "2026901594941353997" } }),
    };
    this.sql = {
      sql_node_si_so: (text) => self.sqlLines(text, self.so, "s.id IN", "sales_order_axszx8cj_sub",
        ["id", "parent_id", "item_name", "item_id", "item_bundle_id", "so_quantity", "return_qty", "invoice_qty", "si_status"], ["id", "parent_id", "item_bundle_id"]),
      sql_node_si_gd: (text) => self.sqlLines(text, self.gd, "g.id IN", "goods_delivery_fwii8mvb_sub",
        ["id", "parent_id", "material_id", "material_name", "item_bundle_id", "gd_qty", "return_qty", "invoice_qty", "si_status"],
        ["id", "parent_id", "material_id", "item_bundle_id"]),
      sql_node_si_after: (text) => {
        if (tenantOf(text) !== self.tenantId) throw new Error("sql tenant " + tenantOf(text));
        const id = sqlIds(text, "AND s.id")[0];
        const s = id && self.si[id];
        if (!s) return [];
        return [{ j: JSON.stringify({ id: String(s.id), sales_invoice_no: s.sales_invoice_no === undefined ? null : s.sales_invoice_no,
          invoice_total: s.invoice_total === undefined || s.invoice_total === "" ? null : Number(s.invoice_total) }) }];
      },
    };
    const call = (name, out) => (params) => {
      self.calls.push({ name, params: clone(params) });
      return typeof out === "function" ? out(params) : clone(out);
    };
    this.wf = {
      CHECK_REQUIRED_FIELD: (params) => ({ data: require("./lib.js").checkRequiredField(params.entry, params.required_fields) }),
      CREDIT_LIMIT_CHECK: call("CREDIT_LIMIT_CHECK", () => clone(self.rec.workflow_node_G4KBFPGT !== undefined ? self.rec.workflow_node_G4KBFPGT : { result: "success", message: "" })),
      AR_SAVE: call("AR_SAVE", {}),
      SI_POST: call("SI_POST", {}),
      CP_SAVE: call("CP_SAVE", {}),
      SI_TO_PI: call("SI_TO_PI", () => clone(self.rec.wf_auto_pi !== undefined ? self.rec.wf_auto_pi : { data: { code: 200, message: "" } })),
    };
    if (opts.read) Object.assign(this.read, opts.read);
    if (opts.sql) Object.assign(this.sql, opts.sql);
    if (opts.wf) Object.assign(this.wf, opts.wf);
  }

  nextId() {
    this.seq += 1n;
    return this.seq.toString();
  }

  // a document as the search node returned it -> header + flat lines (a bundle's items carry parent_id)
  addDoc(store, doc, lineKey) {
    const header = {};
    for (const [k, v] of Object.entries(doc)) if (k !== lineKey) header[k] = clone(v);
    const lines = [];
    for (const l of doc[lineKey] || []) {
      const row = {};
      for (const [k, v] of Object.entries(l)) if (k !== "children") row[k] = clone(v);
      lines.push(row);
      for (const c of Array.isArray(l.children) ? l.children : []) {
        const child = clone(c);
        delete child.children;
        if (child.parent_id === undefined || child.parent_id === null) child.parent_id = l.id;
        lines.push(child);
      }
    }
    store[String(doc.id)] = { header, lines };
  }

  // the platform's read shape: a bundle's items under their bundle row, rows in stored order
  shape(doc, lineKey) {
    const lines = doc.lines.map(keep);
    const present = new Set(lines.map((l) => String(l.id)));
    const kids = new Map();
    for (const l of lines) {
      if (l.parent_id === undefined || !present.has(String(l.parent_id))) continue;
      if (!kids.has(String(l.parent_id))) kids.set(String(l.parent_id), []);
      kids.get(String(l.parent_id)).push(l);
    }
    const top = lines.filter((l) => l.parent_id === undefined || !present.has(String(l.parent_id)));
    const out = keep(doc.header);
    out[lineKey] = top.map((l) => (kids.has(String(l.id)) ? Object.assign({}, l, { children: kids.get(String(l.id)) }) : l));
    return out;
  }

  sqlLines(text, store, after, table, cols, bigints) {
    if (!text.includes(table)) throw new Error("sql table " + table);
    if (tenantOf(text) !== this.tenantId) throw new Error("sql tenant " + tenantOf(text));
    const big = new Set(bigints);
    const rows = [];
    const byId = (x, y) => (BigInt(String(x.id)) < BigInt(String(y.id)) ? -1 : BigInt(String(x.id)) > BigInt(String(y.id)) ? 1 : 0);
    for (const id of sqlIds(text, after).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))) {
      const doc = store[id];
      if (!doc) continue;
      const lines = doc.lines.slice().sort(byId);
      if (!lines.length) rows.push({ j: JSON.stringify({ doc: id, id: null }) });
      for (const l of lines) {
        const o = { doc: id };
        for (const c of cols) {
          const v = l[c];
          o[c] = v === undefined || v === null ? null : big.has(c) ? String(v) : v;
        }
        rows.push({ j: JSON.stringify(o) });
      }
    }
    return rows;
  }

  number(row, recorded) {
    const n = row.sales_invoice_no;
    if (n !== "issued" && n !== "draft") return n;
    if (recorded && recorded.sales_invoice_no) return recorded.sales_invoice_no;
    this.numberSeq++;
    return (n === "draft" ? "Draft-SI/SIM/" : "SI/SIM/") + String(this.numberSeq).padStart(4, "0");
  }

  // Add Data: the stored row comes back (the recorded one when the run has it, so Map AR Data reads what the platform gave)
  add(table, rows) {
    if (table !== "Sales Invoice") throw new Error("add " + table);
    const recorded = this.rec.add_node_adYeQB4a;
    return rows.map((r, i) => {
      const rec = Array.isArray(recorded) ? recorded[i] : null;
      const row = rec ? clone(rec) : Object.assign(keep(r), { id: this.nextId() });
      if (!rec) row.sales_invoice_no = this.number(r);
      this.si[String(row.id)] = row;
      return clone(row);
    });
  }

  update(table, rows) {
    for (const r of rows) {
      const id = String(r.id);
      if (table === "Sales Invoice") {
        const recorded = this.rec.get_node_fcE2I4vj && !Array.isArray(this.rec.get_node_fcE2I4vj) ? this.rec.get_node_fcE2I4vj : null;
        if (recorded && recorded.id !== undefined && String(recorded.id) === id) {
          this.si[id] = clone(recorded);
        } else {
          const next = Object.assign({}, this.si[id] || { id }, keep(r));
          next.sales_invoice_no = this.number(r);
          this.si[id] = next;
        }
      } else if (table === "Sales Order" || table === "Goods Delivery") {
        const store = table === "Sales Order" ? this.so : this.gd;
        const lineKey = table === "Sales Order" ? "table_so" : "table_gd";
        if (!store[id]) throw new Error("update missing header " + table + " " + id);
        if (r.si_status !== undefined) store[id].header.si_status = r.si_status;
        for (const k of Object.keys(r)) if (k !== "id" && k !== "si_status" && k !== lineKey) throw new Error("header prop " + k);
        if (r[lineKey] !== undefined) {
          const flat = [];
          for (const l of r[lineKey] || []) {
            flat.push(l);
            for (const c of Array.isArray(l.children) ? l.children : []) flat.push(c);
          }
          // a whole-row write: a key the row went back without is stored as NULL (prod, SI_CANCEL 2026-10-21 09:26)
          for (const l of flat) this.setLine(store, Object.assign({ si_status: null, invoice_qty: null }, l), table);
        }
      } else if (table === "AR Invoice") {
        this.ar = this.ar || {};
        this.ar[id] = Object.assign({}, this.ar[id] || {}, keep(r));
      } else if (table === "sales_order_axszx8cj_sub" || table === "(Goods Delivery)") {
        this.setLine(table === "sales_order_axszx8cj_sub" ? this.so : this.gd, r, table);
      } else {
        throw new Error("update " + table);
      }
    }
    return true;
  }

  setLine(store, r, table) {
    for (const doc of Object.values(store)) {
      for (const l of doc.lines) {
        if (String(l.id) !== String(r.id)) continue;
        if (r.invoice_qty !== undefined) l.invoice_qty = r.invoice_qty;
        if (r.si_status !== undefined) l.si_status = r.si_status;
        if (r.posted_qty !== undefined) l.posted_qty = r.posted_qty;
        return;
      }
    }
    throw new Error("update missing line " + table + " " + r.id);
  }

  del(rows) {
    for (const r of rows) this.deleted.push(String(r.id));
  }

  // what a save leaves behind on the orders and deliveries, in comparable form
  counters() {
    const out = {};
    for (const [kind, store] of [["so", this.so], ["gd", this.gd]]) {
      for (const [id, doc] of Object.entries(store)) {
        out[kind + ":" + id] = { si_status: doc.header.si_status === undefined || doc.header.si_status === null ? "" : String(doc.header.si_status) };
        for (const l of doc.lines) {
          out[kind + ":" + id + ":" + l.id] = { invoice_qty: num8(l.invoice_qty), si_status: l.si_status === undefined || l.si_status === null ? "" : String(l.si_status),
            posted_qty: num8(l.posted_qty) };
        }
      }
    }
    return out;
  }
}

module.exports = { World, keep, clone, num8 };
