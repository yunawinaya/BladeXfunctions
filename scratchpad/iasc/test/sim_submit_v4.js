// node scratchpad/iasc/test/sim_submit_v4.js - COPY of scratchpad/iav2/test/submit/sim_submit.js run on the BUILT IA_V2_SUBMIT v4
// (Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json): every v3 scenario (prop counts +7 for the Small Cycle columns) + the Small Cycle cases.
// Original header: runs the BUILT IA_V2_SUBMIT.json through lib/sim's FlowGram interpreter
// against an in-memory model of sm_item_assembly / gd_async_job / gd_publish_step (unique keys enforced, SQL mocks computed
// from the model): the write order of an Add and of a stored Draft, the number rule, GENERATE_BATCH (organization_id passed;
// a refusal ends the run before any write), the idempotency key twice, twins, BUSY, a lost read-back -> STOP 500
const path = require("path");
const fs = require("fs");
const IAV2 = path.join(__dirname, "..", "..", "iav2");
const { Engine } = require(path.join(IAV2, "lib", "sim", "engine.js"));
const F = require(path.join(IAV2, "code", "shared", "fingerprint.js"));
const C = require(path.join(IAV2, "code", "shared", "ia_common.js"));
const BUILT = process.env.IA_V4 || path.join(__dirname, "..", "..", "..", "Item Assembly & BOM", "SmallCycle", "IA_V2_SUBMIT.json");
// v5 (phase 1: a split goes to the classic save) / v6 (phase 2: the background completion receives it, plan 10-27)
const IS_V5 = /iaOsIneligible/.test(fs.readFileSync(BUILT, "utf8"));
const IS_V6 = /code_node_ISosFinal/.test(fs.readFileSync(BUILT, "utf8"));
const V6P = IS_V6 ? 1 : 0;
// MIN-02 (BA 10-22): the completion claim has its own switch (shipped ON); the v3 / Small Cycle cases pin write orders with it off, its own
// cases run with it on
const CLAIM_SWITCH = /const IA_CLAIM_ENABLED = (true|false);/g;
const claimFile = (on) => {
  const f = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "ia-v4-")), "IA_V2_SUBMIT.json");
  fs.writeFileSync(f, fs.readFileSync(BUILT, "utf8").replace(CLAIM_SWITCH, "const IA_CLAIM_ENABLED = " + (on ? "true" : "false") + ";"));
  return f;
};
const BUILT_OFF = claimFile(false);
const BUILT_ON = claimFile(true);
let CURRENT = BUILT_OFF;
const T = "000000";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const PARENT = "2094626841323700251";
const BIN = "2018912822846582786";
const RBIN = "2018912822846582999";
const UOM = "2018906563477008392";

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 900) + "\n  want " + JSON.stringify(want).slice(0, 900));
  }
};
const comp = (i) => String(2094626841323700300n + BigInt(i));
const q8s = (v) => (v === undefined || v === null || v === "" ? null : Number((parseFloat(v) || 0).toFixed(8)).toFixed(8));

class Model {
  constructor(opts) {
    this.tenantId = T;
    this.uid = "2109866916722085890";
    this.seq = 2112300000000000000n;
    this.no = 41;
    this.ia = {};
    this.jobs = [];
    this.steps = [];
    this.writes = [];
    this.batchCfg = JSON.stringify({ n: 1, level: "Organization Level", date_format: "Document Date" });
    this.now = "2026-10-19 10:00:00";
    Object.assign(this, opts || {});
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }
  number() {
    this.no += 1;
    return "IA-2610-" + String(this.no).padStart(4, "0");
  }
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
      } else if (table === "Item Assembly") {
        r.id = this.id();
        if (r.stock_movement_no === "issued") r.stock_movement_no = this.number();
        const h = Object.assign({}, r, { lines: [] });
        this.writeLines(h, r.stock_movement);
        delete h.stock_movement;
        this.ia[r.id] = h;
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
      } else if (table === "GD Publish Step") {
        const s = this.steps.find((x) => x.id === id);
        if (s) Object.assign(s, set);
      } else if (table === "Item Assembly") {
        const h = this.ia[id];
        if (!h) continue;
        if (this.dropJobLink) delete set.ia_v2_job_id;
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
    const req = C.iaParseJ(j.request_payload) || {};
    return JSON.stringify({ id: j.id, command: j.command, job_status: j.job_status, correlation_id: j.correlation_id, progress_percent: j.progress_percent,
      progress_message: j.progress_message, error_code: j.error_code || null, error_message: j.error_message || null, line_count: j.line_count, action: req.action || null,
      ia_no: req.iaNo || null });
  }
  latestLock(ia) {
    return this.steps.filter((p) => p.job_id === "IAC|" + ia && /^LOCK\|/.test(p.step_name)).slice(-1)[0] || null;
  }
  facts(sql) {
    const key = sql.match(/k\.idempotency_key = '([^']*)'/)[1];
    const ia = sql.match(/AND g\.id = ([0-9]+)\s*AND g\.is_deleted = 0\s*$/)[1];
    const h = ia !== "0" ? this.ia[ia] : null;
    const kj = this.jobs.filter((j) => j.idempotency_key === key).slice(-1)[0];
    const mine = this.jobs.filter((j) => j.correlation_id === "IA|" + ia);
    const lk = this.latestLock(ia);
    const OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA", "COMMITTING_REVERT", "REQUIRES_REVIEW"];
    const open = mine.filter((j) => OPEN.indexOf(j.job_status) >= 0);
    const no = h ? h.stock_movement_no : null;
    const req = (j) => C.iaParseJ(j.request_payload) || {};
    return [{ db_now: this.now, key_job: this.jobObj(kj), ia_id: h ? ia : null, stock_movement_no: no, item_assembly_status: h ? h.item_assembly_status : null,
      posted_status: h ? h.posted_status || null : null, organization_id: h ? h.organization_id : null, plant_id: h ? h.issuing_operation_faci : null,
      no_type: h ? String(h.stock_movement_no_type) : null, ia_v2_job_id: h ? h.ia_v2_job_id || null : null,
      ia_lock: lk ? JSON.stringify({ step: lk.step_name, ref: lk.result_ref, young: this.lockYoung === undefined ? 1 : this.lockYoung,
        job: (this.jobs.filter((j) => j.idempotency_key === lk.result_ref).slice(-1)[0] || {}).job_status || null }) : null,
      open_jobs: open.length ? "[" + open.map((j) => this.jobObj(j)).join(",") + "]" : null, last_job: this.jobObj(mine.slice(-1)[0]),
      link_job: h && h.ia_v2_job_id ? this.jobObj(this.jobs.find((j) => j.id === h.ia_v2_job_id)) : null,
      issued_by_job: h ? mine.filter((j) => j.command === "COMPLETE_IA" && no && req(j).issuedNo === no).length : 0,
      completed_under: h ? mine.filter((j) => j.command === "COMPLETE_IA" && j.job_status === "COMPLETED" && no && req(j).iaNo === no).length : 0, batch_cfg: this.batchCfg }];
  }
  byJob(sql) {
    const job = sql.match(/ia_v2_job_id = '([0-9]+)'/)[1];
    return Object.keys(this.ia).filter((id) => this.ia[id].ia_v2_job_id === job).sort();
  }
  header(id, withSplit) {
    const h = this.ia[id];
    return { j: JSON.stringify(Object.assign(withSplit ? { output_split: h.output_split === undefined ? null : h.output_split } : {}, { id: id, item_id: h.item_id, item_qty: q8s(h.item_qty), item_uom: h.item_uom, location_id: h.location_id, inventory_category: h.inventory_category,
      batch_no: h.batch_no, issuing_operation_faci: h.issuing_operation_faci, organization_id: h.organization_id, stock_movement_no: h.stock_movement_no,
      stock_movement_no_type: String(h.stock_movement_no_type), item_assembly_status: h.item_assembly_status, posted_status: h.posted_status || null, table_hu: null,
      item_assembly_date: h.item_assembly_date ? h.item_assembly_date + " 00:00:00" : null, manufacturing_date: null, expired_date: null, remarks: h.remarks,
      remarks_2: h.remarks_2, remarks_3: h.remarks_3, ia_v2_job_id: h.ia_v2_job_id || null })) };
  }
  lineRows(id) {
    return this.ia[id].lines.map((l) => ({ j: JSON.stringify({ id: l.id, line_index: String(l.line_index), item_selection: l.item_selection, quantity_uom: l.quantity_uom,
      total_quantity: q8s(l.total_quantity), temp_qty_data: l.temp_qty_data, temp_hu_data: l.temp_hu_data || null, item_name: l.item_name }) }));
  }
  scSource(sql, sc) {
    const ia = (sql.match(/h\.id = ([0-9]+) AND h\.is_deleted/) || [])[1];
    const lineId = (sql.match(/l\.id = IF\(([0-9]+) > 0/) || [])[1];
    const h = ia && ia !== "0" ? this.ia[ia] : null;
    const SC = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id", "bom_snapshot_json", "planned_output_qty"];
    const stored = h ? Object.assign({ item_id: h.item_id }, ...SC.map((k) => ({ [k]: h[k] === undefined ? (k === "planned_output_qty" ? null : "") : h[k] }))) : null;
    const want = lineId && lineId !== "0" ? lineId : stored && stored.source_so_line_id;
    const line = want && sc.lines && sc.lines[want] ? sc.lines[want] : null;
    this.scSql = (this.scSql || []).concat([sql]);
    // FIX-03: whether the session user is assigned to the IA's organisation (sc.member 0 = not assigned)
    return [{ j: JSON.stringify({ member: sc.member === undefined ? 1 : sc.member, stored: stored, line: line,
      header: line && sc.headers ? sc.headers[line.sales_order_id] || null : null }) }];
  }
  back(sql) {
    const key = sql.match(/j\.idempotency_key = '([^']*)'/)[1];
    const j = this.jobs.filter((x) => x.idempotency_key === key).slice(-1)[0];
    if (!j) return [];
    const m = String(j.correlation_id || "").match(/^IA\|([0-9]{1,20})$/);
    const h = m ? this.ia[m[1]] : null;
    const lk = m ? this.latestLock(m[1]) : null;
    return [{ job_id: j.id, job_status: j.job_status, correlation_id: j.correlation_id, item_assembly_status: h ? h.item_assembly_status : null,
      stock_movement_no: h ? h.stock_movement_no : null, ia_v2_job_id: h ? h.ia_v2_job_id || null : null, lock_ref: lk ? lk.result_ref : null }];
  }
}

