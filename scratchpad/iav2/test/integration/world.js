// Integration world (plan.md Task F): ONE in-memory BladeX on which every BUILT Item Assembly V2 workflow runs - completion
// (IA_V2_SUBMIT / WORKER / PREPARE / COMMIT), Revert V2 (IA_REVERT_V2_*) and the classic IA_REVERT v5 - so a document completed by
// C's COMMIT is what F's revert reads. Base: F's world (test/revert/_world.js, required read-only: the revert SQL, the classic's
// reads, INVENTORY_BULK_APPLY = the deployed v10 guard + core, INVENTORY_LOCK_TOKENS, SUBTRACT_ / ADD_INVENTORY as one-movement core
// calls). Added here: the component lines, the IA numbering rule, GENERATE_BATCH, the Batch / Item writes, and every SQL node of
// the completion answered from its INJECTED text (the ids the SQL names, so a mis-wired placeholder reads the wrong rows).
// Callees resolve by the workflow id in the node (stand-in ids, in memory) and must agree with the name next to it.
const crypto = require("crypto");
const path = require("path");
const { Engine } = require(path.join(__dirname, "..", "..", "lib", "sim", "engine.js"));
const RV = require(path.join(__dirname, "..", "revert", "_world.js"));
const SH = require(path.join(__dirname, "..", "..", "code", "shared", "ia_common.js"));

const FIFO = "First In First Out";
const WA = "Weighted Average";
const OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA", "COMMITTING_REVERT", "REQUIRES_REVIEW"];
const fmt = RV.fmt;
const s = (v) => (v === undefined || v === null ? "" : String(v));
const J = (o) => ({ j: JSON.stringify(o) });
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const byIdDesc = (a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1);
const byIdAsc = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
const must = (text, re, what) => {
  const m = text.match(re);
  if (!m) throw new Error("SQL mock: " + what + " not found in " + text.slice(0, 400));
  return m;
};
// a stored datetime as DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s') reads it
const dt = (v) => {
  const t = s(v).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t + " 00:00:00";
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? m[1] + " " + m[2] : t;
};

class IntegrationWorld extends RV.World {
  constructor() {
    super();
    this.lines = [];
    this.no = 41;
    this.batchSeq = 0;
    this.batchCfg = { n: 1, level: "Organization Level", date_format: "Document Created Date" };
    this.batchCalls = [];
    this.itemDates = {};
    this.trace = [];
    this.hooks = {};
    this.faults = {};
  }

  // ------------------------------------------------------------------------------------------------ rows as the SQL returns them
  itemRow(id) {
    const it = this.items[id];
    return { id: it.id, material_code: it.material_code, material_name: it.material_name, stock_control: it.stock_control, show_delivery: 1,
      serial_number_management: it.serial ? 1 : 0, item_batch_management: it.item_batch_management, batch_number_genaration: it.batch_number_genaration || null,
      material_costing_method: it.material_costing_method, purchase_unit_price: Number(it.purchase_unit_price || 0).toFixed(4), assembly_cost: Number(it.assembly_cost || 0).toFixed(4),
      based_uom: it.based_uom, table_uom_conversion: (it.uoms || []).map((u) => ({ alt_uom_id: u.alt_uom_id, base_qty: u.base_qty })) };
  }
  // FP_HEADER (code/shared/sql.py) of one stored IA
  header(iaId) {
    const h = this.ia(iaId);
    if (!h) return [];
    return [J({ id: h.id, item_id: h.item_id, item_qty: num(h.item_qty), item_uom: s(h.item_uom) || null, location_id: s(h.location_id) || null, inventory_category: h.inventory_category,
      batch_no: h.batch_no, issuing_operation_faci: h.issuing_operation_faci, organization_id: h.organization_id, stock_movement_no: h.stock_movement_no,
      stock_movement_no_type: h.stock_movement_no_type === undefined || h.stock_movement_no_type === null ? null : s(h.stock_movement_no_type), item_assembly_status: h.item_assembly_status,
      posted_status: h.posted_status === undefined ? null : h.posted_status, table_hu: h.table_hu === undefined ? null : h.table_hu, item_assembly_date: dt(h.item_assembly_date),
      manufacturing_date: dt(h.manufacturing_date), expired_date: dt(h.expired_date), remarks: h.remarks === undefined ? null : h.remarks,
      remarks_2: h.remarks_2 === undefined ? null : h.remarks_2, remarks_3: h.remarks_3 === undefined ? null : h.remarks_3, ia_v2_job_id: h.ia_v2_job_id || null })];
  }
  // FP_LINES
  lineRows(iaId) {
    return this.lines.filter((l) => !l.is_deleted && l.sm_item_assembly_id === s(iaId)).sort(byIdAsc).map((l) => J({ id: l.id, line_index: num(l.line_index), item_selection: l.item_selection,
      quantity_uom: s(l.quantity_uom) || null, total_quantity: num(l.total_quantity), temp_qty_data: l.temp_qty_data === undefined ? null : l.temp_qty_data,
      temp_hu_data: l.temp_hu_data === undefined || l.temp_hu_data === "" ? null : l.temp_hu_data, item_name: l.item_name === undefined ? null : l.item_name }));
  }
  lockObj(iaId) {
    const lk = this.latestLock(iaId);
    if (!lk) return null;
    const job = this.jobs.filter((j) => !j.is_deleted && j.idempotency_key === lk.result_ref).sort(byIdDesc)[0];
    return JSON.stringify({ step: lk.step_name, ref: lk.result_ref, young: lk.started_at > this.now - 120000 ? 1 : 0, job: job ? job.job_status : null });
  }
  // the completion worker's job row (CONTRACT section 8 IA_LOCK_JOIN / IA_ID_COL / IA_PREV_COL; a soft-deleted IA does not join)
  wjobC(j) {
    return this.wjob(j);
  }

