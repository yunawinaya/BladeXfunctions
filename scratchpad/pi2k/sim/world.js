// In-memory world for engine.js: purchase orders, goods receivings and purchase invoices (header + line rows with
// parent_id), the line collections PI_SAVE writes counters to, the PI number rule and the cache. Read mocks answer the old
// search / get nodes in the platform's shape (null and "" keys left off, a bundle's items under `children`) and the new
// sql-nodes as rows of JSON text, from the same rows.
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

class World {
  constructor(opts) {
    opts = opts || {};
    this.tenantId = opts.tenantId || "000000";
    this.seq = BigInt(opts.seed || "2300000000000000000");
    this.po = {}; // id -> { header, lines: [ flat rows, parent_id on a bundle's items ] }
    this.gr = {};
    this.pi = {}; // id -> header with table_pi (as written)
    this.cache = {};
    this.numberSeq = 0;
    this.docFormatId = opts.docFormatId || "2026901594941353985";
    this.calls = [];
    this.subRuns = [];
    const self = this;
    const searchDocs = (store, lineKey) => (a) => {
      const rows = ids(a.id).filter((id) => store[id]).sort().map((id) => self.shape(store[id], lineKey));
      return { total: rows.length, count: rows.length, data: rows };
    };
    const getPi = (a) => {
      const id = ids(a.id)[0];
      const doc = id && self.pi[id] ? self.piRecord(id) : null;
      return doc ? { count: 1, data: doc } : { count: 0, data: {} };
    };
    this.read = {
      search_node_po: searchDocs(this.po, "table_po"),
      search_node_gr: searchDocs(this.gr, "table_gr"),
      get_node_pi_stored: getPi,
      get_node_pi: getPi,
      get_node_CfStored1: getPi,
      // GR_Convert_PI
      search_node_AHtHRmqi: searchDocs(this.gr, "table_gr"),
      search_node_bOF3TVA2: (a) => {
        const rows = ids(a.id).filter((id) => self.gr[id] && self.gr[id].header.gr_status === a.gr_status).sort().map((id) => self.shape(self.gr[id], "table_gr"));
        return { total: rows.length, count: rows.length, data: rows };
      },
      search_node_d39M3W6h: (a) => self.existingPi(a),
      get_node_yDMG0Sab: () => ({ count: 1, data: { id: self.docFormatId } }),
      search_node_Ivek0yYx: searchDocs(this.po, "table_po"),
      search_node_r3bnMaWy: (a) => {
        const want = new Set(ids(a.id));
        const rows = [];
        for (const id of Object.keys(self.po).sort()) for (const l of self.po[id].lines) if (want.has(String(l.id))) rows.push(keep(l));
        rows.sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
        return { total: rows.length, count: rows.length, data: rows };
      },
      // PO_CONVERT_PI
      search_node_PoConvGetAll: searchDocs(this.po, "table_po"),
      search_node_PoConvDraftPI: (a) => self.draftPi(a),
      get_node_PoConvDocFormat: () => ({ count: 1, data: { id: self.docFormatId } }),
    };
    this.sql = {
      sql_node_pi_po: (text) => self.sqlLines(text, this.po, "p.id IN", "purchase_order_2ukyuanr_sub", ["id", "parent_id", "item_id", "item_bundle_id", "quantity", "invoice_qty", "pi_status"]),
      sql_node_pi_gr: (text) => self.sqlLines(text, this.gr, "g.id IN", "goods_receiving_eg6l4ywi_sub", ["id", "parent_id", "item_id", "item_bundle_id", "received_qty",
        "invoice_qty", "pi_status", "parent_or_child", "po_line_item_id", "line_index"]),
      sql_node_pi_stored: (text) => self.sqlPi(text, ["id", "pi_status", "purchase_invoice_no"]),
      sql_node_pi_after: (text) => self.sqlPi(text, ["id", "purchase_invoice_no"]),
    };
    this.wf = {
      CHECK_REQUIRED_FIELD: (params) => ({ data: require("./lib.js").checkRequiredField(params.entry, params.required_fields) }),
    };
    if (opts.sql) Object.assign(this.sql, opts.sql);
    if (opts.read) Object.assign(this.read, opts.read);
  }

  nextId() {
    this.seq += 1n;
    return this.seq.toString();
  }

  addPo(header, lines) {
    this.po[String(header.id)] = { header: clone(header), lines: clone(lines) };
  }

