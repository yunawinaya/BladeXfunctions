// In-memory world for engine.js: PO / PO lines (subform REPLACE semantics: a written row's absent keys become NULL, rows not
// written are deleted), on-order rows (by-id partial updates), items, PREQs, draft GR / PI, internal trading tables, and the
// sub-workflows PO_SAVE calls. Read mocks answer both the old get / search nodes and the new sql-nodes from the same rows.
"use strict";
const L = require("./lib.js");

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const dropNull = (o) => {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== "") r[k] = v;
  return r;
};
const s8 = (v) => (v === undefined || v === null || v === "" ? null : Number(v).toFixed(8));
const str = (v) => (v === undefined || v === null ? null : String(v));
const LINE_DEC = ["quantity", "unit_price", "gross", "discount", "discount_amount", "tax_amount", "po_amount", "received_qty", "return_quantity",
  "invoice_qty", "posted_qty", "outstanding_quantity", "max_price", "min_price", "created_received_qty", "min_qty", "created_return_qty", "max_qty"];
const LINE_COLS = ["item_id", "item_name", "item_desc", "more_desc", "quantity", "quantity_uom", "unit_price", "gross", "discount", "discount_uom",
  "discount_amount", "tax_preference", "tax_percent", "tax_amount", "tax_inclusive", "po_amount", "received_qty", "return_quantity", "invoice_qty",
  "posted_qty", "line_remark_1", "line_remark_2", "shipping_state_id", "billing_country_id", "shipping_country_id", "supplier_id",
  "shipping_preference_id", "plant_id", "billing_state_id", "payment_term_id", "preq_id", "item_category_id", "line_index", "organization_id",
  "outstanding_quantity", "line_status", "table_uom_conversion", "alt_uom", "po_created_by", "pi_status", "max_price", "min_price", "preq_line_id",
  "created_received_qty", "min_qty", "from_historical", "tariff_id", "created_return_qty", "further_description", "po_expected_date", "project_id",
  "item_bundle_id", "max_qty"];

