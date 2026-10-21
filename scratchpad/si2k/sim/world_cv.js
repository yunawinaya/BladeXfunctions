// In-memory world for engine.js running GD_Convert_SI / SO_Convert_SI, old and lean: goods deliveries and sales orders (header +
// flat line rows, parent_id on a bundle's items), loose sales order lines, the cache, and SI_SAVE as a stub that records the payload.
// The old search / get nodes are answered from a recorded run's own outputs when one is given (same documents, same order), else
// in the platform's read shape built from the rows; the lean sql-nodes are answered as rows of JSON text from the same rows.
"use strict";

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const keep = (o) => {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== undefined && v !== "") r[k] = clone(v);
  return r;
};
const ids = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(String);
const byId = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
const idsIn = (text, after) => {
  const i = text.indexOf(after);
  if (i < 0) throw new Error("ids not found after " + after);
  const m = text.slice(i + after.length).match(/^\s*\(([0-9,\s]*)\)/);
  if (!m) throw new Error("no id list: " + text.slice(i, i + 80));
  return m[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "0");
};
const tenantOf = (text) => {
  const m = text.match(/tenant_id = '([^']*)'/);
  return m ? m[1] : null;
};

const COLS = {
  GD_HEAD: ("id so_id so_no delivery_no plant_id customer_name organization_id currency_code gd_billing_address gd_shipping_address sales_person " +
    "document_description gd_area_id acc_integration_type customer_credit_limit overdue_limit outstanding_balance overdue_inv_total_amount " +
    "is_accurate order_tnc order_payment_details order_delivery_term order_remark order_remark2 order_remark3 order_remark4 order_remark5 " +
    "billing_address_name billing_address_phone billing_address_line_1 billing_address_line_2 billing_address_line_3 billing_address_line_4 " +
    "billing_address_city billing_postal_code billing_address_state billing_address_country billing_attention billing_address_fax " +
    "shipping_address_name shipping_address_phone shipping_address_line_1 shipping_address_line_2 shipping_address_line_3 " +
    "shipping_address_line_4 shipping_address_city shipping_postal_code shipping_address_state shipping_address_country shipping_attention " +
    "shipping_address_fax project_id").split(" "),
  GD_LINE: ("id parent_id so_line_item_id line_so_id gd_qty return_qty good_delivery_uom_id more_desc item_category_id material_name material_id " +
    "item_bundle_id customer_id area_id line_remark_1 line_remark_2 line_remark_3 tariff_id custom_fields project_id").split(" "),
  GD_SO_HEAD: "id so_type so_no exchange_rate exchange_rate_currency".split(" "),
  GD_SO_LINE: ("id so_quantity so_item_price so_discount so_discount_amount so_tax_amount so_amount so_discount_uom invoice_qty return_qty " +
    "sales_person_id so_item_uom so_desc payment_term_id so_tax_inclusive so_tax_preference so_tax_percentage").split(" "),
  SO_HEAD: ("id customer_name organization_id plant_name so_type so_no so_currency cust_billing_address cust_shipping_address so_sales_person " +
    "so_payment_term exchange_rate_currency exchange_rate so_description so_area_id acc_integration_type customer_credit_limit overdue_limit " +
    "outstanding_balance overdue_inv_total_amount is_accurate total_gross_currency total_discount_currency total_tax_currency " +
    "total_amount_currency so_total_gross so_total_discount so_total_tax so_total myr_total_amount so_tnc so_payment_details so_delivery_term " +
    "so_remarks so_remarks2 so_remarks3 so_remarks4 so_remarks5 billing_address_name billing_address_phone billing_address_line_1 " +
    "billing_address_line_2 billing_address_line_3 billing_address_line_4 billing_address_city billing_postal_code billing_address_state " +
    "billing_address_country billing_attention billing_address_fax shipping_address_name shipping_address_phone shipping_address_line_1 " +
    "shipping_address_line_2 shipping_address_line_3 shipping_address_line_4 shipping_address_city shipping_postal_code " +
    "shipping_address_state shipping_address_country shipping_attention shipping_address_fax project_id").split(" "),
  SO_LINE: ("id parent_id so_tax_amount so_quantity so_discount return_qty sales_person_id so_discount_amount so_item_uom so_desc more_desc " +
    "so_discount_uom item_category_id payment_term_id item_id so_amount so_gross so_tax_inclusive so_tax_preference so_tax_percentage " +
    "so_item_price item_name item_bundle_id customer_id area_id line_remark_1 line_remark_2 line_remark_3 tariff_id custom_fields " +
    "further_description project_id").split(" "),
};

