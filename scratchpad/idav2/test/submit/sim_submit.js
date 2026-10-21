// TZ=Asia/Kuala_Lumpur node scratchpad/idav2/test/submit/sim_submit.js - runs the BUILT IDA_V2_SUBMIT.json through lib/sim's FlowGram
// interpreter against an in-memory model of sm_item_disassembly / gd_async_job / gd_publish_step (unique keys enforced, SQL mocks computed
// from the model): the write order of an Add and of a stored Draft, the number rule, every refusal before the first write (the dry run
// reserves nothing), the idempotency key twice, twins, BUSY, a lost read-back -> STOP 500, a Clone's new ids
const path = require("path");
const fs = require("fs");
const IDAV2 = path.join(__dirname, "..", "..");
const { Engine } = require(path.join(IDAV2, "lib", "sim", "engine.js"));
const F = require(path.join(IDAV2, "code", "shared", "fingerprint.js"));
const C = require(path.join(IDAV2, "code", "shared", "ida_common.js"));
const BUILT = require("./load_submit").BUILT;
const T = "000000";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const SRC = "2105489115887079441";
const BIN = "2018912822846582786";
const RBIN = "2018912822846582999";
const SLOC = "2018912759311265793";
const UOM = "2018906563477008392";
const ID = "2112073133161844738";

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + String(JSON.stringify(got)).slice(0, 900) + "\n  want " + String(JSON.stringify(want)).slice(0, 900));
  }
};
const comp = (i) => String(2094626841323700300n + BigInt(i));
const q8s = (v) => (v === undefined || v === null || v === "" ? null : Number((parseFloat(v) || 0).toFixed(8)).toFixed(8));

