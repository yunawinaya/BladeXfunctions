// In-memory tables + the SQL / get / search mocks of the Picking V2 workflows. Each SQL mock returns what its SELECT
// returns on MySQL (ids as text, the same column names), computed from these tables - verified against dev by sqlcheck.py.
// Stage 1c copy of scratchpad/gdc/pkv2tools/sim/db.js: + on_reserved_gd (res), document_linkage (links), the 1c SQL
// mocks (PSmove, PPmove, PPmvparts, PCmvparts, PCpm1facts, PCpm2facts/back, PCpm3facts/back) and e.hooks[<sql node>].
const T = "496474";

class DB {
  constructor() {
    this.tenantId = T;
    this.now = Date.UTC(2026, 9, 12, 4, 0, 0); // DB session clock (UTC)
    this.seq = 3000000000000000000n;
    this.t = { job: [], step: [], picking: [], lines: [], records: [], gd: [], gdl: [], packing: [], setup: [], psetup: [], rules: [], items: [], uom: [], hu: [], so: [], bins: [], batches: [],
      res: [], links: [] };
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }
  fmt(ms) {
    const d = new Date(ms);
    const p = (n) => (n < 10 ? "0" : "") + n;
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
  }
  parse(text) {
    const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }
  advance(sec) {
    this.now += sec * 1000;
  }

  // --------------------------------------------------------------------------------------------- writes
  insert(table, rows, ctx) {
    const out = [];
    for (const r0 of rows) {
      const r = Object.assign({}, r0);
      delete r.__id;
      if (table === "GD Async Job") {
        if (this.t.job.some((j) => j.organization_id === r.organization_id && j.idempotency_key === r.idempotency_key)) throw new Error("Duplicate entry for key 'Idempotency Key'");
        r.id = this.id();
        r.is_deleted = 0;
        r.create_time = this.now;
        this.t.job.push(r);
      } else if (table === "GD Publish Step") {
        if (this.t.step.some((x) => x.job_id === String(r.job_id) && x.step_name === r.step_name)) throw new Error("Duplicate entry for key 'Job Step'");
        r.id = this.id();
        r.job_id = String(r.job_id);
        r.is_deleted = 0;
        r.started_at = r.started_at ? this.parse(r.started_at) : this.now;
        this.t.step.push(r);
      } else if (table === "Packing") {
        r.id = this.id();
        r.is_deleted = 0;
        if (r.packing_no === "issued") r.packing_no = "PACK/" + r.id.slice(-4);
        r.table_item_source = (r.table_item_source || []).map((x) => Object.assign({ id: this.id() }, x));
        r.table_hu_source = (r.table_hu_source || []).map((x) => Object.assign({ id: this.id() }, x));
        this.t.packing.push(r);
      } else if (table === "On Reserved Goods Delivery") {
        r.id = this.id();
        r.is_deleted = 0;
        for (const k of Object.keys(r)) if (r[k] === undefined) r[k] = null;
        this.t.res.push(r);
      } else throw new Error("insert into " + table + " not simulated");
      out.push(r);
    }
    return out;
  }

  update(table, rows, ctx) {
    let n = 0;
    for (const r of rows) {
      const id = String(r.__id);
      const set = Object.assign({}, r);
      delete set.__id;
      delete set.id;
      if (table === "GD Async Job") {
        const j = this.t.job.find((x) => x.id === id);
        if (!j) continue;
        for (const k of Object.keys(set)) j[k] = k === "next_attempt_at" || k === "lease_expires_at" ? (set[k] ? this.parse(set[k]) : null) : set[k];
      } else if (table === "Transfer Order Picking") {
        const p = this.t.picking.find((x) => x.id === id);
        if (!p) continue;
        for (const k of Object.keys(set)) {
          if (k === "table_picking_items") this.writeLines(p, set[k]);
          else if (k === "table_picking_records") this.writeRecords(p, set[k]);
          else p[k] = set[k];
        }
        p.update_time = this.now + 8 * 3600 * 1000;
      } else if (table === "goods_delivery_fwii8mvb_sub") {
        const l = this.t.gdl.find((x) => x.id === id);
        if (!l) continue;
        Object.assign(l, set);
      } else if (table === "Goods Delivery") {
        const g = this.t.gd.find((x) => x.id === id);
        if (!g) continue;
        Object.assign(g, set);
      } else if (table === "On Reserved Goods Delivery") {
        // an update-node writes NULL for a mapped column the record omits
        const r = this.t.res.find((x) => x.id === id);
        if (!r) continue;
        for (const k of Object.keys(set)) r[k] = set[k] === undefined ? null : set[k];
      } else if (table === "Packing") {
        const p = this.t.packing.find((x) => x.id === id);
        if (!p) continue;
        for (const k of Object.keys(set)) {
          if (k === "table_item_source" || k === "table_hu_source") p[k] = (set[k] || []).map((x) => Object.assign({ id: x.id || this.id() }, x));
          else p[k] = set[k];
        }
      } else throw new Error("update of " + table + " not simulated");
      n++;
    }
    return { count: n };
  }

