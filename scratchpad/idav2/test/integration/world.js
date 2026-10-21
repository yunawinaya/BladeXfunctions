// ONE in-memory BladeX for the Item Disassembly V2 integration (CONTRACT section 13, E): every SQL node of IDA_V2_SUBMIT / WORKER /
// PREPARE / COMMIT, of the classic IDA_SAVE v7 and of the deployed INVENTORY_BULK_APPLY v10 + LOCK_TOKENS v5 is answered from its
// INJECTED text (the ids / keys / hex lists the text names, so a mis-wired placeholder reads the wrong rows or fails the parse), with
// MySQL's JSON_OBJECT typing (decimals at their scale, ints as numbers, CAST AS CHAR ids as strings, a json column embedded). Writes go
// through the platform's rules as far as the runs touch them: unique Idempotency Key / Job Step (soft-deleted rows included) / Lock Key,
// varchar(32 / 16 / 128 / 64) limits on step and lock rows, whole-subform line writes (a missing row soft-deleted, an id-less row
// inserted), the number sentinels ('issued' / 'draft' with a rule id; -9999 keeps the typed number). The classic v7's children:
// CHECK_REQUIRED_FIELD v8 runs from base/; SUBTRACT_INVENTORY v59 / ADD_INVENTORY v65 are answered by the deployed engine with ONE
// movement per call (ADD's own Batch insert and its stock_control 0 answer 401 first, as add_node_F9KqZLfd / return_node_EAFxgDzE),
// GENERATE_BATCH v20 by code/shared/batchnum.js (one request per call, its duplicate refusal), GLOBAL_INVENTORY_VALIDATION v11 by the
// balance read; their per-call parity with the real children is E phase 1's replay (test/twins, 3/3 DOC identical).
const fs = require("fs");
const path = require("path");
const IDAV2 = path.join(__dirname, "..", "..");
const C = require(path.join(IDAV2, "code", "shared", "ida_common.js"));
// batchnum.js + its adapter in ONE private scope (as the built nodes inline them; never a global a built node could lean on)
const BA = new Function("module", fs.readFileSync(path.join(IDAV2, "code", "shared", "batchnum.js"), "utf8") + "\n"
  + fs.readFileSync(path.join(IDAV2, "code", "shared", "batchnum_adapter.js"), "utf8").replace(/^if \(typeof module.*$/m, "")
  + "\nreturn { idaBatchnum: idaBatchnum, bnNumber: bnNumber };")({});

const T = "000000";
const s = (v) => (v === undefined || v === null ? "" : String(v));
const isNil = (v) => v === undefined || v === null;
const fmt = (ms) => (isNil(ms) ? null : new Date(ms).toISOString().slice(0, 19).replace("T", " "));
const fmtMs = (ms) => (isNil(ms) ? null : new Date(ms).toISOString().replace("T", " ").replace("Z", "000"));
const parseTs = (v) => {
  if (isNil(v) || v === "") return null;
  if (typeof v === "number") return v;
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?)?/);
  if (!m) throw new Error("not a timestamp: " + v);
  return Date.parse(m[1] + "T" + (m[2] ? (m[2].length === 5 ? m[2] + ":00" : m[2]) : "00:00:00") + (m[3] ? m[3].slice(0, 4) : "") + "Z");
};
// DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s') of a stored date / datetime text
const dt = (v) => {
  const t = s(v).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t + " 00:00:00";
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? m[1] + " " + m[2] : t;
};
const must = (text, re, what) => {
  const m = text.match(re);
  if (!m) throw new Error("SQL mock: " + what + " not found in: " + text.replace(/\s+/g, " ").slice(0, 300));
  return m;
};
const big = (a) => BigInt(s(a) || "0");
const byIdAsc = (a, b) => (big(a.id) < big(b.id) ? -1 : big(a.id) > big(b.id) ? 1 : 0);
// utf8mb4_general_ci with PAD SPACE: case-insensitive, trailing spaces ignored
const ci = (v) => s(v).toLowerCase().replace(/ +$/, "");
// a JSON text whose 16+ digit integers stay exact (JSON_TABLE BIGINT columns over digit arrays)
const parseBig = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(-?\d{16,})/g, (m, d) => (d === undefined ? m : '"' + d + '"')));
const dec = (v, dp) => ({ __dec: v, dp: dp });
const jsonCol = (text) => ({ __json: text });
// MySQL's JSON text (", " and ": " separators)
function jval(v) {
  if (v === undefined || v === null) return "null";
  if (typeof v === "object" && v.__dec !== undefined) return v.__dec === null || v.__dec === "" || v.__dec === undefined ? "null" : Number(v.__dec).toFixed(v.dp);
  if (typeof v === "object" && v.__json !== undefined) return isNil(v.__json) || v.__json === "" ? "null" : jval(parseBig(v.__json));
  if (Array.isArray(v)) return "[" + v.map(jval).join(", ") + "]";
  if (typeof v === "object") return "{" + Object.keys(v).map((k) => JSON.stringify(k) + ": " + jval(v[k])).join(", ") + "}";
  return JSON.stringify(v);
}
const J = (o) => ({ j: jval(o) });
const castDec = (v, dp) => (isNil(v) || v === "" ? null : Number(v).toFixed(dp));
const castId = (v) => (isNil(v) || v === "" ? null : s(v));
const jsonPath = (text, key) => {
  try {
    const o = JSON.parse(text);
    return o && typeof o === "object" && o[key] !== undefined && o[key] !== null ? (typeof o[key] === "object" ? JSON.stringify(o[key]) : String(o[key])) : null;
  } catch (e) {
    return null;
  }
};
// MySQL LIKE (case-insensitive under general_ci): % any, _ one character
const like = (pattern, text) => new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "is").test(s(text));
const listIn = (text, re, what) => must(text, re, what)[1].split(",").map((x) => x.trim()).filter((x) => x !== "");

const STATES4 = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"];
const OPEN5 = STATES4.concat(["REQUIRES_REVIEW"]);
const JOB_TS = ["next_attempt_at", "lease_expires_at", "finished_at", "queued_at", "started_at"];
const JOB_INT = ["progress_percent", "attempt_count", "row_version", "cancel_requested", "line_count"];
const IDA_BIGINT = ["item_id", "item_uom", "issuing_operation_faci", "stock_movement_no_type", "project_id"];
const LINE_BIGINT = ["quantity_uom", "location_id", "storage_location_id", "issuing_plant", "project_id"];
const LINE_DEC = ["total_quantity", "requested_qty", "bom_ratio"];
// the schema / column rules a write can break (base columns.json varchar sizes; schema_*.json minimum 0 on decimals, maxLength 23 on dates)
const JOB_LEN = { progress_message: 255, error_code: 255, lease_owner: 255, correlation_id: 255, causation_id: 255, idempotency_key: 255, job_status: 255, command: 255,
  organization_id: 255, plant_id: 255 };
const IDA_LEN = { stock_movement_no: 255, item_disassembly_status: 255, posted_status: 255, ida_v2_job_id: 255, ida_idem_key: 255, item_disassembly_date: 23 };
const DATE_LEN = { manufacturing_date: 23, expired_date: 23 };
const minimum0 = (nid, r, cols) => {
  for (const c of cols) if (!isNil(r[c]) && r[c] !== "" && Number(r[c]) < 0) throw new Error(nid + ": minimum not match, expect >= 0 (" + c + " " + r[c] + ")");
};

class World {
  constructor(opts) {
    const o = opts || {};
    this.T = T;
    this.uid = "1123598821738675201";
    this.now = o.now || Date.UTC(2026, 9, 21, 2, 0, 0);
    this.seq = BigInt(o.seq || "2113000000000000000");
    this.runSeq = 0;
    this.jobs = [];
    this.jobById = new Map();
    this.steps = [];
    this.stepKey = new Map();
    this.locks = [];
    this.lockById = new Map();
    this.lockKey = new Map();
    this.idas = new Map();
    this.lines = new Map();
    this.lineById = new Map();
    this.items = new Map();
    this.ib = [];
    this.bb = [];
    this.fifo = [];
    this.wa = [];
    this.mv = [];
    this.batches = [];
    this.bnc = [];
    this.bins = new Map();
    this.rules = {};
    this.no = o.no === undefined ? 41 : o.no;
    this.draftNo = 0;
    this.faults = {};
    this.hooks = {};
    this.writeLog = [];
    this.writeCount = 0;
    this.crashAfter = 0;
    this.violations = [];
    this.sqlSeen = {};
    this.readSeen = {};
    this.childCalls = [];
    this.keepCallParams = false;
    this.classicOp = 0;
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }
  dbNow() {
    return fmt(this.now);
  }
  beginChain() {
    this.chainWrites = 0;
  }
  endChain() {}
  wrote(what) {
    this.writeCount++;
    this.writeLog.push(what);
    if (this.crashAfter && this.writeCount === this.crashAfter) {
      this.crashed = what;
      throw new Error("crash right after write " + this.crashAfter + " (" + what + ")");
    }
  }