class Model {
  constructor(opts) {
    this.tenantId = T;
    this.seq = 2112300000000000000n;
    this.no = 41;
    this.ida = {};
    this.jobs = [];
    this.steps = [];
    this.writes = [];
    this.now = "2026-10-21 10:00:00";
    Object.assign(this, opts || {});
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }
  number() {
    this.no += 1;
    return "IDA-2610-" + String(this.no).padStart(4, "0");
  }
  // the whole-subform write: rows missing from the call go (soft-deleted), rows without a known id are inserted
  writeLines(h, lines) {
    const keep = [];
    for (const l of Array.isArray(lines) ? lines : []) {
      const old = h.lines.find((x) => x.id && String(x.id) === String(l.id));
      keep.push(Object.assign({}, l, { id: old ? old.id : this.id() }));
    }
    h.lines = keep;
  }
  insert(table, rows) {
    return rows.map((r0) => {
      const r = Object.assign({}, r0);
      delete r.__id;
      if (this.failInsert && this.failInsert(table, r)) throw new Error("injected crash at the " + table + " insert");
      if (table === "GD Async Job") {
        if (this.jobs.some((j) => j.organization_id === r.organization_id && j.idempotency_key === r.idempotency_key)) throw new Error("Duplicate entry for key 'Idempotency Key'");
        r.id = this.id();
        this.jobs.push(r);
      } else if (table === "GD Publish Step") {
        if (this.steps.some((x) => x.job_id === r.job_id && x.step_name === r.step_name)) throw new Error("Duplicate entry for key 'Job Step'");
        r.id = this.id();
        this.steps.push(r);
      } else if (table === "Item Disassembly") {
        r.id = this.id();
        if (r.stock_movement_no === "issued") r.stock_movement_no = this.number();
        const h = Object.assign({}, r, { lines: [] });
        this.writeLines(h, r.stock_movement);
        delete h.stock_movement;
        this.ida[r.id] = h;
      } else throw new Error("insert into " + table + " not modelled");
      this.writes.push(["insert", table, r]);
      return r;
    });
  }
  update(table, rows) {
    for (const r0 of rows) {
      const id = String(r0.__id);
      const set = Object.assign({}, r0);
      delete set.__id;
      delete set.id;
      if (table === "GD Async Job") {
        const j = this.jobs.find((x) => x.id === id);
        if (j) Object.assign(j, set);
      } else if (table === "Item Disassembly") {
        const h = this.ida[id];
        if (!h) continue;
        if (this.dropJobLink) delete set.ida_v2_job_id;
        if (set.stock_movement_no === "issued") set.stock_movement_no = this.number();
        const lines = set.stock_movement;
        delete set.stock_movement;
        Object.assign(h, set);
        if (lines !== undefined) this.writeLines(h, lines);
      } else throw new Error("update of " + table + " not modelled");
      this.writes.push(["update", table, Object.assign({ id: id }, r0)]);
    }
    return { count: rows.length };
  }
  jobObj(j) {
    if (!j) return null;
    const req = C.idaParseJ(j.request_payload) || {};
    return JSON.stringify({ id: j.id, command: j.command, job_status: j.job_status, correlation_id: j.correlation_id, progress_percent: j.progress_percent,
      progress_message: j.progress_message, error_code: j.error_code || null, error_message: j.error_message || null, line_count: j.line_count, action: req.action || null,
      ida_no: req.idaNo || null });
  }
  latestLock(ida) {
    return this.steps.filter((p) => p.job_id === "IDC|" + ida && /^LOCK\|/.test(p.step_name)).slice(-1)[0] || null;
  }
  facts(sql) {
    const key = sql.match(/k\.idempotency_key = '([^']*)'/)[1];
    const ida = sql.match(/AND g\.id = ([0-9]+)\s*AND g\.is_deleted = 0\s*$/)[1];
    const h = ida !== "0" ? this.ida[ida] : null;
    const kj = this.jobs.filter((j) => j.idempotency_key === key).slice(-1)[0];
    const mine = this.jobs.filter((j) => j.correlation_id === "IDA|" + ida);
    const lk = this.latestLock(ida);
    const open = mine.filter((j) => C.IDA_OPEN_JOB.indexOf(j.job_status) >= 0);
    const no = h ? h.stock_movement_no : null;
    const req = (j) => C.idaParseJ(j.request_payload) || {};
    return [{ db_now: this.now, key_job: this.jobObj(kj), ida_id: h ? ida : null, stock_movement_no: no, item_disassembly_status: h ? h.item_disassembly_status : null,
      posted_status: h ? h.posted_status || null : null, organization_id: h ? h.organization_id : null, plant_id: h ? h.issuing_operation_faci : null,
      no_type: h ? String(h.stock_movement_no_type) : null, ida_v2_job_id: h ? h.ida_v2_job_id || null : null,
      ida_lock: lk ? JSON.stringify({ step: lk.step_name, ref: lk.result_ref, young: this.lockYoung === undefined ? 1 : this.lockYoung,
        job: (this.jobs.filter((j) => j.idempotency_key === lk.result_ref).slice(-1)[0] || {}).job_status || null }) : null,
      open_jobs: open.length ? "[" + open.map((j) => this.jobObj(j)).join(",") + "]" : null, last_job: this.jobObj(mine.slice(-1)[0]),
      link_job: h && h.ida_v2_job_id ? this.jobObj(this.jobs.find((j) => j.id === h.ida_v2_job_id)) : null,
      issued_by_job: h ? mine.filter((j) => no && req(j).issuedNo === no).length : 0,
      completed_under: h ? mine.filter((j) => j.job_status === "COMPLETED" && no && req(j).idaNo === no).length : 0 }];
  }
  byJob(sql) {
    const job = sql.match(/ida_v2_job_id = '([0-9]+)'/)[1];
    return Object.keys(this.ida).filter((id) => this.ida[id].ida_v2_job_id === job).sort();
  }
  header(id) {
    const h = this.ida[id];
    return { j: JSON.stringify({ id: id, item_id: h.item_id, item_code: h.item_code, item_name: h.item_name, item_qty: q8s(h.item_qty), item_uom: h.item_uom,
      issuing_operation_faci: h.issuing_operation_faci, organization_id: h.organization_id, stock_movement_no: h.stock_movement_no,
      stock_movement_no_type: String(h.stock_movement_no_type), item_disassembly_status: h.item_disassembly_status, posted_status: h.posted_status || null,
      item_disassembly_date: h.item_disassembly_date ? h.item_disassembly_date + " 00:00:00" : null, temp_qty_data: h.temp_qty_data, temp_hu_data: h.temp_hu_data || null,
      table_hu: null, remarks: h.remarks, remarks_2: h.remarks_2, remarks_3: h.remarks_3, ida_v2_job_id: h.ida_v2_job_id || null }) };
  }
  lineRows(id) {
    return this.ida[id].lines.map((l) => ({ j: JSON.stringify({ id: l.id, line_index: String(l.line_index), item_selection: l.item_selection, quantity_uom: l.quantity_uom,
      total_quantity: q8s(l.total_quantity), location_id: l.location_id, batch_number: l.batch_number, manufacturing_date: null, expired_date: null,
      item_remark: l.item_remark || null, issuing_plant: l.issuing_plant, organization_id: l.organization_id, item_name: l.item_name }) }));
  }
  back(sql) {
    const key = sql.match(/j\.idempotency_key = '([^']*)'/)[1];
    const j = this.jobs.filter((x) => x.idempotency_key === key).slice(-1)[0];
    if (!j) return [];
    const m = String(j.correlation_id || "").match(/^IDA\|([0-9]{1,20})$/);
    const h = m ? this.ida[m[1]] : null;
    const lk = m ? this.latestLock(m[1]) : null;
    return [{ job_id: j.id, job_status: j.job_status, correlation_id: j.correlation_id, item_disassembly_status: h ? h.item_disassembly_status : null,
      stock_movement_no: h ? h.stock_movement_no : null, ida_v2_job_id: h ? h.ida_v2_job_id || null : null, lock_ref: lk ? lk.result_ref : null }];
  }
}