class Sim extends Engine {
  constructor(model, sc) {
    const items = () => sc.items.map((it) => ({ j: JSON.stringify(it) }));
    super({ dir: path.dirname(BUILT), db: model, mocks: { read: {}, sql: {
      sql_node_ISfacts: (q) => model.facts(q),
      sql_node_ISitems: () => items(),
      sql_node_IScost: () => sc.cost || [],
      sql_node_ISwa: () => sc.wa || [],
      // the screen answers only for the (material, bin) / (material, bin, batch) tuples its SQL names (code_node_ISkeys)
      sql_node_ISdup: (q) => {
        const lists = [...q.matchAll(/JSON_TABLE\('(\[[^']*\])'/g)].map((x) => C.iaParseJ(x[1]).map((tu) => tu.map(String).join("|")));
        return (sc.dup || []).filter((r) => {
          const x = JSON.parse(r.j);
          return x.t === "B" ? lists[0].indexOf(x.material_id + "|" + x.location_id) >= 0 : lists[1].indexOf(x.material_id + "|" + x.location_id + "|" + x.batch_id) >= 0;
        });
      },
      sql_node_IShdr: (q) => model.byJob(q).map((id) => ({ id: id, stock_movement_no: model.ia[id].stock_movement_no, item_assembly_status: model.ia[id].item_assembly_status,
        ia_v2_job_id: model.ia[id].ia_v2_job_id })),
      sql_node_ISheader: (q) => model.byJob(q).slice(0, 1).map((id) => model.header(id, /'output_split', h\.output_split/.test(q))),
      // v6: the split rows' bins - the payload's (b2.id IN) + the stored IA's rows (h2.id = <ia>); sc.bins overrides a bin's plant / sl / active -
      // and the stored IA's split, plant, item and bin
      sql_node_ISosRead: (q) => {
        model.osBinSql = (model.osBinSql || []).concat([q]);
        const ids = ((q.match(/b2\.id IN \(([0-9,]+)\)/) || [])[1] || "").split(",").filter((x) => x && x !== "0");
        const ia = (q.match(/h2\.id = ([0-9]+) AND h2\.is_deleted = 0/) || [])[1];
        const h = ia && ia !== "0" ? model.ia[ia] : null;
        const rows = h && Array.isArray(h.output_split) ? h.output_split : [];
        const all = ids.concat(rows.map((r) => String(r.os_location_id))).filter((x, i, a) => a.indexOf(x) === i);
        if (q.indexOf("b.tenant_id = '" + T + "'") < 0) throw new Error("bins SQL without the tenant: " + q);
        const stored = h ? { output_split: h.output_split === undefined ? null : h.output_split, plant: h.issuing_operation_faci, item_id: h.item_id, bin: h.location_id } : null;
        return [{ j: JSON.stringify({ bins: all.length ? all.map((id) => Object.assign({ id: id, plant: PLANT, sl: "2018912759311265793", active: 1 }, (sc.bins || {})[id] || {})) : null,
          stored: stored }) }];
      },
      sql_node_ISlines: (q) => model.byJob(q).slice(0, 1).reduce((a, id) => a.concat(model.lineRows(id)), []),
      sql_node_ISback: (q) => model.back(q),
      sql_node_ISsc: (q) => model.scSource(q, sc),
      // MIN-02: the claim number before our insert, the HELD claims and the IA's status after it
      sql_node_ISclaimState: (q) => {
        const ia = (q.match(/p\.job_id = 'IAS\|([0-9]+)'/) || [])[1];
        if (!ia || q.indexOf("p.tenant_id = '" + T + "'") < 0 || /is_deleted/.test(q)) throw new Error("claim state SQL: " + q);
        const mine = model.steps.filter((x) => x.job_id === "IAS|" + ia && /^CLAIM\|/.test(x.step_name));
        return [{ j: JSON.stringify({ max: mine.reduce((mx, x) => Math.max(mx, Number(x.step_name.slice(6))), 0), now: model.now }) }];
      },
      sql_node_ISclaims: (q) => {
        const ia = (q.match(/p\.job_id = 'IAS\|([0-9]+)'/) || [])[1];
        if (!ia || q.indexOf("h.tenant_id = '" + T + "' AND h.id = '" + ia + "' AND h.is_deleted = 0") < 0) throw new Error("claims SQL: " + q);
        const held = model.steps.filter((x) => x.job_id === "IAS|" + ia && /^CLAIM\|/.test(x.step_name) && x.step_status === "HELD" && !Number(x.is_deleted));
        return [{ j: JSON.stringify({ claims: held.length ? held.map((x) => ({ id: x.id, name: x.step_name, started_at: x.started_at })) : null,
          status: model.statusNow !== undefined ? model.statusNow : model.ia[ia] ? model.ia[ia].item_assembly_status : null, now: model.now }) }];
      },
    } } });
    this.model = model;
    this.sc = sc;
    this.batchCalls = [];
  }
  load(name) {
    if (name === "IA_V2_SUBMIT") return JSON.parse(fs.readFileSync(CURRENT, "utf8"));
    throw new Error("no workflow " + name);
  }
  run(name, params) {
    if (name === "GENERATE_BATCH") {
      this.batchCalls.push(JSON.parse(JSON.stringify(params)));
      if (this.sc.batchRefuse) throw new Error("执行工作流节点[Generate Batch]报错[" + this.sc.batchRefuse + "]");
      if (Array.isArray(this.sc.batchNumbers)) return { returned: { batch_number: this.sc.batchNumbers[this.batchCalls.length - 1] }, ctx: null };
      return { returned: { batch_number: "batchNumber" in this.sc ? this.sc.batchNumber : "1016-005-0003" }, ctx: null };
    }
    return super.run(name, params);
  }
  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined ? "null" : JSON.stringify(v);
    });
  }
}