  // ------------------------------------------------------------------------------------------------ fixtures
  addItem(it) {
    const row = Object.assign({ stock_control: 1, serial_number_management: 0, item_batch_management: 0, batch_number_genaration: null,
      material_costing_method: "First In First Out", purchase_unit_price: 0, item_category: "2018905941675634693", item_group_id: null, uoms: [], is_deleted: 0,
      last_transaction_date: null, material_desc: "" }, it);
    this.items.set(row.id, row);
    return row;
  }
  addBalance(b) {
    const row = Object.assign({ id: this.id(), material_uom: null, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0, is_deleted: 0 }, b);
    if (row.balance_quantity === undefined) row.balance_quantity = Number(row.unrestricted_qty || 0);
    (row.batch_id ? this.bb : this.ib).push(row);
    return row;
  }
  addFifo(f) {
    const row = Object.assign({ id: this.id(), batch_id: null, is_deleted: 0 }, f);
    this.fifo.push(row);
    return row;
  }
  addWa(r) {
    const row = Object.assign({ id: this.id(), batch_id: null, is_deleted: 0, created_at: "2026-10-01 00:00:00" }, r);
    this.wa.push(row);
    return row;
  }
  addBatch(b) {
    const row = Object.assign({ id: this.id(), is_deleted: 0, remark: "", remark2: "", remark3: "", manufacturing_date: null, expired_date: null, initial_quantity: 0 }, b);
    this.batches.push(row);
    return row;
  }
  // a stored IDA (header + lines) written directly, as the classic Draft save left it
  storeIda(h, lines) {
    const row = Object.assign({ id: this.id(), tenant_id: T, is_deleted: 0, table_hu: null, posted_status: null, ida_v2_job_id: null, ida_idem_key: null, create_time: this.now }, h);
    this.idas.set(row.id, row);
    this.writeLines(row.id, lines || []);
    return row;
  }

  // ------------------------------------------------------------------------------------------------ row helpers
  ida(id) {
    const h = this.idas.get(s(id));
    return h && !h.is_deleted ? h : null;
  }
  liveLines(idaId) {
    return (this.lines.get(s(idaId)) || []).filter((l) => !l.is_deleted).sort(byIdAsc);
  }
  job(id) {
    return this.jobById.get(s(id)) || null;
  }
  liveStep(jobId, pred) {
    return this.steps.filter((r) => !r.is_deleted && r.job_id === jobId && pred(r));
  }
  latestLock(idaId) {
    const rows = this.liveStep("IDC|" + idaId, (r) => r.step_name.indexOf("LOCK|") === 0);
    return rows.length ? rows.reduce((a, b) => (big(a.id) > big(b.id) ? a : b)) : null;
  }
  jobByKey(key) {
    const rows = this.jobs.filter((j) => !j.is_deleted && j.idempotency_key === key);
    return rows.length ? rows.reduce((a, b) => (big(a.id) > big(b.id) ? a : b)) : null;
  }
  // the IDA a job's correlation names (the worker's / COMMIT's join: IDA|<digits>, live)
  idaOfJob(j) {
    const m = s(j && j.correlation_id).match(/^IDA\|([0-9]{1,20})$/);
    return m ? this.ida(m[1]) : null;
  }
  jobObjText(j) {
    if (!j) return null;
    return jval({ id: j.id, command: j.command, job_status: j.job_status, correlation_id: j.correlation_id, progress_percent: j.progress_percent, progress_message: j.progress_message,
      error_code: j.error_code, error_message: j.error_message, line_count: j.line_count, action: jsonPath(j.request_payload, "action"), ida_no: jsonPath(j.request_payload, "idaNo") });
  }
  itemJ(it) {
    return J({ id: it.id, material_code: it.material_code, material_name: it.material_name, stock_control: it.stock_control, serial_number_management: it.serial_number_management,
      item_batch_management: it.item_batch_management, batch_number_genaration: it.batch_number_genaration, material_costing_method: it.material_costing_method,
      purchase_unit_price: castDec(it.purchase_unit_price, 4), based_uom: castId(it.based_uom), item_category: it.item_category, item_group_id: it.item_group_id,
      table_uom_conversion: (it.uoms || []).map((u) => ({ alt_uom_id: castId(u.alt_uom_id), base_qty: dec(u.base_qty, 6) })) });
  }
  headerJ(h) {
    return J({ id: h.id, item_id: castId(h.item_id), item_code: h.item_code, item_name: h.item_name, item_qty: dec(h.item_qty, 8), item_uom: castId(h.item_uom),
      issuing_operation_faci: castId(h.issuing_operation_faci), organization_id: h.organization_id, stock_movement_no: h.stock_movement_no,
      stock_movement_no_type: castId(h.stock_movement_no_type), item_disassembly_status: h.item_disassembly_status, posted_status: h.posted_status,
      item_disassembly_date: dt(h.item_disassembly_date), temp_qty_data: isNil(h.temp_qty_data) ? null : s(h.temp_qty_data), temp_hu_data: isNil(h.temp_hu_data) ? null : s(h.temp_hu_data),
      table_hu: jsonCol(isNil(h.table_hu) ? null : typeof h.table_hu === "string" ? h.table_hu : JSON.stringify(h.table_hu)), remarks: h.remarks, remarks_2: h.remarks_2,
      remarks_3: h.remarks_3, ida_v2_job_id: h.ida_v2_job_id });
  }
  lineJ(l) {
    return J({ id: l.id, line_index: isNil(l.line_index) ? null : s(l.line_index), item_selection: l.item_selection, quantity_uom: castId(l.quantity_uom),
      total_quantity: dec(l.total_quantity, 8), location_id: castId(l.location_id), batch_number: l.batch_number, manufacturing_date: dt(l.manufacturing_date),
      expired_date: dt(l.expired_date), item_remark: l.item_remark, item_remark_2: l.item_remark_2, item_remark_3: l.item_remark_3, issuing_plant: castId(l.issuing_plant),
      organization_id: l.organization_id, item_name: l.item_name });
  }
  batchJ(b) {
    return J({ id: b.id, batch_number: b.batch_number, material_id: castId(b.material_id), plant_id: castId(b.plant_id), organization_id: b.organization_id, transaction_no: b.transaction_no });
  }
  ownerRow(idaId) {
    const h = this.ida(idaId);
    const lk = this.latestLock(idaId);
    return [{ db_now: this.dbNow(), ida_id: h ? h.id : null, item_disassembly_status: h ? h.item_disassembly_status : null, ida_v2_job_id: h ? h.ida_v2_job_id : null,
      stock_movement_no: h ? h.stock_movement_no : null, lock_ref: lk ? lk.result_ref : null, lock_step: lk ? lk.step_name : null }];
  }
  // the worker's job columns (CONTRACT section 8 IDA_LOCK_JOIN / IDA_ID_COL / IDA_PREV_COL)
  wjob(j) {
    const g = this.idaOfJob(j);
    const lk = g ? this.latestLock(g.id) : null;
    const prev = (() => {
      try {
        const o = JSON.parse(j.request_payload);
        return o && o.prevStatus !== undefined && o.prevStatus !== null ? String(o.prevStatus) : null;
      } catch (e) {
        return null;
      }
    })();
    return { id: j.id, organization_id: j.organization_id, ida_id: g && g.item_disassembly_status === "Processing" && lk && lk.result_ref === j.idempotency_key ? g.id : "0", prev_status: prev,
      job_status: j.job_status, progress_percent: j.progress_percent, progress_message: j.progress_message, attempt_count: j.attempt_count, next_attempt_at: fmt(j.next_attempt_at),
      lease_owner: j.lease_owner, lease_expires_at: fmt(j.lease_expires_at),
      dead_lease: !isNil(j.lease_owner) && j.lease_owner !== "" && !isNil(j.lease_expires_at) && j.lease_expires_at <= this.now ? 1 : 0,
      lease_live: isNil(j.lease_expires_at) ? null : j.lease_expires_at > this.now ? 1 : 0, row_version: j.row_version, error_code: j.error_code, error_message: j.error_message,
      error_details: j.error_details, finished_at: fmt(j.finished_at), line_count: j.line_count };
  }
  claimOf(j) {
    return this.steps.find((r) => !r.is_deleted && r.job_id === j.id && r.step_name === "W0_CLAIM_" + j.row_version) || null;
  }

  // ------------------------------------------------------------------------------------------------ SQL, by node id
  sql(nid, text, ctx) {
    this.sqlSeen[nid] = (this.sqlSeen[nid] || 0) + 1;
    const ten = text.match(/tenant_id = '([0-9]*)'/);
    if (ten && ten[1] !== T) throw new Error(nid + ": tenant " + ten[1]);
    const h = HANDLERS[nid];
    if (!h) throw new Error("no SQL mock for " + nid);
    return h.call(this, text, ctx, nid);
  }