const bncRow = (o) => ({ j: JSON.stringify(Object.assign({ id: "2062365526375706626", batch_level_selection: "Organization Level", item_id: null, item_category_id: null,
  item_group_id: null, batch_format: "Batch-%5d", running_number: 631, reset_frequency: "Never Reset", initial_value: 0, last_reset_date: null,
  date_format: "Document Created Date", format_preview: "Batch-00001", organization_id: ORG }, o || {})) });

class Sim extends Engine {
  constructor(model, sc) {
    const rows = (list) => list.map((it) => ({ j: JSON.stringify(it) }));
    super({ dir: path.dirname(BUILT), db: model, mocks: { read: {}, sql: {
      sql_node_DSfacts: (q) => model.facts(q),
      sql_node_DSitems: () => rows(sc.items),
      sql_node_DScost: () => sc.cost || [],
      sql_node_DSwa: () => sc.wa || [],
      sql_node_DSdup: () => sc.dup || [],
      sql_node_DSbnc: () => (sc.bnc === undefined ? [bncRow()] : sc.bnc),
      sql_node_DSbatches: (q) => {
        model.hexSeen = q.match(/JSON_TABLE\('([^']*)'/)[1];
        return sc.batches || [];
      },
      sql_node_DShdr: (q) => model.byJob(q).map((id) => ({ id: id })),
      sql_node_DSheader: (q) => model.byJob(q).slice(0, 1).map((id) => model.header(id)),
      sql_node_DSlines: (q) => model.byJob(q).slice(0, 1).reduce((a, id) => a.concat(model.lineRows(id)), []),
      sql_node_DSback: (q) => model.back(q),
      sql_node_DSbackAdd: (q) => model.back(q),
    } } });
    this.model = model;
    this.sc = sc;
  }
  load(name) {
    if (name === "IDA_V2_SUBMIT") return JSON.parse(fs.readFileSync(BUILT, "utf8"));
    throw new Error("no workflow " + name);
  }
  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined ? "null" : JSON.stringify(v);
    });
  }
}