const lineOf = (i, k, extra) => Object.assign({ item_selection: comp(i), item_name: "C" + i, total_quantity: k, requested_qty: k, quantity_uom: UOM, temp_hu_data: "",
  temp_qty_data: JSON.stringify(Array.from({ length: k }, (_, j) => ({ material_id: comp(i), location_id: BIN, batch_id: null, balance_id: String(9000 + j), sm_quantity: 1,
    category: "Unrestricted" }))) }, extra || {});
const record = (lines, extra) => Object.assign({ organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: "", stock_movement_no_type: "2098266711093927937",
  item_assembly_status: "", item_id: PARENT, item_name: "FG", item_desc: "", item_qty: 1, item_uom: UOM, item_assembly_date: "2026-10-19", issued_by: "t", project_id: "",
  batch_no: "", manufacturing_date: null, expired_date: null, storage_location_id: "2018912759311265793", location_id: RBIN, inventory_category: "Unrestricted", remarks: "",
  remarks_2: "", remarks_3: "", reference_documents: [], page_status: "Add", stock_movement: lines }, extra || {});
const itemRow = (id, extra) => Object.assign({ id: id, material_code: "M" + id.slice(-4), stock_control: 1, serial_number_management: 0, item_batch_management: 0,
  batch_number_genaration: "", material_costing_method: "First In First Out", based_uom: UOM, table_uom_conversion: [] }, extra || {});
const ITEMS = [itemRow(PARENT)].concat(Array.from({ length: 70 }, (_, i) => itemRow(comp(i))));
const lines60 = () => Array.from({ length: 60 }, (_, i) => lineOf(i, 1));
const keyOf = (id, gen) => "IA:" + ORG + ":" + id + ":0123456789abcdef:" + (gen || 1);
function go(model, req, sc) {
  const e = new Sim(model, Object.assign({ items: ITEMS }, sc || {}));
  let out = null;
  let error = null;
  try {
    out = e.run("IA_V2_SUBMIT", Object.assign({ operation: "SUBMIT", saveAs: "Completed", source: "FORM" }, req)).returned;
  } catch (x) {
    error = x.message;
  }
  return { out: out, error: error, steps: e.trace.map((t) => t.split(" ")[1]), batchCalls: e.batchCalls };
}
const writesOf = (model) => model.writes.map((w) => w[0] + " " + w[1] + (w[1] === "GD Publish Step" ? " " + w[2].step_name : ""));

// 1. an Add: job -> IA (Processing) -> read-back -> LOCK|1 -> link -> due
let m = new Model();
let r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-a1"), form: record(lines60()) });
eq("Add: QUEUED", r.error || [r.out.route, r.out.code, r.out.job_status, r.out.ia_no], ["QUEUED", "200", "QUEUED", "IA-2610-0042"]);
eq("Add: the write order", writesOf(m), ["insert GD Async Job", "insert Item Assembly", "insert GD Publish Step LOCK|1", "update GD Async Job", "update GD Async Job"]);
const ia1 = Object.keys(m.ia)[0];
const h1 = m.ia[ia1];
eq("Add: the IA is Processing under the job, no posted_status, batch_no ''", [h1.item_assembly_status, h1.ia_v2_job_id, h1.ia_idem_key, "posted_status" in h1, h1.batch_no,
  h1.lines.length], ["Processing", m.jobs[0].id, keyOf("new-a1"), false, "", 60]);
eq("Add: the job linked, due now, its final request", [m.jobs[0].correlation_id, m.jobs[0].causation_id, m.jobs[0].next_attempt_at, m.jobs[0].line_count],
  ["IA|" + ia1, ia1, "2026-10-19 10:00:00", 60]);
const req1 = C.iaParseJ(m.jobs[0].request_payload);
eq("Add: request iaId / iaNo / issuedNo / lineFingerprint from the read-back", [req1.iaId, req1.iaNo, req1.issuedNo, req1.lineFingerprint],
  [ia1, "IA-2610-0042", "IA-2610-0042", F.iaLineFingerprint(m.lineRows(ia1), [m.header(ia1, IS_V6)])]);
eq("Add: the lock is the key", [m.steps[0].job_id, m.steps[0].step_name, m.steps[0].result_ref, m.steps[0].step_status], ["IAC|" + ia1, "LOCK|1", keyOf("new-a1"), "LOCK"]);
eq("Add: answer ia_id", r.out.ia_id, ia1);
// the same key again (a lost answer re-sent): that job's STATUS, nothing written
let before = m.writes.length;
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-a1"), form: record(lines60()) });
eq("the same key twice: STATUS of the job, nothing written", [r.out.route, r.out.job_id, r.out.ia_id, m.writes.length - before], ["STATUS", m.jobs[0].id, ia1, 0]);
// another key while the job is open: BUSY
r = go(m, { pageStatus: "Edit", ia_id: ia1, idempotency_key: keyOf(ia1), form: Object.assign(record(lines60()), { id: ia1, item_assembly_status: "Processing" }) });
eq("another key on the Processing IA: BUSY", [r.out.route, r.out.code, r.out.error_code, r.out.job_id], ["BUSY", "409", "IA_BUSY", m.jobs[0].id]);
// STATUS by key only
r = go(m, { operation: "STATUS", pageStatus: "", ia_id: "", idempotency_key: keyOf("new-a1"), form: {} });
eq("STATUS by key", [r.out.route, r.out.ia_id, r.out.job_status], ["STATUS", ia1, "QUEUED"]);