  // ------------------------------------------------------------------------------------------------ get / search nodes (the classic v7)
  ruleMatch(f, row, it, ctx) {
    if (f.type === "branch") {
      const kids = f.children || [];
      return f.operator === "all" ? kids.every((c) => this.ruleMatch(c, row, it, ctx)) : kids.some((c) => this.ruleMatch(c, row, it, ctx));
    }
    const want = f.valueType === "field" ? it.value(f.value, ctx) : f.value;
    const have = row[f.prop];
    const list = Array.isArray(want) ? Array.from(want) : isNil(want) ? [] : [want];
    switch (f.operator) {
      case "equal":
        return !isNil(want) && ci(have) === ci(want);
      case "in":
      case "equalAny":
        return list.some((x) => ci(x) === ci(have));
      case "isNull":
        return isNil(have);
      case "isNotNull":
        return !isNil(have);
      default:
        throw new Error("read rule operator " + f.operator + " not simulated");
    }
  }
  read(n, ctx, it) {
    const d = n.data;
    const table = d.table_id.source.split(":Table:")[0];
    this.readSeen[n.id] = (this.readSeen[n.id] || 0) + 1;
    let rows;
    if (table === "Item") rows = Array.from(this.items.values()).filter((x) => !x.is_deleted).map((x) => this.itemRecord(x));
    else if (table === "Batch") rows = this.batches.filter((x) => !x.is_deleted).sort(byIdAsc).map((x) => Object.assign({}, x));
    else if (table === "Item Disassembly") rows = Array.from(this.idas.values()).filter((x) => !x.is_deleted).map((x) => this.idaRecord(x));
    else if (table === "Inventory Movement") rows = this.mv.filter((x) => !x.is_deleted).sort(byIdAsc).map((x) => Object.assign({}, x));
    else throw new Error(n.id + ": read of " + table + " not simulated");
    const rule = d.table_id.rules.list[0];
    const hit = rows.filter((r) => this.ruleMatch(rule, r, it, ctx)).map((r) => {
      // search records drop null and '' keys (memory project_lowcode_search_record_semantics)
      const o = {};
      for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined && v !== "") o[k] = v;
      return o;
    });
    if (n.type === "search-node") return { total: hit.length, count: hit.length, data: hit };
    return { count: hit.length, data: hit.length === 1 ? hit[0] : hit.length ? hit : {} };
  }
  itemRecord(x) {
    return { id: x.id, material_code: x.material_code, material_name: x.material_name, material_desc: x.material_desc, stock_control: x.stock_control,
      serial_number_management: x.serial_number_management, item_batch_management: x.item_batch_management, batch_number_genaration: x.batch_number_genaration,
      material_costing_method: x.material_costing_method, purchase_unit_price: x.purchase_unit_price, based_uom: x.based_uom, item_category: x.item_category,
      item_group_id: x.item_group_id, organization_id: x.organization_id || ORG_DEFAULT,
      table_uom_conversion: (x.uoms || []).map((u) => ({ alt_uom_id: s(u.alt_uom_id), base_uom_id: s(x.based_uom), base_qty: u.base_qty })) };
  }
  idaRecord(h) {
    const o = Object.assign({}, h);
    delete o.tenant_id;
    o.stock_movement = this.liveLines(h.id).map((l) => Object.assign({}, l));
    return o;
  }

  // ------------------------------------------------------------------------------------------------ writes
  insert(table, rows, nid, ctx) {
    const out = [];
    for (const r0 of rows) {
      const r = Object.assign({}, r0);
      delete r.__id;
      if (table === "GD Async Job") {
        this.lengthCheck(nid, r, JOB_LEN);
        if (this.jobs.some((j) => j.organization_id === s(r.organization_id) && j.idempotency_key === r.idempotency_key)) {
          throw new Error("Duplicate entry '" + T + "-" + r.organization_id + "-" + r.idempotency_key + "' for key 'Idempotency Key'");
        }
        const row = Object.assign({ lease_owner: null, lease_expires_at: null, error_code: null, error_message: null, error_details: null, prepared_payload: null, finished_at: null,
          causation_id: null, correlation_id: null }, this.jobVals(r), { id: this.id(), tenant_id: T, create_time: this.now, is_deleted: 0 });
        this.jobs.push(row);
        this.jobById.set(row.id, row);
        out.push(Object.assign({}, row));
      } else if (table === "GD Publish Step") {
        this.lengthCheck(nid, r, { job_id: 32, step_name: 32, step_status: 16, organization_id: 32 });
        const k = s(r.job_id) + "\u0001" + s(r.step_name);
        if (this.stepKey.has(k)) throw new Error("Duplicate entry '" + T + "-" + r.job_id + "-" + r.step_name + "' for key 'Job Step'");
        const row = Object.assign({ inventory_operation_id: null, error_code: null, error_message: null, result_ref: null }, r, { id: this.id(), tenant_id: T, is_deleted: 0,
          started_at: parseTs(r.started_at), finished_at: parseTs(r.finished_at), create_time: this.now });
        this.steps.push(row);
        this.stepKey.set(k, row);
        out.push(Object.assign({}, row));
      } else if (table === "Inventory Balance Lock") {
        this.lengthCheck(nid, r, { lock_key: 128, balance_type: 16, owner_operation_id: 64, last_owner_operation_id: 64, organization_id: 32 });
        const k = s(r.organization_id) + "|" + ci(r.lock_key);
        if (this.lockKey.has(k)) throw new Error("Duplicate entry '" + T + "-" + r.organization_id + "-" + r.lock_key + "' for key 'Lock Key'");
        const row = Object.assign({ claimed_at: null, last_released_at: null }, r, { id: this.id(), is_deleted: 0, free_token: Number(r.free_token), lock_version: Number(r.lock_version || 0),
          update_time: this.now });
        this.locks.push(row);
        this.lockById.set(row.id, row);
        this.lockKey.set(k, row);
        out.push(Object.assign({}, row));
      } else if (table === "Item Disassembly") {
        const lines = r.stock_movement;
        delete r.stock_movement;
        this.lengthCheck(nid, r, IDA_LEN);
        minimum0(nid, r, ["item_qty"]);
        const row = Object.assign({ table_hu: null, posted_status: null, ida_v2_job_id: null, ida_idem_key: null }, this.idaVals(r), { id: this.id(), tenant_id: T, is_deleted: 0, create_time: this.now });
        row.stock_movement_no = this.numberFor(row.stock_movement_no, row.stock_movement_no_type, true);
        this.idas.set(row.id, row);
        this.writeLines(row.id, lines || []);
        out.push(Object.assign({}, row));
      } else if (table === "Batch") {
        this.lengthCheck(nid, r, Object.assign({ batch_number: 255, transaction_no: 255, organization_id: 255 }, DATE_LEN));
        minimum0(nid, r, ["initial_quantity"]);
        const row = Object.assign({}, r, { id: this.id(), is_deleted: 0, initial_quantity_given: r.initial_quantity, initial_quantity: Number(r.initial_quantity) });
        this.batches.push(row);
        out.push(Object.assign({}, row));
      } else if (table === "Item Balance" || table === "Item Batch Balance") {
        const row = Object.assign({}, r, { id: this.id(), is_deleted: 0 });
        for (const c of ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"]) row[c] = Number(r[c] || 0);
        (table === "Item Balance" ? this.ib : this.bb).push(row);
        out.push(Object.assign({}, row));
      } else if (table === "FIFO Costing History") {
        const row = Object.assign({}, r, { id: this.id(), is_deleted: 0, fifo_cost_price: Number(r.fifo_cost_price), fifo_initial_quantity: Number(r.fifo_initial_quantity),
          fifo_available_quantity: Number(r.fifo_available_quantity), batch_id: r.batch_id === "" ? null : r.batch_id });
        this.fifo.push(row);
        out.push(Object.assign({}, row));
      } else if (table === "Weighted Average Costing History") {
        const row = Object.assign({ created_at: this.dbNow() }, r, { id: this.id(), is_deleted: 0, wa_quantity: Number(r.wa_quantity), wa_cost_price: Number(r.wa_cost_price),
          batch_id: r.batch_id === "" ? null : r.batch_id, plant_id: s(r.plant_id) });
        this.wa.push(row);
        out.push(Object.assign({}, row));
      } else if (table === "Inventory Movement") {
        const row = Object.assign({}, r, { id: this.id(), is_deleted: 0, run: ctx && ctx.name });
        for (const c of ["unit_price", "total_price", "quantity", "base_qty", "actual_qty", "actual_base_qty"]) if (!isNil(row[c]) && row[c] !== "") row[c] = Number(row[c]);
        this.mv.push(row);
        out.push(Object.assign({}, row));
      } else throw new Error(nid + ": insert into " + table + " not simulated");
    }
    return out;
  }
  update(table, rows, nid, ctx) {
    let n = 0;
    for (const r0 of rows) {
      const id = s(r0.__id);
      const set = Object.assign({}, r0);
      delete set.__id;
      if (table === "GD Async Job") {
        const j = this.job(id);
        if (!j) continue;
        this.lengthCheck(nid, set, JOB_LEN);
        Object.assign(j, this.jobVals(set), { id: j.id });
      } else if (table === "GD Publish Step") {
        const st = this.steps.find((x) => x.id === id);
        if (!st) continue;
        Object.assign(st, set, { id: st.id });
      } else if (table === "Inventory Balance Lock") {
        const lk = this.lockById.get(id);
        if (!lk) continue;
        if (set.last_released_at !== undefined) set.last_released_at = parseTs(set.last_released_at);
        if (set.lock_version !== undefined) set.lock_version = Number(set.lock_version);
        Object.assign(lk, set, { id: lk.id, update_time: this.now });
      } else if (table === "Item Disassembly") {
        const h = this.idas.get(id);
        if (!h) continue;
        if (h.is_deleted) this.violations.push(nid + " wrote the soft-deleted IDA " + id + ": " + Object.keys(set).join(","));
        const lines = set.stock_movement;
        delete set.stock_movement;
        delete set.id;
        this.lengthCheck(nid, set, IDA_LEN);
        minimum0(nid, set, ["item_qty"]);
        const vals = this.idaVals(set);
        if ("stock_movement_no" in vals) vals.stock_movement_no = this.numberFor(vals.stock_movement_no, "stock_movement_no_type" in vals ? vals.stock_movement_no_type : h.stock_movement_no_type, false, h.stock_movement_no);
        Object.assign(h, vals);
        if (lines !== undefined) this.writeLines(h.id, lines);
        (this.statusWrites = this.statusWrites || []).push({ id: h.id, by: nid, status: vals.item_disassembly_status, keys: Object.keys(set).sort().join(",") });
      } else if (table === "Stock movement(Item Disassembly)") {
        const l = this.lineById.get(id);
        if (!l || l.is_deleted) throw new Error(nid + ": line update of unknown id " + id);
        if (Object.keys(set).sort().join(",") !== "batch_number,id") this.violations.push(nid + ": a line write of " + Object.keys(set).join(","));
        l.batch_number = set.batch_number;
      } else if (table === "Batch") {
        const b = this.batches.find((x) => x.id === id);
        if (!b) throw new Error(nid + ": Batch update of unknown id " + id);
        Object.assign(b, set, { id: b.id });
      } else if (table === "Batch Number Configuration") {
        const c = this.bnc.find((x) => x.id === id);
        if (!c) throw new Error(nid + ": config update of unknown id " + id);
        if (Number(set.running_number) < Number(c.running_number)) this.violations.push(nid + ": a running number went back " + c.running_number + " -> " + set.running_number);
        Object.assign(c, { running_number: Number(set.running_number), last_reset_date: set.last_reset_date });
      } else if (table === "Item") {
        const it = this.items.get(id);
        if (!it) throw new Error(nid + ": Item update of unknown id " + id);
        it.last_transaction_date = set.last_transaction_date;
        it.stamps = (it.stamps || 0) + 1;
      } else if (table === "Item Balance" || table === "Item Batch Balance") {
        const row = (table === "Item Balance" ? this.ib : this.bb).find((x) => x.id === id);
        if (!row) throw new Error(nid + ": " + table + " update of unknown id " + id);
        for (const [k, v] of Object.entries(set)) if (k !== "id") row[k] = /qty|quantity/.test(k) ? Number(v) : v;
      } else if (table === "FIFO Costing History") {
        const row = this.fifo.find((x) => x.id === id);
        if (!row) throw new Error(nid + ": FIFO update of unknown id " + id);
        row.fifo_available_quantity = Number(set.fifo_available_quantity);
      } else if (table === "Weighted Average Costing History") {
        const row = this.wa.find((x) => x.id === id);
        if (!row) throw new Error(nid + ": WA update of unknown id " + id);
        if (set.wa_quantity !== undefined) row.wa_quantity = Number(set.wa_quantity);
        if (set.wa_cost_price !== undefined) row.wa_cost_price = Number(set.wa_cost_price);
      } else throw new Error(nid + ": update of " + table + " not simulated");
      n++;
    }
    return { count: n };
  }
  atomicCount(n, ctx, it) {
    const d = n.data;
    const id = s(it.value(d.table_id.rules.list[0].value, ctx));
    const lk = this.lockById.get(id);
    if (!lk || lk.is_deleted) throw new Error(n.id + ": " + (d.err_data_not_found || "row not found") + " (" + id + ")");
    for (const p of d.props.list) {
      const v = it.value(p.value, ctx);
      if (p.valueType === "formula") {
        const m = s(v).match(/^(minus|plus)\((-?[0-9.]+)\)$/);
        if (!m) throw new Error(n.id + ": formula " + v + " not simulated");
        const next = Number(lk[p.prop]) + (m[1] === "minus" ? -1 : 1) * Number(m[2]);
        if (next < 0) throw new Error(n.id + ": " + (d.err_stock_insufficient || "count below zero") + " (" + lk.lock_key + ")");
        lk[p.prop] = next;
      } else lk[p.prop] = p.prop === "claimed_at" ? parseTs(v) : v;
    }
    lk.update_time = this.now;
    return { count: 1 };
  }
  lengthCheck(nid, r, lim) {
    for (const [k, n] of Object.entries(lim)) if (!isNil(r[k]) && s(r[k]).length > n) throw new Error(nid + ": Data too long for column '" + k + "' (" + s(r[k]).length + " > " + n + "): " + s(r[k]));
  }
  jobVals(r) {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      if (JOB_TS.indexOf(k) >= 0) o[k] = parseTs(v);
      else if (JOB_INT.indexOf(k) >= 0) o[k] = isNil(v) || v === "" ? null : Number(v);
      else if (k === "organization_id" || k === "plant_id") o[k] = isNil(v) ? v : s(v);
      else o[k] = v;
    }
    return o;
  }
  idaVals(r) {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      if (IDA_BIGINT.indexOf(k) >= 0) o[k] = isNil(v) || v === "" ? null : s(v);
      else if (k === "item_qty") o[k] = isNil(v) || v === "" ? null : Number(v);
      else if (k === "organization_id") o[k] = isNil(v) ? v : s(v);
      else o[k] = v;
    }
    return o;
  }
  // the serial engine: a rule id + a sentinel (or any value on insert) issues a number; -9999 keeps the typed one
  numberFor(value, type, isInsert, prev) {
    const manual = s(type) === "-9999";
    if (manual) return value;
    if (isNil(type) || s(type) === "") return value === "issued" || value === "draft" ? prev || value : value;
    if (value === "issued" || (isInsert && value !== "draft")) {
      this.no += 1;
      return "IDA-2610-" + String(this.no).padStart(4, "0");
    }
    if (value === "draft") {
      this.draftNo += 1;
      return "Draft-IDA-" + String(this.draftNo).padStart(4, "0");
    }
    return value;
  }
  // the whole-subform write: rows missing from the call soft-deleted, rows without a known id inserted, the others updated
  writeLines(idaId, lines) {
    const list = Array.isArray(lines) ? lines : [];
    const cur = this.lines.get(idaId) || [];
    this.lines.set(idaId, cur);
    const keep = new Set(list.map((l) => s(l && l.id)).filter((x) => x));
    for (const l of cur) if (!l.is_deleted && !keep.has(l.id)) l.is_deleted = 1;
    for (const l0 of list) {
      this.lengthCheck("line write", l0 || {}, DATE_LEN);
      minimum0("line write", l0 || {}, LINE_DEC);
      const l = {};
      for (const [k, v] of Object.entries(l0 || {})) {
        if (LINE_BIGINT.indexOf(k) >= 0) l[k] = isNil(v) || v === "" ? null : s(v);
        else if (LINE_DEC.indexOf(k) >= 0) l[k] = isNil(v) || v === "" ? null : Number(v);
        else if (k === "line_index" || k === "item_selection") l[k] = isNil(v) ? v : s(v);
        else l[k] = v;
      }
      const old = l.id ? cur.find((x) => x.id === s(l.id)) : null;
      if (old) Object.assign(old, l, { id: old.id, is_deleted: 0 });
      else {
        const row = Object.assign({ batch_number: null, manufacturing_date: null, expired_date: null, item_remark: null, item_remark_2: null, item_remark_3: null }, l,
          { id: this.id(), sm_item_disassembly_id: idaId, is_deleted: 0 });
        cur.push(row);
        this.lineById.set(row.id, row);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ the classic v7's children
  child(name, p, it) {
    this.childCalls.push({ name: name, params: p });
    if (name === "GLOBAL_INVENTORY_VALIDATION") return this.classicGiv(p);
    if (name === "GENERATE_BATCH") return this.classicGenerate(p);
    if (name === "SUBTRACT_INVENTORY") return this.classicMove(p, "SUBTRACT", it);
    if (name === "ADD_INVENTORY") return this.classicMove(p, "ADD", it);
    throw new Error("the child " + name + " is not simulated");
  }
  classicGiv(p) {
    const it = this.items.get(s(p.material_id));
    const conv = it && (it.uoms || []).find((u) => s(u.alt_uom_id) === s(p.orderUomId));
    const need = Number(p.quantity) * (conv ? Number(conv.base_qty) : 1);
    const field = { Unrestricted: "unrestricted_qty", Blocked: "block_qty", Reserved: "reserved_qty", "Quality Inspection": "qualityinsp_qty" }[s(p.category) || "Unrestricted"] || "unrestricted_qty";
    const rows = (s(p.batch_id) ? this.bb : this.ib).filter((b) => !b.is_deleted && b.material_id === s(p.material_id) && b.location_id === s(p.location_id) && b.plant_id === s(p.plant_id)
      && (!s(p.batch_id) || b.batch_id === s(p.batch_id)));
    const have = rows.reduce((a, b) => a + Number(b[field] || 0), 0);
    return have + 1e-9 >= need ? { code: "200", message: "ok" } : { code: "400", message: "Insufficient stock for item " + (it ? it.material_code : p.material_id) + ": " + have + " available, " + need + " required" };
  }
  classicGenerate(p) {
    const org = s(p.organization_id) || ORG_DEFAULT;
    const it = this.items.get(s(p.item_id));
    const cfg = this.bnc.filter((c) => !c.is_deleted && c.organization_id === org).sort(byIdAsc).map((c) => this.bncRow(c));
    const r = BA.idaBatchnum(cfg, [{ id: s(p.item_id), item_category: it ? it.item_category : null, item_group_id: it ? it.item_group_id : null }],
      [{ item_id: s(p.item_id), document_date: p.document_date || null, manufacturing_date: p.manufacturing_date || null, expired_date: p.expired_date || null, organization_id: org }],
      Date.now());
    if (r.error) return { batch_number: "" };
    const n = r.numbers[0];
    if (this.batches.some((b) => !b.is_deleted && b.organization_id === org && ci(b.batch_number) === ci(n))) return { batch_number: "" };
    for (const c of r.configs) {
      const row = this.bnc.find((x) => x.id === s(c.id));
      Object.assign(row, { running_number: Number(c.after.running_number), last_reset_date: c.after.last_reset_date });
    }
    return { batch_number: n };
  }
  bncRow(c) {
    return { id: c.id, batch_level_selection: c.batch_level_selection, item_id: castId(c.item_id), item_category_id: castId(c.item_category_id), item_group_id: castId(c.item_group_id),
      batch_format: c.batch_format, running_number: c.running_number, reset_frequency: c.reset_frequency, initial_value: c.initial_value, last_reset_date: c.last_reset_date,
      date_format: c.date_format, format_preview: c.format_preview, organization_id: c.organization_id };
  }
  // SUBTRACT_INVENTORY v59 / ADD_INVENTORY v65 as ONE engine movement each (op CLS|<n>; the classic writes no operation_effect_key)
  classicMove(p, dir, it) {
    const item = this.items.get(s(p.material_id));
    if (!item) return { code: "400", errorMessage: "Item not found" };
    if (dir === "ADD" && Number(item.stock_control) === 0) return { code: 401, errorMessage: "Skipping inventory update for item (stock control = 0)" };
    let batchId = s(p.batch_id);
    if (dir === "ADD") {
      const bn = p.batch_number;
      if (bn !== "-" && !isNil(bn) && !batchId) {
        const conv = (item.uoms || []).find((u) => s(u.alt_uom_id) === s(p.material_uom || item.based_uom));
        const baseQty = conv ? Number((Number(p.quantity) * Number(conv.base_qty)).toFixed(8)) : Number(p.quantity);
        const b = this.insert("Batch", [{ batch_number: bn, material_id: s(p.material_id), initial_quantity: baseQty, transaction_no: p.trx_no, plant_id: s(p.plant_id),
          organization_id: s(p.organization_id), remark: p.remark || "", remark2: p.remark2 || "", remark3: p.remark3 || "", manufacturing_date: p.manufacturing_date || null,
          expired_date: p.expired_date || null }], "classic_add_node_F9KqZLfd")[0];
        b.classic = true;
        if (bn !== "" && bn) batchId = b.id;
      }
    }
    const op = "CLS|" + ++this.classicOp;
    const mv = { movement_key: dir === "ADD" ? "R1" : "M1", direction: dir, plant_id: s(p.plant_id), organization_id: s(p.organization_id), material_id: s(p.material_id),
      quantity: Number(p.quantity), material_uom: s(p.material_uom), transaction_type: p.transaction_type, trx_no: p.trx_no, parent_trx_no: "", inventory_category: p.inventory_category || "Unrestricted",
      location_id: s(p.location_id), batch_id: batchId || null, manufacturing_date: p.manufacturing_date || null, expired_date: p.expired_date || null, doc_date: p.doc_date || null,
      isMovingInv: Number(p.isMovingInv || 0), handling_unit_id: p.handling_unit_id || null };
    if (dir === "ADD") Object.assign(mv, { unit_price: Number(p.unit_price || 0), remark: p.remark || "", remark2: p.remark2 || "", remark3: p.remark3 || "" });
    const r = it.run("INVENTORY_BULK_APPLY", { operation_key: op, mode: "APPLY", organization_id: s(p.organization_id), movements: [mv] }).returned || {};
    for (const m of this.mv) if (s(m.operation_effect_key).indexOf(op + "|") === 0) m.operation_effect_key = null;
    if (s(r.code) !== "200") return { code: "400", errorMessage: s(r.message) };
    const res = (Array.isArray(r.results) ? r.results : [])[0] || {};
    if (s(res.code) === "401") return { code: 401, errorMessage: "Skipping inventory update for item (stock control = 0)" };
    return { code: "200", batchId: batchId || null, unitPrice: res.unit_price, totalPrice: res.total_price };
  }
}
const ORG_DEFAULT = "1123598813738675201";

// ------------------------------------------------------------------------------------------------ the SQL handlers
const tuples = (text, re, what) => parseBig(must(text, re, what)[1]).map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]));
const jsonTables = (text) => {
  const out = [];
  const re = /JSON_TABLE\('(\[[^']*\])'/g;
  let m;
  while ((m = re.exec(text))) out.push(parseBig(m[1]));
  return out;
};
const unhex = (h) => Buffer.from(String(h), "hex").toString("utf8");