const pickOf = (j, extra) => Object.assign({ material_id: SRC, location_id: BIN, batch_id: null, balance_id: String(9000 + j), sm_quantity: 1, category: "Unrestricted" },
  extra || {});
const lineOf = (i, extra) => Object.assign({ item_selection: comp(i), item_name: "C" + i, total_quantity: 1, requested_qty: 1, bom_ratio: 1, quantity_uom: UOM,
  storage_location_id: SLOC, location_id: RBIN, batch_number: "-" }, extra || {});
const record = (lines, extra) => Object.assign({ organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: "", stock_movement_no_type: "2107022471794724866",
  item_disassembly_status: "", item_id: SRC, item_code: "FG-0001", item_name: "FG", item_desc: "", item_qty: 1, item_uom: UOM, item_disassembly_date: "2026-10-21",
  issued_by: "t", project_id: "", remarks: "", remarks_2: "", remarks_3: "", reference_documents: [], stock_summary: "", temp_qty_data: JSON.stringify([pickOf(0)]),
  temp_hu_data: "[]", page_status: "Add", stock_movement: lines }, extra || {});
const itemRow = (id, extra) => Object.assign({ id: id, material_code: "M" + id.slice(-4), stock_control: 1, serial_number_management: 0, item_batch_management: 0,
  batch_number_genaration: "", material_costing_method: "First In First Out", purchase_unit_price: "0.0000", based_uom: UOM, item_category: "2018905941675634693",
  item_group_id: null, table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }] }, extra || {});
const ITEMS = [itemRow(SRC)].concat(Array.from({ length: 70 }, (_, i) => itemRow(comp(i))));
const lines60 = () => Array.from({ length: 60 }, (_, i) => lineOf(i));
const keyOf = (id, gen) => "IDA:" + ORG + ":" + id + ":0123456789abcdef:" + (gen || 1);
function go(model, req, sc) {
  const e = new Sim(model, Object.assign({ items: ITEMS }, sc || {}));
  let out = null;
  let error = null;
  try {
    out = e.run("IDA_V2_SUBMIT", Object.assign({ operation: "SUBMIT", saveAs: "Completed", source: "FORM" }, req)).returned;
  } catch (x) {
    error = x.message;
  }
  return { out: out, error: error, steps: e.trace.map((t) => t.split(" ")[1]) };
}
const writesOf = (model) => model.writes.map((w) => w[0] + " " + w[1] + (w[1] === "GD Publish Step" ? " " + w[2].step_name : ""));

// 1. an Add: job -> IDA (Processing) -> read-back -> LOCK|1 -> link -> due
let m = new Model();
let r = go(m, { pageStatus: "Add", ida_id: "", idempotency_key: keyOf("new-a1"), form: record(lines60()) });
eq("Add: QUEUED", r.error || [r.out.route, r.out.code, r.out.job_status, r.out.ida_no, r.out.line_count], ["QUEUED", "200", "QUEUED", "IDA-2610-0042", "61"]);
eq("Add: the write order", writesOf(m), ["insert GD Async Job", "insert Item Disassembly", "insert GD Publish Step LOCK|1", "update GD Async Job", "update GD Async Job"]);
const ida1 = Object.keys(m.ida)[0];
const h1 = m.ida[ida1];
eq("Add: the IDA is Processing under the job, with the key, no posted_status, 60 lines with their placeholders", [h1.item_disassembly_status, h1.ida_v2_job_id, h1.ida_idem_key,
  "posted_status" in h1, h1.lines.length, h1.lines.every((l) => l.batch_number === "-")], ["Processing", m.jobs[0].id, keyOf("new-a1"), false, 60, true]);
