// In-memory tables for GR_CREATED / GR_CANCEL_CREATED and the mocks of their sql-nodes. Each SQL mock returns what
// its SELECT returns on MySQL (ids and decimals as text, COUNT/SUM of booleans as numbers) - the statements themselves
// are run read-only on dev by ../sqlcheck.py.
const T = "000000";

class GrDB {
  constructor() {
    this.tenantId = T;
    this.seq = 3000000000000000000n;
    this.t = { gr: [], grl: [], po: [], pol: [], items: [], uom: [] };
    this.writes = []; // every add / update the run made, in order: { table, rows }
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }

  // ------------------------------------------------------------------------------------------------ writes
  insert(table, rows) {
    const out = [];
    for (const r0 of rows) {
      const r = Object.assign({}, r0);
      delete r.__id;
      if (table !== "Goods Receiving") throw new Error("insert into " + table + " not simulated");
      r.id = this.id();
      r.is_deleted = 0;
      r.tenant_id = this.tenantId;
      if (r.gr_no === "issued") r.gr_no = "GR/SIM" + r.id.slice(-4);
      this.writeGrLines(r.id, r.table_gr);
      const head = Object.assign({}, r);
      delete head.table_gr;
      this.t.gr.push(head);
      out.push(r);
    }
    this.writes.push({ table, op: "add", rows: JSON.parse(JSON.stringify(rows)) });
    return out;
  }

  update(table, rows) {
    let n = 0;
    for (const r of rows) {
      const id = String(r.__id);
      const set = Object.assign({}, r);
      delete set.__id;
      delete set.id;
      if (table === "Goods Receiving") {
        const g = this.t.gr.find((x) => x.id === id);
        if (!g) continue;
        for (const k of Object.keys(set)) {
          if (k === "table_gr") this.writeGrLines(id, set[k]);
          else g[k] = set[k] === "issued" && k === "gr_no" ? "GR/SIM" + id.slice(-4) : set[k];
        }
      } else if (table === "Item Table(Purchase Order)") {
        const l = this.t.pol.find((x) => x.id === id);
        if (!l) continue;
        Object.assign(l, set);
      } else if (table === "Purchase Order") {
        const p = this.t.po.find((x) => x.id === id);
        if (!p) continue;
        Object.assign(p, set);
      } else throw new Error("update of " + table + " not simulated");
      n++;
    }
    this.writes.push({ table, op: "update", rows: JSON.parse(JSON.stringify(rows)) });
    return { count: n };
  }

  // a subform write replaces the rows: the platform soft-deletes what is not in the array and inserts the rest
  writeGrLines(grId, tree) {
    for (const l of this.t.grl) if (l.goods_receiving_id === grId) l.is_deleted = 1;
    const put = (row, parentId) => {
      const r = Object.assign({}, row);
      const kids = r.children;
      delete r.children;
      r.id = this.id();
      r.goods_receiving_id = grId;
      r.parent_id = parentId;
      r.is_deleted = 0;
      r.tenant_id = this.tenantId;
      this.t.grl.push(r);
      for (const k of kids || []) put(k, r.id);
    };
    for (const row of tree || []) put(row, null);
  }
}

// ------------------------------------------------------------------------------------------------ helpers
const csvIn = (sql, re) => {
  const m = sql.match(re);
  if (!m) throw new Error("mock: pattern not found " + re);
  return m[1].split(",").map((s) => s.trim()).filter((s) => s !== "");
};
const num = (v) => Number(v) || 0;
const dec = (v) => (v === undefined || v === null || v === "" ? null : Number(v).toFixed(8));
const splitParent = (l) => String(l.is_split || "") === "Yes" && String(l.parent_or_child || "") === "Parent";
const bundleChild = (p) => num(p.item_bundle_id) !== 0 && String(p.item_id || "") !== "";
const liveGrl = (db, grIds) => db.t.grl.filter((l) => grIds.includes(String(l.goods_receiving_id)) && !l.is_deleted);
const poLive = (db, poId) => db.t.po.some((p) => p.id === poId && !p.is_deleted);

function poStatusRows(db, sql) {
  const ids = csvIn(sql, /CONCAT\('\[', '([0-9,]*)', '\]'\)/);
  const out = [];
  for (const pid of [...new Set(ids)]) {
    if (!poLive(db, pid)) continue;
    const lines = db.t.pol.filter((p) => p.purchase_order_id === pid && !p.is_deleted);
    if (!lines.length) continue;
    const cnt = lines.filter((p) => !bundleChild(p));
    out.push({
      po_id: pid,
      reserved: String(lines.filter((p) => num(p.created_received_qty) > 0).length),
      countable: String(cnt.length),
      partially: String(cnt.filter((p) => num(p.received_qty) > 0).length),
      fully: String(cnt.filter((p) => num(p.received_qty) > 0 && num(p.received_qty) >= num(p.quantity)).length),
    });
  }
  return out;
}