// 2. a stored Draft: LOCK|n+1 -> job -> IA update -> read-back -> due (+ the request)
m = new Model();
m.ia["2112073133161844738"] = Object.assign(record(lines60(), { page_status: "Edit", item_assembly_status: "Draft", stock_movement_no: "IA-2610-0007" }), { lines: [] });
m.writeLines(m.ia["2112073133161844738"], lines60().map((l, i) => Object.assign(l, { line_index: i + 1 })));
m.steps.push({ id: "1", job_id: "IAC|2112073133161844738", step_name: "LOCK|2", result_ref: "IA:old:key:1", step_status: "LOCK" });
m.lockYoung = 0;
const ID = "2112073133161844738";
const stored = () => Object.assign(record(m.ia[ID].lines.map((l) => Object.assign({}, l)), { id: ID, page_status: "Edit", item_assembly_status: "Draft", stock_movement_no: "IA-2610-0007" }));
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID), form: stored() });
eq("stored Draft: QUEUED", r.error || [r.out.route, r.out.ia_id, r.out.ia_no], ["QUEUED", ID, "IA-2610-0042"]);
eq("stored Draft: the write order (lock first)", writesOf(m), ["insert GD Publish Step LOCK|3", "insert GD Async Job", "update Item Assembly", "update GD Async Job"]);
const upd = m.writes[2][2];
eq("stored Draft: the update carries Processing, the job, the key, the number sentinel, no posted_status", [upd.item_assembly_status, upd.ia_v2_job_id, upd.ia_idem_key,
  upd.stock_movement_no, "posted_status" in upd, Object.keys(upd).filter((k) => k !== "__id").length], ["Processing", m.jobs[0].id, keyOf(ID), "issued", false, 34 + V6P]);
eq("stored Draft: existing line ids kept (an update, not new rows)", m.ia[ID].lines.map((l) => l.id).join(), stored().stock_movement.map((l) => l.id).join());
const req2 = C.iaParseJ(m.jobs[0].request_payload);
eq("stored Draft: due wrote the final request", [m.jobs[0].next_attempt_at, req2.iaId, req2.iaNo, req2.issuedNo, req2.lineFingerprint, m.jobs[0].correlation_id],
  ["2026-10-19 10:00:00", ID, "IA-2610-0042", "IA-2610-0042", F.iaLineFingerprint(m.lineRows(ID), [m.header(ID, IS_V6)]), "IA|" + ID]);
// the job FAILED later (unlocked to Draft): a resubmit with gen 2 keeps the number that job issued
m.jobs[0].job_status = "FAILED";
m.ia[ID].item_assembly_status = "Draft";
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 2), form: Object.assign(stored(), { stock_movement_no: "IA-2610-0042" }) });
const upd2 = m.writes.filter((w) => w[1] === "Item Assembly").slice(-1)[0][2];
eq("number rule: after a FAILED job, the number it issued is kept (no number props)", [r.out.route, "stock_movement_no" in upd2, "stock_movement_no_type" in upd2,
  m.ia[ID].stock_movement_no, C.iaParseJ(m.jobs[1].request_payload).issuedNo, Object.keys(upd2).filter((k) => k !== "__id").length],
["QUEUED", false, false, "IA-2610-0042", "", 32 + V6P]);
// it COMPLETED and was reverted to Draft: the next completion issues a new number
m.jobs[1].job_status = "COMPLETED";
m.ia[ID].item_assembly_status = "Draft";
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 3), form: Object.assign(stored(), { stock_movement_no: "IA-2610-0042" }) });
eq("number rule: after a COMPLETED (then reverted) job, a new number", [r.out.route, m.ia[ID].stock_movement_no, C.iaParseJ(m.jobs[2].request_payload).issuedNo],
  ["QUEUED", "IA-2610-0043", "IA-2610-0043"]);

// 3. a batch-managed system-numbered parent: GENERATE_BATCH with organization_id, its number in batch_no
const batchItems = [itemRow(PARENT, { item_batch_management: 1, batch_number_genaration: "According To System Settings" })].concat(ITEMS.slice(1));
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-b1"), form: record(lines60()) }, { items: batchItems, batchNumber: "1016-005-0003" });
eq("batch parent: the call (classic params + organization_id)", r.batchCalls, [{ item_id: PARENT, document_date: "2026-10-19", manufacturing_date: null, expired_date: null,
  organization_id: ORG }]);
eq("batch parent: batch_no on the IA", [r.out.route, m.ia[Object.keys(m.ia)[0]].batch_no], ["QUEUED", "1016-005-0003"]);
eq("batch parent: GENERATE_BATCH ran after every check, right before the job insert",
  r.steps.indexOf("workflow_node_ISbatch") > r.steps.indexOf("code_node_ISgate") && r.steps.indexOf("workflow_node_ISbatch") < r.steps.indexOf("add_node_ISjob"), true);
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-b2"), form: record(lines60()) }, { items: batchItems, batchRefuse: "Duplicate Batch Format found." });
eq("a GENERATE_BATCH refusal ends the run, nothing written", [r.out, /Duplicate Batch Format found/.test(r.error), m.writes.length], [null, true, 0]);
m = new Model({ batchCfg: JSON.stringify({ n: 0, level: null, date_format: null }) });
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-b3"), form: record(lines60()) }, { items: batchItems });
eq("pre-check refusal: STOP with GENERATE_BATCH's text, no call, nothing written", [r.out.route, r.out.message, r.batchCalls.length, m.writes.length],
  ["STOP", "No default batch found.", 0, 0]);
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-b4"), form: record(lines60()) }, { items: batchItems, batchNumber: "" });
eq("GENERATE_BATCH without a number: STOP, nothing written", [r.out.route, r.out.error_code, m.writes.length], ["STOP", "IA_BATCH_FAILED", 0]);