eq("Add: the job linked, due now, line_count = moves", [m.jobs[0].command, m.jobs[0].correlation_id, m.jobs[0].causation_id, m.jobs[0].next_attempt_at, m.jobs[0].line_count],
  ["COMPLETE_IDA", "IDA|" + ida1, ida1, "2026-10-21 10:00:00", 61]);
const req1 = C.idaParseJ(m.jobs[0].request_payload);
eq("Add: request idaId / idaNo / issuedNo / lineFingerprint from the read-back", [req1.idaId, req1.idaNo, req1.issuedNo, req1.lineFingerprint],
  [ida1, "IDA-2610-0042", "IDA-2610-0042", F.idaLineFingerprint(m.lineRows(ida1), [m.header(ida1)])]);
eq("Add: the lock is the key", [m.steps[0].job_id, m.steps[0].step_name, m.steps[0].result_ref, m.steps[0].step_status], ["IDC|" + ida1, "LOCK|1", keyOf("new-a1"), "LOCK"]);
eq("Add: answer ida_id", r.out.ida_id, ida1);
eq("Add: its BACK runs after the LOCK|1 and the link, the stored-Draft BACK never", [r.steps.indexOf("sql_node_DSbackAdd") > r.steps.indexOf("update_node_DSlink"),
  r.steps.indexOf("update_node_DSlink") > r.steps.indexOf("add_node_DSlock1"), r.steps.indexOf("sql_node_DSback")], [true, true, -1]);
eq("Add: the typed numbers reach SQL only hex-encoded (the classic sentinel here)", m.hexSeen, C.idaHexJson(["__no_batch__"]));
// the same key again (a lost answer re-sent): that job's STATUS, nothing written
let before = m.writes.length;
r = go(m, { pageStatus: "Add", ida_id: "", idempotency_key: keyOf("new-a1"), form: record(lines60()) });
eq("the same key twice: STATUS of the job, nothing written", [r.out.route, r.out.job_id, r.out.ida_id, m.writes.length - before], ["STATUS", m.jobs[0].id, ida1, 0]);
// another key while the job is open: BUSY
r = go(m, { pageStatus: "Edit", ida_id: ida1, idempotency_key: keyOf(ida1), form: Object.assign(record(lines60()), { id: ida1, item_disassembly_status: "Processing" }) });
eq("another key on the Processing IDA: BUSY", [r.out.route, r.out.code, r.out.error_code, r.out.job_id], ["BUSY", "409", "IDA_BUSY", m.jobs[0].id]);
r = go(m, { operation: "STATUS", pageStatus: "", ida_id: "", idempotency_key: keyOf("new-a1"), form: {} });
eq("STATUS by key", [r.out.route, r.out.ida_id, r.out.job_status, r.out.terminal], ["STATUS", ida1, "QUEUED", "NO"]);
r = go(m, { operation: "STATUS", pageStatus: "", ida_id: ida1, idempotency_key: "", form: {} });
eq("STATUS by ida_id", [r.out.route, r.out.job_id, r.out.job_status], ["STATUS", m.jobs[0].id, "QUEUED"]);

// 2. a stored Draft: LOCK|n+1 -> job -> IDA update -> read-back -> due (+ the request)
m = new Model();
m.ida[ID] = Object.assign(record([], { page_status: "Edit", item_disassembly_status: "Draft", stock_movement_no: "IDA-2610-0007" }), { lines: [] });
m.writeLines(m.ida[ID], lines60().map((l, i) => Object.assign(l, { line_index: i + 1 })));
m.steps.push({ id: "1", job_id: "IDC|" + ID, step_name: "LOCK|2", result_ref: "IDA:old:key:1", step_status: "LOCK" });
m.lockYoung = 0;
const stored = () => Object.assign(record(m.ida[ID].lines.map((l) => Object.assign({}, l)), { id: ID, page_status: "Edit", item_disassembly_status: "Draft",
  stock_movement_no: "IDA-2610-0007" }));