// a document in the read shape -> header + flat rows (a bundle's items carry their bundle row's id in parent_id)
const flatten = (doc, lineKey) => {
  const header = {};
  for (const [k, v] of Object.entries(doc)) if (k !== lineKey) header[k] = v;
  const lines = [];
  for (const l of doc[lineKey] || []) {
    const r = {};
    for (const [k, v] of Object.entries(l)) if (k !== "children") r[k] = v;
    lines.push(r);
    for (const c of Array.isArray(l.children) ? l.children : []) {
      const child = Object.assign({}, c);
      delete child.children;
      if (child.parent_id === undefined || child.parent_id === null) child.parent_id = l.id;
      lines.push(child);
    }
  }
  return { header, lines };
};

class CvWorld {
  constructor(opts) {
    opts = opts || {};
    this.tenantId = opts.tenantId || "000000";
    this.seq = BigInt(opts.seed || "2300000000000000000");
    this.gd = {}; // id -> { header, lines }
    this.so = {};
    this.looseSoLines = {}; // id -> row (an order line read by id whose order was not read)
    this.cache = {};
    this.saved = [];
    this.recorded = opts.recorded || {}; // node id -> the recorded output envelope (the `data` of the node's response)
    const self = this;
    const rec = (id, fallback) => (a) => (self.recorded[id] !== undefined ? clone(self.recorded[id]) : fallback(a));
    const docsShape = (store, lineKey, pick) => (a) => {
      const rows = ids(a.id).filter((id) => store[id] && (!pick || pick(store[id]))).sort(byId).map((id) => self.shape(store[id], lineKey));
      return { total: rows.length, count: rows.length, data: rows };
    };
    this.read = {
      // GD_Convert_SI (old)
      search_node_AHtHRmqi: (a) => (opts.kind === "SO" ? rec("search_node_AHtHRmqi", docsShape(self.so, "table_so"))(a) : rec("search_node_AHtHRmqi", docsShape(self.gd, "table_gd"))(a)),
      search_node_bOF3TVA2: (a) => (opts.kind === "SO"
        ? rec("search_node_bOF3TVA2", docsShape(self.so, "table_so", (d) => d.header.so_status !== "Draft"))(a)
        : rec("search_node_bOF3TVA2", docsShape(self.gd, "table_gd", (d) => d.header.gd_status === a.gd_status))(a)),
      search_node_Ivek0yYx: rec("search_node_Ivek0yYx", docsShape(this.so, "table_so")),
      // always from the rows: which order lines it is asked for depends on the version (v25 added a bundle's items in August), so a
      // recorded answer to an older run's question would be wrong for today's
      search_node_r3bnMaWy: (a) => {
        const want = new Set(ids(a.id));
        const rows = self.allSoLines().filter((l) => want.has(String(l.id))).map(keep).sort((x, y) => byId(x.id, y.id));
        return { total: rows.length, count: rows.length, data: rows };
      },
      // kept in both versions
      search_node_d39M3W6h: rec("search_node_d39M3W6h", () => ({ total: 0, count: 0, data: [] })),
      get_node_yDMG0Sab: rec("get_node_yDMG0Sab", () => ({ count: 1, data: { id: "2026901594941353985" } })),
      get_node_srSetup1: rec("get_node_srSetup1", () => ({ count: 0, data: {} })),
    };
    const row = (src, cols, doc) => {
      const o = doc === undefined ? {} : { doc: doc };
      for (const c of cols) o[c] = src[c] === undefined ? null : src[c];
      return { j: JSON.stringify(o) };
    };
    const check = (text) => {
      if (tenantOf(text) !== self.tenantId) throw new Error("sql tenant " + tenantOf(text));
    };
    const gdOf = (text, completed) => idsIn(text, "g.id IN").filter((id) => self.gd[id] && (!completed || self.gd[id].header.gd_status === "Completed")).sort(byId);
    const soOf = (text, notDraft) => idsIn(text, "s.id IN").filter((id) => self.so[id] && (!notDraft || (self.so[id].header.so_status !== undefined &&
      self.so[id].header.so_status !== null && self.so[id].header.so_status !== "Draft"))).sort(byId);
    const lines = (doc) => doc.lines.slice().sort((x, y) => byId(x.id, y.id));
    this.sql = {
      sql_node_gdcvHeads: (t) => (check(t), gdOf(t, false).map((id) => row(self.gd[id].header, ["id", "gd_status", "so_id"]))),
      sql_node_gdcvDone: (t) => (check(t), gdOf(t, true).map((id) => row(self.gd[id].header, COLS.GD_HEAD))),
      sql_node_gdcvLines: (t) => (check(t), [].concat(...gdOf(t, true).map((id) => lines(self.gd[id]).map((l) => row(l, COLS.GD_LINE, id))))),
      sql_node_gdcvSoHeads: (t) => (check(t), soOf(t, false).map((id) => row(self.so[id].header, COLS.GD_SO_HEAD))),
      sql_node_gdcvSoLines: (t) => {
        check(t);
        const want = new Set();
        for (const id of idsIn(t, "gl.goods_delivery_id IN")) if (self.gd[id]) for (const l of self.gd[id].lines) if (l.so_line_item_id) want.add(String(l.so_line_item_id));
        return self.allSoLines().filter((l) => want.has(String(l.id))).sort((x, y) => byId(x.id, y.id)).map((l) => row(l, COLS.GD_SO_LINE));
      },
      sql_node_socvHeads: (t) => (check(t), soOf(t, false).map((id) => row(self.so[id].header, ["id", "so_status"]))),
      sql_node_socvDone: (t) => (check(t), soOf(t, true).map((id) => row(self.so[id].header, COLS.SO_HEAD))),
      sql_node_socvLines: (t) => (check(t), [].concat(...soOf(t, true).map((id) => lines(self.so[id]).map((l) => row(l, COLS.SO_LINE, id))))),
    };
    this.wf = {
      SI_SAVE: (p, world) => {
        world.saved.push(clone(p.data));
        return { id: world.nextId(), si_no: "SI/SIM/" + String(world.saved.length).padStart(4, "0") };
      },
    };
  }