class World {
  constructor(opts) {
    opts = opts || {};
    this.tenantId = opts.tenantId || "000000";
    this.seq = BigInt(opts.seed || "2200000000000000000");
    this.po = {}; // id -> { header, lines: [ {id, parent_id, ...} ] }
    this.onorder = []; // rows
    this.items = {}; // id -> { id, table_uom_conversion: [...], pad? }
    this.preq = {}; // id -> { id, preq_status, preq_type, table_pr: [...] }
    this.drafts = []; // { kind: 'GR'|'PI', no, po_ids: [] }
    this.its = []; // internal trading setups
    this.alias = [];
    this.itemPadBytes = opts.itemPadBytes || 0; // the subforms an Item get / search node also returns
    this.approvalConfig = opts.approvalConfig || null;
    this.slotResult = opts.slotResult === undefined ? true : opts.slotResult;
    this.calls = [];
    this.seqNo = 0;
    const self = this;

    this.read = {
      get_one_po: (a) => ({ data: self.readback(a.id), total: 1 }),
      get_po_full: (a) => ({ data: self.readback(a.id), total: 1 }),
      get_po_snap: (a) => ({ data: self.readback(a.id), total: 1 }),
      get_po_approved: (a) => ({ data: self.readback(a.id), total: 1 }),
      get_direct_pi_po: (a) => ({ data: self.readback(a.id), total: 1 }),
      get_direct_pi_format: () => ({ data: { id: "2000000000000000001" }, total: 1 }),
      search_items: (a) => {
        const ids = (Array.isArray(a.id) ? a.id : [a.id]).map(String);
        const rows = ids.filter((id) => self.items[id] && !self.items[id].is_deleted).map((id) => self.itemRecord(id));
        return { data: rows, total: rows.length };
      },
      search_onorder: (a) => {
        const rows = self.onorder.filter((r) => !r.is_deleted && String(r.organization_id) === String(a.organization_id) &&
          (String(r.po_id || "") === String(a.po_id) || String(r.purchase_order_number || "").toLowerCase() === String(a.purchase_order_number || "").toLowerCase()));
        return { data: rows.map((r) => dropNull(clone(r))), total: rows.length };
      },
      search_onorder_orphans: (a) => {
        const ids = (Array.isArray(a.id) ? a.id : [a.id]).map(String);
        const rows = self.onorder.filter((r) => !r.is_deleted && ids.includes(String(r.id)));
        return { data: rows.map((r) => ({ id: r.id })), total: rows.length };
      },
      search_draft_gr: (a) => self.draftSearch("GR", a.po_id),
      search_draft_pi: (a) => self.draftSearch("PI", a.po_id),
      search_preq: (a) => {
        const ids = (Array.isArray(a.id) ? a.id : [a.id]).map(String);
        const rows = ids.filter((id) => self.preq[id]).map((id) => clone(self.preq[id]));
        return { data: rows, total: rows.length };
      },
      get_its_pre: (a) => self.itsSearch(a),
      get_its: (a) => self.itsSearch(a),
      // internal trading (seller side)
      search_alias_pre: (a) => self.aliasSearch(a),
      search_alias: (a) => self.aliasSearch(a),
      get_customer_pre: () => ({ data: { id: "1300000000000000003", customer_com_name: "Seller Co", customer_currency_id: "1" }, total: 1 }),
      get_customer: () => ({ data: { id: "1300000000000000003", customer_com_name: "Seller Co", customer_currency_id: "1", customer_payment_term_id: "7" }, total: 1 }),
      get_currency_pre: () => ({ data: { id: "1", currency_code: "MYR" }, total: 1 }),
      get_currency: () => ({ data: { id: "1", currency_code: "MYR" }, total: 1 }),
      search_linked_so: () => ({ data: [], total: 0 }),
      search_linked_so2: () => ({ data: [], total: 0 }),
      search_existing_link: () => ({ data: [], total: 0 }),
      get_acc: () => ({ data: { acc_integration_type: "No Accounting" }, total: 1 }),
      get_so_rule: () => ({ data: { id: "1990000000000000001" }, total: 1 }),
      search_addr: () => ({ data: [], total: 0 }),
      search_country: () => ({ data: [], total: 0 }),
      search_state: () => ({ data: [], total: 0 }),
      get_ship_purpose: () => ({ data: { id: "1990000000000000002" }, total: 1 }),
      search_seller_items: (a) => {
        const ids = (Array.isArray(a.id) ? a.id : [a.id]).map(String);
        const rows = ids.filter((id) => self.items[id]).map((id) => self.itemRecord(id));
        return { data: rows, total: rows.length };
      },
    };

    this.sql = {
      sql_draft_grpi: (text, ctx) => {
        const id = L.resolve("node:code_pre.data.poIdSql", ctx);
        if (!text.includes("'" + id + "'")) throw new Error("sql_draft_grpi: id not injected");
        const out = [];
        for (const kind of ["GR", "PI"]) for (const d of self.drafts) if (d.kind === kind && d.po_ids.includes(String(id))) out.push({ kind: kind, doc_no: d.no });
        return out;
      },
      sql_po_owned: (text, ctx) => {
        const id = L.resolve("node:code_pre.data.poIdSql", ctx);
        const po = self.po[id];
        if (!po) return [];
        // the header joined to its lines (LEFT JOIN): a PO without lines still answers its po_status
        const head = str(po.header.po_status);
        if (!po.lines.length) return [{ head_po_status: head }];
        return po.lines.map((l) => ({ id: l.id, received_qty: s8(l.received_qty), created_received_qty: s8(l.created_received_qty), invoice_qty: s8(l.invoice_qty),
          return_quantity: s8(l.return_quantity), created_return_qty: s8(l.created_return_qty), line_status: l.line_status === undefined ? null : l.line_status,
          head_po_status: head }));
      },
      sql_po_head: (text, ctx) => {
        const id = L.resolve("node:code_get_latest.data.poIdSql", ctx);
        const po = self.po[id];
        if (!po) return [];
        const h = po.header;
        return [{ id: h.id, purchase_order_no: str(h.purchase_order_no), po_status: str(h.po_status), po_plant: str(h.po_plant), organization_id: str(h.organization_id),
          po_supplier_id: str(h.po_supplier_id), preq_id_json: Array.isArray(h.preq_id) ? JSON.stringify(h.preq_id.map(String)) : null,
          po_total: s8(h.po_total), auto_pi: h.auto_pi === undefined || h.auto_pi === null ? null : String(h.auto_pi), create_pi: str(h.create_pi) }];
      },
      sql_oo_lines: (text, ctx) => {
        const id = L.resolve("node:code_resolve_latest.data.poIdSql", ctx);
        const po = self.po[id];
        if (!po) return [];
        return self.orderedLines(po).map((l) => ({ id: l.id, item_id: l.item_id === undefined || l.item_id === "" ? null : str(l.item_id), quantity: s8(l.quantity),
          quantity_uom: str(l.quantity_uom), preq_id: str(l.preq_id), preq_line_id: str(l.preq_line_id), parent_id: str(l.parent_id) }));
      },
      sql_oo_items: (text, ctx) => {
        const id = L.resolve("node:code_resolve_latest.data.poIdSql", ctx);
        const po = self.po[id];
        if (!po) return [];
        const ids = [...new Set(po.lines.map((l) => String(l.item_id || "")).filter((x) => /^[0-9]{1,19}$/.test(x)))];
        return ids.filter((x) => self.items[x] && !self.items[x].is_deleted).map((x) => ({ id: x,
          uom_json: (self.items[x].table_uom_conversion || []).length ? JSON.stringify(self.items[x].table_uom_conversion.map((c) => ({ alt_uom_id: String(c.alt_uom_id), base_qty: c.base_qty }))) : null }));
      },
      sql_onorder: (text, ctx) => {
        const id = L.resolve("node:code_resolve_latest.data.poIdSql", ctx);
        const org = L.resolve("node:code_resolve_latest.data.orgSql", ctx);
        const hex = L.resolve("node:code_resolve_latest.data.poNoHex", ctx);
        const no = Buffer.from(hex, "hex").toString("utf8");
        const rows = self.onorder.filter((r) => !r.is_deleted && String(r.organization_id) === String(org) &&
          (String(r.po_id || "") === String(id) || String(r.purchase_order_number || "").toLowerCase() === no.toLowerCase()));
        rows.sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
        return rows.map((r) => ({ id: r.id, po_id: str(r.po_id), po_line_id: str(r.po_line_id), material_id: str(r.material_id), purchase_order_number: r.purchase_order_number,
          purchase_order_line: r.purchase_order_line === undefined || r.purchase_order_line === null ? null : String(r.purchase_order_line), received_qty: s8(r.received_qty) }));
      },
    };

    this.wf = {
      CHECK_REQUIRED_FIELD: (p) => ({ data: L.checkRequiredField(p.entry, p.required_fields) }),
      VALIDATE_QUANTITY: (p) => ({ data: L.validateQuantity(p.lineItem, p.itemFields, p.quantityFields) }),
      CHECK_APPROVAL: (p) => {
        if (!self.approvalConfig) return { needApproval: "No" };
        const r = L.checkApprovalPO(p.data, self.approvalConfig);
        return r.needApproval === "Yes" ? { needApproval: "Yes", data: r.poData } : { needApproval: "No" };
      },
      UPDATE_ITEM_TRANSACTION_DATE: (p) => {
        self.calls.push({ wf: "UPDATE_ITEM_TRANSACTION_DATE", itemIDs: clone(p.itemIDs) });
        return {};
      },
      "Sales Order Issued Save": (p) => {
        self.calls.push({ wf: "SO_SAVE", allData: clone(p.allData) });
        return { data: { so_id: self.nextId(), so_no: "SO-1" } };
      },
      PI_SAVE: (p) => {
        self.calls.push({ wf: "PI_SAVE", data: clone(p.data) });
        return { id: self.nextId(), pi_no: "PI-1" };
      },
    };
  }