r = go(m, { pageStatus: "Edit", ida_id: ID, idempotency_key: keyOf(ID), form: stored() });
eq("stored Draft: QUEUED", r.error || [r.out.route, r.out.ida_id, r.out.ida_no], ["QUEUED", ID, "IDA-2610-0042"]);
eq("stored Draft: the write order (lock first)", writesOf(m), ["insert GD Publish Step LOCK|3", "insert GD Async Job", "update Item Disassembly", "update GD Async Job"]);
eq("stored Draft: its BACK runs in the read-back fork-join (before the link), the Add's BACK never", [r.steps.indexOf("sql_node_DSback") > r.steps.indexOf("update_node_DSidaNum"),
  r.steps.indexOf("sql_node_DSback") < r.steps.indexOf("code_node_DSlink"), r.steps.indexOf("sql_node_DSbackAdd")], [true, true, -1]);
const upd = m.writes[2][2];
eq("stored Draft: the update carries Processing, the job, the key, the number sentinel, no posted_status (25 props incl. id)", [upd.item_disassembly_status,
  upd.ida_v2_job_id, upd.ida_idem_key, upd.stock_movement_no, "posted_status" in upd, Object.keys(upd).filter((k) => k !== "__id").length],
["Processing", m.jobs[0].id, keyOf(ID), "issued", false, 25]);
eq("stored Draft: existing line ids kept (an update, not new rows)", m.ida[ID].lines.map((l) => l.id).join(), stored().stock_movement.map((l) => l.id).join());
const req2 = C.idaParseJ(m.jobs[0].request_payload);
eq("stored Draft: due wrote the final request", [m.jobs[0].next_attempt_at, req2.idaId, req2.idaNo, req2.issuedNo, req2.lineFingerprint, m.jobs[0].correlation_id],
  ["2026-10-21 10:00:00", ID, "IDA-2610-0042", "IDA-2610-0042", F.idaLineFingerprint(m.lineRows(ID), [m.header(ID)]), "IDA|" + ID]);
// a line removed from the form is soft-deleted by the whole-subform write; a new line inserted (the classic's semantics)
const fewer = stored();
fewer.stock_movement = fewer.stock_movement.slice(1).concat([lineOf(65)]);
m.jobs[0].job_status = "FAILED";
m.ida[ID].item_disassembly_status = "Draft";
r = go(m, { pageStatus: "Edit", ida_id: ID, idempotency_key: keyOf(ID, 2), form: Object.assign(fewer, { stock_movement_no: "IDA-2610-0042" }) });
eq("stored Draft: the whole-subform write (a removed line gone, a new one inserted)", [r.out.route, m.ida[ID].lines.length, m.ida[ID].lines.some((l) => l.item_selection === comp(0)),
  m.ida[ID].lines.some((l) => l.item_selection === comp(65))], ["QUEUED", 60, false, true]);
const upd2 = m.writes.filter((w) => w[1] === "Item Disassembly").slice(-1)[0][2];
eq("number rule: after a FAILED job, the number it issued is kept (no number props, 23 props)", ["stock_movement_no" in upd2, "stock_movement_no_type" in upd2,
  m.ida[ID].stock_movement_no, C.idaParseJ(m.jobs[1].request_payload).issuedNo, Object.keys(upd2).filter((k) => k !== "__id").length], [false, false, "IDA-2610-0042", "", 23]);
m.jobs[1].job_status = "COMPLETED";
m.ida[ID].item_disassembly_status = "Draft";
r = go(m, { pageStatus: "Edit", ida_id: ID, idempotency_key: keyOf(ID, 3), form: Object.assign(stored(), { stock_movement_no: "IDA-2610-0042" }) });
eq("number rule: after a COMPLETED job under the number, a new number", [r.out.route, m.ida[ID].stock_movement_no, C.idaParseJ(m.jobs[2].request_payload).issuedNo],
  ["QUEUED", "IDA-2610-0043", "IDA-2610-0043"]);