  // ------------------------------------------------------------------------------------------------ SQL by node id
  sql(nid, text, ctx) {
    const m = nid.match(/^sql_node_(IS|IW|IP|IAC)(.*)$/);
    const out = (id) => ctx.out[id] || {};
    this.trace.push(nid);
    if (!m) return super.sql(nid, text, ctx);
    if (m[1] === "IS") return this.cSubmitSql(m[2], text, out);
    if (m[1] === "IW") return this.cWorkerSql(m[2], text, out);
    if (m[1] === "IP") return this.cPrepareSql(m[2], text, out);
    return this.cCommitSql(m[2], text, out);
  }

  cSubmitSql(key, text, out) {
    const tenant = must(text, /tenant_id = '([0-9]+)'/, "tenant")[1];
    if (tenant !== RV.T) throw new Error(key + ": tenant " + tenant);
    const jsonTable = (re) => SH.iaParseJ(must(text, re, "JSON_TABLE")[1]).map((r) => r.map(String));
    if (key === "facts") {
      const iaId = must(text, /AND g\.id = ([0-9]+)\s+AND g\.is_deleted = 0\s*$/, "g.id")[1];
      const k = must(text, /k\.idempotency_key = '([^']*)'/, "key")[1];
      const org = must(text, /COALESCE\(g\.organization_id, '([0-9]*)'\)/, "org")[1];
      const h = iaId !== "0" ? this.ia(iaId) : null;
      const kj = this.jobs.filter((j) => !j.is_deleted && j.idempotency_key === k).sort(byIdDesc)[0];
      const mine = iaId !== "0" ? this.jobs.filter((j) => !j.is_deleted && SH.IA_COMMANDS.indexOf(j.command) >= 0 && j.correlation_id === "IA|" + iaId) : [];
      const open = mine.filter((j) => OPEN.indexOf(j.job_status) >= 0);
      const last = mine.slice().sort(byIdDesc)[0];
      const link = h && h.ia_v2_job_id ? this.jobs.find((j) => !j.is_deleted && j.id === s(h.ia_v2_job_id) && SH.IA_COMMANDS.indexOf(j.command) >= 0) : null;
      const req = (j) => SH.iaParseJ(j.request_payload) || {};
      const no = h ? s(h.stock_movement_no) : "";
      const cfgOrg = h ? s(h.organization_id) : org;
      return [{ db_now: this.dbNow(), key_job: kj ? this.jobObj(kj) : null, ia_id: h ? h.id : null, stock_movement_no: h ? h.stock_movement_no : null,
        item_assembly_status: h ? h.item_assembly_status : null, posted_status: h ? h.posted_status || null : null, organization_id: h ? h.organization_id : null,
        plant_id: h ? h.issuing_operation_faci : null, no_type: h && h.stock_movement_no_type !== undefined && h.stock_movement_no_type !== null ? s(h.stock_movement_no_type) : null,
        ia_v2_job_id: h ? h.ia_v2_job_id || null : null, ia_lock: iaId !== "0" ? this.lockObj(iaId) : null,
        open_jobs: open.length ? "[" + open.map((j) => this.jobObj(j)).join(",") + "]" : null, last_job: last ? this.jobObj(last) : null, link_job: link ? this.jobObj(link) : null,
        issued_by_job: h ? mine.filter((j) => j.command === "COMPLETE_IA" && no && s(req(j).issuedNo) === no).length : 0,
        completed_under: h ? mine.filter((j) => j.command === "COMPLETE_IA" && j.job_status === "COMPLETED" && no && s(req(j).iaNo) === no).length : 0,
        batch_cfg: cfgOrg ? JSON.stringify(this.batchCfg) : JSON.stringify({ n: 0, level: null, date_format: null }) }];
    }
    if (key === "items") {
      const ids = must(text, /i\.id IN \(([0-9, ]+)\)/, "item ids")[1].split(",").map((x) => x.trim()).filter((x) => x !== "0");
      return ids.filter((id) => this.items[id]).map((id) => J(this.itemRow(id)));
    }
    if (key === "cost" || key === "wa") {
      const pairs = jsonTable(key === "cost" ? /JSON_TABLE\('(\[[^']*\])', '\$\[\*\]' COLUMNS \(m BIGINT PATH '\$\[0\]', b BIGINT/ : /JSON_TABLE\('(\[[^']*\])'/);
      const plant = must(text, /plant_id = '?([0-9]+)'?/, "plant")[1];
      const org = must(text, /organization_id = '([0-9]+)'/, "org")[1];
      const seen = {};
      const rows = [];
      for (const [mm, bb] of pairs) {
        if (seen[mm + "|" + bb]) continue;
        seen[mm + "|" + bb] = 1;
        const it = this.items[mm];
        if (!it || Number(it.stock_control) === 0) continue;
        const mat = (r) => !r.is_deleted && r.material_id === mm && r.plant_id === plant && r.organization_id === org;
        if (key === "cost") {
          const f = this.fifo.filter((r) => mat(r) && s(r.batch_id || "0") === bb).length;
          const w = this.wa.filter((r) => mat(r) && s(r.batch_id || "0") === bb).length;
          if ((f > 0 && w > 0) || (it.material_costing_method === FIFO && f === 0 && w > 0) || (it.material_costing_method === WA && w === 0 && f > 0)) {
            rows.push(J({ material_id: mm, batch_id: bb, method: it.material_costing_method, fifo: f, wa: w }));
          }
        } else if (it.material_costing_method === WA && !this.wa.some((r) => mat(r) && (bb === "0" || s(r.batch_id) === bb))) {
          rows.push(J({ material_id: mm, batch_id: bb, material_code: it.material_code }));
        }
      }
      return rows;
    }
    if (key === "dup") {
      const bal = jsonTable(/\(b\.material_id, b\.location_id\) IN \(SELECT jt\.m, jt\.l FROM JSON_TABLE\('(\[[^']*\])'/);
      const bat = jsonTable(/\(b\.material_id, b\.location_id, b\.batch_id\) IN \(SELECT jt\.m, jt\.l, jt\.b[\s\S]*?JSON_TABLE\('(\[[^']*\])'/);
      const rows = [];
      const count = (list, pred) => list.filter((b) => !b.is_deleted && pred(b)).length;
      for (const [mm, ll] of bal) {
        const n = count(this.ib, (b) => b.material_id === mm && b.location_id === ll);
        if (n > 1) rows.push(J({ t: "B", material_id: mm, location_id: ll, batch_id: "", n: n }));
      }
      for (const [mm, ll, bb] of bat) {
        const n = count(this.bb, (b) => b.material_id === mm && b.location_id === ll && b.batch_id === bb);
        if (n > 1) rows.push(J({ t: "T", material_id: mm, location_id: ll, batch_id: bb, n: n }));
      }
      return rows;
    }
    const byJob = () => {
      const job = must(text, /ia_v2_job_id = '([0-9]+)'/, "ia_v2_job_id")[1];
      return this.ias.filter((h) => !h.is_deleted && s(h.ia_v2_job_id) === job).sort(byIdAsc);
    };
    if (key === "hdr") return byJob().map((h) => ({ id: h.id, stock_movement_no: h.stock_movement_no, item_assembly_status: h.item_assembly_status, ia_v2_job_id: h.ia_v2_job_id }));
    if (key === "header") return byJob().slice(0, 1).reduce((a, h) => a.concat(this.header(h.id)), []);
    if (key === "lines") return byJob().slice(0, 1).reduce((a, h) => a.concat(this.lineRows(h.id)), []);
    if (key === "back") {
      const k = must(text, /j\.idempotency_key = '([^']*)'/, "key")[1];
      const j = this.jobs.filter((x) => !x.is_deleted && x.idempotency_key === k).sort(byIdDesc)[0];
      if (!j) return [];
      const mm = s(j.correlation_id).match(/^IA\|([0-9]{1,20})$/);
      const h = mm ? this.ia(mm[1]) : null;
      const lk = mm ? this.latestLock(mm[1]) : null;
      return [{ job_id: j.id, job_status: j.job_status, correlation_id: j.correlation_id, item_assembly_status: h ? h.item_assembly_status : null,
        stock_movement_no: h ? h.stock_movement_no : null, ia_v2_job_id: h ? h.ia_v2_job_id || null : null, lock_ref: lk ? lk.result_ref : null }];
    }
    throw new Error("no IA_V2_SUBMIT SQL mock for " + key);
  }

  cWorkerSql(key, text, out) {
    const g = out("code_node_IWguard");
    const plan = out("code_node_IWplan");
    const pick = out("code_node_IWpick");
    if (!/j\.correlation_id REGEXP '\^IA\\\\\|\[0-9\]\{1,20\}\$'[\s\S]*AND g\.is_deleted = 0/.test(text) && key !== "final") throw new Error(key + ": the read lacks IA_LOCK_JOIN");
    const planned = s(plan.jobIdsSql).split(",").filter((x) => x && x !== "0");
    const states = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA"];
    if (key === "poll") {
      if (!/j\.command = 'COMPLETE_IA'/.test(text)) throw new Error("poll: not COMPLETE_IA");
      const rows = this.jobs.filter((j) => !j.is_deleted && j.command === "COMPLETE_IA" && (s(g.jobId) === "0" || j.id === s(g.jobId)) && states.indexOf(j.job_status) >= 0
        && (j.lease_expires_at === null || j.lease_expires_at <= this.now) && (j.next_attempt_at === null || j.next_attempt_at <= this.now))
        .filter((j) => {
          const c = this.steps.find((x) => !x.is_deleted && x.job_id === j.id && x.step_name === "W0_CLAIM_" + j.row_version);
          return !c || c.started_at <= this.now - 600000;
        }).sort((a, b) => a.create_time - b.create_time || (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).slice(0, 5);
      if (!rows.length) return [{ db_now: this.dbNow() }];
      return rows.map((j) => Object.assign({ db_now: this.dbNow() }, this.wjobC(j)));
    }
    if (key === "tick") {
      const rows = planned.map((id) => this.job(id)).filter((j) => j && !j.is_deleted);
      if (!rows.length) return [{ db_now: this.dbNow(), lease_until: fmt(this.now + 600000) }];
      return rows.map((j) => Object.assign({ db_now: this.dbNow(), lease_until: fmt(this.now + 600000) }, this.wjobC(j)));
    }
    if (["own", "prepBack", "mid", "pubBack", "split", "pub2Back"].indexOf(key) >= 0) return [Object.assign({ db_now: this.dbNow() }, this.wjobC(this.job(pick.jobId)))];
    if (key === "final") return planned.map((id) => this.job(id)).filter((j) => j).map((j) => ({ id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner,
      error_code: j.error_code, error_message: j.error_message, ia_id: s(j.correlation_id).slice(3) }));
    throw new Error("no IA_V2_WORKER SQL mock for " + key);
  }

  cPrepareSql(key, text, out) {
    // RES-01: this world holds nothing (no on_reserved_gd): the IA's hold status as stored, no rows, no running ticket
    if (key === "res") {
      const iaId = must(text, /AND h\.id = ([0-9]+)\)/, "h.id")[1];
      const h = this.ia(iaId);
      return [J({ hold: h ? h.material_hold_status || "" : "", rows: null, live: 0 })];
    }
    if (key === "job" || key === "back") {
      const id = must(text, /AND j\.id = ([0-9]+)\s*$/m, "j.id")[1];
      const j = this.job(id);
      if (key === "back") return j ? [{ id: j.id, job_status: j.job_status, progress_message: j.progress_message, error_code: j.error_code, error_message: j.error_message }] : [];
      const linked = j ? this.ias.filter((h) => !h.is_deleted && s(h.ia_v2_job_id) === id && h.item_assembly_status === "Processing" && (!this.latestLock(h.id)
        || this.latestLock(h.id).result_ref === j.idempotency_key)).sort(byIdDesc)[0] : null;
      return [{ db_now: this.dbNow(), id: j ? j.id : null, organization_id: j ? j.organization_id : null, command: j ? j.command : null, job_status: j ? j.job_status : null,
        lease_owner: j ? j.lease_owner : null, lease_live: j && j.lease_expires_at !== null && j.lease_expires_at > this.now ? 1 : 0, row_version: j ? j.row_version : null,
        attempt_count: j ? j.attempt_count : null, idempotency_key: j ? j.idempotency_key : null, correlation_id: j ? j.correlation_id : null,
        request_payload: j ? j.request_payload : null, is_deleted: j ? j.is_deleted : null, linked_ia: linked ? linked.id : null,
        linked_ia_no: linked ? linked.stock_movement_no : null, linked_ia_no_type: linked && linked.stock_movement_no_type !== undefined && linked.stock_movement_no_type !== null ? s(linked.stock_movement_no_type) : null }];
    }
    const iaId = must(text, /(?:h\.id|l\.sm_item_assembly_id|p\.job_id = 'IAC\|)\s*=?\s*'?([0-9]+)/, "IA id")[1];
    if (key === "owner") return this.owner(iaId);
    if (key === "hdr") return this.header(iaId);
    if (key === "lines") return this.lineRows(iaId);
    const h = this.ia(iaId);
    if (key === "items") {
      if (!h) return [];
      const ids = [s(h.item_id)].concat(this.lines.filter((l) => !l.is_deleted && l.sm_item_assembly_id === h.id).map((l) => s(l.item_selection)));
      return ids.filter((x, i, a) => this.items[x] && a.indexOf(x) === i).map((x) => J(this.itemRow(x)));
    }
    if (key === "bins") {
      if (!h) return [];
      const ids = [s(h.location_id)];
      for (const l of this.lines.filter((x) => !x.is_deleted && x.sm_item_assembly_id === h.id)) for (const p of SH.iaJsonList(l.temp_qty_data)) if (/^[0-9]{1,20}$/.test(s(p.location_id))) ids.push(s(p.location_id));
      return ids.filter((x, i, a) => x && a.indexOf(x) === i && this.bins[x]).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).map((x) => J({ id: x, bin: this.bins[x] }));
    }
    throw new Error("no IA_V2_PREPARE SQL mock for " + key);
  }

  cCommitSql(key, text, out) {
    const jobId = s(out("code_node_IACguard").jobId);
    const named = text.match(/(?:j\.id = |st\.job_id = '|p\.job_id = 'IAC\|(?=[0-9]+\|)|m\.id > |b\.id > )([0-9]+)/);
    if (named && named[1] !== jobId) throw new Error(key + ": the SQL names job " + named[1] + ", the guard's is " + jobId);
    const j = this.job(jobId);
    const e = out("code_node_IACentry");
    if (key === "job") {
      let q = {};
      try {
        q = JSON.parse(j.request_payload);
      } catch (x) {
        q = {};
      }
      return [{ db_now: this.dbNow(), lease_until: fmt(this.now + 600000), id: j ? j.id : null, organization_id: j ? j.organization_id : null, command: j ? j.command : null,
        job_status: j ? j.job_status : null, progress_percent: j ? j.progress_percent : null, progress_message: j ? j.progress_message : null, attempt_count: j ? j.attempt_count : null,
        next_attempt_at: j ? fmt(j.next_attempt_at) : null, lease_owner: j ? j.lease_owner : null, lease_expires_at: j ? fmt(j.lease_expires_at) : null,
        lease_live: j && j.lease_expires_at !== null && j.lease_expires_at > this.now ? 1 : 0, due: j && (j.next_attempt_at === null || j.next_attempt_at <= this.now) ? 1 : 0,
        row_version: j ? j.row_version : null, error_code: j ? j.error_code : null, error_message: j ? j.error_message : null, error_details: j ? j.error_details : null,
        idempotency_key: j ? j.idempotency_key : null, correlation_id: j ? j.correlation_id : null, is_deleted: j ? j.is_deleted : null, line_count: j ? j.line_count : null,
        prev_status: q.prevStatus === undefined ? null : q.prevStatus, req_action: q.action === undefined ? null : q.action }];
    }
    const mine = (pred) => this.steps.filter((r) => !r.is_deleted && r.job_id === jobId && pred(r.step_name));
    if (key === "steps") return mine((n) => /^I[0-9]_/.test(n)).map((r) => ({ step_name: r.step_name, step_status: r.step_status, result_ref: r.result_ref, finished_at: fmt(r.finished_at_ms) || r.finished_at || null }));
    if (key === "intent") return mine((n) => n.indexOf("I1|I|") === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
    if (key === "payload") return j ? [{ prepared_payload: j.prepared_payload }] : [];
    if (key === "own") return j ? [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }] : [];
    if (key === "ia") {
      const mm = j && s(j.correlation_id).match(/^IA\|([0-9]{1,20})$/);
      const h = mm ? this.ia(mm[1]) : null;
      if (!h) return [];
      const lk = this.latestLock(h.id);
      return [{ ia_id: h.id, item_assembly_status: h.item_assembly_status, ia_v2_job_id: h.ia_v2_job_id, stock_movement_no: h.stock_movement_no, item_id: h.item_id, lock_ref: lk ? lk.result_ref : null }];
    }
    const part = text.match(/LIKE CONCAT\('([^']*)',\s*'([A-Z_]+)\|%'\)/);
    if (part) return this.partRows(jobId, part[1] + part[2] + "|");
    if (key === "i0hdr" || key === "i4own" || key === "i4back" || key === "i0lines" || key === "i3out") {
      const iaId = must(text, /(?:h\.id = |l\.sm_item_assembly_id = )([0-9]+)/, "IA id")[1];
      if (iaId !== s(e.iaId)) throw new Error(key + ": reads IA " + iaId + ", the entry's is " + e.iaId);
      if (key === "i0hdr") return this.header(iaId);
      if (key === "i0lines") return this.lineRows(iaId);
      if (key === "i3out") {
        const h = this.ia(iaId);
        const rows = this.mv.filter((m) => !m.is_deleted && BigInt(m.id) > BigInt(jobId) && m.movement === "OUT" && m.transaction_type === "IA" && h && m.trx_no === h.stock_movement_no
          && s(m.operation_effect_key).indexOf("IAC|" + jobId + "|I|") === 0);
        let t = 0n;
        for (const m of rows) t += BigInt(Number(m.total_price || 0).toFixed(8).replace(".", ""));
        const neg = t < 0n;
        const a = (neg ? -t : t).toString().padStart(9, "0");
        return [{ n: rows.length, total: (neg ? "-" : "") + a.slice(0, -8) + "." + a.slice(-8) }];
      }
      return this.owner(iaId);
    }
    if (/^(op1|i2ops|i3op1|i3op2)$/.test(key)) {
      const mm = must(text, /p\.job_id = 'IAC\|([0-9]+)\|([IR])'/, "op key");
      const rows = this.steps.filter((r) => !r.is_deleted && r.job_id === "IAC|" + mm[1] + "|" + mm[2]);
      const done = rows.filter((r) => r.step_name === "IBA|DONE").slice(-1)[0];
      return [{ intents: rows.filter((r) => r.step_name.indexOf("IBA|I|") === 0).length, review: rows.filter((r) => r.step_name === "IBA|REVIEW").length,
        done_summary: done ? JSON.stringify(JSON.parse(done.result_ref).summary) : null }];
    }
    if (/^(i1rows|i1back|efours)$/.test(key)) {
      const org = must(text, /b\.organization_id = '([0-9]+)'/, "org")[1];
      const mat = must(text, /b\.material_id = ([0-9]+)/, "material")[1];
      const after = text.match(/AND b\.id > ([0-9]+)/);
      return this.batch.filter((b) => !b.is_deleted && b.organization_id === org && b.material_id === mat && (!after || BigInt(b.id) > BigInt(after[1]))).sort(byIdAsc)
        .map((b) => J({ id: b.id, batch_number: b.batch_number, material_id: b.material_id, plant_id: b.plant_id, organization_id: b.organization_id, transaction_no: b.transaction_no }));
    }
    throw new Error("no IA_V2_COMMIT SQL mock for " + key);
  }

  // ------------------------------------------------------------------------------------------------ writes
  insert(table, rows) {
    if (table === "GD Publish Step") {
      // the unique Job Step index (tenant, job_id, step_name) refuses a second row of a name, soft-deleted or not
      for (const r of rows) if (this.steps.some((x) => x.job_id === s(r.job_id) && x.step_name === r.step_name)) throw new Error("Duplicate entry '" + r.job_id + "-" + r.step_name + "' for key 'Job Step'");
      const out = super.insert(table, rows);
      for (const r of out) if (r.finished_at) r.finished_at_ms = RV.parse(r.finished_at);
      return out;
    }
    if (table === "Item Assembly") {
      const out = [];
      for (const r0 of rows) {
        const r = Object.assign({}, r0);
        delete r.__id;
        const lines = r.stock_movement;
        delete r.stock_movement;
        r.id = this.id();
        r.is_deleted = 0;
        if (r.stock_movement_no === "issued") r.stock_movement_no = this.number();
        this.ias.push(r);
        this.writeLines(r.id, lines);
        out.push(Object.assign({}, r));
      }
      this.wrote("insert Item Assembly x" + rows.length);
      return out;
    }
    if (table === "Batch") {
      const out = [];
      for (const r0 of rows) {
        const r = Object.assign({}, r0, { id: this.id(), is_deleted: 0 });
        delete r.__id;
        this.batch.push(r);
        out.push(r);
      }
      this.wrote("insert Batch x" + rows.length);
      return out;
    }
    return super.insert(table, rows);
  }
  update(table, rows) {
    if (table === "Item") {
      for (const r of rows) this.itemDates[s(r.__id)] = r.last_transaction_date;
      this.wrote("update Item x" + rows.length);
      return { count: rows.length };
    }
    if (table === "Item Assembly") {
      const plain = [];
      for (const r0 of rows) {
        if (!("stock_movement" in r0) && !(r0.stock_movement_no === "issued")) {
          plain.push(r0);
          continue;
        }
        const h = this.ias.find((x) => x.id === s(r0.__id));
        if (!h || this.dropIaWrites) continue;
        const set = Object.assign({}, r0);
        delete set.__id;
        delete set.id;
        const lines = set.stock_movement;
        delete set.stock_movement;
        if (set.stock_movement_no === "issued") set.stock_movement_no = this.number();
        Object.assign(h, set);
        if (lines !== undefined) this.writeLines(h.id, lines);
        if ("item_assembly_status" in set) this.statusWrites.push({ id: h.id, status: set.item_assembly_status, deleted: h.is_deleted });
      }
      if (plain.length) return super.update(table, plain);
      this.wrote("update Item Assembly x" + rows.length);
      return { count: rows.length };
    }
    const res = super.update(table, rows);
    if (table === "GD Async Job") return res;
    return res;
  }
  number() {
    this.no += 1;
    return "IA-2610-" + String(this.no).padStart(4, "0");
  }
  // the whole-subform write: rows missing from the call are soft-deleted, rows without an id inserted, the others updated
  writeLines(iaId, lines) {
    const list = Array.isArray(lines) ? lines : [];
    const keep = new Set(list.map((l) => s(l && l.id)).filter((x) => x));
    for (const l of this.lines) if (l.sm_item_assembly_id === iaId && !l.is_deleted && !keep.has(l.id)) l.is_deleted = 1;
    for (const l0 of list) {
      const l = Object.assign({}, l0);
      const old = l.id ? this.lines.find((x) => x.id === s(l.id) && x.sm_item_assembly_id === iaId) : null;
      if (old) Object.assign(old, l, { id: old.id, is_deleted: 0 });
      else this.lines.push(Object.assign(l, { id: this.id(), sm_item_assembly_id: iaId, is_deleted: 0 }));
    }
  }

  // ------------------------------------------------------------------------------------------------ GENERATE_BATCH v20 (its answer)
  generateBatch(params) {
    this.batchCalls.push(JSON.parse(JSON.stringify(params)));
    this.batchSeq += 1;
    return { batch_number: "1019-" + String(this.batchSeq).padStart(3, "0") + "-0001" };
  }
}

