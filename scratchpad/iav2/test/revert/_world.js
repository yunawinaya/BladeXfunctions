// An in-memory BladeX for the Revert V2 interpreter sims (lib/sim/engine.js runs the BUILT workflow JSON): the tables a revert
// touches, every SQL node of IA_REVERT_V2_SUBMIT / _WORKER / _PREPARE / _COMMIT (and the classic IA_REVERT v5's reads) computed
// from them as MySQL + the platform return it (ids as text, raw DECIMAL columns as BigDecimal text - zero is "0E-8" - JSON_OBJECT
// decimals as numbers, null sql columns dropped), the writes by table, and the callees: INVENTORY_BULK_APPLY = the engine's own
// core (_engine.js) over these tables, INVENTORY_LOCK_TOKENS (TAKE / GIVE), SUBTRACT_ / ADD_INVENTORY for the classic (one-movement
// core calls). A crash can be injected right after the n-th write; the ordering rule is watched on every engine call / lock take.
const path = require("path");
const { Engine } = require(path.join(__dirname, "..", "..", "lib", "sim", "engine.js"));
const { core } = require("./_engine");
const OUT = path.join(__dirname, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2");
const ENGINE = core();
const T = "000000";
const STATES = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_REVERT"];
const OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA", "COMMITTING_REVERT", "REQUIRES_REVIEW"];
const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const fmt = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString().slice(0, 19).replace("T", " "));
const parse = (t) => (t === null || t === undefined || t === "" ? null : Date.parse(String(t).replace(" ", "T") + "Z"));
const s = (v) => (v === undefined || v === null ? "" : String(v));
// a raw DECIMAL(65,8) column as the platform's sql-node hands it on (BigDecimal.toString)
const dec = (v) => (v === undefined || v === null || v === "" ? null : Number(v) === 0 ? "0E-8" : Number(v).toFixed(8));
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const J = (o) => ({ j: JSON.stringify(o) });
const drop = (row) => {
  const o = {};
  for (const k of Object.keys(row)) if (row[k] !== null && row[k] !== undefined) o[k] = row[k];
  return o;
};