// 3. every refusal answers before the first write
const autoItems = ITEMS.map((it, i) => (i === 5 ? Object.assign({}, it, { item_batch_management: 1, batch_number_genaration: "According To System Settings" }) : it));
const autoForm = () => {
  const x = record(lines60());
  x.stock_movement[4].batch_number = "Auto-generated batch number";
  return x;
};
const typedForm = () => {
  const x = record(lines60());
  x.stock_movement[6].batch_number = "lot-7";
  return x;
};
for (const [label, sc, req, want, code] of [
  ["NOT_ELIGIBLE (serial source)", { items: ITEMS.map((it, i) => (i === 0 ? Object.assign({}, it, { serial_number_management: 1 }) : it)) }, {}, "NOT_ELIGIBLE", "IDA_NOT_ELIGIBLE"],
  ["STOP (WA screen)", { wa: [{ j: JSON.stringify({ material_id: SRC, batch_id: "0" }) }] }, {}, "STOP", "IDA_NO_WA_RECORD"],
  ["INVALID (no key)", {}, { idempotency_key: "" }, "INVALID", "IDA_INVALID_REQUEST"],
  ["NOT_ELIGIBLE (Draft)", {}, { saveAs: "Draft" }, "NOT_ELIGIBLE", "IDA_NOT_ELIGIBLE"],
  ["STOP (required fields)", {}, { form: Object.assign(record(lines60()), { item_disassembly_date: "" }) }, "STOP", "IDA_REQUIRED_FIELDS"],
  ["STOP (dry run: no default config)", { items: autoItems, bnc: [] }, { form: autoForm() }, "STOP", "IDA_BATCH_CONFIG"],
  ["STOP (F4: a typed number held, other case)", { batches: [{ j: JSON.stringify({ id: "1", batch_number: "LOT-7", material_id: comp(90), plant_id: PLANT,
    organization_id: ORG, transaction_no: "GR-1" }) }] }, { form: typedForm() }, "STOP", "IDA_INVALID"],
  ["STOP (5,001 recovery lines)", {}, { form: record(Array.from({ length: 5001 }, (_, i) => lineOf(i % 60))) }, "STOP", "IDA_SPLIT_REQUIRED"]]) {
  m = new Model();
  r = go(m, Object.assign({ pageStatus: "Add", ida_id: "", idempotency_key: keyOf("new-x"), form: record(lines60()) }, req), sc);
  eq(label + ": answered, nothing written", [r.error, r.out && r.out.route, r.out && r.out.error_code, m.writes.length,
    Object.values(r.out || {}).every((v) => typeof v === "string")], [null, want, code, 0, true]);
}
m = new Model();
r = go(m, { pageStatus: "Add", ida_id: "", idempotency_key: keyOf("new-d1"), form: autoForm() }, { items: autoItems });
eq("dry run passes: queued, the line keeps its placeholder, nothing reserved (no config / Batch write exists)", [r.out.route,
  m.ida[Object.keys(m.ida)[0]].lines[4].batch_number, writesOf(m).filter((w) => !/GD Async Job|Item Disassembly|GD Publish Step/.test(w))],
["QUEUED", "Auto-generated batch number", []]);
eq("the gate ran after the reads and before the first write", r.steps.indexOf("code_node_DSgate") > r.steps.indexOf("sql_node_DSbnc")
  && r.steps.indexOf("code_node_DSgate") < r.steps.indexOf("add_node_DSjob"), true);