// 4. answers before any write
for (const [label, sc, req, want] of [
  ["NOT_ELIGIBLE (serial)", { items: ITEMS.map((it, i) => (i === 3 ? Object.assign({}, it, { serial_number_management: 1 }) : it)) }, {}, "NOT_ELIGIBLE"],
  ["STOP (WA screen)", { wa: [{ j: JSON.stringify({ material_id: comp(1), batch_id: "0" }) }] }, {}, "STOP"],
  ["INVALID (no key)", {}, { idempotency_key: "" }, "INVALID"],
  ["NOT_ELIGIBLE (Draft)", {}, { saveAs: "Draft" }, "NOT_ELIGIBLE"]]) {
  m = new Model();
  r = go(m, Object.assign({ pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-x"), form: record(lines60()) }, req), sc);
  eq(label + ": answered, nothing written", [r.error, r.out && r.out.route, m.writes.length, Object.values(r.out || {}).every((v) => typeof v === "string")], [null, want, 0, true]);
}

// 4b. IA output split, phase 1 (v5, plan 10-27): a split completion goes to the classic save (NOT_ELIGIBLE); above its 250 picks a STOP
// naming the reason; no split rows (or none sent) = the background completion as before. Run on a v5 build (the repo's must be one); a v4
// build (IA_V4: mutants_v4.py) skips them
eq("the repo's IA_V2_SUBMIT is v6 (the output split in the background)", IS_V6 || !!process.env.IA_V4, true);
if (IS_V5) {
  const split = [{ os_qty: 0.5, os_location_id: BIN }, { os_qty: 0.5, os_location_id: RBIN }];
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-os1"), form: record(lines60(), { output_split: split }) });
  eq("v5 output split: NOT_ELIGIBLE (300), nothing written, no number generated", [r.error, r.out && r.out.route, r.out && r.out.code, m.writes.length, r.batchCalls.length],
    [null, "NOT_ELIGIBLE", "300", 0, 0]);
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-os2"), form: record(lines60(), { output_split: JSON.stringify(split) }) });
  eq("v5 output split as JSON text: NOT_ELIGIBLE", r.out && r.out.route, "NOT_ELIGIBLE");
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-os3"), form: record(Array.from({ length: 65 }, (_, i) => lineOf(i, 4)), { output_split: split }) });
  eq("v5 output split above 250 picks: STOP IA_TOO_BIG naming the split, nothing written", [r.out && r.out.route, r.out && r.out.error_code,
    /260 stock picks .*\(its output is split across bins\); the classic save handles at most 250 picks/.test((r.out && r.out.message) || ""), m.writes.length], ["STOP", "IA_TOO_BIG", true, 0]);
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-os4"), form: record(lines60(), { output_split: [] }) });
  eq("v5 no split rows: queued in the background as before", r.out && r.out.route, "QUEUED");
}

// 4c. IA output split, phase 2 (v6, plan 10-27): the background completion receives a split (System Settings batch or no batch): the rows
// checked as IA_SAVE v14's completion before any write, a System split numbered per group, the rows stored with their numbers, row 1 in the
// header's single fields, the request's fingerprint and movement count cover the split. Manual stays the classic's (NOT_ELIGIBLE)
if (IS_V6) {
  const SL = "2018912759311265793";
  const BIN3 = "2018912822846583001";
  const SYS = [itemRow(PARENT, { item_batch_management: 1, batch_number_genaration: "According To System Settings" })].concat(ITEMS.slice(1));
  const MAN = [itemRow(PARENT, { item_batch_management: 1, batch_number_genaration: "Manual Input" })].concat(ITEMS.slice(1));
  const plain = [{ os_qty: 0.4, os_storage_location_id: SL, os_location_id: BIN, os_category: "Unrestricted" },
    { os_qty: 0.6, os_storage_location_id: SL, os_location_id: RBIN, os_category: "Blocked" }];
  const sys3 = [{ os_qty: 0.5, os_location_id: BIN, os_category: "Blocked", os_group: 1, os_mfg_date: "2026-10-27", os_exp_date: "2028-10-27" },
    { os_qty: 0.3, os_location_id: RBIN, os_category: "Blocked", os_group: 1, os_mfg_date: "2026-10-27", os_exp_date: "2028-10-27" },
    { os_qty: 0.2, os_location_id: BIN3, os_category: "Unrestricted", os_group: 2, os_mfg_date: "2026-10-20", os_exp_date: "2028-10-20" }];
  const split = (o) => Object.assign({ output_split: plain }, o || {});
  const iaOf = (mm) => mm.ia[Object.keys(mm.ia)[0]] || {};
  // a non-batch split: QUEUED, the Add's writes as before, the rows stored, row 1 in the header, the split in the fingerprint and the count
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-v6a"), form: record(lines60(), split({ location_id: RBIN, inventory_category: "Blocked" })) });
  eq("v6 non-batch split: QUEUED, the Add's write order", [r.error, r.out && r.out.route, writesOf(m)],
    [null, "QUEUED", ["insert GD Async Job", "insert Item Assembly", "insert GD Publish Step LOCK|1", "update GD Async Job", "update GD Async Job"]]);
  let h = iaOf(m);
  eq("v6 non-batch split: the rows stored (storage location from the bin), row 1 in the header, no batch, no number generated",
    [h.output_split, h.location_id, h.inventory_category, h.storage_location_id, h.batch_no, r.batchCalls.length],
    [[{ os_qty: 0.4, os_storage_location_id: SL, os_location_id: BIN, os_category: "Unrestricted", os_group: "", os_batch_no: "", os_mfg_date: "", os_exp_date: "" },
      { os_qty: 0.6, os_storage_location_id: SL, os_location_id: RBIN, os_category: "Blocked", os_group: "", os_batch_no: "", os_mfg_date: "", os_exp_date: "" }],
    BIN, "Unrestricted", SL, "", 0]);
  let rq = C.iaParseJ(m.jobs[0].request_payload);
  const idA = Object.keys(m.ia)[0];
  eq("v6 non-batch split: the request's fingerprint covers the split, movementCount = picks + receipts",
    [rq.lineFingerprint === F.iaLineFingerprint(m.lineRows(idA), [m.header(idA, true)]), rq.lineFingerprint !== F.iaLineFingerprint(m.lineRows(idA), [m.header(idA, false)]), rq.movementCount],
    [true, true, 62]);
  eq("v6: the bins read takes the payload's bins, by tenant", /b2\.id IN \(0,2018912822846582786,2018912822846582999\)/.test((m.osBinSql || [""])[0]), true);
  // a System split: one GENERATE_BATCH per group (its dates, the organization), the numbers on the rows, row 1's in the header
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-v6b"), form: record(lines60(), { output_split: sys3 }) },
    { items: SYS, batchNumbers: ["1016-005-0003", "1016-005-0004"] });
  h = iaOf(m);
  eq("v6 System split: QUEUED, GENERATE_BATCH once per group with its dates and the organization",
    [r.error, r.out && r.out.route, r.batchCalls.map((c) => [c.item_id, c.manufacturing_date, c.expired_date, c.organization_id])],
    [null, "QUEUED", [[PARENT, "2026-10-27", "2028-10-27", ORG], [PARENT, "2026-10-20", "2028-10-20", ORG]]]);
  eq("v6 System split: the rows carry their group's number, the header row 1's number, bin, category and dates",
    [(h.output_split || []).map((x) => [x.os_group, x.os_batch_no, x.os_location_id]), h.batch_no, h.location_id, h.inventory_category, h.manufacturing_date, h.expired_date],
    [[["1", "1016-005-0003", BIN], ["1", "1016-005-0003", RBIN], ["2", "1016-005-0004", BIN3]], "1016-005-0003", BIN, "Blocked", "2026-10-27", "2028-10-27"]);
  rq = C.iaParseJ(m.jobs[0].request_payload);
  eq("v6 System split: movementCount = 60 picks + 3 receipts", rq.movementCount, 63);
  // refusals before any write (and before any number is generated)
  const refused = [
    ["the total is not the output", { output_split: [plain[0], Object.assign({}, plain[1], { os_qty: 0.5 })] }, {}, /The split total 0\.9 is not the output quantity 1/],
    ["one row", { output_split: [Object.assign({}, plain[0], { os_qty: 1 })] }, {}, /at least 2 rows/],
    ["a bin of another plant", split(), { bins: { [RBIN]: { plant: "999" } } }, /Output row 2: its bin location is not a bin of this plant/],
    ["an inactive bin", split(), { bins: { [RBIN]: { active: 0 } } }, /Output row 2: its bin location is not active/],
    ["a System group without its group number", { output_split: [sys3[0], Object.assign({}, sys3[1], { os_group: "" }), sys3[2]] }, { items: SYS }, /Output row 2: enter a group number/],
    ["a System group with two date pairs", { output_split: [sys3[0], Object.assign({}, sys3[1], { os_mfg_date: "2026-10-01" }), sys3[2]] }, { items: SYS }, /are one batch \(group 1\) with different dates/],
  ];
  for (const [label, extra, sc, re] of refused) {
    m = new Model();
    r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-v6r"), form: record(lines60(), extra) }, sc);
    eq("v6 split refused (" + label + "): STOP 400 IA_OS_INVALID, nothing written, no number", [r.error, r.out && r.out.route, r.out && r.out.code, r.out && r.out.error_code,
      re.test((r.out && r.out.message) || ""), m.writes.length, r.batchCalls.length], [null, "STOP", "400", "IA_OS_INVALID", true, 0, 0]);
  }
  // the numbering refused: one number twice, none for group 2; a date the configuration needs missing on group 2 (before any call)
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-v6n1"), form: record(lines60(), { output_split: sys3 }) }, { items: SYS, batchNumbers: ["1016-005-0003", "1016-005-0003"] });
  eq("v6 System split: the same number for both groups: STOP 400, nothing written", [r.out && r.out.route, r.out && r.out.code, /the same number 1016-005-0003/.test((r.out && r.out.message) || ""),
    m.writes.length], ["STOP", "400", true, 0]);
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-v6n2"), form: record(lines60(), { output_split: sys3 }) }, { items: SYS, batchNumbers: ["1016-005-0003", ""] });
  eq("v6 System split: no number for group 2: STOP 400, nothing written", [r.out && r.out.route, r.out && r.out.code,
    /Could not generate a batch number for group 2/.test((r.out && r.out.message) || ""), m.writes.length], ["STOP", "400", true, 0]);
  m = new Model({ batchCfg: JSON.stringify({ n: 1, level: "Organization Level", date_format: "Manufacturing Date" }) });
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-v6n3"), form: record(lines60(), { output_split: [sys3[0], sys3[1], Object.assign({}, sys3[2], { os_mfg_date: "" })] }) },
    { items: SYS, batchNumbers: ["1016-005-0003", "1016-005-0004"] });
  eq("v6 System split: group 2 without the Manufacturing Date its numbering needs: STOP 400 before any call", [r.out && r.out.route, r.out && r.out.code,
    /Manufacturing Date is required/.test((r.out && r.out.message) || ""), m.writes.length, r.batchCalls.length], ["STOP", "400", true, 0, 0]);
  // a duplicate balance at a split row's bin: the classic's (NOT_ELIGIBLE), as at the header's bin
  m = new Model();
  // the header's bin is row 1's (BIN): only the split's row 2 meets the duplicate
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-v6d"), form: record(lines60(), split({ location_id: BIN })) },
    { dup: [{ j: JSON.stringify({ t: "B", material_id: PARENT, location_id: RBIN, batch_id: "", n: 2 }) }] });
  eq("v6 split: a duplicate balance at row 2's bin: NOT_ELIGIBLE, nothing written", [r.out && r.out.route, r.out && r.out.code, m.writes.length], ["NOT_ELIGIBLE", "300", 0]);
  // a Manual batch output: the classic's split (NOT_ELIGIBLE by the Manual rule); above 250 picks a STOP naming it
  m = new Model();
  r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-v6m"), form: record(lines60(), { output_split: [{ os_qty: 0.5, os_location_id: BIN, os_category: "Unrestricted",
    os_batch_no: "M-1" }, { os_qty: 0.5, os_location_id: RBIN, os_category: "Unrestricted", os_batch_no: "M-2" }] }) }, { items: MAN });
  eq("v6 Manual split: NOT_ELIGIBLE (the classic's), nothing written", [r.out && r.out.route, m.writes.length, r.batchCalls.length], ["NOT_ELIGIBLE", 0, 0]);
  // a stored Draft split, completed from a tab that sends no output_split (an old form): the stored rows are received; moving its bin is refused
  const SID = "2112073133161849999";
  const mk = () => {
    const mm = new Model();
    mm.ia[SID] = Object.assign(record(lines60(), { page_status: "Edit", item_assembly_status: "Draft", stock_movement_no: "IA-2610-0009", location_id: BIN }), { lines: [],
      output_split: plain.map((x) => Object.assign({}, x)) });
    mm.writeLines(mm.ia[SID], lines60().map((l, i) => Object.assign(l, { line_index: i + 1 })));
    mm.lockYoung = 0;
    return mm;
  };
  const noKey = (o) => {
    const f = Object.assign(record(m.ia[SID].lines.map((l) => Object.assign({}, l)), { id: SID, page_status: "Edit", item_assembly_status: "Draft", stock_movement_no: "IA-2610-0009",
      location_id: BIN }), o || {});
    delete f.output_split;
    return f;
  };
  m = mk();
  r = go(m, { pageStatus: "Edit", ia_id: SID, idempotency_key: keyOf(SID), form: noKey() });
  eq("v6 stored split, no output_split sent: QUEUED with the stored rows", [r.error, r.out && r.out.route, (m.ia[SID].output_split || []).map((x) => [x.os_qty, x.os_location_id])],
    [null, "QUEUED", [[0.4, BIN], [0.6, RBIN]]]);
  eq("v6: the bins read also takes the stored IA's rows", /h2\.id = 2112073133161849999 AND h2\.is_deleted = 0/.test((m.osBinSql || [""])[0]), true);
  m = mk();
  r = go(m, { pageStatus: "Edit", ia_id: SID, idempotency_key: keyOf(SID), form: noKey({ location_id: BIN3 }) });
  eq("v6 stored split, no output_split sent, its bin moved: STOP 400, nothing written", [r.out && r.out.route, r.out && r.out.code,
    /output is split across bins: change its plant, item or bin on the desktop/.test((r.out && r.out.message) || ""), m.writes.length], ["STOP", "400", true, 0]);
}