class World {
  constructor() {
    this.now = Date.UTC(2026, 9, 19, 4, 0, 0);
    this.seq = 2130000000000000000n;
    this.jobs = [];
    this.steps = [];
    this.ias = [];
    this.items = {};
    this.ib = [];
    this.bb = [];
    this.fifo = [];
    this.wa = [];
    this.mv = [];
    this.batch = [];
    this.locks = [];
    this.bins = {};
    this.writes = [];
    this.crashAfter = 0;
    this.crashed = null;
    this.engineMode = [];
    this.engineCalls = [];
    this.tokenCalls = [];
    this.violations = [];
    this.statusWrites = [];
    this.planThrows = 0;
    this.sqlThrows = {};
    this.dropIaWrites = false;
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }
  dbNow() {
    return fmt(this.now);
  }
  wrote(what) {
    this.writes.push(what);
    if (this.crashAfter && this.writes.length === this.crashAfter) {
      this.crashed = what;
      throw new Error("crash right after write " + this.crashAfter + " (" + what + ")");
    }
  }
  ia(id) {
    return this.ias.find((h) => h.id === s(id) && !h.is_deleted) || null;
  }
  job(id) {
    return this.jobs.find((j) => j.id === s(id)) || null;
  }
  latestLock(iaId) {
    return this.steps.filter((p) => !p.is_deleted && p.job_id === "IAC|" + iaId && /^LOCK\|/.test(p.step_name)).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0] || null;
  }

  // ------------------------------------------------------------------------------------------------------------- shared reads
  owner(iaId) {
    const h = this.ia(iaId);
    const lk = this.latestLock(iaId);
    return [{ db_now: this.dbNow(), ia_id: h ? h.id : null, item_assembly_status: h ? h.item_assembly_status : null, ia_v2_job_id: h ? h.ia_v2_job_id : null,
      stock_movement_no: h ? h.stock_movement_no : null, lock_ref: lk ? lk.result_ref : null, lock_step: lk ? lk.step_name : null }];
  }
  header(iaId) {
    const h = this.ia(iaId);
    if (!h) return [];
    return [J({ id: h.id, item_id: h.item_id, item_qty: num(h.item_qty), item_uom: h.item_uom, location_id: h.location_id, inventory_category: h.inventory_category,
      batch_no: h.batch_no, issuing_operation_faci: h.issuing_operation_faci, organization_id: h.organization_id, stock_movement_no: h.stock_movement_no,
      stock_movement_no_type: null, item_assembly_status: h.item_assembly_status, posted_status: h.posted_status, table_hu: null, item_assembly_date: null, manufacturing_date: null,
      expired_date: null, remarks: null, remarks_2: null, remarks_3: null, ia_v2_job_id: h.ia_v2_job_id })];
  }
  moveRow(m) {
    return drop({ id: m.id, transaction_type: m.transaction_type, movement: m.movement, trx_no: m.trx_no, item_id: m.item_id, plant_id: m.plant_id, bin_location_id: m.bin_location_id,
      batch_number_id: m.batch_number_id || null, handling_unit_id: m.handling_unit_id || null, inventory_category: m.inventory_category, quantity: dec(m.quantity),
      base_qty: dec(m.base_qty), uom_id: m.uom_id, base_uom_id: m.base_uom_id, unit_price: dec(m.unit_price), total_price: dec(m.total_price), costing_method_id: m.costing_method_id });
  }
  moves(iaId) {
    const h = this.ia(iaId);
    if (!h) return [];
    return this.mv.filter((m) => !m.is_deleted && BigInt(m.id) > BigInt(h.id) && m.organization_id === h.organization_id && m.trx_no === h.stock_movement_no
      && ["IA", "IA-R"].indexOf(m.transaction_type) >= 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((m) => this.moveRow(m));
  }
  batchRows(iaId) {
    const h = this.ia(iaId);
    if (!h) return [];
    return this.batch.filter((b) => !b.is_deleted && b.transaction_no === h.stock_movement_no && b.organization_id === h.organization_id)
      .map((b) => J({ id: b.id, batch_number: b.batch_number, material_id: b.material_id, plant_id: b.plant_id, organization_id: b.organization_id, transaction_no: b.transaction_no }));
  }
  itemRow(id) {
    const it = this.items[id];
    return { id: it.id, material_code: it.material_code, material_name: it.material_name, stock_control: it.stock_control, show_delivery: 1, serial_number_management: it.serial ? 1 : 0,
      item_batch_management: it.item_batch_management, batch_number_genaration: null, material_costing_method: it.material_costing_method, purchase_unit_price: s(it.purchase_unit_price || 0),
      assembly_cost: "0.00", based_uom: it.based_uom, table_uom_conversion: (it.uoms || []).map((u) => ({ alt_uom_id: u.alt_uom_id, base_qty: u.base_qty })) };
  }
  jobObj(j) {
    if (!j) return null;
    let req = {};
    try {
      req = JSON.parse(j.request_payload || "{}");
    } catch (e) {
      req = {};
    }
    return JSON.stringify({ id: j.id, command: j.command, job_status: j.job_status, correlation_id: j.correlation_id, progress_percent: j.progress_percent,
      progress_message: j.progress_message, error_code: j.error_code, error_message: j.error_message, line_count: j.line_count, action: req.action || null, ia_no: req.iaNo || null });
  }

  // ------------------------------------------------------------------------------------------------------------- SQL by node id
  sql(nid, text, ctx) {
    if (this.sqlThrows[nid] > 0) {
      this.sqlThrows[nid]--;
      throw new Error(nid + ": the run died");
    }
    const out = (id) => ctx.out[id] || {};
    const m = nid.match(/^sql_node_IV([SPCW])(.*)$/);
    if (!m) return this.classicSql(nid, ctx);
    const [, wf, key] = m;
    if (wf === "S") return this.submitSql(key, out);
    if (wf === "P") return this.prepareSql(key, out);
    if (wf === "C") return this.commitSql(key, out, text);
    return this.workerSql(key, out);
  }
  submitSql(key, out) {
    const g = out("code_node_IVSguard");
    const iaId = s(g.iaId);
    if (key === "facts") {
      const h = this.ia(iaId);
      const kj = this.jobs.filter((j) => !j.is_deleted && j.idempotency_key === g.key).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
      const mine = this.jobs.filter((j) => !j.is_deleted && ["COMPLETE_IA", "REVERT_IA"].indexOf(j.command) >= 0 && j.correlation_id === "IA|" + iaId);
      const open = mine.filter((j) => OPEN.indexOf(j.job_status) >= 0);
      const last = mine.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
      const link = h && h.ia_v2_job_id ? this.job(h.ia_v2_job_id) : null;
      const lk = this.latestLock(iaId);
      const lockJob = lk ? this.jobs.filter((j) => !j.is_deleted && j.idempotency_key === lk.result_ref).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0] : null;
      return [{ db_now: this.dbNow(), key_job: kj ? this.jobObj(kj) : null, ia_id: h ? h.id : null, stock_movement_no: h ? h.stock_movement_no : null,
        item_assembly_status: h ? h.item_assembly_status : null, posted_status: h ? h.posted_status : null, organization_id: h ? h.organization_id : null,
        plant_id: h ? h.issuing_operation_faci : null, no_type: null, ia_v2_job_id: h ? h.ia_v2_job_id : null,
        ia_lock: lk ? JSON.stringify({ step: lk.step_name, ref: lk.result_ref, young: lk.started_at > this.now - 120000 ? 1 : 0, job: lockJob ? lockJob.job_status : null }) : null,
        open_jobs: open.length ? "[" + open.map((j) => this.jobObj(j)).join(",") + "]" : null, last_job: last ? this.jobObj(last) : null, link_job: link ? this.jobObj(link) : null,
        issued_by_job: 0, completed_under: 0, batch_cfg: JSON.stringify({ n: 0, level: null, date_format: null }) }];
    }
    if (key === "hdr") return this.header(iaId);
    if (key === "moves") return this.moves(iaId);
    if (key === "batch") return this.batchRows(iaId);
    if (key === "serial") {
      const ids = new Set(this.moves(iaId).map((r) => r.item_id));
      return Object.values(this.items).filter((it) => it.serial && ids.has(it.id)).map((it) => ({ id: it.id }));
    }
    if (key === "backia") return this.owner(iaId);
    if (key === "backjob") {
      const kj = this.jobs.filter((j) => !j.is_deleted && j.idempotency_key === g.key).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
      return kj ? [{ job_id: kj.id, job_status: kj.job_status, command: kj.command, correlation_id: kj.correlation_id, line_count: kj.line_count }] : [];
    }
    throw new Error("no SUBMIT SQL mock for " + key);
  }
  prepareSql(key, out) {
    const g = out("code_node_IVPguard");
    const e = out("code_node_IVPentry");
    const p = out("code_node_IVPprep");
    const iaId = s(e.iaId);
    const ids = (csv) => s(csv).split(",").filter((x) => x && x !== "0");
    if (key === "job") {
      const j = this.job(g.jobId);
      return [{ db_now: this.dbNow(), id: j ? j.id : null, organization_id: j ? j.organization_id : null, command: j ? j.command : null, job_status: j ? j.job_status : null,
        lease_owner: j ? j.lease_owner : null, lease_live: j && j.lease_expires_at !== null && j.lease_expires_at > this.now ? 1 : 0, row_version: j ? j.row_version : null,
        attempt_count: j ? j.attempt_count : null, idempotency_key: j ? j.idempotency_key : null, correlation_id: j ? j.correlation_id : null,
        request_payload: j ? j.request_payload : null, is_deleted: j ? j.is_deleted : null }];
    }
    if (key === "own") return this.owner(iaId);
    if (key === "hdr") return this.header(iaId);
    if (key === "moves") return this.moves(iaId);
    if (key === "batch") return this.batchRows(iaId);
    const org = s(p.orgSql);
    const plant = s(p.plantIdSql);
    const assembled = ids(p.assembledIdsCsv);
    if (key === "fifo") {
      return this.fifo.filter((f) => !f.is_deleted && BigInt(f.id) > BigInt(p.iaIdSql) && f.organization_id === org && f.plant_id === plant && assembled.indexOf(f.material_id) >= 0)
        .map((f) => drop({ id: f.id, material_id: f.material_id, batch_id: f.batch_id || null, fifo_cost_price: dec(f.fifo_cost_price), fifo_initial_quantity: dec(f.fifo_initial_quantity),
          fifo_available_quantity: dec(f.fifo_available_quantity), fifo_sequence: s(f.fifo_sequence) }));
    }
    if (key === "wa") {
      return this.wa.filter((w) => !w.is_deleted && w.organization_id === org && w.plant_id === plant && assembled.indexOf(w.material_id) >= 0 && (!w.batch_id || BigInt(w.id) > BigInt(p.iaIdSql)))
        .map((w) => drop({ id: w.id, material_id: w.material_id, batch_id: w.batch_id || null, wa_quantity: dec(w.wa_quantity), wa_cost_price: dec(w.wa_cost_price) }));
    }
    if (key === "costcounts") {
      const items = ids(p.itemIdsCsv);
      const rows = [];
      for (const [t, list] of [["FIFO", this.fifo], ["WA", this.wa]]) {
        const by = {};
        for (const r of list) if (!r.is_deleted && r.organization_id === org && r.plant_id === plant && items.indexOf(r.material_id) >= 0) by[r.material_id] = (by[r.material_id] || 0) + 1;
        for (const k of Object.keys(by)) rows.push({ t: t, material_id: k, cnt: by[k] });
      }
      return rows;
    }
    const bal = (b, batch) => J(Object.assign({ id: b.id, material_id: b.material_id, location_id: b.location_id }, batch ? { batch_id: b.batch_id } : {},
      { plant_id: b.plant_id, organization_id: b.organization_id }, ...QTY.map((c) => ({ [c]: Number(b[c] || 0) }))));
    if (key === "itembal") return this.ib.filter((b) => !b.is_deleted && assembled.indexOf(b.material_id) >= 0 && b.plant_id === plant && b.organization_id === org).map((b) => bal(b, false));
    if (key === "batchbal") return this.bb.filter((b) => !b.is_deleted && ids(p.batchIdsCsv).indexOf(b.batch_id) >= 0 && b.plant_id === plant && b.organization_id === org).map((b) => bal(b, true));
    if (key === "items") return ids(p.itemIdsCsv).filter((id) => this.items[id]).map((id) => J(this.itemRow(id)));
    if (key === "bins") return ids(p.binIdsCsv).map((id) => J({ id: id, bin_location_combine: this.bins[id] || "BIN-" + id.slice(-4) }));
    if (key === "back" || key === "backP") {
      const j = this.job(g.jobId);
      return j ? [{ id: j.id, job_status: j.job_status, progress_message: j.progress_message, error_code: j.error_code, error_message: j.error_message }] : [];
    }
    throw new Error("no PREPARE SQL mock for " + key);
  }
  partRows(jobId, prefix) {
    return this.steps.filter((r) => !r.is_deleted && r.job_id === jobId && r.step_name.indexOf(prefix) === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1))
      .map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
  }
  lockRows(org, keysJson, live) {
    const keys = JSON.parse(keysJson || "[]").map((k) => k.toUpperCase());
    return this.locks.filter((l) => l.organization_id === org && keys.indexOf(l.lock_key.toUpperCase()) >= 0 && (!live || !l.is_deleted)).sort((a, b) => (a.lock_key < b.lock_key ? -1 : 1));
  }
  commitSql(key, out, text) {
    const g = out("code_node_IVCguard");
    const e = out("code_node_IVCentry");
    const j = this.job(g.jobId);
    const jobId = s(g.jobId);
    const ids = (csv) => s(csv).split(",").filter((x) => x && x !== "0");
    if (key === "job") {
      let prev = null;
      try {
        prev = j ? JSON.parse(j.request_payload).prevStatus : null;
      } catch (x) {
        prev = null;
      }
      return [{ db_now: this.dbNow(), lease_until: fmt(this.now + 600000), id: j ? j.id : null, organization_id: j ? j.organization_id : null, command: j ? j.command : null,
        job_status: j ? j.job_status : null, progress_percent: j ? j.progress_percent : null, progress_message: j ? j.progress_message : null, attempt_count: j ? j.attempt_count : null,
        next_attempt_at: j ? fmt(j.next_attempt_at) : null, lease_owner: j ? j.lease_owner : null, lease_expires_at: j ? fmt(j.lease_expires_at) : null,
        lease_live: j && j.lease_expires_at !== null && j.lease_expires_at > this.now ? 1 : 0, due: j && (j.next_attempt_at === null || j.next_attempt_at <= this.now) ? 1 : 0,
        row_version: j ? j.row_version : null, error_code: j ? j.error_code : null, error_message: j ? j.error_message : null, error_details: j ? j.error_details : null,
        idempotency_key: j ? j.idempotency_key : null, correlation_id: j ? j.correlation_id : null, is_deleted: j ? j.is_deleted : null, line_count: j ? j.line_count : null,
        prev_status: prev === undefined ? null : prev }];
    }
    if (key === "steps") return this.steps.filter((r) => !r.is_deleted && r.job_id === jobId && /^V[0-9]_/.test(r.step_name)).map((r) => ({ step_name: r.step_name, step_status: r.step_status, finished_at: r.finished_at }));
    if (key === "payload") return j ? [{ prepared_payload: j.prepared_payload }] : [];
    if (key === "ia") {
      const mm = j && s(j.correlation_id).match(/^IA\|([0-9]+)$/);
      if (!mm || !this.ia(mm[1])) return [];
      const o = this.owner(mm[1])[0];
      return [{ ia_id: o.ia_id, item_assembly_status: o.item_assembly_status, ia_v2_job_id: o.ia_v2_job_id, stock_movement_no: o.stock_movement_no, lock_ref: o.lock_ref }];
    }
    if (key === "own") return j ? [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }] : [];
    const part = text.match(/LIKE CONCAT\('([^']*)',\s*'([A-Z]+)\|%'\)/);
    if (part) return this.partRows(jobId, part[1] + part[2] + "|");
    if (key === "v0moves") return this.moves(e.iaId);
    if (key === "v1ops") return [{ intents: this.steps.filter((r) => !r.is_deleted && r.job_id === "IAV|" + jobId && /^IBA\|I\|/.test(r.step_name)).length }];
    if (key === "ops") {
      if (text.indexOf("'IAV|" + jobId + "'") < 0 || text.indexOf("IBA|DONE") < 0) throw new Error("ops: the read does not name IAV|" + jobId + " and its DONE row");
      return [{ op_rows: this.steps.filter((r) => !r.is_deleted && r.job_id === "IAV|" + jobId && (/^IBA\|I\|/.test(r.step_name) || r.step_name === "IBA|DONE")).length }];
    }
    const k = out("code_node_IVCv2lkeys");
    if (key === "v2lk1") return this.lockRows(e.organizationId, k.keysJson, false).map((l) => ({ id: l.id, lock_key: l.lock_key, is_deleted: l.is_deleted }));
    if (key === "v2lk2") return this.lockRows(e.organizationId, k.keysJson, true).map((l) => ({ id: l.id, lock_key: l.lock_key, free_token: l.free_token, owner_operation_id: l.owner_operation_id,
      last_owner_operation_id: l.last_owner_operation_id, db_now: this.dbNow() }));
    if (key === "v2lk3") return this.lockRows(e.organizationId, k.keysJson, true).map((l) => ({ id: l.id, lock_key: l.lock_key, free_token: l.free_token, owner_operation_id: l.owner_operation_id }));
    if (/rel$|finback$/.test(key)) {
      const op = "IAV|" + jobId + "|C";
      if (text.indexOf("'" + op + "'") < 0) throw new Error(key + ": the release read does not name " + op);
      return this.locks.filter((l) => !l.is_deleted && l.organization_id === e.organizationId && l.balance_type === "COST" && Number(l.free_token) === 0
        && (l.owner_operation_id === op || (!l.owner_operation_id && l.last_owner_operation_id === op))).sort((a, b) => (a.lock_key < b.lock_key ? -1 : 1))
        .map((l) => ({ id: l.id, lock_key: l.lock_key, free_token: l.free_token, owner_operation_id: l.owner_operation_id, last_owner_operation_id: l.last_owner_operation_id,
          lock_version: l.lock_version, db_now: this.dbNow() }));
    }
    const v2 = out("code_node_IVCv2in");
    if (key === "v2fifo" || key === "v2fifoB") return this.fifo.filter((f) => ids(v2.fifoIdsSql).indexOf(f.id) >= 0).map((f) => J({ id: f.id, material_id: f.material_id,
      fifo_initial_quantity: Number(f.fifo_initial_quantity), fifo_available_quantity: Number(f.fifo_available_quantity), is_deleted: f.is_deleted ? 1 : 0 }));
    if (key === "v2wa" || key === "v2waB") return this.wa.filter((w) => ids(v2.waIdsSql).indexOf(w.id) >= 0).map((w) => J({ id: w.id, material_id: w.material_id, batch_id: w.batch_id || null,
      wa_quantity: Number(w.wa_quantity), wa_cost_price: Number(w.wa_cost_price), is_deleted: w.is_deleted ? 1 : 0 }));
    const v3 = out("code_node_IVCv3in");
    if (key === "v3batch" || key === "v3batchB") return this.batch.filter((b) => ids(v3.idsSql).indexOf(b.id) >= 0).map((b) => J({ id: b.id, is_deleted: b.is_deleted ? 1 : 0 }));
    if (key === "v4now" || key === "v4back") {
      const h = this.ia(e.iaId);
      const lk = this.latestLock(e.iaId);
      return h ? [{ ia_id: h.id, item_assembly_status: h.item_assembly_status, posted_status: h.posted_status, ia_v2_job_id: h.ia_v2_job_id, lock_ref: lk ? lk.result_ref : null }] : [];
    }
    throw new Error("no COMMIT SQL mock for " + key);
  }
  wjob(j) {
    let prev = null;
    let iaId = "0";
    if (j) {
      try {
        prev = JSON.parse(j.request_payload).prevStatus;
      } catch (x) {
        prev = null;
      }
      const mm = s(j.correlation_id).match(/^IA\|([0-9]{1,20})$/);
      // IA_LOCK_JOIN (CONTRACT.md section 8, ruling 5): a soft-deleted IA does not join
      const h = mm ? this.ias.find((x) => x.id === mm[1] && !x.is_deleted) : null;
      const lk = mm ? this.latestLock(mm[1]) : null;
      iaId = h && h.item_assembly_status === "Processing" && lk && lk.result_ref === j.idempotency_key ? h.id : "0";
    }
    const claim = j ? this.steps.find((c) => !c.is_deleted && c.job_id === j.id && c.step_name === "W0_CLAIM_" + j.row_version) : null;
    return { id: j ? j.id : null, organization_id: j ? j.organization_id : null, ia_id: j ? iaId : null, prev_status: prev === undefined ? null : prev, job_status: j ? j.job_status : null,
      progress_percent: j ? j.progress_percent : null, progress_message: j ? j.progress_message : null, attempt_count: j ? j.attempt_count : null, next_attempt_at: j ? fmt(j.next_attempt_at) : null,
      lease_owner: j ? j.lease_owner : null, lease_expires_at: j ? fmt(j.lease_expires_at) : null, lease_live: j && j.lease_expires_at !== null && j.lease_expires_at > this.now ? 1 : 0,
      dead_lease: j && j.lease_owner && j.lease_expires_at !== null && j.lease_expires_at <= this.now ? 1 : 0, due_now: j && (j.next_attempt_at === null || j.next_attempt_at <= this.now) ? 1 : 0,
      row_version: j ? j.row_version : null, error_code: j ? j.error_code : null, error_message: j ? j.error_message : null, error_details: j ? j.error_details : null,
      claim_id: claim ? claim.id : null, claim_started_at: claim ? fmt(claim.started_at) : null, claim_owner: claim ? claim.result_ref : null,
      claim_live: claim && claim.started_at > this.now - 600000 ? 1 : 0, finished_at: j ? j.finished_at : null };
  }
  workerSql(key, out) {
    const g = out("code_node_IVWguard");
    const plan = out("code_node_IVWplan");
    const pick = out("code_node_IVWpick");
    const planned = s(plan.jobIdsSql).split(",").filter((x) => x && x !== "0");
    if (key === "poll") {
      const rows = this.jobs.filter((j) => !j.is_deleted && j.command === "REVERT_IA" && (s(g.jobId) === "0" || j.id === s(g.jobId)) && STATES.indexOf(j.job_status) >= 0
        && (j.lease_expires_at === null || j.lease_expires_at <= this.now) && (j.next_attempt_at === null || j.next_attempt_at <= this.now))
        .filter((j) => {
          const c = this.steps.find((x) => !x.is_deleted && x.job_id === j.id && x.step_name === "W0_CLAIM_" + j.row_version);
          return !c || c.started_at <= this.now - 600000;
        }).sort((a, b) => a.create_time - b.create_time || (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).slice(0, 5);
      if (!rows.length) return [{ db_now: this.dbNow() }];
      return rows.map((j) => Object.assign({ db_now: this.dbNow() }, this.wjob(j)));
    }
    if (key === "tick") {
      const rows = planned.map((id) => this.job(id)).filter((j) => j && !j.is_deleted);
      if (!rows.length) return [{ db_now: this.dbNow(), lease_until: fmt(this.now + 600000) }];
      return rows.map((j) => Object.assign({ db_now: this.dbNow(), lease_until: fmt(this.now + 600000) }, this.wjob(j)));
    }
    if (["own", "prepBack", "mid", "pubBack", "split", "pub2Back"].indexOf(key) >= 0) {
      const j = this.job(pick.jobId);
      return [Object.assign({ db_now: this.dbNow() }, this.wjob(j))];
    }
    if (key === "final") return planned.map((id) => this.job(id)).filter((j) => j).map((j) => ({ id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner,
      error_code: j.error_code, error_message: j.error_message, ia_id: s(j.correlation_id).slice(3) }));
    throw new Error("no WORKER SQL mock for " + key);
  }
  // the classic IA_REVERT v5's sql-nodes (its own SQL, read by the tokens the classic's prep node gave)
  classicSql(nid, ctx) {
    const P = ctx.out.code_node_iaRvParams || {};
    const p = ctx.out.code_node_iaRvPrep || {};
    const ids = (csv) => s(csv).split(",").filter((x) => x && x !== "0");
    if (nid === "sql_node_iaRvMovs") {
      return this.mv.filter((m) => !m.is_deleted && BigInt(m.id) > BigInt(P.iaIdSql || 0) && m.organization_id === P.orgSql && m.trx_no === P.iaNoSql && ["IA", "IA-R"].indexOf(m.transaction_type) >= 0)
        .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((m) => this.moveRow(m));
    }
    const fake = { code_node_IVPprep: { iaIdSql: p.iaIdSql, orgSql: p.orgSql, plantIdSql: p.plantIdSql, assembledIdsCsv: p.assembledIdsCsv, itemIdsCsv: p.itemIdsCsv } };
    const out = (id) => fake[id] || {};
    if (nid === "sql_node_iaRvFifo") return this.prepareSql("fifo", out);
    if (nid === "sql_node_iaRvWa") return this.prepareSql("wa", out);
    if (nid === "sql_node_iaRvCostCounts") return this.prepareSql("costcounts", out);
    throw new Error("no classic SQL mock for " + nid + " " + ids("").length);
  }
  // the classic's get / search nodes (the platform shapes: { count, data } / { total, count, data })
  read(nid, ctx) {
    const P = ctx.out.code_node_iaRvParams || {};
    const p = ctx.out.code_node_iaRvPrep || {};
    const list = (v) => (Array.isArray(v) ? v : []).filter((x) => x !== "-1");
    const search = (rows) => ({ total: rows.length, count: rows.length, data: rows });
    if (nid === "get_node_iaRvIa") {
      const h = this.ia(P.iaId);
      if (!h || h.organization_id !== s(P.organizationId)) return { count: 0, data: {} };
      return { count: 1, data: { id: h.id, item_id: h.item_id, item_assembly_status: h.item_assembly_status, posted_status: h.posted_status, issuing_operation_faci: h.issuing_operation_faci,
        organization_id: h.organization_id, stock_movement_no: h.stock_movement_no } };
    }
    if (nid === "search_node_iaRvBatch") return search(this.batch.filter((b) => !b.is_deleted && b.transaction_no === s(P.iaNo) && b.organization_id === s(P.organizationId))
      .map((b) => ({ id: b.id, batch_number: b.batch_number, material_id: b.material_id, plant_id: b.plant_id, organization_id: b.organization_id, transaction_no: b.transaction_no })));
    const balOf = (b, batch) => Object.assign({ id: b.id, material_id: b.material_id, location_id: b.location_id }, batch ? { batch_id: b.batch_id } : {}, { plant_id: b.plant_id,
      organization_id: b.organization_id }, ...QTY.map((c) => ({ [c]: Number(b[c] || 0) })));
    if (nid === "search_node_iaRvItemBal") return search(this.ib.filter((b) => !b.is_deleted && list(p.assembledIds).indexOf(b.material_id) >= 0 && b.plant_id === s(p.plantId)
      && b.organization_id === s(p.organizationId)).map((b) => balOf(b, false)));
    if (nid === "search_node_iaRvBatchBal") return search(this.bb.filter((b) => !b.is_deleted && list(p.batchIds).indexOf(b.batch_id) >= 0 && b.plant_id === s(p.plantId)
      && b.organization_id === s(p.organizationId)).map((b) => balOf(b, true)));
    if (nid === "search_node_iaRvHu") return search([]);
    if (nid === "search_node_iaRvItems") return search(list(p.itemIds).filter((id) => this.items[id]).map((id) => this.itemRow(id)));
    throw new Error("no classic read mock for " + nid);
  }

  // ------------------------------------------------------------------------------------------------------------- writes
  insert(table, rows) {
    const out = [];
    for (const r0 of rows) {
      const r = Object.assign({}, r0);
      delete r.__id;
      if (table === "GD Async Job") {
        if (this.jobs.some((j) => !j.is_deleted && j.organization_id === r.organization_id && j.idempotency_key === r.idempotency_key)) throw new Error("Duplicate entry for key 'Idempotency Key'");
        Object.assign(r, { id: this.id(), is_deleted: 0, create_time: this.now, next_attempt_at: parse(r.next_attempt_at), lease_owner: null, lease_expires_at: null, error_code: null,
          error_message: null, error_details: null, finished_at: null, prepared_payload: null });
        this.jobs.push(r);
      } else if (table === "GD Publish Step") {
        if (this.steps.some((x) => !x.is_deleted && x.job_id === s(r.job_id) && x.step_name === r.step_name)) throw new Error("Duplicate entry '" + r.job_id + "-" + r.step_name + "' for key 'Job Step'");
        Object.assign(r, { id: this.id(), job_id: s(r.job_id), is_deleted: 0, started_at: r.started_at ? parse(r.started_at) : this.now });
        this.steps.push(r);
      } else if (table === "Inventory Balance Lock") {
        if (this.locks.some((l) => l.organization_id === r.organization_id && l.lock_key.toUpperCase() === s(r.lock_key).toUpperCase())) throw new Error("Duplicate entry for key 'Lock Key'");
        Object.assign(r, { id: this.id(), is_deleted: 0, free_token: Number(r.free_token), lock_version: Number(r.lock_version) || 0 });
        this.locks.push(r);
      } else throw new Error("insert into " + table + " not simulated");
      out.push(r);
    }
    this.wrote("insert " + table + " x" + rows.length + (table === "GD Publish Step" ? " (" + rows.map((x) => x.step_name).join(",") + ")" : ""));
    return out;
  }
  update(table, rows) {
    let n = 0;
    for (const r0 of rows) {
      const id = s(r0.__id);
      const set = Object.assign({}, r0);
      delete set.__id;
      delete set.id;
      const find = (list) => list.find((x) => x.id === id);
      let row = null;
      if (table === "GD Async Job") row = find(this.jobs);
      else if (table === "Item Assembly") {
        row = find(this.ias);
        if (this.dropIaWrites) row = null;
      }
      else if (table === "FIFO Costing History") row = find(this.fifo);
      else if (table === "Weighted Average Costing History") row = find(this.wa);
      else if (table === "Batch") row = find(this.batch);
      else if (table === "Inventory Balance Lock") row = find(this.locks);
      else throw new Error("update of " + table + " not simulated");
      if (!row) continue;
      for (const k of Object.keys(set)) {
        let v = set[k];
        if (table === "GD Async Job" && (k === "next_attempt_at" || k === "lease_expires_at")) v = parse(v);
        if (k === "is_deleted" || k === "free_token" || k === "lock_version") v = Number(v);
        row[k] = v === undefined ? null : v;
      }
      if (table === "Item Assembly" && "item_assembly_status" in set) this.statusWrites.push({ id: id, status: set.item_assembly_status, deleted: row.is_deleted });
      n++;
    }
    this.wrote("update " + table + " x" + rows.length);
    return { count: n };
  }

  // ------------------------------------------------------------------------------------------------------------- callees
  engine(params) {
    const op = s(params.operation_key);
    const mode = s(params.mode).toUpperCase();
    const forced = mode === "APPLY" && this.engineMode.length ? this.engineMode.shift() : "";
    this.engineCalls.push({ op: op, mode: mode, forced: forced, n: Array.isArray(params.movements) ? params.movements.length : 0 });
    if (mode === "PLAN" && this.planThrows > 0) {
      this.planThrows--;
      throw new Error("the engine's PLAN run died");
    }
    const costOwner = op + "|C";
    if (this.locks.some((l) => l.owner_operation_id === costOwner && Number(l.free_token) === 0)) this.violations.push("engine " + op + " ran while " + costOwner + " held a COST lock");
    if (forced === "409") return { code: "409", result_code: "LOCK_BUSY", message: "COST|x|y held by GDC|9" };
    if (forced === "500") return { code: "500", result_code: "REQUIRES_REVIEW", message: "boom" };
    if (forced === "none") return null;
    if (forced === "env400") return { code: 400, success: false, data: null, msg: "An error occurred" };
    const g = ENGINE.bulkGuard({ mode: mode, operationKey: op, organizationId: params.organization_id, movements: params.movements, tenantId: T, uuid: "00ff00ff00ff" });
    if (g.route === "REJECT") return { code: "400", result_code: g.result_code, message: g.result_message };
    const opSteps = this.steps.filter((r) => !r.is_deleted && r.job_id === op);
    const done = opSteps.find((r) => r.step_name === "IBA|DONE");
    if (mode === "APPLY" && done) {
      const st = JSON.parse(done.result_ref);
      return { code: "200", result_code: "REPLAYED", message: "Already applied", results: st.results, summary: st.summary };
    }
    if (mode === "APPLY" && opSteps.some((r) => r.step_name === "IBA|REVIEW")) return { code: "500", result_code: "REQUIRES_REVIEW", message: "under review" };
    if (mode === "APPLY") {
      for (const key of g.lockKeys) {
        const l = this.locks.find((x) => x.organization_id === s(params.organization_id) && x.lock_key.toUpperCase() === key.toUpperCase());
        if (l && Number(l.free_token) === 0 && l.owner_operation_id !== op) return { code: "409", result_code: "LOCK_BUSY", message: key + " held by " + (l.owner_operation_id || "a cleared owner") };
      }
    }
    const mats = g.materialIdsCsv.split(",");
    const items = mats.filter((m) => this.items[m]).map((m) => {
      const it = this.items[m];
      return { id: it.id, item_batch_management: it.item_batch_management, stock_control: it.stock_control, based_uom: it.based_uom, material_costing_method: it.material_costing_method,
        purchase_unit_price: s(it.purchase_unit_price || 0), uom_conversion_json: JSON.stringify(it.uoms || []) };
    });
    const sv = (o) => Object.assign({}, o, ...QTY.map((c) => ({ [c]: s(Number(o[c] || 0)) })));
    const plan = ENGINE.bulkPlan({ route: mode === "PLAN" ? "PLAN" : "FRESH", dbNow: this.dbNow(), intentText: "", operationKey: op, organizationId: s(params.organization_id),
      movements: params.movements, lockRoute: "HELD", items: items,
      itemBalances: this.ib.filter((b) => !b.is_deleted && mats.indexOf(b.material_id) >= 0).map(sv), batchBalances: this.bb.filter((b) => !b.is_deleted && mats.indexOf(b.material_id) >= 0).map(sv),
      fifoLayers: this.fifo.filter((f) => !f.is_deleted && mats.indexOf(f.material_id) >= 0).map((f) => Object.assign({}, f, { batch_id: f.batch_id || "0" })),
      waRows: this.wa.filter((w) => !w.is_deleted && mats.indexOf(w.material_id) >= 0).map((w) => Object.assign({}, w, { batch_id: w.batch_id || "0" })),
      existingMovements: this.mv.filter((m) => s(m.operation_effect_key).indexOf(op + "|") === 0).map((m) => ({ operation_effect_key: m.operation_effect_key })), precision: [] });
    if (plan.route === "FAIL") return { code: "400", result_code: plan.result_code, message: plan.result_message, results: plan.results };
    if (plan.route === "PLAN_OK") return { code: "200", result_code: "OK", message: plan.result_message, results: plan.results, summary: plan.summary };
    if (plan.route !== "WRITE") return { code: "500", result_code: plan.result_code || "REQUIRES_REVIEW", message: plan.result_message || plan.route };
    // the writes of the engine's APPLY, then its intent / DONE rows (the operation is replayable from here on)
    const byId = (list, id) => list.find((x) => x.id === s(id));
    for (const u of plan.ib) Object.assign(byId(this.ib, u.id), ...QTY.filter((c) => c in u).map((c) => ({ [c]: Number(u[c]) })));
    for (const u of plan.bb.concat(plan.bbr)) Object.assign(byId(this.bb, u.id), ...QTY.filter((c) => c in u).map((c) => ({ [c]: Number(u[c]) })));
    for (const u of plan.ff) byId(this.fifo, u.id).fifo_available_quantity = Number(u.fifo_available_quantity);
    for (const u of plan.wa) Object.assign(byId(this.wa, u.id), { wa_quantity: Number(u.wa_quantity), wa_cost_price: Number(u.wa_cost_price) });
    for (const r of plan.ibNew) this.ib.push(Object.assign({}, r, { id: this.id(), is_deleted: 0 }, ...QTY.map((c) => ({ [c]: Number(r[c] || 0) }))));
    for (const r of plan.bbNew) this.bb.push(Object.assign({}, r, { id: this.id(), is_deleted: 0 }, ...QTY.map((c) => ({ [c]: Number(r[c] || 0) }))));
    for (const r of plan.ffNew) this.fifo.push(Object.assign({}, r, { id: this.id(), is_deleted: 0, batch_id: r.batch_id || null, fifo_initial_quantity: Number(r.fifo_initial_quantity),
      fifo_available_quantity: Number(r.fifo_available_quantity), fifo_cost_price: Number(r.fifo_cost_price) }));
    for (const r of plan.waNew) this.wa.push(Object.assign({}, r, { id: this.id(), is_deleted: 0, batch_id: r.batch_id || null, wa_quantity: Number(r.wa_quantity), wa_cost_price: Number(r.wa_cost_price) }));
    for (const r of plan.mv) this.mv.push(Object.assign({}, r, { id: this.id(), is_deleted: 0, quantity: Number(r.quantity), base_qty: Number(r.base_qty), unit_price: Number(r.unit_price),
      total_price: Number(r.total_price) }));
    this.steps.push({ id: this.id(), job_id: op, step_name: "IBA|I|001", step_status: "INTENT", result_ref: "{}", is_deleted: 0, started_at: this.now });
    this.steps.push({ id: this.id(), job_id: op, step_name: "IBA|DONE", step_status: "DONE", result_ref: JSON.stringify({ results: plan.results, summary: plan.summary }), is_deleted: 0,
      started_at: this.now });
    // its lock rows exist afterwards, given back (last owner = the operation)
    for (const key of g.lockKeys) {
      let l = this.locks.find((x) => x.organization_id === s(params.organization_id) && x.lock_key.toUpperCase() === key.toUpperCase());
      if (!l) {
        l = { id: this.id(), organization_id: s(params.organization_id), lock_key: key, balance_type: key.split("|")[0], free_token: 1, lock_version: 0, owner_operation_id: "",
          last_owner_operation_id: "", is_deleted: 0 };
        this.locks.push(l);
      }
      Object.assign(l, { free_token: 1, owner_operation_id: "", last_owner_operation_id: op, lock_version: l.lock_version + 2 });
    }
    this.wrote("engine " + op);
    if (forced === "applied-none") return null;
    return { code: "200", result_code: "OK", message: "Applied " + plan.results.length + " movements", results: plan.results, summary: plan.summary };
  }
  tokens(params) {
    const op = s(params.operation_id);
    const mode = s(params.mode).toUpperCase();
    this.tokenCalls.push({ mode: mode, op: op, ids: (params.ids || []).slice() });
    if (mode === "TAKE") {
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(s(params.claimed_at))) throw new Error("INV_LOCK_TOKENS_INPUT: claimed_at must be YYYY-MM-DD HH:MM:SS for TAKE");
      const engineOp = op.replace(/\|C$/, "");
      if (this.locks.some((l) => l.owner_operation_id === engineOp && Number(l.free_token) === 0)) this.violations.push("TAKE " + op + " while the engine operation " + engineOp + " holds a lock");
      for (const id of params.ids) {
        const l = this.locks.find((x) => x.id === s(id));
        if (!l || Number(l.free_token) !== 1) throw new Error("INVENTORY_LOCK_TOKENS: the take of " + id + " failed (token " + (l ? l.free_token : "none") + ")");
        Object.assign(l, { free_token: 0, owner_operation_id: op, claimed_at: params.claimed_at, lock_version: l.lock_version + 1 });
      }
      this.wrote("TAKE " + op);
      return { mode: "TAKE", operation_id: op, requested: params.ids.length, applied: params.ids.length, skipped: "[]", result_code: "TAKEN" };
    }
    if (s(params.claimed_at) !== "") throw new Error("INV_LOCK_TOKENS_INPUT: claimed_at must be empty for GIVE");
    let applied = 0;
    for (const id of params.ids) {
      const l = this.locks.find((x) => x.id === s(id));
      if (l && Number(l.free_token) === 0 && !l.owner_operation_id && l.last_owner_operation_id === op) {
        l.free_token = 1;
        applied++;
      }
    }
    this.wrote("GIVE " + op);
    return { mode: "GIVE", operation_id: op, requested: params.ids.length, applied: applied, skipped: "[]", result_code: applied === params.ids.length ? "GIVEN" : "GIVEN_WITH_SKIPS" };
  }
  // the classic's per-movement callees as one-movement core calls (SUBTRACT_INVENTORY / ADD_INVENTORY are what the core replays)
  classicCall(kind, params) {
    const m = { movement_key: "C" + (this.engineCalls.length + 1), direction: kind === "SUBTRACT_INVENTORY" ? "SUBTRACT" : "ADD", plant_id: s(params.plant_id), organization_id: s(params.organization_id),
      material_id: s(params.material_id), quantity: params.quantity, material_uom: s(params.material_uom), unit_price: params.unit_price, transaction_type: params.transaction_type,
      trx_no: params.trx_no, inventory_category: params.inventory_category, location_id: s(params.location_id), batch_id: params.batch_id || null, doc_date: params.doc_date,
      isMovingInv: Number(params.isMovingInv), parent_trx_no: "" };
    if (m.direction === "ADD") m.batch_number = params.batch_number;
    const a = this.engine({ operation_key: "CLS|" + this.id().slice(-12), mode: "APPLY", organization_id: m.organization_id, movements: [m] });
    return { code: s(a && a.code) || "500", message: a && a.message };
  }
}