  addGr(header, lines) {
    this.gr[String(header.id)] = { header: clone(header), lines: clone(lines) };
  }

  // the platform's read shape: a bundle's items under their bundle row, in id order
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

  sqlLines(text, store, after, table, cols) {
    if (!text.includes(table)) throw new Error("sql table " + table);
    if (tenantOf(text) !== this.tenantId) throw new Error("sql tenant " + tenantOf(text));
    const rows = [];
    for (const id of sqlIds(text, after).sort()) {
      const doc = store[id];
      if (!doc) continue;
      const lines = doc.lines.slice().sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
      if (!lines.length) rows.push({ j: JSON.stringify({ doc: id, id: null }) });
      for (const l of lines) {
        const o = { doc: id };
        for (const c of cols) o[c] = l[c] === undefined ? null : l[c];
        rows.push({ j: JSON.stringify(o) });
      }
    }
    return rows;
  }

  sqlPi(text, cols) {
    if (tenantOf(text) !== this.tenantId) throw new Error("sql tenant " + tenantOf(text));
    const id = sqlIds(text, "AND p.id")[0];
    if (!id || !this.pi[id]) return [];
    const o = {};
    for (const c of cols) o[c] = this.pi[id][c] === undefined ? null : this.pi[id][c];
    return [{ j: JSON.stringify(o) }];
  }

  piRecord(id) {
    const doc = this.pi[id];
    const out = keep(doc);
    out.table_pi = (doc.table_pi || []).map((l) => {
      const r = keep(l);
      if (Array.isArray(l.children)) r.children = l.children.map(keep);
      return r;
    });
    return out;
  }

  existingPi(a) {
    const want = new Set(ids(a.po_id));
    const rows = Object.keys(this.pi).sort().filter((id) => {
      const p = this.pi[id];
      const empty = p.gr_id === undefined || p.gr_id === null;
      return empty && ids(p.po_id).some((x) => want.has(x));
    }).map((id) => this.piRecord(id));
    return { total: rows.length, count: rows.length, data: rows };
  }

  draftPi(a) {
    const want = new Set(ids(a.po_id));
    const rows = Object.keys(this.pi).sort().filter((id) => this.pi[id].pi_status === a.pi_status && ids(this.pi[id].po_id).some((x) => want.has(x)))
      .map((id) => this.piRecord(id));
    return { total: rows.length, count: rows.length, data: rows };
  }

  number(row) {
    if (row.purchase_invoice_no_type === -9999 || row.purchase_invoice_no_type === "-9999" || row.purchase_invoice_no_type === undefined || row.purchase_invoice_no_type === null) {
      return row.purchase_invoice_no;
    }
    if (row.purchase_invoice_no === "issued" || row.purchase_invoice_no === "draft") {
      this.numberSeq++;
      return (row.purchase_invoice_no === "draft" ? "Draft-PI/SIM/" : "PI/SIM/") + String(this.numberSeq).padStart(4, "0");
    }
    return row.purchase_invoice_no;
  }

  add(table, rows) {
    if (table !== "Purchase Invoice") throw new Error("add " + table);
    return rows.map((r) => {
      const id = this.nextId();
      const row = clone(r);
      row.id = id;
      row.purchase_invoice_no = this.number(row);
      this.pi[id] = row;
      return keep(row);
    });
  }

  update(table, rows) {
    for (const r of rows) {
      const id = String(r.id);
      if (table === "Purchase Invoice") {
        if (!this.pi[id]) throw new Error("update missing PI " + id);
        const next = Object.assign({}, this.pi[id], clone(r));
        if (r.purchase_invoice_no !== undefined) next.purchase_invoice_no = this.number(next);
        this.pi[id] = next;
      } else if (table === "Item Table(Purchase Order)" || table === "Item Table(Goods Receiving)") {
        const store = table === "Item Table(Purchase Order)" ? this.po : this.gr;
        let hit = false;
        for (const doc of Object.values(store)) for (const l of doc.lines) if (String(l.id) === id) {
          Object.assign(l, clone(r));
          hit = true;
        }
        if (!hit) throw new Error("update missing line " + id);
      } else if (table === "Purchase Order" || table === "Goods Receiving") {
        const store = table === "Purchase Order" ? this.po : this.gr;
        if (!store[id]) throw new Error("update missing header " + id);
        Object.assign(store[id].header, clone(r));
      } else {
        throw new Error("update " + table);
      }
    }
    return true;
  }
}

module.exports = { World, keep, clone };