  nextId() {
    this.seq += 1n;
    return this.seq.toString();
  }

  slot() {
    return { result: this.slotResult, processStatus: "finished" };
  }

  itemRecord(id) {
    const it = clone(this.items[id]);
    if (this.itemPadBytes) it.table_customer_price = "x".repeat(this.itemPadBytes);
    return it;
  }

  draftSearch(kind, poId) {
    const id = String(Array.isArray(poId) ? poId[0] : poId);
    const rows = this.drafts.filter((d) => d.kind === kind && d.po_ids.includes(id)).map((d) => (kind === "GR" ? { gr_no: d.no } : { purchase_invoice_no: d.no }));
    return { data: rows, total: rows.length };
  }

  itsSearch(a) {
    const rows = this.its.filter((s) => String(s.buyer_org_id) === String(a.buyer_org_id) && String(s.buyer_supplier_id) === String(a.buyer_supplier_id) && Number(s.is_active) === 1);
    return { data: rows.slice(0, 1), total: rows.length };
  }

  aliasSearch(a) {
    const rows = this.alias.filter((x) => String(x.buyer_org_id) === String(a.buyer_org_id) && String(x.seller_org_id) === String(a.seller_org_id) && Number(x.is_active) === 1);
    return { data: rows, total: rows.length };
  }

  orderedLines(po) {
    const live = po.lines.slice().sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
    const out = [];
    for (const top of live.filter((l) => !l.parent_id)) {
      out.push(top);
      for (const c of live.filter((l) => String(l.parent_id || "") === String(top.id))) out.push(c);
    }
    return out;
  }