  // a parent update with a subform array replaces the rows: rows missing from the array are deleted, new ones inserted
  writeLines(p, tree) {
    const keep = new Set();
    const put = (row, parentId) => {
      const r = Object.assign({}, row);
      const kids = r.children;
      delete r.children;
      r.transfer_order_id = p.id;
      r.parent_id = parentId || r.parent_id || null;
      if (!r.id) r.id = this.id();
      const old = this.t.lines.find((x) => x.id === r.id);
      if (old) Object.assign(old, r);
      else this.t.lines.push(r);
      keep.add(r.id);
      for (const k of kids || []) put(k, r.id);
    };
    for (const row of tree || []) put(row, null);
    this.t.lines = this.t.lines.filter((x) => x.transfer_order_id !== p.id || keep.has(x.id));
  }
  writeRecords(p, recs) {
    const keep = new Set();
    for (const rec of recs || []) {
      const r = Object.assign({}, rec);
      r.transfer_order_id = p.id;
      if (!r.id) r.id = this.id();
      const old = this.t.records.find((x) => x.id === r.id);
      if (old) Object.assign(old, r);
      else this.t.records.push(r);
      keep.add(r.id);
    }
    this.t.records = this.t.records.filter((x) => x.transfer_order_id !== p.id || keep.has(x.id));
  }

  // --------------------------------------------------------------------------------------------- reads (platform shapes)
  pickingTree(id) {
    const p = this.t.picking.find((x) => x.id === id && !x.is_deleted);
    if (!p) return { count: 0, data: null };
    const lines = this.t.lines.filter((l) => l.transfer_order_id === id);
    const tree = lines.filter((l) => !l.parent_id).map((l) => {
      const kids = lines.filter((k) => k.parent_id === l.id).map((k) => Object.assign({}, k));
      const r = Object.assign({}, l);
      if (kids.length) r.children = kids;
      return r;
    });
    const doc = Object.assign({}, p, { table_picking_items: tree, table_picking_records: this.t.records.filter((r) => r.transfer_order_id === id).map((r) => Object.assign({}, r)) });
    return { count: 1, data: JSON.parse(JSON.stringify(doc)) };
  }
  gdTree(g) {
    const lines = this.t.gdl.filter((l) => l.goods_delivery_id === g.id);
    const tree = lines.filter((l) => !l.parent_id).map((l) => {
      const kids = lines.filter((k) => k.parent_id === l.id);
      return kids.length ? Object.assign({}, l, { children: kids }) : Object.assign({}, l);
    });
    return Object.assign({}, g, { table_gd: tree });
  }
}

const S = (v) => (v === undefined || v === null ? null : String(v));
const n8 = (v) => (v === undefined || v === null ? null : Number(v).toFixed(8));
const nz = (v) => (v === undefined || v === null || v === "" || String(v) === "0" ? null : String(v));
const OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PICKING", "REQUIRES_REVIEW"];
// a moved GD's facts (sql_node_PSmove / sql_node_PPmove G rows): line count, serial items, select picking, linkage, an open CONFIRM_PICKING on another Picking
function gFacts(db, gd, pickingId) {
  const lines = db.t.gdl.filter((l) => l.goods_delivery_id === gd.id && !l.is_deleted);
  const serial = lines.filter((l) => Number((db.t.items.find((i) => i.id === l.material_id) || {}).serial_number_management) === 1).length;
  const so = new Set(lines.map((l) => S(l.line_so_id)).filter((x) => x).concat((gd.so_id || []).map(String)));
  const linked = db.t.links.filter((d) => !d.is_deleted && d.target_doc_type === "Sales Order" && d.link_status === "Linked" && so.has(String(d.target_doc_id))).length;
  const other = db.t.job.filter((j) => j.command === "CONFIRM_PICKING" && !j.is_deleted && OPEN.includes(j.job_status) && j.picking_id !== pickingId
    && (db.t.picking.find((p) => p.id === j.picking_id) || { gd_no: [] }).gd_no.map(String).includes(gd.id)).length;
  return { line_count: String(lines.length), serial_items: String(serial), select_picking: String(gd.is_select_picking || 0), linked: String(linked), other_job: String(other) };
}
// gd_publish_step part rows MV|<nonce>|..., ORDER BY step_name (PREPARE's read leaves the ALC part out)
function parts(db, jobId, nonce, withAlc) {
  const pre = "MV|" + nonce + "|";
  return db.t.step.filter((x) => x.job_id === String(jobId) && !x.is_deleted && x.step_status === "PAYLOAD" && String(x.step_name).indexOf(pre) === 0 && (withAlc || !/^MV\|[^|]*\|ALC\|/.test(x.step_name)))
    .sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((x) => ({ step_name: x.step_name, result_ref: x.result_ref }));
}
// JSON_OBJECT text as MySQL prints it: DECIMAL(65,8) a number with 8 decimals, varchar / CHAR a string, int a number
const jstr = (v) => (v === undefined || v === null ? "null" : JSON.stringify(String(v)));
const jdec = (v) => (v === undefined || v === null || v === "" ? "null" : Number(v).toFixed(8));
const idsOf = (json) => JSON.parse(json || "[]").map(String);
function resRows(db, idsJson) {
  const ids = idsOf(idsJson);
  return db.t.res.filter((r) => ids.includes(r.id)).map((r) => ({ k: "U", j: "{" + [["id", jstr(r.id)], ["doc_id", jstr(r.doc_id)], ["doc_no", jstr(r.doc_no)], ["status", jstr(r.status)],
    ["item_uom", jstr(r.item_uom)], ["open_qty", jdec(r.open_qty)], ["is_deleted", String(r.is_deleted || 0)], ["doc_line_id", jstr(r.doc_line_id)], ["reserved_qty", jdec(r.reserved_qty)],
    ["target_gd_id", jstr(r.target_gd_id)], ["delivered_qty", jdec(r.delivered_qty)], ["source_reserved_id", jstr(r.source_reserved_id)]].map(([k, v]) => '"' + k + '": ' + v).join(", ") + "}" }));
}
function lineRows(db, idsJson) {
  const ids = idsOf(idsJson);
  return db.t.gdl.filter((l) => ids.includes(l.id) && !l.is_deleted).map((l) => ({ k: "L", j: "{" + [["id", jstr(l.id)], ["view_stock", jstr(l.view_stock)], ["temp_qty_data", jstr(l.temp_qty_data)],
    ["prev_temp_qty_data", jstr(l.prev_temp_qty_data)]].map(([k, v]) => '"' + k + '": ' + v).join(", ") + "}" }));
}
function createRows(db, jobId) {
  return db.t.res.filter((r) => !r.is_deleted && String(r.job_line_key || "").indexOf(String(jobId) + "|R|") === 0).map((r) => ({ k: "C", j: '{"id": ' + jstr(r.id) + ', "job_line_key": ' + jstr(r.job_line_key) + "}" }));
}