// the interpreter: a distinct uuid per run, a token without a value injected as null (A's / B's platform rule), callees by the id
// in the node (the in-memory stand-in ids) - the name next to it must be the workflow that id names
let runN = 0;
class IntegrationEngine extends Engine {
  constructor(w, docs, idToName) {
    super({ dir: "/nonexistent", db: { tenantId: RV.T, insert: (t, rows) => w.insert(t, rows), update: (t, rows) => w.update(t, rows) },
      mocks: { sql: new Proxy({}, { get: (_, id) => (text, ctx) => w.sql(String(id), text, ctx) }), read: new Proxy({}, { get: (_, id) => (v, ctx) => w.read(String(id), ctx) }) } });
    this.w = w;
    // a run dies at the node named here (lib/sim/engine.js's fault rule; the counts are the world's, shared by every run)
    this.faults = w.faults;
    this.docs = docs;
    this.idToName = idToName;
    this.calls = [];
  }
  load(name) {
    if (!this.docs[name]) throw new Error("no built workflow " + name);
    return JSON.parse(JSON.stringify(this.docs[name]));
  }
  run(name, params) {
    const wf = this.load(name);
    const ctx = { name: name, params: params || {}, out: {}, loops: {}, uuid: crypto.createHash("md5").update("integration-run" + ++runN).digest("hex") + "bbbbbbbb", bytes: 0 };
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
  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined || v === null ? "null" : JSON.stringify(v);
    });
  }
  node(n, ctx) {
    if (n.type !== "workflow-node") return super.node(n, ctx);
    const [name, id] = n.data.workflow.source.split(":Workflow:");
    const known = this.idToName[id];
    if (known === undefined) throw new Error(n.id + " calls workflow id " + id + " (" + name + "), not a known id");
    if (known !== name) throw new Error(n.id + " calls " + name + " with the id of " + known);
    const params = {};
    for (const b of n.data.body_params.list) params[b.prop] = this.value(b.value, ctx);
    this.calls.push({ from: ctx.name, to: name, id: id });
    if (this.w.hooks[name]) this.w.hooks[name](params);
    let returned;
    if (name === "INVENTORY_BULK_APPLY") returned = this.w.engine(JSON.parse(JSON.stringify(params)));
    else if (name === "INVENTORY_LOCK_TOKENS") returned = this.w.tokens(params);
    else if (name === "SUBTRACT_INVENTORY" || name === "ADD_INVENTORY") returned = this.w.classicCall(name, params);
    else if (name === "GENERATE_BATCH") returned = this.w.generateBatch(params);
    else returned = this.run(name, params).returned;
    this.record(n, ctx, returned || {});
  }
}

// one run of a built workflow; { out, err, calls, trace }
function runWorkflow(w, docs, idToName, name, params) {
  const e = new IntegrationEngine(w, docs, idToName);
  let out = null;
  let err = null;
  try {
    out = e.run(name, params).returned;
  } catch (x) {
    err = x.message;
  }
  return { out: out, err: err, calls: e.calls, trace: e.trace, sizes: e.sizes };
}

module.exports = { IntegrationWorld, runWorkflow, fmt, parse: RV.parse, T: RV.T, FIFO, WA };