function holders(text) {
  const org = must(text, /b\.organization_id = '([0-9]+)'/, "org")[1];
  const hexes = parseBig(must(text, /JSON_TABLE\('(\[[^']*\])', '\$\[\*\]' COLUMNS \(h VARCHAR/, "hex list")[1]).map((h) => ci(unhex(h)));
  const want = new Set(hexes);
  return this.batches.filter((b) => !b.is_deleted && b.organization_id === org && want.has(ci(b.batch_number))).sort(byIdAsc).map((b) => this.batchJ(b));
}
function ours(text) {
  const org = must(text, /b\.organization_id = '([0-9]+)'/, "org")[1];
  const job = must(text, /b\.id > ([0-9]+)/, "b.id > job")[1];
  const ida = must(text, /h\.id = ([0-9]+)\)/, "h.id")[1];
  const h = this.idas.get(ida);
  const no = h ? h.stock_movement_no : null;
  return this.batches.filter((b) => !b.is_deleted && b.organization_id === org && big(b.id) > big(job) && !isNil(no) && ci(b.transaction_no) === ci(no)).sort(byIdAsc).map((b) => this.batchJ(b));
}
function bncRows(text) {
  const org = must(text, /c\.organization_id = '([0-9]+)'/, "org")[1];
  return this.bnc.filter((c) => !c.is_deleted && c.organization_id === org).sort(byIdAsc).map((c) => ({ j: jval(this.bncRow(c)) }));
}
function fpHeader(text) {
  const id = must(text, /h\.id = ([0-9]+)\s/, "h.id")[1];
  const h = this.ida(id);
  return h ? [this.headerJ(h)] : [];
}
function fpLines(text) {
  const id = must(text, /l\.sm_item_disassembly_id = ([0-9]+)/, "l.sm_item_disassembly_id")[1];
  return this.liveLines(id).map((l) => this.lineJ(l));
}
function byJobIda(text) {
  const job = must(text, /ida_v2_job_id = '([0-9]+)'/, "ida_v2_job_id")[1];
  return Array.from(this.idas.values()).filter((h) => !h.is_deleted && s(h.ida_v2_job_id) === job).sort(byIdAsc);
}
function owner(text) {
  const id = must(text, /h\.id = ([0-9]+)\s/, "h.id")[1];
  const lk = must(text, /p\.job_id = 'IDC\|([0-9]+)'/, "IDC| lock")[1];
  if (lk !== id) throw new Error("OWNER: the lock read names IDA " + lk + ", the header " + id);
  return this.ownerRow(id);
}
function opState(text) {
  const m = must(text, /p\.job_id = 'IDC\|([0-9]+)\|([IR])'/, "op key");
  const rows = this.liveStep("IDC|" + m[1] + "|" + m[2], () => true);
  const done = rows.filter((r) => r.step_name === "IBA|DONE").sort(byIdAsc).slice(-1)[0];
  let summary = null;
  if (done) {
    try {
      const o = JSON.parse(done.result_ref);
      summary = o.summary === undefined ? null : jval(o.summary);
    } catch (e) {
      summary = null;
    }
  }
  return [{ intents: rows.filter((r) => r.step_name.indexOf("IBA|I|") === 0).length, review: rows.filter((r) => r.step_name === "IBA|REVIEW").length, done_summary: summary }];
}
function stepRows(text, pred, cols) {
  const job = must(text, /st\.job_id = '([0-9]+)'/, "st.job_id")[1];
  return this.liveStep(job, pred).sort((a, b) => (a.step_name < b.step_name ? -1 : a.step_name > b.step_name ? 1 : 0)).map((r) => {
    const o = {};
    for (const c of cols) o[c] = c === "finished_at" ? fmt(r.finished_at) : r[c];
    return o;
  });
}
function part(text) {
  const m = must(text, /LIKE CONCAT\('([^']*)',\s*'([A-Z_]+)\|%'\)/, "part LIKE");
  return stepRows.call(this, text, (r) => like(m[1] + m[2] + "|%", r.step_name), ["step_name", "result_ref"]);
}
function jobOnly(text) {
  return this.job(must(text, /j\.id = ([0-9]+)/, "j.id")[1]);
}
function wjobRow(text, extra) {
  const j = this.job(must(text, /AND j\.id = ([0-9]+)\s/, "j.id")[1]);
  const base = { db_now: this.dbNow() };
  if (!j) return [Object.assign(base, { id: null })];
  const w = this.wjob(j);
  const o = Object.assign(base, { id: w.id, job_status: w.job_status, progress_percent: w.progress_percent, progress_message: w.progress_message, attempt_count: w.attempt_count,
    next_attempt_at: w.next_attempt_at, lease_owner: w.lease_owner, lease_expires_at: w.lease_expires_at, lease_live: w.lease_live, row_version: w.row_version,
    error_code: w.error_code, error_message: w.error_message, error_details: w.error_details });
  if (extra) o.line_count = w.line_count;
  return [Object.assign(o, { ida_id: w.ida_id, prev_status: w.prev_status, finished_at: w.finished_at })];
}
function finals(text) {
  const ids = listIn(text, /j\.id IN \(([0-9, ]+)\)/, "j.id IN");
  return this.jobs.filter((j) => ids.indexOf(j.id) >= 0).map((j) => ({ id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner,
    error_code: j.error_code, error_message: j.error_message, ida_id: s(j.correlation_id).slice(4) }));
}
function back(text) {
  const key = must(text, /j\.idempotency_key = '([^']*)'/, "key")[1];
  const j = this.jobByKey(key);
  if (!j) return [];
  const g = this.idaOfJob(j);
  const m = s(j.correlation_id).match(/^IDA\|([0-9]{1,20})$/);
  const lk = m ? this.latestLock(m[1]) : null;
  return [{ job_id: j.id, job_status: j.job_status, correlation_id: j.correlation_id, item_disassembly_status: g ? g.item_disassembly_status : null,
    stock_movement_no: g ? g.stock_movement_no : null, ida_v2_job_id: g ? g.ida_v2_job_id : null, lock_ref: lk ? lk.result_ref : null }];
}
function lockRows(text, cols, liveOnly) {
  const org = must(text, /organization_id = '([0-9]+)'/, "org")[1];
  const keys = new Set(parseBig(must(text, /JSON_TABLE\('(\[[^']*\])'/, "lock keys")[1]).map(ci));
  return this.locks.filter((l) => l.organization_id === org && keys.has(ci(l.lock_key)) && (!liveOnly || !l.is_deleted))
    .sort((a, b) => (a.lock_key < b.lock_key ? -1 : a.lock_key > b.lock_key ? 1 : 0)).map((l) => {
      const o = {};
      for (const c of cols) o[c] = c === "id" ? l.id : c === "db_now" ? this.dbNow() : l[c];
      return o;
    });
}
function engBal(text, batch) {
  const org = must(text, /b\.organization_id = '([0-9]+)'/, "org")[1];
  const t = jsonTables(text)[0].map((r) => r.map(String));
  const want = new Set(t.map((r) => r.join("|")));
  const rows = (batch ? this.bb : this.ib).filter((b) => !b.is_deleted && b.organization_id === org
    && want.has(batch ? [b.material_id, b.location_id, s(b.batch_id), b.plant_id].join("|") : [b.material_id, b.location_id, b.plant_id].join("|")));
  return rows.sort(byIdAsc).map((b) => {
    const o = { id: b.id, material_id: b.material_id, location_id: b.location_id };
    if (batch) o.batch_id = s(b.batch_id);
    Object.assign(o, { plant_id: b.plant_id, organization_id: b.organization_id });
    for (const c of ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"]) o[c] = castDec(b[c] || 0, 8);
    if (batch) Object.assign(o, { manufacturing_date: dt(b.manufacturing_date), expired_date: dt(b.expired_date), remark: isNil(b.remark) ? null : b.remark,
      remark2: isNil(b.remark2) ? null : b.remark2, remark3: isNil(b.remark3) ? null : b.remark3 });
    return o;
  });
}
function engCost(text, wa) {
  const org = must(text, /organization_id = '([0-9]+)'/, "org")[1];
  const want = new Set(jsonTables(text)[0].map((r) => r.map(String).join("|")));
  if (!wa) {
    return this.fifo.filter((f) => !f.is_deleted && f.organization_id === org && want.has(f.material_id + "|" + f.plant_id)).sort(byIdAsc).map((f) => ({ id: f.id,
      material_id: f.material_id, plant_id: f.plant_id, organization_id: f.organization_id, batch_id: s(f.batch_id || "0") || "0", fifo_sequence: s(f.fifo_sequence),
      fifo_cost_price: castDec(f.fifo_cost_price, 8), fifo_initial_quantity: castDec(f.fifo_initial_quantity, 8), fifo_available_quantity: castDec(f.fifo_available_quantity, 8) }));
  }
  return this.wa.filter((w) => !w.is_deleted && w.organization_id === org && want.has(w.material_id + "|" + w.plant_id)).sort(byIdAsc).map((w) => ({ id: w.id,
    material_id: w.material_id, plant_id: s(w.plant_id), organization_id: w.organization_id, batch_id: s(w.batch_id || "0") || "0", wa_quantity: castDec(w.wa_quantity, 8),
    wa_cost_price: castDec(w.wa_cost_price, 8), created_at: w.created_at }));
}
function engMv(text) {
  const keys = new Set(parseBig(must(text, /JSON_TABLE\('(\[[^']*\])'/, "effect keys")[1]).map(ci));
  return this.mv.filter((m) => !m.is_deleted && !isNil(m.operation_effect_key) && keys.has(ci(m.operation_effect_key))).map((m) => ({ operation_effect_key: m.operation_effect_key }));
}

const HANDLERS = {
  // ---------------------------------------------------------------- IDA_V2_SUBMIT
  sql_node_DSfacts(text) {
    const key = must(text, /k\.idempotency_key = '([^']*)'/, "key")[1];
    const idaId = must(text, /AND g\.id = ([0-9]+)\s+AND g\.is_deleted = 0\s*$/, "g.id")[1];
    const pos = big(idaId) > 0n;
    const h = pos ? this.ida(idaId) : null;
    const mine = pos ? this.jobs.filter((j) => !j.is_deleted && j.command === "COMPLETE_IDA" && j.correlation_id === "IDA|" + idaId) : [];
    const open = mine.filter((j) => OPEN5.indexOf(j.job_status) >= 0);
    const last = mine.length ? mine.reduce((a, b) => (big(a.id) > big(b.id) ? a : b)) : null;
    const lk = pos ? this.latestLock(idaId) : null;
    const lkJob = lk ? this.jobByKey(lk.result_ref) : null;
    const link = h && h.ida_v2_job_id ? this.jobs.find((j) => !j.is_deleted && j.command === "COMPLETE_IDA" && j.id === s(h.ida_v2_job_id)) : null;
    const no = h ? s(h.stock_movement_no) : "";
    return [{ db_now: this.dbNow(), key_job: this.jobObjText(this.jobByKey(key)), ida_id: h ? h.id : null, stock_movement_no: h ? h.stock_movement_no : null,
      item_disassembly_status: h ? h.item_disassembly_status : null, posted_status: h ? h.posted_status : null, organization_id: h ? h.organization_id : null,
      plant_id: h ? castId(h.issuing_operation_faci) : null, no_type: h ? castId(h.stock_movement_no_type) : null, ida_v2_job_id: h ? h.ida_v2_job_id : null,
      ida_lock: lk ? jval({ step: lk.step_name, ref: lk.result_ref, young: isNil(lk.started_at) ? null : lk.started_at > this.now - 120000 ? 1 : 0, job: lkJob ? lkJob.job_status : null }) : null,
      open_jobs: open.length ? jval(open.map((j) => JSON.parse(this.jobObjText(j)))) : null, last_job: this.jobObjText(last), link_job: this.jobObjText(link),
      issued_by_job: h ? mine.filter((j) => no && ci(jsonPath(j.request_payload, "issuedNo")) === ci(no) && jsonPath(j.request_payload, "issuedNo") !== null).length : 0,
      completed_under: h ? mine.filter((j) => j.job_status === "COMPLETED" && no && jsonPath(j.request_payload, "idaNo") !== null && ci(jsonPath(j.request_payload, "idaNo")) === ci(no)).length : 0 }];
  },
  sql_node_DSitems(text) {
    const ids = listIn(text, /i\.id IN \(([0-9, ]+)\)/, "i.id IN");
    return ids.filter((x, i, a) => x !== "0" && a.indexOf(x) === i && this.items.get(x) && !this.items.get(x).is_deleted).map((x) => this.itemJ(this.items.get(x)));
  },
  sql_node_DScost(text) {
    const pairs = tuples(text, /JSON_TABLE\('(\[[^']*\])', '\$\[\*\]' COLUMNS \(m BIGINT PATH '\$\[0\]', b BIGINT/, "cost pairs");
    const plant = must(text, /f\.plant_id = ([0-9]+)/, "f.plant_id")[1];
    const plantW = must(text, /w\.plant_id = '([0-9]+)'/, "w.plant_id")[1];
    const org = must(text, /f\.organization_id = '([0-9]+)'/, "org")[1];
    const ids = new Set(listIn(text, /f\.material_id IN \(([0-9, ]+)\)/, "f.material_id IN"));
    const seen = new Set();
    const rows = [];
    for (const [m, b] of pairs.slice().sort((x, y) => (big(x[0]) < big(y[0]) ? -1 : big(x[0]) > big(y[0]) ? 1 : big(x[1]) < big(y[1]) ? -1 : 1))) {
      if (seen.has(m + "|" + b)) continue;
      seen.add(m + "|" + b);
      const it = this.items.get(m);
      if (!it || it.is_deleted || Number(it.stock_control) === 0) continue;
      const f = ids.has(m) ? this.fifo.filter((r) => !r.is_deleted && r.material_id === m && r.plant_id === plant && r.organization_id === org && s(r.batch_id || "0") === b).length : 0;
      const w = ids.has(m) ? this.wa.filter((r) => !r.is_deleted && r.material_id === m && s(r.plant_id) === plantW && r.organization_id === org && s(r.batch_id || "0") === b).length : 0;
      if ((f > 0 && w > 0) || (it.material_costing_method === "First In First Out" && f === 0 && w > 0) || (it.material_costing_method === "Weighted Average" && w === 0 && f > 0)) {
        rows.push(J({ material_id: m, batch_id: b, method: it.material_costing_method, fifo: f, wa: w }));
      }
    }
    return rows;
  },
  sql_node_DSwa(text) {
    const pairs = tuples(text, /JSON_TABLE\('(\[[^']*\])'/, "pick pairs");
    const plant = must(text, /w\.plant_id = '([0-9]+)'/, "w.plant_id")[1];
    const org = must(text, /w\.organization_id = '([0-9]+)'/, "org")[1];
    const seen = new Set();
    const rows = [];
    for (const [m, b] of pairs) {
      if (seen.has(m + "|" + b)) continue;
      seen.add(m + "|" + b);
      const it = this.items.get(m);
      if (!it || it.is_deleted || Number(it.stock_control) === 0 || it.material_costing_method !== "Weighted Average") continue;
      if (!this.wa.some((r) => !r.is_deleted && r.material_id === m && s(r.plant_id) === plant && r.organization_id === org && (b === "0" || s(r.batch_id) === b))) {
        rows.push(J({ material_id: m, batch_id: b, material_code: it.material_code }));
      }
    }
    return rows;
  },
  sql_node_DSdup(text) {
    const [bal, bat] = jsonTables(text);
    const plant = must(text, /b\.plant_id = ([0-9]+)/, "plant")[1];
    const org = must(text, /b\.organization_id = '([0-9]+)'/, "org")[1];
    const ids = new Set(listIn(text, /b\.material_id IN \(([0-9, ]+)\)/, "material IN"));
    const rows = [];
    const balSet = new Set(bal.map((r) => r.map(String).join("|")));
    const cnt = {};
    for (const b of this.ib) if (!b.is_deleted && b.plant_id === plant && b.organization_id === org && ids.has(b.material_id) && balSet.has(b.material_id + "|" + b.location_id)) cnt[b.material_id + "|" + b.location_id] = (cnt[b.material_id + "|" + b.location_id] || 0) + 1;
    for (const [k, n] of Object.entries(cnt)) if (n > 1) rows.push(J({ t: "B", material_id: k.split("|")[0], location_id: k.split("|")[1], batch_id: "", n: n }));
    const batSet = new Set(bat.map((r) => r.map(String).join("|")));
    const cnt2 = {};
    for (const b of this.bb) {
      const k = b.material_id + "|" + b.location_id + "|" + s(b.batch_id);
      if (!b.is_deleted && b.plant_id === plant && b.organization_id === org && ids.has(b.material_id) && batSet.has(k)) cnt2[k] = (cnt2[k] || 0) + 1;
    }
    for (const [k, n] of Object.entries(cnt2)) if (n > 1) rows.push(J({ t: "T", material_id: k.split("|")[0], location_id: k.split("|")[1], batch_id: k.split("|")[2], n: n }));
    return rows;
  },
  sql_node_DSbnc: bncRows,
  sql_node_DSbatches: holders,
  sql_node_DShdr(text) {
    return byJobIda.call(this, text).map((h) => ({ id: h.id }));
  },
  sql_node_DSheader(text) {
    return byJobIda.call(this, text).slice(0, 1).map((h) => this.headerJ(h));
  },
  sql_node_DSlines(text) {
    return byJobIda.call(this, text).slice(0, 1).reduce((a, h) => a.concat(this.liveLines(h.id).map((l) => this.lineJ(l))), []);
  },
  sql_node_DSback: back,
  sql_node_DSbackAdd: back,
  // ---------------------------------------------------------------- IDA_V2_WORKER
  sql_node_DWpoll(text) {
    if (!/j\.correlation_id REGEXP '\^IDA\\\\\|\[0-9\]\{1,20\}\$'[\s\S]*AND g\.is_deleted = 0/.test(text)) throw new Error("DWpoll: the read lacks IDA_LOCK_JOIN");
    const m = must(text, /AND \(([0-9]+) = 0 OR j\.id = ([0-9]+)\)/, "job filter");
    const rows = this.jobs.filter((j) => !j.is_deleted && j.command === "COMPLETE_IDA" && (m[1] === "0" || j.id === m[2]) && STATES4.indexOf(j.job_status) >= 0
      && (isNil(j.lease_expires_at) || j.lease_expires_at <= this.now) && (isNil(j.next_attempt_at) || j.next_attempt_at <= this.now)).filter((j) => {
      const c = this.claimOf(j);
      return !c || (!isNil(c.started_at) && c.started_at <= this.now - 600000);
    }).sort((a, b) => a.create_time - b.create_time || (big(a.id) < big(b.id) ? -1 : 1)).slice(0, 5);
    if (!rows.length) return [{ db_now: this.dbNow(), id: null, organization_id: null, ida_id: null, prev_status: null, job_status: null }];
    return rows.map((j) => {
      const w = this.wjob(j);
      const c = this.claimOf(j);
      return { db_now: this.dbNow(), id: w.id, organization_id: w.organization_id, ida_id: w.ida_id, prev_status: w.prev_status, job_status: w.job_status, progress_percent: w.progress_percent,
        progress_message: w.progress_message, attempt_count: w.attempt_count, next_attempt_at: w.next_attempt_at, lease_owner: w.lease_owner, lease_expires_at: w.lease_expires_at,
        dead_lease: w.dead_lease, row_version: w.row_version, error_code: w.error_code, error_message: w.error_message, error_details: w.error_details, claim_id: c ? c.id : null,
        claim_started_at: c ? fmt(c.started_at) : null, claim_owner: c ? c.result_ref : null };
    });
  },
  sql_node_DWtick(text) {
    const ids = listIn(text, /j\.id IN \(([0-9, ]+)\)/, "j.id IN");
    const base = { db_now: this.dbNow(), lease_until: fmt(this.now + 600000) };
    const rows = this.jobs.filter((j) => !j.is_deleted && ids.indexOf(j.id) >= 0);
    if (!rows.length) return [Object.assign({}, base, { id: null })];
    return rows.map((j) => {
      const w = this.wjob(j);
      const c = this.claimOf(j);
      return Object.assign({}, base, { id: w.id, organization_id: w.organization_id, ida_id: w.ida_id, prev_status: w.prev_status, job_status: w.job_status,
        progress_percent: w.progress_percent, progress_message: w.progress_message, attempt_count: w.attempt_count, next_attempt_at: w.next_attempt_at, lease_owner: w.lease_owner,
        lease_expires_at: w.lease_expires_at, lease_live: w.lease_live, dead_lease: w.dead_lease, due_now: isNil(j.next_attempt_at) || j.next_attempt_at <= this.now ? 1 : 0,
        row_version: w.row_version, error_code: w.error_code, error_message: w.error_message, error_details: w.error_details, claim_id: c ? c.id : null,
        claim_started_at: c ? fmt(c.started_at) : null, claim_owner: c ? c.result_ref : null, claim_live: c && !isNil(c.started_at) && c.started_at > this.now - 600000 ? 1 : 0 });
    });
  },
  sql_node_DWown: (t) => null,
  sql_node_DWprepBack: (t) => null,
  sql_node_DWmid: (t) => null,
  sql_node_DWpubBack: (t) => null,
  sql_node_DWsplit: (t) => null,
  sql_node_DWpub2Back: (t) => null,
  sql_node_DWstopFinal: finals,
  sql_node_DWfinal: finals,
  // ---------------------------------------------------------------- IDA_V2_PREPARE
  sql_node_DPjob(text) {
    const jid = must(text, /AND j\.id = ([0-9]+)\s/, "j.id")[1];
    const j = this.job(jid);
    let linked = null;
    if (j) {
      const cands = Array.from(this.idas.values()).filter((g) => !g.is_deleted && s(g.ida_v2_job_id) === jid && g.item_disassembly_status === "Processing").filter((g) => {
        const lk = this.latestLock(g.id);
        return (lk ? lk.result_ref : j.idempotency_key) === j.idempotency_key;
      });
      linked = cands.length ? cands.reduce((a, b) => (big(a.id) > big(b.id) ? a : b)) : null;
    }
    return [{ db_now: this.dbNow(), id: j ? j.id : null, organization_id: j ? j.organization_id : null, command: j ? j.command : null, job_status: j ? j.job_status : null,
      lease_owner: j ? j.lease_owner : null, lease_live: j && !isNil(j.lease_expires_at) ? (j.lease_expires_at > this.now ? 1 : 0) : null, row_version: j ? j.row_version : null,
      attempt_count: j ? j.attempt_count : null, idempotency_key: j ? j.idempotency_key : null, correlation_id: j ? j.correlation_id : null, request_payload: j ? j.request_payload : null,
      is_deleted: j ? j.is_deleted : null, linked_ida: linked ? linked.id : null, linked_ida_no: linked ? linked.stock_movement_no : null,
      linked_ida_no_type: linked ? castId(linked.stock_movement_no_type) : null }];
  },
  sql_node_DPowner: owner,
  sql_node_DPhdr: fpHeader,
  sql_node_DPlines: fpLines,
  sql_node_DPitems(text) {
    const id = must(text, /h\.id = ([0-9]+) AND h\.is_deleted = 0/, "h.id")[1];
    const h = this.ida(id);
    if (!h) return [];
    const ids = [s(h.item_id)].concat(this.liveLines(id).map((l) => s(l.item_selection)).filter((x) => /^[0-9]{1,20}$/.test(x)));
    return ids.filter((x, i, a) => a.indexOf(x) === i && this.items.get(x) && !this.items.get(x).is_deleted).sort((a, b) => (big(a) < big(b) ? -1 : 1)).map((x) => this.itemJ(this.items.get(x)));
  },
  sql_node_DPbins(text) {
    const id = must(text, /h\.id = ([0-9]+) AND h\.is_deleted = 0/, "h.id")[1];
    const h = this.ida(id);
    const ids = new Set(this.liveLines(id).map((l) => s(l.location_id)).filter((x) => x));
    if (h) {
      let picks = [];
      try {
        picks = JSON.parse(h.temp_qty_data);
      } catch (e) {
        picks = [];
      }
      for (const p of Array.isArray(picks) ? picks : []) if (/^[0-9]{1,20}$/.test(s(p && p.location_id))) ids.add(s(p.location_id));
    }
    return Array.from(ids).filter((x) => this.bins.has(x)).sort((a, b) => (big(a) < big(b) ? -1 : 1)).map((x) => J({ id: x, bin: this.bins.get(x) }));
  },
  sql_node_DPtyped(text) {
    const id = must(text, /h\.id = ([0-9]+)\)/, "h.id")[1];
    const h = this.idas.get(id);
    if (!h) return [];
    const nums = new Set();
    for (const l of this.liveLines(id)) {
      const t = s(l.batch_number).trim();
      if (t === "" || t === "-" || t === "Auto-generated batch number") continue;
      nums.add(ci(l.batch_number));
      nums.add(ci(t));
    }
    return this.batches.filter((b) => !b.is_deleted && b.organization_id === h.organization_id && nums.has(ci(b.batch_number))).sort(byIdAsc).map((b) => this.batchJ(b));
  },
  sql_node_DPstorage(text) {
    const id = must(text, /l\.sm_item_disassembly_id = ([0-9]+)/, "lines")[1];
    return this.liveLines(id).map((l) => J({ id: l.id, storage_location_id: castId(l.storage_location_id) }));
  },
  sql_node_DPback(text) {
    const j = jobOnly.call(this, text);
    return j ? [{ id: j.id, job_status: j.job_status, progress_message: j.progress_message, error_code: j.error_code, error_message: j.error_message }] : [];
  },
  // ---------------------------------------------------------------- IDA_V2_COMMIT
  sql_node_DCjob(text) {
    const j = jobOnly.call(this, text);
    const base = { db_now: this.dbNow(), lease_until: fmt(this.now + 600000) };
    if (!j) return [Object.assign(base, { id: null })];
    return [Object.assign(base, { id: j.id, organization_id: j.organization_id, command: j.command, job_status: j.job_status, progress_percent: j.progress_percent,
      progress_message: j.progress_message, attempt_count: j.attempt_count, next_attempt_at: fmt(j.next_attempt_at), lease_owner: j.lease_owner, lease_expires_at: fmt(j.lease_expires_at),
      lease_live: isNil(j.lease_expires_at) ? null : j.lease_expires_at > this.now ? 1 : 0, due: isNil(j.next_attempt_at) || j.next_attempt_at <= this.now ? 1 : 0,
      row_version: j.row_version, error_code: j.error_code, error_message: j.error_message, error_details: j.error_details, idempotency_key: j.idempotency_key,
      correlation_id: j.correlation_id, is_deleted: j.is_deleted, line_count: j.line_count, prev_status: jsonPath(j.request_payload, "prevStatus"), req_action: jsonPath(j.request_payload, "action") })];
  },
  sql_node_DCsteps(text) {
    return stepRows.call(this, text, (r) => /^D[0-9]_/.test(r.step_name), ["step_name", "step_status", "result_ref", "finished_at"]);
  },
  sql_node_DCintent(text) {
    return stepRows.call(this, text, (r) => like("D1|I|%", r.step_name), ["step_name", "result_ref"]);
  },
  sql_node_DCpayload(text) {
    const j = jobOnly.call(this, text);
    return j ? [{ prepared_payload: j.prepared_payload }] : [];
  },
  sql_node_DCida(text) {
    const j = jobOnly.call(this, text);
    const g = j ? this.idaOfJob(j) : null;
    if (!g) return [];
    const lk = this.latestLock(g.id);
    return [{ ida_id: g.id, item_disassembly_status: g.item_disassembly_status, ida_v2_job_id: g.ida_v2_job_id, stock_movement_no: g.stock_movement_no, lock_ref: lk ? lk.result_ref : null }];
  },
  sql_node_DCop1: opState,
  sql_node_DCop2: opState,
  sql_node_DCefopart: part,
  sql_node_DCefoours: ours,
  sql_node_DCown(text) {
    const j = jobOnly.call(this, text);
    return j ? [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }] : [];
  },
  sql_node_DCd0hdr: fpHeader,
  sql_node_DCd0lines: fpLines,
  sql_node_DCd0opart: part,
  sql_node_DCd0oours: ours,
  sql_node_DCd1part: part,
  sql_node_DCd1bnc: bncRows,
  sql_node_DCd1hold: holders,
  sql_node_DCd1dlab: part,
  sql_node_DCd1intentB(text) {
    return stepRows.call(this, text, (r) => like("D1|I|%", r.step_name), ["step_name", "result_ref"]);
  },
  sql_node_DCd1bncB: bncRows,
  sql_node_DCd1holdB: holders,
  sql_node_DCd1engr: part,
  sql_node_DCd1labels: part,
  sql_node_DCd2part: part,
  sql_node_DCd2ops: opState,
  sql_node_DCd2labels: part,
  sql_node_DCd2opart: part,
  sql_node_DCd2oint(text) {
    return stepRows.call(this, text, (r) => like("D1|I|%", r.step_name), ["step_name", "result_ref"]);
  },
  sql_node_DCd2oours: ours,
  sql_node_DCd3engr: part,
  sql_node_DCd3out(text) {
    const job = must(text, /m\.id > ([0-9]+)/, "m.id > job")[1];
    const org = must(text, /m\.organization_id = '([0-9]+)'/, "org")[1];
    const ida = must(text, /h\.id = ([0-9]+)\)/, "h.id")[1];
    const op = must(text, /m\.operation_effect_key LIKE 'IDC\|([0-9]+)\|I\|%'/, "effect key")[1];
    if (op !== job) throw new Error("OUT_TOTALS: the effect key names job " + op + ", m.id > " + job);
    const h = this.idas.get(ida);
    const rows = this.mv.filter((m) => !m.is_deleted && big(m.id) > big(job) && m.organization_id === org && m.movement === "OUT" && m.transaction_type === "IDA" && h
      && ci(m.trx_no) === ci(h.stock_movement_no) && like("IDC|" + job + "|I|%", m.operation_effect_key));
    let t = 0n;
    for (const m of rows) t += BigInt(Number(m.total_price || 0).toFixed(8).replace(".", ""));
    const neg = t < 0n;
    const a = (neg ? -t : t).toString().padStart(9, "0");
    return [{ n: rows.length, total: (neg ? "-" : "") + a.slice(0, -8) + "." + a.slice(-8) }];
  },
  sql_node_DCd3part: part,
  sql_node_DCd3ours: ours,
  sql_node_DCd3ops: opState,
  sql_node_DCd4items: part,
  sql_node_DCd4own: owner,
  sql_node_DCd4lines(text) {
    const id = must(text, /l\.sm_item_disassembly_id = ([0-9]+)/, "lines")[1];
    return this.liveLines(id).map((l) => J({ id: l.id, batch_number: l.batch_number }));
  },
  sql_node_DCd4part: part,
  sql_node_DCd4back: owner,
  sql_node_DCd4linesB(text) {
    return HANDLERS.sql_node_DCd4lines.call(this, text);
  },
  // ---------------------------------------------------------------- IDA_SAVE v7
  sql_node_IDAguard(text) {
    const h = this.ida(must(text, /h\.id = ([0-9]+)\s/, "h.id")[1]);
    return h ? [{ ida_id: h.id, item_disassembly_status: h.item_disassembly_status }] : [];
  },
  // ---------------------------------------------------------------- INVENTORY_BULK_APPLY v10
  sql_node_IBops(text) {
    const op = must(text, /p\.job_id = '([^']*)'/, "op key")[1];
    const rows = this.liveStep(op, (r) => like("IBA|%", r.step_name));
    if (!rows.length) return [{ step_name: null, step_status: null, result_ref: null, error_message: null, db_now: this.dbNow() }];
    return rows.sort(byIdAsc).map((r) => ({ step_name: r.step_name, step_status: r.step_status, result_ref: r.result_ref, error_message: r.error_message, db_now: this.dbNow() }));
  },
  sql_node_IBlk1(text) {
    return lockRows.call(this, text, ["id", "lock_key", "balance_type", "free_token", "owner_operation_id", "lock_version", "last_owner_operation_id", "is_deleted", "db_now"], false);
  },
  sql_node_IBlk2(text) {
    return lockRows.call(this, text, ["id", "lock_key", "free_token", "owner_operation_id", "db_now"], true);
  },
  sql_node_IBlk3(text) {
    return lockRows.call(this, text, ["id", "lock_key", "free_token", "owner_operation_id"], true);
  },
  sql_node_IBrel(text) {
    return lockRows.call(this, text, ["id", "lock_key", "free_token", "owner_operation_id", "lock_version", "db_now"], true);
  },
  sql_node_IBitems(text) {
    const ids = must(text, /CONCAT\('\[', '([0-9,]*)', '\]'\)/, "material ids")[1].split(",").filter((x) => x && x !== "0");
    return ids.filter((x, i, a) => a.indexOf(x) === i && this.items.get(x) && !this.items.get(x).is_deleted).map((x) => {
      const it = this.items.get(x);
      return { id: it.id, item_batch_management: it.item_batch_management, stock_control: it.stock_control, based_uom: castId(it.based_uom),
        material_costing_method: it.material_costing_method, purchase_unit_price: castDec(it.purchase_unit_price, 4),
        uom_conversion_json: (it.uoms || []).length ? jval((it.uoms || []).map((u) => ({ alt_uom_id: castId(u.alt_uom_id), base_qty: dec(u.base_qty, 6) }))) : "[]" };
    });
  },
  sql_node_IBbal: (t) => null,
  sql_node_IBbatch: (t) => null,
  sql_node_IBfifo: (t) => null,
  sql_node_IBwa: (t) => null,
  sql_node_IBmv: engMv,
  sql_node_IBprec() {
    return (this.precRows || []).map((r) => Object.assign({}, r));
  },
  sql_node_IBbalB: (t) => null,
  sql_node_IBbatchB: (t) => null,
  sql_node_IBfifoB: (t) => null,
  sql_node_IBwaB: (t) => null,
  sql_node_IBmvB: engMv,
  // ---------------------------------------------------------------- INVENTORY_LOCK_TOKENS v5
  sql_node_C2IGFf42(text) {
    const org = must(text, /organization_id = '([0-9]+)'/, "org")[1];
    const ids = listIn(text, /AND id IN \(([0-9, ]+)\)/, "id IN");
    const types = ["ITEM", "BATCH", "HU", "RESERVATION", "COST"];
    return this.locks.filter((l) => !l.is_deleted && l.organization_id === org && ids.indexOf(l.id) >= 0 && types.indexOf(l.balance_type) >= 0)
      .sort((a, b) => (a.lock_key < b.lock_key ? -1 : 1)).map((l) => ({ id: l.id, lock_key: l.lock_key, balance_type: l.balance_type, free_token: l.free_token,
        owner_operation_id: l.owner_operation_id, lock_version: l.lock_version, last_owner_operation_id: l.last_owner_operation_id, is_deleted: l.is_deleted,
        updated_at: fmtMs(l.update_time), db_now: this.dbNow() }));
  },
};
for (const k of ["sql_node_DWown", "sql_node_DWmid", "sql_node_DWpubBack", "sql_node_DWsplit", "sql_node_DWpub2Back"]) HANDLERS[k] = function (t) { return wjobRow.call(this, t, false); };
HANDLERS.sql_node_DWprepBack = function (t) { return wjobRow.call(this, t, true); };
HANDLERS.sql_node_IBbal = function (t) { return engBal.call(this, t, false); };
HANDLERS.sql_node_IBbalB = HANDLERS.sql_node_IBbal;
HANDLERS.sql_node_IBbatch = function (t) { return engBal.call(this, t, true); };
HANDLERS.sql_node_IBbatchB = HANDLERS.sql_node_IBbatch;
HANDLERS.sql_node_IBfifo = function (t) { return engCost.call(this, t, false); };
HANDLERS.sql_node_IBfifoB = HANDLERS.sql_node_IBfifo;
HANDLERS.sql_node_IBwa = function (t) { return engCost.call(this, t, true); };
HANDLERS.sql_node_IBwaB = HANDLERS.sql_node_IBwa;

module.exports = { World, HANDLERS, BA, T, fmt, parseTs, dt, jval, ci, parseBig, s, big, byIdAsc };