function mocks() {
  const out = (ctx, id) => ctx.out[id];
  const jobRow = (db, j, extra) => (j ? Object.assign({
    db_now: db.fmt(db.now), id: j.id, organization_id: j.organization_id, picking_id: j.picking_id, command: j.command, job_status: j.job_status,
    progress_percent: j.progress_percent, progress_message: j.progress_message, attempt_count: j.attempt_count, next_attempt_at: j.next_attempt_at ? db.fmt(j.next_attempt_at) : null,
    lease_owner: j.lease_owner || null, lease_expires_at: j.lease_expires_at ? db.fmt(j.lease_expires_at) : null, lease_live: j.lease_expires_at && j.lease_expires_at > db.now ? 1 : 0,
    row_version: j.row_version, error_code: j.error_code || null, error_message: j.error_message || null, error_details: j.error_details || null,
    finished_at: j.finished_at || null,
  }, extra || {}) : { db_now: db.fmt(db.now) });
  const findJob = (db, id) => db.t.job.find((j) => j.id === String(id) && !j.is_deleted);
  const claim = (db, j) => db.t.step.find((c) => c.job_id === j.id && c.step_name === "W0_CLAIM_" + j.row_version && !c.is_deleted);
  const setupOf = (db, org) => db.t.setup.filter((x) => x.organization_id === org).sort((a, b) => (a.id < b.id ? -1 : 1))[0] || {};
  const psetupOf = (db, org) => db.t.psetup.filter((x) => x.organization_id === org).sort((a, b) => (a.id < b.id ? -1 : 1))[0] || {};
  const lineRow = (l) => ({
    id: l.id, parent_id: S(l.parent_id), item_code: S(l.item_code), item_name: l.item_name, item_desc: l.item_desc, more_desc: l.more_desc, item_uom: S(l.item_uom),
    qty_to_pick: n8(l.qty_to_pick), pending_process_qty: n8(l.pending_process_qty), line_status: l.line_status, gd_id: S(l.gd_id), gd_no: l.gd_no, gd_line_id: S(l.gd_line_id),
    so_id: S(l.so_id), so_no: l.so_no, so_line_id: S(l.so_line_id), source_bin: S(l.source_bin), target_location: S(l.target_location), batch_no: S(l.batch_no),
    target_batch: S(l.target_batch), handling_unit_id: S(l.handling_unit_id), item_bundle_id: S(l.item_bundle_id), row_type: l.row_type, remark: l.remark,
    remark_2: l.remark_2, remark_3: l.remark_3, attachment: l.attachment ? JSON.stringify(l.attachment) : null,
  });

  const sql = {
    // ------------------------------------------------------------------ SUBMIT
    sql_node_PSfacts: (text, ctx, e) => {
      const db = e.db;
      const g = out(ctx, "code_node_PSguard");
      const p = db.t.picking.find((x) => x.id === g.pickingId);
      const st = setupOf(db, g.organizationId);
      const key = db.t.job.find((j) => j.organization_id === g.organizationId && j.idempotency_key === g.idempotencyKey);
      const open = db.t.job.filter((j) => j.command === "CONFIRM_PICKING" && j.picking_id === g.pickingId && !j.is_deleted && ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PICKING", "REQUIRES_REVIEW"].includes(j.job_status)).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
      const moved = db.t.lines.filter((l) => l.transfer_order_id === g.pickingId && l.line_status !== "Cancelled" && Number(l.pending_process_qty) > 0 && ((l.target_location && l.target_location !== l.source_bin) || (l.target_batch && l.target_batch !== l.batch_no))).length;
      return [{
        db_now: db.fmt(db.now), id: p ? p.id : null, to_id: p ? p.to_id : null, to_status: p ? p.to_status : null, is_deleted: p ? p.is_deleted : null, organization_id: p ? p.organization_id : null,
        plant_id: p ? p.plant_id : null, is_processing: p ? p.is_processing || 0 : null, is_loading_bay: p ? p.is_loading_bay || 0 : null,
        lock_age_sec: p ? Math.round((db.now + 8 * 3600 * 1000 - p.update_time) / 1000) : null, picking_after: st.picking_after || null,
        allow_full_picking: S(st.allow_full_picking), auto_completed_gd: S(st.auto_completed_gd), setup_loading_bay: S(st.is_loading_bay),
        key_job: key ? key.id + "|" + key.job_status : null, open_job: open ? open.id + "|" + open.job_status : null, moved_rows: moved,
      }];
    },
    sql_node_PSstatus: (text, ctx, e) => {
      const g = out(ctx, "code_node_PSguard");
      const j = e.db.t.job.filter((x) => x.command === "CONFIRM_PICKING" && x.organization_id === g.organizationId && x.picking_id === g.pickingId && !x.is_deleted).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
      return j ? [{ id: j.id, job_status: j.job_status, progress_message: j.progress_message, error_code: j.error_code || null, error_message: j.error_message || null }] : [];
    },
    sql_node_PSback: (text, ctx, e) => {
      const g = out(ctx, "code_node_PSguard");
      const j = e.db.t.job.find((x) => x.organization_id === g.organizationId && x.idempotency_key === g.idempotencyKey);
      return j ? [{ id: j.id, job_status: j.job_status, progress_message: j.progress_message, error_code: j.error_code || null, error_message: j.error_message || null, picking_no: j.picking_no }] : [];
    },
    // ------------------------------------------------------------------ WORKER
    sql_node_PWpoll: (text, ctx, e) => {
      const db = e.db;
      const g = out(ctx, "code_node_PWguard");
      const due = db.t.job.filter((j) => !j.is_deleted && j.command === "CONFIRM_PICKING" && (g.jobId === "0" || j.id === g.jobId)
        && ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PICKING"].includes(j.job_status)
        && (!j.lease_expires_at || j.lease_expires_at <= db.now) && (!j.next_attempt_at || j.next_attempt_at <= db.now)
        && (() => { const c = claim(db, j); return !c || c.started_at <= db.now - 600000; })()).sort((a, b) => a.create_time - b.create_time || (a.id < b.id ? -1 : 1)).slice(0, 5);
      if (!due.length) return [{ db_now: db.fmt(db.now) }];
      return due.map((j) => {
        const c = claim(db, j);
        return jobRow(db, j, { dead_lease: j.lease_owner && j.lease_expires_at && j.lease_expires_at <= db.now ? 1 : 0, claim_id: c ? c.id : null, claim_started_at: c ? db.fmt(c.started_at) : null, claim_owner: c ? c.result_ref : null });
      });
    },
    sql_node_PWtick: (text, ctx, e) => {
      const db = e.db;
      const ids = String(out(ctx, "code_node_PWplan").jobIdsSql).split(",");
      const base = { db_now: db.fmt(db.now), lease_until: db.fmt(db.now + 600000) };
      const rows = db.t.job.filter((j) => ids.includes(j.id) && !j.is_deleted).map((j) => {
        const c = claim(db, j);
        return Object.assign(jobRow(db, j), base, { dead_lease: j.lease_owner && j.lease_expires_at && j.lease_expires_at <= db.now ? 1 : 0, due_now: !j.next_attempt_at || j.next_attempt_at <= db.now ? 1 : 0, claim_id: c ? c.id : null, claim_started_at: c ? db.fmt(c.started_at) : null, claim_owner: c ? c.result_ref : null, claim_live: c && c.started_at > db.now - 600000 ? 1 : 0 });
      });
      return rows.length ? rows : [base];
    },
    sql_node_PWfinal: (text, ctx, e) => {
      const ids = String(out(ctx, "code_node_PWplan").jobIdsSql).split(",");
      return e.db.t.job.filter((j) => ids.includes(j.id)).map((j) => ({ id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner || null, error_code: j.error_code || null, error_message: j.error_message || null, picking_id: j.picking_id }));
    },
    // ------------------------------------------------------------------ PREPARE
    sql_node_PPjob: (text, ctx, e) => {
      const db = e.db;
      const j = findJob(db, out(ctx, "code_node_PPguard").jobId);
      return [j ? { db_now: db.fmt(db.now), id: j.id, organization_id: j.organization_id, command: j.command, job_status: j.job_status, lease_owner: j.lease_owner || null, lease_live: j.lease_expires_at && j.lease_expires_at > db.now ? 1 : 0, row_version: j.row_version, attempt_count: j.attempt_count, picking_id: j.picking_id, picking_no: j.picking_no, request_payload: j.request_payload, is_deleted: 0 } : { db_now: db.fmt(db.now) }];
    },
    sql_node_PPhdr: (text, ctx, e) => {
      const db = e.db;
      const en = out(ctx, "code_node_PPentry");
      const p = db.t.picking.find((x) => x.id === en.pickingId);
      const st = setupOf(db, en.organizationId);
      const pk = psetupOf(db, en.organizationId);
      return [Object.assign(p ? { id: p.id, to_id: p.to_id, to_status: p.to_status, is_deleted: p.is_deleted || 0, organization_id: p.organization_id, plant_id: p.plant_id, is_loading_bay: p.is_loading_bay || 0, gd_no_json: JSON.stringify(p.gd_no || []), delivery_no: p.delivery_no, so_no: p.so_no } : {},
        { picking_after: st.picking_after || null, allow_full_picking: S(st.allow_full_picking), auto_completed_gd: S(st.auto_completed_gd), setup_loading_bay: S(st.is_loading_bay), packing_required: S(pk.packing_required), auto_trigger_pkg: S(pk.auto_trigger_pkg), packing_mode: pk.packing_mode || null })];
    },
    sql_node_PPlines: (text, ctx, e) => e.db.t.lines.filter((l) => l.transfer_order_id === out(ctx, "code_node_PPentry").pickingId).map(lineRow),
    sql_node_PPgd: (text, ctx, e) => {
      const db = e.db;
      const pid = out(ctx, "code_node_PPentry").pickingId;
      const gds = new Set(db.t.lines.filter((l) => l.transfer_order_id === pid && l.gd_id).map((l) => l.gd_id));
      return db.t.gdl.filter((l) => gds.has(l.goods_delivery_id)).map((l) => ({ id: l.id, goods_delivery_id: l.goods_delivery_id, picking_status: l.picking_status || null, gd_status: (db.t.gd.find((g) => g.id === l.goods_delivery_id) || {}).gd_status, gd_qty: n8(l.gd_qty), material_name: l.material_name || null }));
    },
    sql_node_PPpicked: (text, ctx, e) => {
      const db = e.db;
      const en = out(ctx, "code_node_PPentry");
      if (String(setupOf(db, en.organizationId).allow_full_picking) !== "1") return [];
      const mine = new Set(db.t.lines.filter((l) => l.transfer_order_id === en.pickingId && l.gd_line_id).map((l) => String(l.gd_line_id)));
      const live = new Set(db.t.picking.filter((p) => !p.is_deleted).map((p) => p.id));
      const sum = {};
      for (const r of db.t.records) if (live.has(r.transfer_order_id) && mine.has(String(r.gd_line_id))) sum[String(r.gd_line_id)] = (sum[String(r.gd_line_id)] || 0) + Number(r.store_out_qty);
      return Object.keys(sum).map((k) => ({ gd_line_id: k, picked_qty: sum[k].toFixed(8) }));
    },
    sql_node_PPuom: (text, ctx, e) => {
      const db = e.db;
      const en = out(ctx, "code_node_PPentry");
      const rows = String(en.uomRowIdsSql).split(",");
      const items = new Set(db.t.lines.filter((l) => l.transfer_order_id === en.pickingId && rows.includes(l.id)).map((l) => l.item_code));
      const outRows = [];
      for (const it of db.t.items.filter((i) => items.has(i.id))) {
        const conv = db.t.uom.filter((u) => u.item_id === it.id);
        if (!conv.length) outRows.push({ item_id: it.id, based_uom: it.based_uom, alt_uom_id: null, base_qty: null });
        for (const c of conv) outRows.push({ item_id: it.id, based_uom: it.based_uom, alt_uom_id: c.alt_uom_id, base_qty: Number(c.base_qty).toFixed(6) });
      }
      return outRows;
    },
    sql_node_PPback: (text, ctx, e) => {
      const j = findJob(e.db, out(ctx, "code_node_PPguard").jobId);
      return j ? [{ id: j.id, job_status: j.job_status, progress_message: j.progress_message, error_code: j.error_code || null, error_message: j.error_message || null }] : [];
    },
    // ------------------------------------------------------------------ COMMIT
    sql_node_PCjob: (text, ctx, e) => {
      const db = e.db;
      const j = findJob(db, out(ctx, "code_node_PCguard").jobId);
      return [j ? Object.assign(jobRow(db, j), { lease_until: db.fmt(db.now + 600000), started_at: j.started_at || null, due: !j.next_attempt_at || j.next_attempt_at <= db.now ? 1 : 0, is_deleted: 0 }) : { db_now: db.fmt(db.now), lease_until: db.fmt(db.now + 600000) }];
    },
    sql_node_PCsteps: (text, ctx, e) => e.db.t.step.filter((x) => x.job_id === out(ctx, "code_node_PCguard").jobId && !x.is_deleted).map((x) => ({ id: x.id, step_name: x.step_name, step_status: x.step_status })),
    sql_node_PCpayload: (text, ctx, e) => {
      const j = findJob(e.db, out(ctx, "code_node_PCguard").jobId);
      return j ? [{ prepared_payload: j.prepared_payload || null }] : [];
    },
    sql_node_PCown: (text, ctx, e) => {
      const j = findJob(e.db, out(ctx, "code_node_PCguard").jobId);
      return j ? [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner || null, row_version: j.row_version }] : [];
    },
    sql_node_PCp0facts: (text, ctx, e) => {
      const db = e.db;
      const en = out(ctx, "code_node_PCentry");
      const rows = String(en.rowIdsSql).split(",");
      const gds = String(en.gdIdsSql).split(",");
      const res = db.t.lines.filter((l) => l.transfer_order_id === en.pickingId && rows.includes(l.id)).map((l) => ({ kind: "ROW", id: l.id, v1: n8(l.pending_process_qty), v2: l.line_status }));
      const p = db.t.picking.find((x) => x.id === en.pickingId && !x.is_deleted);
      if (p) res.push({ kind: "HDR", id: p.id, v1: p.to_status, v2: String(p.is_processing) });
      for (const g of db.t.gd.filter((x) => gds.includes(x.id))) res.push({ kind: "GD", id: g.id, v1: g.gd_status, v2: "" });
      return res;
    },
    sql_node_PCp1back: (text, ctx, e) => {
      const db = e.db;
      const en = out(ctx, "code_node_PCentry");
      const pre = out(ctx, "code_node_PCguard").jobId + "|";
      const mine = db.t.records.filter((r) => r.transfer_order_id === en.pickingId && String(r.job_line_key || "").startsWith(pre));
      const p = db.t.picking.find((x) => x.id === en.pickingId);
      return [{ job_records: mine.length, job_keys: new Set(mine.map((r) => r.job_line_key)).size, to_status: p ? p.to_status : null }];
    },
    sql_node_PCp3facts: (text, ctx, e) => {
      const ids = String(out(ctx, "code_node_PCentry").gdLineIdsSql).split(",");
      return e.db.t.gdl.filter((l) => ids.includes(l.id)).map((l) => ({ id: l.id, temp_qty_data: l.temp_qty_data === undefined ? null : l.temp_qty_data, picking_status: l.picking_status || null }));
    },
    sql_node_PCp3fpFacts: (text, ctx, e) => {
      const db = e.db;
      if (e.hooks && e.hooks.beforeP3fp) e.hooks.beforeP3fp(ctx, e);
      const ids = String(out(ctx, "code_node_PCentry").gdLineIdsSql).split(",");
      const T = (v) => (v === undefined || v === null ? null : String(v));
      const L = db.t.gdl.filter((l) => ids.includes(l.id) && !l.is_deleted).map((l) => ({
        kind: "L", id: l.id, rid: null, gd_qty: n8(l.gd_qty), material_id: S(l.material_id), plant_id: S(l.plant_id), organization_id: S(l.organization_id),
        picking_status: T(l.picking_status), picked_qty: l.picked_qty === undefined || l.picked_qty === null ? null : n8(l.picked_qty), temp_qty_data: T(l.temp_qty_data),
        prev_temp_qty_data: T(l.prev_temp_qty_data), picked_temp_qty_data: T(l.picked_temp_qty_data), picked_view_stock: T(l.picked_view_stock), view_stock: T(l.view_stock),
        qty: null, loc: null, batch: null, hu: null, loc_name: null, batch_name: null, hu_name: null,
      }));
      const live = new Set(db.t.picking.filter((p) => !p.is_deleted).map((p) => p.id));
      const nz = (v) => (v === undefined || v === null || v === "" ? null : String(v));
      const R = db.t.records.filter((r) => live.has(r.transfer_order_id) && ids.includes(String(r.gd_line_id))).map((r) => {
        const loc = nz(r.target_location) || nz(r.source_bin);
        const batch = nz(r.target_batch) || nz(r.batch_no);
        const hu = nz(r.handling_unit_id);
        const b = db.t.bins.find((x) => x.id === loc) || {};
        const bt = db.t.batches.find((x) => x.id === batch) || {};
        const h = db.t.hu.find((x) => x.id === hu) || {};
        return { kind: "R", id: String(r.gd_line_id), rid: r.id, gd_qty: null, material_id: null, plant_id: null, organization_id: null, picking_status: null, picked_qty: null,
          temp_qty_data: null, prev_temp_qty_data: null, picked_temp_qty_data: null, picked_view_stock: null, view_stock: null, qty: n8(r.store_out_qty), loc: loc, batch: batch, hu: hu,
          loc_name: b.bin_location_combine || b.bin_name || null, batch_name: bt.batch_number || null, hu_name: h.handling_no || null };
      });
      return L.concat(R);
    },
    sql_node_PCp3back: (text, ctx, e) => {
      const ids = String(out(ctx, "code_node_PCentry").gdLineIdsSql).split(",");
      return e.db.t.gdl.filter((l) => ids.includes(l.id)).map((l) => ({ id: l.id, picking_status: l.picking_status || null }));
    },
    sql_node_PCp4facts: (text, ctx, e) => {
      const db = e.db;
      const gds = String(out(ctx, "code_node_PCentry").gdIdsAllSql).split(",");
      const res = db.t.gdl.filter((l) => gds.includes(l.goods_delivery_id)).map((l) => ({ kind: "L", gd_id: l.goods_delivery_id, id: l.id, material_id: S(l.material_id), item_bundle_id: S(l.item_bundle_id), picking_status: l.picking_status || null, gd_qty: n8(l.gd_qty), gd_status: "" }));
      for (const g of db.t.gd.filter((x) => gds.includes(x.id))) res.push({ kind: "H", gd_id: g.id, id: g.id, material_id: "", item_bundle_id: "", picking_status: g.picking_status || null, gd_qty: "", gd_status: g.gd_status });
      return res;
    },
    sql_node_PCp4back: (text, ctx, e) => {
      const gds = String(out(ctx, "code_node_PCentry").gdIdsAllSql).split(",");
      return e.db.t.gd.filter((g) => gds.includes(g.id)).map((g) => ({ id: g.id, picking_status: g.picking_status || null }));
    },
    sql_node_PCp5hdr: (text, ctx, e) => {
      const p = e.db.t.picking.find((x) => x.id === out(ctx, "code_node_PCentry").pickingId);
      if (!p) return [];
      const r = { id: p.id, to_status: p.to_status, gd_no_json: JSON.stringify(p.gd_no || []), plant_id: p.plant_id, created_by: p.created_by, customer_id_json: JSON.stringify(p.customer_id || []), organization_id: p.organization_id };
      for (const k of ["di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no", "di_shipping_company", "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection", "di_tracking_number", "di_freight_charges"]) r[k] = p[k] === undefined ? null : p[k];
      return [r];
    },
    // the header re-check (phase B, before P5): the stored status and the Picking's live / Completed rows
    sql_node_PCbhdr: (text, ctx, e) => {
      const id = out(ctx, "code_node_PCentry").pickingId;
      const p = e.db.t.picking.find((x) => x.id === id);
      if (!p) return [];
      const rows = e.db.t.lines.filter((l) => l.transfer_order_id === id && !l.is_deleted);
      return [{ to_status: p.to_status, live_rows: String(rows.filter((l) => (l.line_status || "") !== "Cancelled").length),
        completed_rows: String(rows.filter((l) => (l.line_status || "") === "Completed").length) }];
    },
    sql_node_PCp5lines: (text, ctx, e) => e.db.t.lines.filter((l) => l.transfer_order_id === out(ctx, "code_node_PCentry").pickingId).map((l) => ({ gd_id: S(l.gd_id), gd_no: l.gd_no, so_id: S(l.so_id), so_no: l.so_no, customer_id: S(l.customer_id), qty_to_pick: n8(l.qty_to_pick), pending_process_qty: n8(l.pending_process_qty), line_status: l.line_status, item_bundle_id: S(l.item_bundle_id), item_code: S(l.item_code), handling_unit_id: S(l.handling_unit_id), row_type: l.row_type })),
    // stage 1b reads the records of one chunk of deliveries; stage 1a read all of the Picking's
    sql_node_PCp5recs: (text, ctx, e) => e.db.t.records.filter((r) => r.transfer_order_id === out(ctx, "code_node_PCentry").pickingId && (!out(ctx, "code_node_PCp5chunk") || String(out(ctx, "code_node_PCp5chunk").gdIdsCsv).split(",").includes(String(r.gd_id)))).map((r) => ({ gd_line_id: S(r.gd_line_id), store_out_qty: n8(r.store_out_qty), target_location: S(r.target_location) || null, source_bin: S(r.source_bin) || null, target_batch: S(r.target_batch) || null, batch_no: S(r.batch_no) || null, handling_unit_id: S(r.handling_unit_id) || null })),
    sql_node_PCp5rule: (text, ctx, e) => {
      const org = out(ctx, "code_node_PCentry").organizationId;
      const rule = e.db.t.rules.filter((r) => r.department_id === org).sort((a, b) => a.is_draft - b.is_draft || b.is_default - a.is_default || (a.id < b.id ? -1 : 1))[0];
      return [{ rule_id: rule ? rule.id : null, packing_mode: psetupOf(e.db, org).packing_mode || null }];
    },
    sql_node_PCp5back: (text, ctx, e) => {
      const want = String((out(ctx, "code_node_PCp5expect") || out(ctx, "code_node_PCp5build")).expectSql).replace(/'/g, "").split(",");
      const cnt = {};
      for (const p of e.db.t.packing.filter((x) => want.includes(x.gd_id) && !x.is_deleted && x.packing_status !== "Cancelled")) cnt[p.gd_id] = (cnt[p.gd_id] || 0) + 1;
      return Object.keys(cnt).map((g) => ({ gd_id: g, n: cnt[g] }));
    },
    sql_node_PCback: (text, ctx, e) => {
      const j = findJob(e.db, out(ctx, "code_node_PCguard").jobId);
      return j ? [{ id: j.id, job_status: j.job_status, progress_message: j.progress_message, error_code: j.error_code || null, error_message: j.error_message || null }] : [];
    },
    // ------------------------------------------------------------------ 1c
    sql_node_PSmove: (text, ctx, e) => {
      const db = e.db;
      const g = out(ctx, "code_node_PSguard");
      const sent = {};
      for (const x of JSON.parse(g.moveRowsJson || "[]")) sent[String(x.r)] = x;
      const rows = db.t.lines.filter((l) => l.transfer_order_id === g.pickingId && !l.is_deleted && l.line_status !== "Cancelled"
        && ((g.operation === "PICK_ALL_REMAINING" && Number(l.pending_process_qty) > 0) || sent[l.id])).map((l) => {
        const x = sent[l.id];
        const src = nz(l.source_bin), bat0 = nz(l.batch_no);
        const loc = (x && x.l !== null && x.l !== undefined ? nz(x.l) : nz(l.target_location)) || src;
        const bat = (x && x.b !== null && x.b !== undefined ? nz(x.b) : nz(l.target_batch)) || bat0;
        return { l: l, moved: (src && loc && loc !== src) || (bat0 && bat && bat !== bat0) ? 1 : 0, bayBad: !loc || loc === src ? 1 : 0 };
      });
      const bayOrg = Number(setupOf(db, g.organizationId).is_loading_bay) === 1;
      const R = rows.filter((x) => x.moved === 1 || (x.bayBad === 1 && bayOrg)).map((x) => ({ kind: "R", row_id: x.l.id, gd_id: S(x.l.gd_id), moved: String(x.moved), bay_bad: String(x.bayBad),
        hu: S(x.l.handling_unit_id), label: x.l.item_name || S(x.l.item_code), delivery_no: null, line_count: null, serial_items: null, select_picking: null, linked: null, other_job: null }));
      const gds = new Set(rows.filter((x) => x.moved === 1).map((x) => String(x.l.gd_id)));
      const G = db.t.gd.filter((gd) => gds.has(gd.id)).map((gd) => Object.assign({ kind: "G", row_id: null, gd_id: gd.id, moved: null, bay_bad: null, hu: null, label: null,
        delivery_no: gd.delivery_no }, gFacts(db, gd, g.pickingId)));
      return R.concat(G);
    },
    sql_node_PPmove: (text, ctx, e) => {
      const db = e.db;
      const en = out(ctx, "code_node_PPentry");
      const pl = out(ctx, "code_node_PPplan");
      const ids = String(pl.moveGdLineIdsSql).split(",");
      const L = db.t.gdl.filter((l) => ids.includes(l.id) && !l.is_deleted);
      const ents = [];
      for (const l of L) {
        try {
          const a = JSON.parse(l.temp_qty_data);
          if (Array.isArray(a)) ents.push(...a);
        } catch (err) { /* JSON_VALID false: no entries */ }
      }
      const locs = new Set(String(pl.moveBinIdsSql).split(",").concat(ents.map((x) => S(x.location_id))));
      const bats = new Set(String(pl.moveBatchIdsSql).split(",").concat(ents.map((x) => S(x.batch_id))));
      const hus = new Set(ents.map((x) => S(x.handling_unit_id)).filter((x) => x));
      const row = (o) => Object.assign({ kind: null, id: null, gd_id: null, material_id: null, picking_status: null, temp_qty_data: null, view_stock: null, plant_id: null, name: null,
        line_count: null, linked: null, other_job: null }, o);
      const res = L.map((l) => row({ kind: "L", id: l.id, gd_id: S(l.goods_delivery_id), material_id: S(l.material_id), picking_status: l.picking_status || null,
        temp_qty_data: l.temp_qty_data === undefined ? null : l.temp_qty_data, view_stock: l.view_stock === undefined ? null : l.view_stock }));
      for (const b of db.t.bins.filter((x) => locs.has(x.id) && !x.is_deleted)) res.push(row({ kind: "B", id: b.id, plant_id: S(b.plant_id), name: b.bin_location_combine || b.bin_name || null }));
      for (const t of db.t.batches.filter((x) => bats.has(x.id) && !x.is_deleted)) res.push(row({ kind: "T", id: t.id, material_id: S(t.material_id), plant_id: S(t.plant_id), name: t.batch_number || null }));
      for (const h of db.t.hu.filter((x) => hus.has(x.id))) res.push(row({ kind: "H", id: h.id, name: h.handling_no || null }));
      const gds = new Set(L.map((l) => l.goods_delivery_id));
      for (const gd of db.t.gd.filter((x) => gds.has(x.id))) {
        const f = gFacts(db, gd, en.pickingId);
        res.push(row({ kind: "G", id: gd.id, gd_id: gd.id, name: gd.delivery_no, line_count: f.line_count, linked: f.linked, other_job: f.other_job }));
      }
      return res;
    },
    sql_node_PPmvparts: (text, ctx, e) => parts(e.db, out(ctx, "code_node_PPentry").jobId, out(ctx, "code_node_PPmove").nonce, false),
    sql_node_PCmvparts: (text, ctx, e) => parts(e.db, out(ctx, "code_node_PCguard").jobId, out(ctx, "code_node_PCentry").moveNonce, true),
    sql_node_PCpm1facts: (text, ctx, e) => {
      const m = out(ctx, "code_node_PCmvparse");
      const op = out(ctx, "code_node_PCentry").moveOpKey;
      const intents = e.db.t.step.filter((x) => x.job_id === op && String(x.step_name).indexOf("IBA|I|") === 0).length;
      return resRows(e.db, m.resIdsJson).concat(lineRows(e.db, m.lineIdsJson), [{ k: "I", j: String(intents) }]);
    },
    sql_node_PCpm2facts: (text, ctx, e) => resRows(e.db, out(ctx, "code_node_PCmvparse").resIdsJson).concat(createRows(e.db, out(ctx, "code_node_PCguard").jobId)),
    sql_node_PCpm2back: (text, ctx, e) => resRows(e.db, out(ctx, "code_node_PCmvparse").resIdsJson).concat(createRows(e.db, out(ctx, "code_node_PCguard").jobId)),
    sql_node_PCpm3facts: (text, ctx, e) => resRows(e.db, out(ctx, "code_node_PCmvparse").resIdsJson).concat(createRows(e.db, out(ctx, "code_node_PCguard").jobId),
      lineRows(e.db, out(ctx, "code_node_PCmvparse").lineIdsJson)),
    sql_node_PCpm3back: (text, ctx, e) => lineRows(e.db, out(ctx, "code_node_PCmvparse").lineIdsJson),
  };
  // a test hook runs right before a 1c read (someone else writes in between)
  for (const id of ["sql_node_PSmove", "sql_node_PPmove", "sql_node_PPmvparts", "sql_node_PCmvparts", "sql_node_PCpm1facts", "sql_node_PCpm2facts", "sql_node_PCpm2back", "sql_node_PCpm3facts", "sql_node_PCpm3back"]) {
    const f = sql[id];
    sql[id] = (text, ctx, e) => {
      if (e.hooks && e.hooks[id]) e.hooks[id](ctx, e);
      return f(text, ctx, e);
    };
  }
  // the worker's job read-backs: one SQL text, several nodes
  for (const id of ["sql_node_PWown", "sql_node_PWprepBack", "sql_node_PWmid", "sql_node_PWpubBack", "sql_node_PWsplit", "sql_node_PWpub2Back"]) {
    sql[id] = (text, ctx, e) => [jobRow(e.db, findJob(e.db, out(ctx, "code_node_PWpick").jobId))];
  }
  const asList = (v) => (Array.isArray(v) ? Array.from(v).map(String) : [String(v)]);
  const read = {
    get_node_PCp1get: (v, ctx, e) => e.db.pickingTree(String(v)),
    search_node_PCp5gd: (v, ctx, e) => { const ids = asList(v); const rows = e.db.t.gd.filter((g) => ids.includes(g.id)).map((g) => JSON.parse(JSON.stringify(e.db.gdTree(g)))); return { total: rows.length, count: rows.length, data: rows }; },
    search_node_PCp5pack: (v, ctx, e) => { const ids = asList(v); const rows = e.db.t.packing.filter((p) => ids.includes(p.gd_id) && !p.is_deleted).map((p) => JSON.parse(JSON.stringify(p))); return { total: rows.length, count: rows.length, data: rows }; },
    search_node_PCp5hu: (v, ctx, e) => { const ids = asList(v); const rows = e.db.t.hu.filter((h) => ids.includes(h.id)); return { total: rows.length, count: rows.length, data: rows }; },
    search_node_PCp5so: (v, ctx, e) => { const ids = asList(v); const rows = e.db.t.so.filter((s) => ids.includes(s.id)); return { total: rows.length, count: rows.length, data: rows }; },
  };
  return { sql, read };
}

module.exports = { DB, mocks };
