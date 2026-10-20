// Picking 1d simulator: the SQL stand-ins of every read 1d adds or changes, on top of the 1c sim's (scratchpad/pk1c/sim/db.js).
// Each returns what its SELECT returns on MySQL (ids as text, decimals as 8-dp text), computed from the sim's tables:
// SUBMIT sql_node_PSfc / PSstatus (+ operation, progress_percent, kick), PREPARE sql_node_PPfcGd / PPfcRecs / PPfcOther,
// WORKER sql_node_PWmid / PWdriveBack (+ operation, fc_gds) / PWfinal (+ kick), COMMIT sql_node_PCp0facts (+ REC), and
// PICKING_FC_DRIVE's (drive_sim.js).
const path = require("path");
const { mocks } = require(path.join(__dirname, "../../pk1c/sim/db.js"));
const { driveMocks } = require(path.join(__dirname, "drive_sim.js"));

const S = (v) => (v === undefined || v === null ? null : String(v));
const n8 = (v) => (v === undefined || v === null || v === "" ? null : Number(v).toFixed(8));
const T = (v) => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
const idCmp = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);
const OPEN_PICK = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PICKING", "REQUIRES_REVIEW"];
const req = (j) => { try { return JSON.parse(j.request_payload || "{}") || {}; } catch (e) { return {}; } };

const gdIdsOf = (db, pickingId) => [...new Set(db.t.lines.filter((l) => l.transfer_order_id === pickingId && !l.is_deleted && S(l.gd_id)).map((l) => String(l.gd_id)))];
const naming = (db, gdIds) => db.t.picking.filter((t) => !t.is_deleted && (t.gd_no || []).map(String).some((g) => gdIds.includes(g)));
// STATUS's / the worker's kick: the force complete's edit jobs in flight (or held and due) with no live lease
const kickOf = (db, jobId) => {
  const ids = db.t.job.filter((x) => x.command === "EDIT_GD" && !x.is_deleted && x.causation_id === "PICKING_FC" && String(req(x).causation_job_id) === String(jobId)
    && (["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD"].includes(x.job_status) || (x.job_status === "HELD" && x.next_attempt_at <= db.now))
    && (!x.lease_expires_at || x.lease_expires_at <= db.now)).map((x) => x.id).sort(idCmp);
  return ids.length ? ids.join(",") : null;
};