// the interpreter with a distinct uuid per run (its own pads the counter with "a": every run's first 8 characters would repeat)
const crypto = require("crypto");
let uuidN = 0;
class SimEngine extends Engine {
  run(name, params) {
    const wf = this.load(name);
    const ctx = { name: name, params: params || {}, out: {}, loops: {}, uuid: crypto.createHash("md5").update("run" + ++uuidN).digest("hex") + "bbbbbbbb", bytes: 0 };
    try {
      this.block(wf.nodes, ctx);
      return { returned: null, ctx: ctx };
    } catch (e) {
      if (e && e.constructor && e.constructor.name === "Stop") return { returned: e.value, ctx: ctx };
      throw e;
    } finally {
      this.sizes[name] = Math.max(this.sizes[name] || 0, ctx.bytes);
    }
  }
}

// a deep copy of a world (same tables, ids, clock) for twin runs
function cloneWorld(w) {
  const c = new World();
  for (const k of Object.keys(w)) c[k] = typeof w[k] === "bigint" ? w[k] : JSON.parse(JSON.stringify(w[k] === undefined ? null : w[k]));
  return c;
}

// one run of a built workflow on the interpreter against the world; callees by name (the V2 workflows nest on the same engine)
function runWorkflow(w, name, params, dir) {
  const e = new SimEngine({ dir: dir || OUT, db: { tenantId: T, insert: (t, rows) => w.insert(t, rows), update: (t, rows) => w.update(t, rows) },
    mocks: { sql: new Proxy({}, { get: (_, id) => (text, ctx) => w.sql(String(id), text, ctx) }), read: new Proxy({}, { get: (_, id) => (v, ctx) => w.read(String(id), ctx) }) } });
  const run0 = e.run.bind(e);
  e.run = (n, p) => {
    if (n === "INVENTORY_BULK_APPLY") return { returned: w.engine(p), ctx: {} };
    if (n === "INVENTORY_LOCK_TOKENS") return { returned: w.tokens(p), ctx: {} };
    if (n === "SUBTRACT_INVENTORY" || n === "ADD_INVENTORY") return { returned: w.classicCall(n, p), ctx: {} };
    if (n === "HANDLING_UNIT") throw new Error("HANDLING_UNIT is not simulated");
    return run0(n, p);
  };
  let out = null;
  let err = null;
  try {
    out = e.run(name, params).returned;
  } catch (x) {
    err = x.message;
  }
  return { out: out, err: err, sizes: e.sizes, trace: e.trace };
}

module.exports = { World, runWorkflow, cloneWorld, fmt, parse, dec, T, OUT };