// 4. twins and crashes
m = new Model({ failInsert: (table) => table === "GD Async Job" });
r = go(m, { pageStatus: "Add", ida_id: "", idempotency_key: keyOf("new-t1"), form: record(lines60()) });
eq("Add: the job insert fails (a twin of the key) -> no IDA written", [r.out, Object.keys(m.ida).length], [null, 0]);
const formD = Object.assign(record(lines60()), { id: ID, item_disassembly_status: "Draft" });
m = new Model();
m.ida[ID] = Object.assign(record([], { item_disassembly_status: "Draft", stock_movement_no: "IDA-2610-0007" }), { lines: [] });
m.steps.push({ id: "1", job_id: "IDC|" + ID, step_name: "LOCK|1", result_ref: "IDA:another:key:1" });
m.lockYoung = 0;
// a concurrent submit of another key took LOCK|2 between our facts read and our lock insert
const facts0 = m.facts.bind(m);
m.facts = (q) => {
  const f = facts0(q);
  m.steps.push({ id: "9", job_id: "IDC|" + ID, step_name: "LOCK|2", result_ref: keyOf(ID, 7) });
  return f;
};
r = go(m, { pageStatus: "Edit", ida_id: ID, idempotency_key: keyOf(ID, 1), form: formD });
eq("two keys on one Draft: the loser fails at its LOCK insert, writes nothing else", [r.out, /Job Step/.test(r.error), m.jobs.length, m.writes.length], [null, true, 0, 0]);
m = new Model({ dropJobLink: true });
m.ida[ID] = Object.assign(record([], { item_disassembly_status: "Draft", stock_movement_no: "IDA-2610-0007" }), { lines: [] });
r = go(m, { pageStatus: "Edit", ida_id: ID, idempotency_key: keyOf(ID), form: formD });
eq("a document write that did not read back: STOP 500, the job not made due", [r.out.route, r.out.code, r.out.error_code, m.jobs[0].next_attempt_at],
  ["STOP", "500", "IDA_QUEUE_FAILED", "2026-10-21 10:10:00"]);
m = new Model();
r = go(m, { pageStatus: "Clone", ida_id: "", idempotency_key: keyOf("new-c1"),
  form: Object.assign(record(lines60().map((l, i) => Object.assign(l, { id: String(2112073133161845000n + BigInt(i)) }))), { id: ID, item_disassembly_status: "Completed",
    page_status: "Clone", ida_v2_job_id: "2112100000000000001", ida_idem_key: "IDA:old" }) });
const clone = m.ida[Object.keys(m.ida)[0]];
eq("Clone: a new IDA with new line ids (the source ids never written), this job's link only", [r.out.route, Object.keys(m.ida)[0] !== ID,
  clone.lines.every((l) => !String(l.id).startsWith("21120731331618")), clone.ida_v2_job_id === m.jobs[0].id, clone.ida_idem_key], ["QUEUED", true, true, true, keyOf("new-c1")]);

// 5. scale: a 2,000-line Add (2,000 distinct recovery items, remarks and UOM options on every line) in one run
{
  const N = 2000;
  const bigLines = Array.from({ length: N }, (_, i) => lineOf(i, { item_remark: "remark " + i, uom_options: JSON.stringify([{ label: "PCS", value: UOM }]) }));
  const bigItems = [itemRow(SRC)].concat(Array.from({ length: N }, (_, i) => itemRow(comp(i))));
  m = new Model();
  const e = new Sim(m, { items: bigItems });
  const t0 = Date.now();
  const out = e.run("IDA_V2_SUBMIT", { operation: "SUBMIT", saveAs: "Completed", source: "FORM", pageStatus: "Add", ida_id: "", idempotency_key: keyOf("new-big"),
    form: record(bigLines) }).returned;
  const ms = Date.now() - t0;
  const bytes = e.sizes.IDA_V2_SUBMIT;
  console.log("     2,000 lines: %d ms in-process, node outputs %s MB, the form %s MB", ms, (bytes / 1048576).toFixed(1),
    (JSON.stringify(record(bigLines)).length / 1048576).toFixed(1));
  eq("2,000 lines: QUEUED, 2,001 moves, every line stored", [out.route, out.line_count, m.ida[Object.keys(m.ida)[0]].lines.length], ["QUEUED", "2001", N]);
  eq("2,000 lines: node outputs well under the ~35 MB budget", bytes < 20 * 1048576, true);
}

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