function mocks() {
  const sql = {
    // GR_CREATED
    sql_node_GcKeyHit: (s, ctx, e) => {
      const key = s.match(/SUBSTRING_INDEX\(g\.gr_idem_key, '#', 1\) = '([^']*)'/)[1];
      const g = e.db.t.gr.filter((x) => !x.is_deleted && x.gr_idem_key !== null && x.gr_idem_key !== undefined && String(x.gr_idem_key).split("#")[0] === key)
        .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0];
      return g ? [{ id: g.id, gr_no: g.gr_no, gr_status: g.gr_status }] : [];
    },
    sql_node_GcKeyDup: (s, ctx, e) => {
      const key = s.match(/SUBSTRING_INDEX\(g\.gr_idem_key, '#', 1\) = '([^']*)'/)[1];
      return e.db.t.gr.filter((x) => !x.is_deleted && x.gr_idem_key !== null && x.gr_idem_key !== undefined && String(x.gr_idem_key).split("#")[0] === key)
        .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((g) => ({ id: g.id, gr_no: g.gr_no, gr_idem_key: g.gr_idem_key }));
    },
    sql_node_GcProcGuard: (s, ctx, e) => {
      const id = s.match(/AND g\.id = ([0-9]+)/)[1];
      const g = e.db.t.gr.find((x) => x.id === id && !x.is_deleted);
      if (!g) return [];
      const agg = new Map();
      for (const l of liveGrl(e.db, [id])) {
        if (!l.po_line_item_id || splitParent(l)) continue;
        const k = String(l.po_line_item_id);
        agg.set(k, (agg.get(k) || 0) + num(l.received_qty));
      }
      if (!agg.size) return [{ gr_status: g.gr_status, gr_no: g.gr_no, po_line_id: null, qty: null }];
      return [...agg.entries()].map(([k, q]) => ({ gr_status: g.gr_status, gr_no: g.gr_no, po_line_id: k, qty: dec(q) }));
    },
    sql_node_GcPoLines: (s, ctx, e) => {
      const ids = new Set(csvIn(s, /CONCAT\('\[', '([0-9,]*)', '\]'\)/));
      const grId = s.match(/l\.goods_receiving_id = ([0-9]+)/)[1];
      for (const l of liveGrl(e.db, [grId])) if (l.po_line_item_id) ids.add(String(l.po_line_item_id));
      return e.db.t.pol.filter((p) => ids.has(p.id) && !p.is_deleted && poLive(e.db, p.purchase_order_id))
        .map((p) => ({ id: p.id, po_id: p.purchase_order_id, quantity: dec(p.quantity), received_qty: dec(p.received_qty),
                       created_received_qty: dec(p.created_received_qty) }));
    },
    sql_node_GcTol: (s, ctx, e) => {
      const ids = csvIn(s, /CONCAT\('\[', '([0-9,]*)', '\]'\)/);
      const out = [];
      for (const it of e.db.t.items) {
        if (!ids.includes(it.id) || it.is_deleted) continue;
        for (const u of e.db.t.uom) {
          if (u.item_id === it.id && !u.is_deleted) out.push({ item_id: it.id, uom_id: u.alt_uom_id === null ? null : String(u.alt_uom_id),
                                                               tol: u.over_receive_tolerance === null ? null : Number(u.over_receive_tolerance).toFixed(2) });
        }
      }
      return out;
    },
    sql_node_GcPoStatus: (s, ctx, e) => poStatusRows(e.db, s),
    // GR_CANCEL_CREATED
    sql_node_CcGuard: (s, ctx, e) => {
      const ids = csvIn(s, /g\.id IN \(([0-9,]*)\)/);
      return e.db.t.gr.filter((g) => ids.includes(g.id) && !g.is_deleted).map((g) => ({ id: g.id, gr_no: g.gr_no, gr_status: g.gr_status }));
    },
    sql_node_CcLines: (s, ctx, e) => {
      const ids = csvIn(s, /l\.goods_receiving_id IN \(([0-9,]*)\)/);
      const agg = new Map();
      for (const l of liveGrl(e.db, ids)) {
        if (splitParent(l)) continue;
        const p = e.db.t.pol.find((x) => x.id === String(l.po_line_item_id) && !x.is_deleted);
        if (!p || !poLive(e.db, p.purchase_order_id)) continue;
        const a = agg.get(p.id) || { id: p.id, po_id: p.purchase_order_id, created_received_qty: dec(p.created_received_qty), rev: 0 };
        a.rev += num(l.received_qty);
        agg.set(p.id, a);
      }
      return [...agg.values()].map((a) => Object.assign(a, { rev: dec(a.rev) }));
    },
    sql_node_CcPoStatus: (s, ctx, e) => poStatusRows(e.db, s),
  };
  return { sql, read: {} };
}

module.exports = { GrDB, mocks, T };
