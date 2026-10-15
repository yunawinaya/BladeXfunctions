// Recorded runs (fetch_runs.py, private folder) -> the DB state the run saw, for the new workflow to run against.
const fs = require("fs");
const path = require("path");
const { GrDB } = require("./grdb");

const FIX = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3184bace-c1a2-43fd-9910-40a12d531785/scratchpad/phase2b";

// 19-digit ids are JSON numbers in the recorded text: keep them as the strings the code nodes saw
const big = (k, v, ctx) => (typeof v === "number" && ctx && /^-?[0-9]{16,}$/.test(ctx.source) ? ctx.source : v);
const jparse = (t) => JSON.parse(t, big);

function runs(env, name) {
  const file = path.join(FIX, env + "_" + name + ".jsonl");
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => jparse(l));
}

function nodeOf(run, id) {
  return (run.nodes || []).find((n) => n && n.node_id === id) || null;
}
const parse = (s) => (typeof s === "string" ? jparse(s) : s);
const reqOf = (run, id) => {
  const n = nodeOf(run, id);
  return n ? parse(n.request_json_data) : null;
};
const respOf = (run, id) => {
  const n = nodeOf(run, id);
  return n ? parse(n.response_json_data) : null;
};
const S = (v) => (v === undefined || v === null ? "" : String(v));
const flat = (rows) => {
  const out = [];
  for (const r of rows || []) {
    out.push(r);
    for (const c of Array.isArray(r.children) ? r.children : []) out.push(Object.assign({ __parent: r }, c));
  }
  return out;
};

// PO documents as a search-node returned them -> header rows + flat line rows
function loadPOs(db, poDocs) {
  for (const po of poDocs || []) {
    const pid = S(po.id);
    if (db.t.po.some((p) => p.id === pid)) continue;
    db.t.po.push({ id: pid, is_deleted: 0, gr_status: po.gr_status === undefined ? null : po.gr_status, po_status: po.po_status, purchase_order_no: po.purchase_order_no });
    for (const r of po.table_po || []) {
      const put = (l, parent) => db.t.pol.push({
        id: S(l.id), purchase_order_id: pid, parent_id: parent, is_deleted: 0, quantity: l.quantity, received_qty: l.received_qty,
        created_received_qty: l.created_received_qty, item_bundle_id: l.item_bundle_id || null, item_id: l.item_id || null,
      });
      put(r, null);
      for (const c of Array.isArray(r.children) ? r.children : []) put(c, S(r.id));
    }
  }
}

function loadItems(db, items) {
  for (const it of items || []) {
    const iid = S(it.id);
    if (db.t.items.some((x) => x.id === iid)) continue;
    db.t.items.push({ id: iid, is_deleted: 0 });
    for (const u of it.table_uom_conversion || []) {
      db.t.uom.push({ item_id: iid, alt_uom_id: u.alt_uom_id === null || u.alt_uom_id === undefined ? null : S(u.alt_uom_id),
                      over_receive_tolerance: u.over_receive_tolerance === undefined ? null : u.over_receive_tolerance, is_deleted: 0 });
    }
  }
}

function loadGR(db, gr) {
  const gid = S(gr.id);
  db.t.gr.push({ id: gid, is_deleted: 0, gr_status: gr.gr_status, gr_no: gr.gr_no, tenant_id: db.tenantId, gr_idem_key: gr.gr_idem_key || null });
  for (const l of flat(gr.table_gr)) {
    db.t.grl.push({ id: S(l.id) || db.id(), goods_receiving_id: gid, is_deleted: 0, po_line_item_id: S(l.po_line_item_id) || null,
                    received_qty: l.received_qty, is_split: l.is_split, parent_or_child: l.parent_or_child, item_id: l.item_id });
  }
}

// GR_CREATED run -> { db, params, recorded }
function createdCase(run) {
  const db = new GrDB();
  const params = Object.assign({}, run.req.request_json);
  const vq = reqOf(run, "cn_validateQty");
  const vm = vq ? vq.variableMap : {};
  const pos = respOf(run, "search_po");
  loadPOs(db, pos ? pos.data.data : vm["node:search_po.data.data"]);
  const items = respOf(run, "search_items");
  loadItems(db, items ? items.data.data : vm["node:search_items.data.data"]);
  const orig = respOf(run, "search_origGR");
  let stored = null;
  if (orig) {
    let d = orig.data.data;
    if (Array.isArray(d)) d = d[0];
    if (d && d.id) stored = d;
  }
  const ad = params.allData || {};
  if (params.pageStatus === "Edit") {
    if (stored) loadGR(db, stored);
    else if (ad.id) {
      // the run stopped before the old workflow read the stored GR: the stored state is what the form loaded
      loadGR(db, { id: ad.id, gr_status: ad.previous_status || ad.gr_status || "Draft", gr_no: ad.gr_no, table_gr: ad.table_gr });
    }
  }
  return { db, params, stored };
}

// GR_CANCEL_CREATED run -> { db, params }
function cancelCase(run) {
  const db = new GrDB();
  const params = Object.assign({}, run.req.request_json);
  const g = respOf(run, "get_gr");
  const pos = respOf(run, "search_po");
  if (pos) loadPOs(db, pos.data.data);
  if (g) {
    let d = g.data.data;
    if (Array.isArray(d)) d = d[0];
    if (d) loadGR(db, d);
  } else {
    // delete runs never read the GR: a Draft or Cancelled one (the list only offers those)
    const ids = Array.isArray(params.gr_id) ? params.gr_id : [params.gr_id];
    for (const id of ids) db.t.gr.push({ id: S(id), is_deleted: 0, gr_status: "Draft", gr_no: S(params.gr_no) || "Draft-GR-X", tenant_id: db.tenantId });
  }
  return { db, params };
}

module.exports = { jparse, runs, nodeOf, reqOf, respOf, createdCase, cancelCase, flat, S, FIX, loadPOs, loadItems, loadGR };