// 5. twins and crashes
m = new Model({ failInsert: (table) => table === "GD Async Job" });
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-t1"), form: record(lines60()) });
eq("Add: the job insert fails (a twin of the key) -> no IA written", [r.out, Object.keys(m.ia).length], [null, 0]);
const formD = Object.assign(record(lines60()), { id: ID, item_assembly_status: "Draft" });
m = new Model();
m.ia[ID] = Object.assign(record([], { item_assembly_status: "Draft", stock_movement_no: "IA-2610-0007" }), { lines: [] });
m.steps.push({ id: "1", job_id: "IAC|" + ID, step_name: "LOCK|1", result_ref: "IA:another:key:1" });
m.lockYoung = 0;
// a concurrent submit of another key took LOCK|2 between our facts read and our lock insert
const facts0 = m.facts.bind(m);
m.facts = (q) => {
  const f = facts0(q);
  m.steps.push({ id: "9", job_id: "IAC|" + ID, step_name: "LOCK|2", result_ref: keyOf(ID, 7) });
  return f;
};
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 1), form: formD });
eq("two keys on one Draft: the loser fails at its LOCK insert, writes nothing else", [r.out, /Job Step/.test(r.error), m.jobs.length, m.writes.length], [null, true, 0, 0]);
m = new Model({ dropJobLink: true });
m.ia[ID] = Object.assign(record([], { item_assembly_status: "Draft", stock_movement_no: "IA-2610-0007" }), { lines: [] });
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID), form: formD });
// peer -8c (IDA's fix): a job left without its final due write falls due in 600 s, so a submit stalled before its document write is
// never claimed (and failed with nothing to unlock) before the write lands
eq("a document write that did not read back: STOP 500, the job not made due (it falls due in 600 s)", [r.out.route, r.out.code, r.out.error_code, m.jobs[0].next_attempt_at],
  ["STOP", "500", "IA_QUEUE_FAILED", "2026-10-19 10:10:00"]);
m = new Model();
r = go(m, { pageStatus: "Clone", ia_id: "", idempotency_key: keyOf("new-c1"),
  form: Object.assign(record(lines60().map((l, i) => Object.assign(l, { id: String(2112073133161845000n + BigInt(i)) }))), { id: ID, item_assembly_status: "Completed", page_status: "Clone" }) });
const cl = m.ia[Object.keys(m.ia)[0]];
eq("Clone: a new IA with new line ids (the source ids never written)", [r.out.route, Object.keys(m.ia)[0] !== ID, cl.lines.every((l) => !String(l.id).startsWith("21120731331618"))],
  ["QUEUED", true, true]);

// 6. Small Cycle (scratchpad/iasc/CONTRACT.md): the check runs after the gate and BEFORE GENERATE_BATCH; the 7 columns are written
const SO = "2112017989476458498";
const LINE = "2112017989484847107";
const SCL = { lines: { [LINE]: { id: LINE, sales_order_id: SO, item_name: PARENT, so_quantity: "100", so_item_uom: UOM, delivered_qty: "0", line_status: "Issued",
  is_deleted: 0, line_index: 1 } }, headers: { [SO]: { id: SO, so_no: "SO/1", so_status: "Issued", organization_id: ORG, customer_id: "7", is_deleted: 0 } } };