function mocks1d() {
  const base = mocks();
  const sql = Object.assign({}, base.sql, driveMocks().sql);
  const out = (ctx, id) => ctx.out[id] || {};

  // ------------------------------------------------------------------ SUBMIT
  sql.sql_node_PSfc = (text, ctx, e) => {
    const db = e.db, g = out(ctx, "code_node_PSguard");
    const ids = gdIdsOf(db, g.pickingId);
    const rows = db.t.gd.filter((x) => ids.includes(x.id) && !x.is_deleted).map((x) => {
      const lines = db.t.gdl.filter((l) => l.goods_delivery_id === x.id && !l.is_deleted);
      const others = db.t.job.filter((j) => j.command === "CONFIRM_PICKING" && !j.is_deleted && OPEN_PICK.includes(j.job_status) && j.picking_id !== g.pickingId
        && naming(db, [x.id]).some((t) => t.id === j.picking_id));
      return { kind: "G", gd_id: x.id, delivery_no: S(x.delivery_no), gd_status: S(x.gd_status), line_count: String(lines.length),
        serial_items: String(lines.filter((l) => (db.t.items.find((i) => i.id === String(l.material_id)) || {}).serial_number_management === 1).length),
        select_picking: String(x.is_select_picking || 0), linked: "0", other_job: String(others.length), rec_count: null };
    });
    rows.push({ kind: "P", gd_id: null, delivery_no: null, gd_status: null, line_count: null, serial_items: null, select_picking: null, linked: null, other_job: null,
      rec_count: String(db.t.records.filter((r) => r.transfer_order_id === g.pickingId && !r.is_deleted && Number(r.store_out_qty) > 0).length) });
    return rows;
  };
  sql.sql_node_PSstatus = (text, ctx, e) => {
    const db = e.db, g = out(ctx, "code_node_PSguard");
    const j = db.t.job.filter((x) => x.command === "CONFIRM_PICKING" && x.organization_id === g.organizationId && x.picking_id === g.pickingId && !x.is_deleted).sort((a, b) => idCmp(b.id, a.id))[0];
    return j ? [{ id: j.id, job_status: j.job_status, progress_message: j.progress_message, progress_percent: j.progress_percent, error_code: j.error_code || null,
      error_message: j.error_message || null, operation: req(j).operation || null, kick: kickOf(db, j.id) }] : [];
  };

  // ------------------------------------------------------------------ PREPARE
  sql.sql_node_PPfcGd = (text, ctx, e) => {
    const db = e.db, ids = gdIdsOf(db, out(ctx, "code_node_PPentry").pickingId);
    const heads = {};
    for (const g of db.t.gd) if (ids.includes(g.id) && !g.is_deleted) heads[g.id] = g;
    return db.t.gdl.filter((l) => heads[l.goods_delivery_id] && !l.is_deleted).sort((a, b) => idCmp(a.goods_delivery_id, b.goods_delivery_id) || idCmp(a.id, b.id)).map((l) => ({
      id: l.id, goods_delivery_id: l.goods_delivery_id, delivery_no: S(heads[l.goods_delivery_id].delivery_no), gd_status: S(heads[l.goods_delivery_id].gd_status),
      material_id: S(l.material_id), material_name: S(l.material_name), gd_qty: n8(l.gd_qty), base_qty: n8(l.base_qty === undefined ? l.gd_qty : l.base_qty),
      gd_order_quantity: n8(l.gd_order_quantity === undefined ? l.gd_qty : l.gd_order_quantity), gd_initial_delivered_qty: n8(l.gd_initial_delivered_qty || 0),
      gd_order_uom_id: S(l.gd_order_uom_id || l.good_delivery_uom_id), temp_qty_data: T(l.temp_qty_data), temp_hu_data: T(l.temp_hu_data), view_stock: S(l.view_stock),
      plan_qty: n8(l.plan_qty), plan_temp_qty_data: T(l.plan_temp_qty_data), plan_view_stock: S(l.plan_view_stock), picking_status: S(l.picking_status),
      item_bundle_id: S(l.item_bundle_id), parent_id: S(l.parent_id), so_line_item_id: S(l.so_line_item_id) }));
  };
  sql.sql_node_PPfcRecs = (text, ctx, e) => {
    const db = e.db, ids = gdIdsOf(db, out(ctx, "code_node_PPentry").pickingId);
    const pk = {};
    for (const t of naming(db, ids)) pk[t.id] = t;
    const name = (tbl, id, f) => { const x = db.t[tbl].find((y) => y.id === S(id)); return x ? S(f(x)) : null; };
    return db.t.records.filter((r) => pk[r.transfer_order_id] && !r.is_deleted).sort((a, b) => idCmp(a.id, b.id)).map((r) => ({
      id: r.id, transfer_order_id: r.transfer_order_id, to_status: pk[r.transfer_order_id].to_status, gd_line_id: S(r.gd_line_id), job_line_key: S(r.job_line_key),
      source_bin: S(r.source_bin), target_location: S(r.target_location), batch_no: S(r.batch_no), target_batch: S(r.target_batch), handling_unit_id: S(r.handling_unit_id),
      store_out_qty: n8(r.store_out_qty), item_code: S(r.item_code),
      source_bin_name: name("bins", r.source_bin, (b) => b.bin_location_combine || b.bin_name), target_location_name: name("bins", r.target_location, (b) => b.bin_location_combine || b.bin_name),
      batch_name: name("batches", r.batch_no, (b) => b.batch_number), target_batch_name: name("batches", r.target_batch, (b) => b.batch_number),
      hu_name: name("hu", r.handling_unit_id, (h) => h.handling_no) }));
  };
  sql.sql_node_PPfcOther = (text, ctx, e) => {
    const db = e.db, P = out(ctx, "code_node_PPentry").pickingId, ids = gdIdsOf(db, P);
    const others = naming(db, ids).filter((t) => t.id !== P && !["Completed", "Cancelled", "Draft"].includes(t.to_status));
    return others.flatMap((t) => db.t.lines.filter((i) => i.transfer_order_id === t.id && !i.is_deleted && i.line_status !== "Cancelled" && S(i.gd_line_id))
      .map((i) => ({ transfer_order_id: t.id, to_id: S(t.to_id), gd_line_id: S(i.gd_line_id) })));
  };

  // ------------------------------------------------------------------ WORKER
  const fcCols = (db, row) => {
    const j = db.t.job.find((x) => x.id === row.id);
    if (!j) return row;
    return Object.assign({}, row, { operation: req(j).operation || null, fc_gds: db.t.step.filter((s) => s.job_id === j.id && s.step_name === "FC_GDS" && !s.is_deleted).length });
  };
  for (const id of ["sql_node_PWmid", "sql_node_PWdriveBack"]) sql[id] = (text, ctx, e) => base.sql.sql_node_PWmid(text, ctx, e).map((r) => fcCols(e.db, r));
  sql.sql_node_PWfinal = (text, ctx, e) => base.sql.sql_node_PWfinal(text, ctx, e).map((r) => Object.assign({}, r, { kick: kickOf(e.db, r.id) }));

  // ------------------------------------------------------------------ COMMIT
  sql.sql_node_PCp0facts = (text, ctx, e) => {
    const en = out(ctx, "code_node_PCentry");
    const recs = e.db.t.records.filter((r) => r.transfer_order_id === en.pickingId && !r.is_deleted);
    return base.sql.sql_node_PCp0facts(text, ctx, e).concat([{ kind: "REC", id: String(recs.length), v1: recs.length ? recs.reduce((t, r) => t + Number(r.store_out_qty), 0).toFixed(8) : null,
      v2: recs.length ? recs.map((r) => r.id).sort(idCmp).pop() : null }]);
  };
  // a removed delivery line is soft-deleted (GD Edit V2's E2): the real P4 SELECT and the P5 search leave it out (1c never deletes one)
  sql.sql_node_PCp4facts = (text, ctx, e) => {
    const gone = new Set(e.db.t.gdl.filter((l) => l.is_deleted).map((l) => l.id));
    return base.sql.sql_node_PCp4facts(text, ctx, e).filter((r) => r.kind !== "L" || !gone.has(r.id));
  };
  const read = Object.assign({}, base.read);
  read.search_node_PCp5gd = (v, ctx, e) => {
    const got = base.read.search_node_PCp5gd(v, ctx, e);
    const live = (rows) => (rows || []).filter((l) => !l.is_deleted).map((l) => (Array.isArray(l.children) ? Object.assign({}, l, { children: live(l.children) }) : l));
    return Object.assign({}, got, { data: (got.data || []).map((g) => Object.assign({}, g, { table_gd: live(g.table_gd) })) });
  };
  return { sql, read };
}

module.exports = { mocks1d, kickOf, gdIdsOf };