  nextId() {
    this.seq += 1n;
    return this.seq.toString();
  }

  addGd(doc) {
    const { header, lines } = flatten(doc, "table_gd");
    this.gd[String(header.id)] = { header: clone(header), lines: clone(lines) };
  }

  addSo(doc) {
    const { header, lines } = flatten(doc, "table_so");
    this.so[String(header.id)] = { header: clone(header), lines: clone(lines) };
  }

  // an order line read on its own (the line collection): replaces the copy under its order, else kept loose
  addSoLine(l) {
    const id = String(l.id);
    for (const d of Object.values(this.so)) {
      const i = d.lines.findIndex((x) => String(x.id) === id);
      if (i >= 0) {
        const parent = d.lines[i].parent_id;
        d.lines[i] = clone(l);
        if ((d.lines[i].parent_id === undefined || d.lines[i].parent_id === null) && parent !== undefined) d.lines[i].parent_id = parent;
        return;
      }
    }
    this.looseSoLines[id] = clone(l);
  }

  allSoLines() {
    const out = Object.values(this.looseSoLines);
    for (const d of Object.values(this.so)) out.push(...d.lines);
    return out;
  }

  // the platform's read shape: a bundle's items under their bundle row, rows in id order
  shape(doc, lineKey) {
    const ls = doc.lines.map(keep).sort((x, y) => byId(x.id, y.id));
    const present = new Set(ls.map((l) => String(l.id)));
    const kids = new Map();
    for (const l of ls) {
      if (l.parent_id === undefined || !present.has(String(l.parent_id))) continue;
      if (!kids.has(String(l.parent_id))) kids.set(String(l.parent_id), []);
      kids.get(String(l.parent_id)).push(l);
    }
    const top = ls.filter((l) => l.parent_id === undefined || !present.has(String(l.parent_id)));
    const out = keep(doc.header);
    out[lineKey] = top.map((l) => (kids.has(String(l.id)) ? Object.assign({}, l, { children: kids.get(String(l.id)) }) : l));
    return out;
  }
}

module.exports = { CvWorld, COLS, flatten, keep, clone };