const linked = (extra) => Object.assign({ source_so_id: SO, source_so_line_id: LINE, source_so_context_json: "", bom_consumption_mode: "STANDARD", source_bom_id: "",
  bom_snapshot_json: "", planned_output_qty: "60" }, extra || {});
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-s1"), form: record(lines60(), linked()) }, SCL);
const hs = m.ia[Object.keys(m.ia)[0]];
eq("SC Add linked: QUEUED", r.error || r.out.route, "QUEUED");
eq("SC Add linked: the 7 columns on the insert", [hs.source_so_id, hs.source_so_line_id, hs.bom_consumption_mode, hs.planned_output_qty, JSON.parse(hs.source_so_context_json).orderedQty],
  [SO, LINE, "STANDARD", "60.00000000", "100"]);
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-s2"), form: record(lines60(), linked()) },
  Object.assign({}, SCL, { items: batchItems, headers: { [SO]: Object.assign({}, SCL.headers[SO], { so_status: "Completed" }) } }));
eq("SC refused link: STOP 400 IA_SC_INVALID, no GENERATE_BATCH, nothing written", [r.error, r.out && r.out.route, r.out && r.out.code, r.out && r.out.error_code,
  r.batchCalls.length, m.writes.length], [null, "STOP", "400", "IA_SC_INVALID", 0, 0]);
m = new Model();
m.ia[ID] = Object.assign(record([], Object.assign({ item_assembly_status: "Draft", stock_movement_no: "IA-2610-0007" }, linked({ planned_output_qty: "5.00000000",
  source_so_context_json: JSON.stringify({ v: 1, lineId: LINE, history: [{ op: "LINK" }] }) }))), { lines: [] });
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 4), form: Object.assign(record(lines60()), { id: ID, item_assembly_status: "Draft" }) }, SCL);
const us = m.writes.filter((w) => w[1] === "Item Assembly").slice(-1)[0][2];
eq("SC Edit with a legacy form: the stored link and plan kept", [r.out.route, us.source_so_line_id, us.planned_output_qty], ["QUEUED", LINE, "5.00000000"]);
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-s3"), form: record(lines60(), linked({ bom_consumption_mode: "FLAT" })) }, SCL);
eq("SC Flat without a snapshot: STOP 400, nothing written", [r.out.route, r.out.code, /Prepare the Flat BOM/.test(r.out.message), m.writes.length], ["STOP", "400", true, 0]);
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-s4"), form: record(lines60(), linked({ organization_id: "" })) }, SCL);
eq("SC new link without an organization: refused 400 (the required-field gate, before the link check), nothing written", [r.out && r.out.code, m.writes.length], ["400", 0]);
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-s5"), form: record(lines60(), linked()) }, Object.assign({}, SCL, { member: 0 }));
eq("SC new link by a user not assigned to the organisation: STOP 400 IA_SC_INVALID, nothing written (FIX-03)", [r.out && r.out.route, r.out && r.out.error_code,
  /not assigned to this organisation/.test((r.out && r.out.message) || ""), m.writes.length], ["STOP", "IA_SC_INVALID", true, 0]);
eq("SC membership read: the session user and the form's organisation (FIX-03)", (m.scSql || []).some((s) => {
  const q = s.replace(/\s+/g, " ");
  return q.indexOf("u.id = 2109866916722085890 LIMIT 1") >= 0 && q.indexOf("(p.id = " + ORG + " OR FIND_IN_SET('" + ORG + "', p.ancestors) > 0)") >= 0;
}), true);

// re-link through Edit (SUBMIT): the stored link L1, the form L2; the SO side changing the line's item does not block
const LINE2 = "2112017989484847108";
const SCL2 = { lines: Object.assign({}, SCL.lines, { [LINE2]: Object.assign({}, SCL.lines[LINE], { id: LINE2, so_quantity: "80", line_index: 2 }) }), headers: SCL.headers };
const storedLinked = (no) => Object.assign(record([], Object.assign({ item_assembly_status: "Draft", stock_movement_no: no }, linked({ planned_output_qty: "5.00000000",
  source_so_context_json: JSON.stringify({ v: 1, lineId: LINE, orderedQty: "120", history: [{ op: "LINK" }] }) }))), { lines: [] });
m = new Model();
m.ia[ID] = storedLinked("IA-2610-0008");
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 5), form: Object.assign(record(lines60(), linked({ source_so_line_id: LINE2 })), { id: ID, item_assembly_status: "Draft" }) }, SCL2);
let rl = m.writes.filter((w) => w[1] === "Item Assembly").slice(-1)[0];
eq("SC re-link through Edit (SUBMIT): QUEUED, the new line, RELINK on the stored history", [r.error || r.out.route, rl && rl[2].source_so_line_id,
  rl && (JSON.parse(rl[2].source_so_context_json || "{}").history || []).map((h) => h.op).join(",")], ["QUEUED", LINE2, "LINK,RELINK"]);
m = new Model();
m.ia[ID] = storedLinked("IA-2610-0009");
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 6), form: Object.assign(record(lines60(), linked({ source_so_line_id: LINE2 })), { id: ID, item_assembly_status: "Draft" }) },
  { lines: Object.assign({}, SCL2.lines, { [LINE2]: Object.assign({}, SCL2.lines[LINE2], { line_status: "Cancelled" }) }), headers: SCL.headers });
eq("SC re-link through Edit to an ineligible line: STOP 400 IA_SC_INVALID, nothing written", [r.out && r.out.route, r.out && r.out.error_code, m.writes.length], ["STOP", "IA_SC_INVALID", 0]);
m = new Model();
m.ia[ID] = storedLinked("IA-2610-0010");
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 7), form: Object.assign(record(lines60()), { id: ID, item_assembly_status: "Draft" }) },
  { lines: { [LINE]: Object.assign({}, SCL.lines[LINE], { item_name: "888" }) }, headers: SCL.headers });
eq("SC the SO line's item changed, the IA's not: QUEUED (a warning, not a refusal)", r.error || r.out.route, "QUEUED");

// a Standard snapshot of one reference row (comp 0, 1 per FG): line 0 carries its key
const snap = JSON.stringify({ v: 1, mode: "STANDARD", itemId: PARENT, uomId: UOM, root: { bomId: "77", version: "V1", baseQty: "1", baseUomId: UOM, conv: "1" }, expand: [],
  boms: { 77: { itemId: PARENT, version: "V1", baseQty: "1", baseUomId: UOM } }, rows: [{ key: comp(0) + "|" + UOM + "|1", itemId: comp(0), uomId: UOM, name: "C0", desc: "",
  remark: "", serial: 0, nonStock: 0, paths: [{ boms: ["77"], items: [comp(0)], steps: [["1", "0", "1"]] }] }], dropped: [], preparedAt: "", preparedBy: "" });