  readback(id) {
    const key = String(Array.isArray(id) ? id[0] : id);
    const po = this.po[key];
    if (!po) return null;
    const h = dropNull(clone(po.header));
    const live = po.lines.slice().sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
    const rowOf = (l) => {
      const r = dropNull(clone(l));
      for (const k of LINE_DEC) if (k in r) r[k] = Number(r[k]);
      return r;
    };
    h.table_po = live.filter((l) => !l.parent_id).map((top) => {
      const r = rowOf(top);
      delete r.parent_id;
      const kids = live.filter((l) => String(l.parent_id || "") === String(top.id)).map(rowOf);
      if (kids.length) r.children = kids;
      return r;
    });
    return h;
  }

  // a written subform row: every line column from the payload row, absent ones NULL
  lineFrom(row, keep) {
    const l = { id: keep.id, purchase_order_id: keep.purchase_order_id, parent_id: keep.parent_id || null };
    for (const c of LINE_COLS) l[c] = row[c] === undefined ? null : clone(row[c]);
    return l;
  }

  writeLines(po, rows) {
    const byId = new Map(po.lines.map((l) => [String(l.id), l]));
    const next = [];
    const put = (row, parentId) => {
      const old = row.id !== undefined && row.id !== null && row.id !== "" ? byId.get(String(row.id)) : null;
      const id = old ? old.id : this.nextId();
      next.push(this.lineFrom(row, { id: id, purchase_order_id: po.header.id, parent_id: parentId }));
      return id;
    };
    for (const row of rows || []) {
      const id = put(row, null);
      for (const c of Array.isArray(row.children) ? row.children : []) put(c, id);
    }
    po.lines = next;
  }

  add(table, rows, nodeId) {
    if (table === "Purchase Order") {
      return rows.map((row) => {
        const id = this.nextId();
        const header = clone(row);
        delete header.table_po;
        header.id = id;
        if (header.purchase_order_no === "issued" || header.purchase_order_no === "draft" || !header.purchase_order_no) {
          this.seqNo += 1;
          header.purchase_order_no = (header.purchase_order_no === "draft" ? "DRAFT-PO-" : "PO-") + String(this.seqNo).padStart(4, "0");
        }
        const po = { header: header, lines: [] };
        this.po[id] = po;
        // a Clone sends its source's line ids: the add inserts new rows
        const fresh = (r) => {
          const c = clone(r);
          delete c.id;
          if (Array.isArray(c.children)) c.children = c.children.map(fresh);
          return c;
        };
        this.writeLines(po, (row.table_po || []).map(fresh));
        return Object.assign(this.readback(id), { draft_status: "x".repeat(1000), issued_status: "x".repeat(1000), processing_status: "x".repeat(1000),
          completed_status: "x".repeat(1000), cancelled_status: "x".repeat(1000) });
      });
    }
    if (table === "On Order Purchase Order") {
      return rows.map((r) => {
        const row = Object.assign({ id: this.nextId(), is_deleted: 0 }, clone(r));
        this.onorder.push(row);
        return row;
      });
    }
    if (table === "Document Linkage") return rows;
    throw new Error("add to " + table);
  }

  update(table, rows, nodeId) {
    if (table === "Purchase Order") {
      for (const row of rows) {
        const key = String(row.id !== undefined ? row.id : "");
        const po = this.po[key];
        if (!po) throw new Error("update of a PO that does not exist: " + key);
        for (const [k, v] of Object.entries(row)) if (k !== "id" && k !== "table_po") po.header[k] = v === undefined ? null : clone(v);
        if ("table_po" in row) this.writeLines(po, row.table_po);
      }
      return rows;
    }
    if (table === "On Order Purchase Order") {
      for (const row of rows) {
        const r = this.onorder.find((x) => String(x.id) === String(row.id));
        if (!r) throw new Error("on-order row " + row.id + " not found");
        for (const [k, v] of Object.entries(row)) if (k !== "id") r[k] = v === undefined ? null : v;
      }
      return rows;
    }
    if (table === "Purchase Requisition") {
      for (const row of rows) {
        const p = this.preq[String(row.id)];
        if (!p) throw new Error("PREQ " + row.id);
        if ("preq_status" in row) p.preq_status = row.preq_status;
        if ("table_pr" in row) p.table_pr = clone(row.table_pr);
      }
      return rows;
    }
    if (table === "Sales Order" || table === "Document Linkage") return rows;
    throw new Error("update of " + table);
  }

  del(rows) {
    for (const r of rows) {
      const x = this.onorder.find((o) => String(o.id) === String(r.id));
      if (x) x.is_deleted = 1;
    }
  }

  // the state a comparison looks at
  snapshot() {
    const pos = {};
    for (const [id, po] of Object.entries(this.po)) pos[id] = { header: po.header, lines: this.orderedLines(po) };
    return clone({ po: pos, onorder: this.onorder.filter((r) => !r.is_deleted), preq: this.preq, calls: this.calls });
  }
}

module.exports = { World, LINE_COLS };