const refLines = (q) => lines60().map((l, i) => (i === 0 ? Object.assign(l, { sc_ref_key: comp(0) + "|" + UOM + "|1", requested_qty: q }) : l));
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-s4"), form: record(refLines(2), linked({ source_bom_id: "77", bom_snapshot_json: snap })) }, SCL);
eq("SC reference drift on the completion: STOP 400, nothing written", [r.out.route, r.out.code, /reference quantity/.test(r.out.message), m.writes.length], ["STOP", "400", true, 0]);
m = new Model();
r = go(m, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-s5"), form: record(refLines(1), linked({ source_bom_id: "77", bom_snapshot_json: snap })) }, SCL);
eq("SC matching snapshot: QUEUED with the snapshot written", [r.out.route, m.ia[Object.keys(m.ia)[0]].bom_snapshot_json === snap], ["QUEUED", true]);

// 7. RES-01 Created (BA, 10-22): a Created IA completes in the background like a Draft; its job records prevStatus Created, so a failed
// job puts it back to Created (its holds stand)
const prevOf = (model) => (C.iaParseJ((model.jobs[0] || {}).request_payload) || {}).prevStatus;
m = new Model();
m.ia[ID] = Object.assign(record([], { item_assembly_status: "Created", stock_movement_no: "IA-2610-0007" }), { lines: [] });
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 9), form: Object.assign(record(lines60()), { id: ID, item_assembly_status: "Created" }) });
eq("Created: QUEUED, the IA Processing, the job's prevStatus Created", [r.out.route, m.ia[ID].item_assembly_status, prevOf(m)], ["QUEUED", "Processing", "Created"]);
// RES-01 Created numbering (user 10-22): a Created IA completes under the number it was issued at Created: no number props, nothing issued
m = new Model();
m.ia[ID] = Object.assign(record([], { item_assembly_status: "Created", stock_movement_no: "IA-2610-0031" }), { lines: [] });
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 12), form: Object.assign(record(lines60()), { id: ID, item_assembly_status: "Created",
  stock_movement_no: "IA-2610-0031" }) });
eq("number: a Created IA completes in the background under its Created number (nothing issued)", [r.out.route, m.ia[ID].stock_movement_no,
  C.iaParseJ(m.jobs[0].request_payload).issuedNo], ["QUEUED", "IA-2610-0031", ""]);
m = new Model();
m.ia[ID] = Object.assign(record([], { item_assembly_status: "Draft", stock_movement_no: "IA-2610-0007" }), { lines: [] });
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 10), form: formD });
eq("a Draft still records prevStatus Draft", [r.out.route, prevOf(m)], ["QUEUED", "Draft"]);
m = new Model();
m.ia[ID] = Object.assign(record([], { item_assembly_status: "Created", stock_movement_no: "IA-2610-0007" }), { lines: [] });
r = go(m, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 11), form: formD });
eq("a tab that still shows Draft for a Created IA: STALE 409, nothing written", [r.out.route, r.out.code, m.writes.length], ["STALE", "409", 0]);

// ---- MIN-02 (BA 10-22): the background completion takes the normal save's completion claim right before its first write
{
  CURRENT = BUILT_ON;
  eq("MIN-02: the shipped IA_V2_SUBMIT takes the claim (IA_CLAIM_ENABLED true)", /const IA_CLAIM_ENABLED = true;/.test(fs.readFileSync(BUILT, "utf8")), true);
  const fresh = (status) => {
    const mm = new Model();
    mm.ia[ID] = Object.assign(record(lines60(), { page_status: "Edit", item_assembly_status: status, stock_movement_no: "IA-2610-0007" }), { lines: [] });
    mm.writeLines(mm.ia[ID], lines60().map((l, i) => Object.assign(l, { line_index: i + 1 })));
    return mm;
  };
  const formOf = (mm, status) => Object.assign(record(mm.ia[ID].lines.map((l) => Object.assign({}, l)), { id: ID, page_status: "Edit", item_assembly_status: status,
    stock_movement_no: "IA-2610-0007" }));
  const order = (mm) => mm.writes.map((w) => w[0] + " " + w[1] + (w[1] === "GD Publish Step" ? " " + (w[2].step_name || w[2].step_status) : ""));
  const claims = (mm) => mm.steps.filter((x) => /^IAS\|/.test(x.job_id)).map((x) => [x.step_name, x.step_status]);
  const rival = (k, at) => ({ id: "800" + k, job_id: "IAS|" + ID, step_name: "CLAIM|" + k, step_status: "HELD", started_at: at, is_deleted: 0 });
  let mm = fresh("Draft");
  let rr = go(mm, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 21), form: formOf(mm, "Draft") });
  eq("MIN-02 alone: QUEUED; the claim first, freed right after the IA is written Processing", [rr.error || rr.out.route, order(mm)],
    ["QUEUED", ["insert GD Publish Step CLAIM|1", "insert GD Publish Step LOCK|1", "insert GD Async Job", "update Item Assembly", "update GD Publish Step FREE", "update GD Async Job"]]);
  eq("MIN-02 alone: IAS|<ia> / CLAIM|1 FREE at the end", claims(mm), [["CLAIM|1", "FREE"]]);
  eq("C2: the submit's claim ends V2 (the background completion owns the effects from Processing on)", mm.steps.filter((x) => /^IAS\|/.test(x.job_id)).map((x) => x.result_ref), ["V2"]);
  mm = fresh("Draft");
  mm.steps.push(rival(1, "2026-10-19 09:59:30"));
  rr = go(mm, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 22), form: formOf(mm, "Draft") });
  eq("MIN-02 the normal save holds the IA (a live claim): BUSY 409 IA_BUSY, no lock, no job, no IA write; ours freed", [rr.out.route, rr.out.code, rr.out.error_code,
    /another window/.test(rr.out.message || ""), order(mm)], ["BUSY", "409", "IA_BUSY", true, ["insert GD Publish Step CLAIM|2", "update GD Publish Step FREE"]]);
  eq("C2: the losing submit's claim ends LOST", mm.steps.filter((x) => x.step_name === "CLAIM|2").map((x) => [x.step_status, x.result_ref]), [["FREE", "LOST"]]);
  mm = fresh("Draft");
  mm.steps.push(rival(1, "2026-10-19 09:49:00"));
  rr = go(mm, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 23), form: formOf(mm, "Draft") });
  eq("MIN-02 a dead run's claim (older than the 10-minute lease): ours wins, QUEUED", [rr.out.route, claims(mm)], ["QUEUED", [["CLAIM|1", "HELD"], ["CLAIM|2", "FREE"]]]);
  mm = fresh("Draft");
  mm.statusNow = "Completed";
  rr = go(mm, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 24), form: formOf(mm, "Draft") });
  eq("MIN-02 the normal save completed it after the entry read it: BUSY 409 'changed', no lock, no job, no IA write", [rr.out.route, rr.out.code,
    /changed while it was being completed \(it is Completed now\)/.test(rr.out.message || ""), order(mm)], ["BUSY", "409", true,
    ["insert GD Publish Step CLAIM|1", "update GD Publish Step FREE"]]);
  mm = fresh("Created");
  rr = go(mm, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 25), form: formOf(mm, "Created") });
  eq("MIN-02 a Created IA: the claim too", [rr.out.route, claims(mm)], ["QUEUED", [["CLAIM|1", "FREE"]]]);
  mm = new Model();
  rr = go(mm, { pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-c1"), form: record(lines60()) });
  eq("MIN-02 a new IA (Add): no claim", [rr.out.route, mm.steps.filter((x) => /^IAS\|/.test(x.job_id)).length], ["QUEUED", 0]);
  mm = fresh("Draft");
  mm.steps.push(rival(1, "2026-10-19 09:59:30"));
  CURRENT = BUILT_OFF;
  rr = go(mm, { pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, 26), form: formOf(mm, "Draft") });
  eq("MIN-02 switch off: no claim read or written, the live claim ignored", [rr.out.route, mm.steps.filter((x) => /^IAS\|/.test(x.job_id) && x.step_name !== "CLAIM|1").length],
    ["QUEUED", 0]);
}

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
