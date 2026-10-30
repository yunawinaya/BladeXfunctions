// node scratchpad/iasc/test/sim_submit_v8.js - IA_V2_SUBMIT v8 (transfer requests from a reserved IA, RESERVED_REQUEST_PLAN.md Task 8)
// against v7 (= dev v16) in the iav2 FlowGram interpreter, on sim_submit_v7.js's model: every submit without a request (or with only
// Cancelled / other IAs' ones), every STATUS poll, every answer before the guard, runs as v7 (same answer, steps, writes, GENERATE_BATCH
// calls); a completion while a request is in transit is STOP 400 IA_TR_TRANSIT, while one is open IA_TR_OPEN, before any write; after a
// receipt every line a request can carry must be picked at the staging bin (D11, IA_TR_STAGING), serial / HU lines excepted. Both requests
// reads are emulated from the facts SQL text (constant gate, filters, first line); the facts node keeps only its declared columns.
// IA_V7 / IA_V8 = given files (else both are built into a temp folder).
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const IASC = path.join(__dirname, "..");
const IAV2 = path.join(IASC, "..", "iav2");
const { Engine } = require(path.join(IAV2, "lib", "sim", "engine.js"));
const C = require(path.join(IAV2, "code", "shared", "ia_common.js"));

const built = (script, env) => {
  if (process.env[env]) return process.env[env];
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ia-" + env.toLowerCase() + "-"));
  const r = spawnSync("python3", [path.join(IASC, "submit", script), "--write"], { env: Object.assign({}, process.env, { IASC_OUT: out }), encoding: "utf8" });
  if (r.status !== 0) throw new Error(script + ": " + r.stderr.slice(-1200));
  return path.join(out, "IA_V2_SUBMIT.json");
};
const CLAIM_SWITCH = /const IA_CLAIM_ENABLED = (true|false);/g;
const variant = (src, on) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ia-v7v-")), "IA_V2_SUBMIT.json");
  fs.writeFileSync(f, fs.readFileSync(src, "utf8").replace(CLAIM_SWITCH, "const IA_CLAIM_ENABLED = " + (on ? "true" : "false") + ";"));
  return f;
};
const SRC7 = built("patch_v7.py", "IA_V7");
const SRC8 = built("patch_v8.py", "IA_V8");
const V7 = variant(SRC7, false);
const V8 = variant(SRC8, false);
const V7_CL = variant(SRC7, true);
const V8_CL = variant(SRC8, true);
const T = "000000";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const PARENT = "2094626841323700251";
const BIN = "2018912822846582786";
// one above BIN: the same double (spacing 256 near 2e18) - only an exact (text) compare tells them apart
const NEIGHBOUR = "2018912822846582787";
const WH = "2018912822846583999";
const RBIN = "2018912822846582999";
const UOM = "2018906563477008392";
const ID = "2112073133161844738";
const LOT1 = "2113300000000000001";
const LOT2 = "2113300000000000002";
const LOT3 = "2113300000000000003";

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
const byBig = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);

// the facts' request column from the SQL text (null = NULL: the platform leaves it out)
const requestRead = (text, M) => {
  const q = String(text || "").replace(/\s+/g, " ");
  if (!/\bAS iatr\b/.test(q)) return null;
  const gate = /WHERE (\d+) > 0 AND '(\w*)' = 'SUBMIT' AND rq\.tenant_id/.exec(q);
  if (!gate) throw new Error("the request read without its gate: " + q.slice(q.indexOf("AS batch_cfg"), q.indexOf("AS batch_cfg") + 600));
  M.gates.push(gate[1] + "|" + gate[2]);
  // v8's column is the JSON object even with its gate closed (both lists null); v7's is NULL then
  if (!(BigInt(gate[1]) > 0n && gate[2] === "SUBMIT")) return /'reqs', \(SELECT/.test(q) ? JSON.stringify({ reqs: null, items: null }) : null;
  if (M.iatrText !== undefined) return M.iatrText;
  const ten = (/rq\.tenant_id = '(\w*)'/.exec(q) || [])[1];
  const ia = (/rq\.source_ia_id = '(\w*)'/.exec(q) || [])[1];
  // a predicate missing from the text filters nothing (as MySQL would read it)
  let rows = (M.requests || []).filter((r) => (ten === undefined || r.tenant === ten) && (ia === undefined || r.source === ia));
  if (/rq\.is_deleted = 0/.test(q)) rows = rows.filter((r) => !r.deleted);
  if (/rq\.transfer_purpose = 'IA_SUPPLY'/.test(q)) rows = rows.filter((r) => r.purpose === "IA_SUPPLY");
  if (/COALESCE\(rq\.stock_movement_status, ''\) <> 'Cancelled'/.test(q)) rows = rows.filter((r) => r.status !== "Cancelled");
  // v8: every request (its first line's bin + name) and the items asked for (none: the gate reads its own)
  if (/'reqs', \(SELECT/.test(q)) {
    const reqs = rows.map((x) => {
      const ls = x.lines.filter((l) => !(l.deleted && /rl\.is_deleted = 0/.test(q))).sort(byBig);
      const f = /MIN\(rl\.id\) AS first_id/.test(q) ? ls[0] : ls[ls.length - 1];
      return { id: x.id, no: x.no, status: x.status === undefined ? null : x.status, bin: f ? f.loc : null, bin_name: f ? (M.binNames || {})[f.loc] || null : null };
    });
    const ids = ((/ri\.id IN \(([0-9,]*)\)/.exec(q) || [])[1] || "").split(",").filter((x) => x && x !== "0");
    const t8 = JSON.stringify({ reqs: reqs.length ? reqs : null, items: ids.length ? ids : null });
    return M.bare ? t8.replace(/"(\d{16,})"/g, "$1") : t8;
  }
  const desc = /ORDER BY rq\.id DESC LIMIT 1\) AS iatr/.test(q);
  rows.sort((a, b) => byBig(a, b) * (desc ? -1 : 1));
  const r = rows[0];
  if (!r) return null;
  const lines = r.lines.filter((l) => !(l.deleted && /rl\.is_deleted = 0/.test(q)) && /rl\.sm_location_transfer_id = rq\.id/.test(q));
  const sorted = lines.slice().sort(byBig);
  const first = /MIN\(rl\.id\) AS first_id/.test(q) ? sorted[0] : sorted[sorted.length - 1];
  const bin = first ? first.loc : null;
  const text2 = JSON.stringify({ id: r.id, no: r.no, bin: bin, lines: lines.length ? lines.map((l) => l.src) : null, status: r.status === undefined ? null : r.status,
    bin_name: bin ? (M.binNames || {})[bin] || null : null });
  return M.bare ? text2.replace(/"(\d{16,})"/g, "$1") : text2;
};

// ---- sim_submit_v4.js's model (copied), + the IA's requests in the facts read
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
    this.gates = [];
    this.requests = [];
    this.binNames = { [BIN]: "PROD-A1", [WH]: "WH-01", [NEIGHBOUR]: "PROD-A2" };
    this.batchCfg = JSON.stringify({ n: 1, level: "Organization Level", date_format: "Document Date" });
    this.now = "2026-10-28 10:00:00";
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
    const row = { db_now: this.now, key_job: this.jobObj(kj), ia_id: h ? ia : null, stock_movement_no: no, item_assembly_status: h ? h.item_assembly_status : null,
      posted_status: h ? h.posted_status || null : null, organization_id: h ? h.organization_id : null, plant_id: h ? h.issuing_operation_faci : null,
      no_type: h ? String(h.stock_movement_no_type) : null, ia_v2_job_id: h ? h.ia_v2_job_id || null : null,
      ia_lock: lk ? JSON.stringify({ step: lk.step_name, ref: lk.result_ref, young: this.lockYoung === undefined ? 1 : this.lockYoung,
        job: (this.jobs.filter((j) => j.idempotency_key === lk.result_ref).slice(-1)[0] || {}).job_status || null }) : null,
      open_jobs: open.length ? "[" + open.map((j) => this.jobObj(j)).join(",") + "]" : null, last_job: this.jobObj(mine.slice(-1)[0]),
      link_job: h && h.ia_v2_job_id ? this.jobObj(this.jobs.find((j) => j.id === h.ia_v2_job_id)) : null,
      issued_by_job: h ? mine.filter((j) => j.command === "COMPLETE_IA" && no && req(j).issuedNo === no).length : 0,
      completed_under: h ? mine.filter((j) => j.command === "COMPLETE_IA" && j.job_status === "COMPLETED" && no && req(j).iaNo === no).length : 0, batch_cfg: this.batchCfg };
    const iatr = requestRead(sql, this);
    if (iatr !== null) row.iatr = iatr;
    return [row];
  }
  byJob(sql) {
    const job = sql.match(/ia_v2_job_id = '([0-9]+)'/)[1];
    return Object.keys(this.ia).filter((id) => this.ia[id].ia_v2_job_id === job).sort();
  }
  header(id) {
    const h = this.ia[id];
    return { j: JSON.stringify({ output_split: h.output_split === undefined ? null : h.output_split, id: id, item_id: h.item_id, item_qty: q8s(h.item_qty), item_uom: h.item_uom,
      location_id: h.location_id, inventory_category: h.inventory_category, batch_no: h.batch_no, issuing_operation_faci: h.issuing_operation_faci,
      organization_id: h.organization_id, stock_movement_no: h.stock_movement_no, stock_movement_no_type: String(h.stock_movement_no_type),
      item_assembly_status: h.item_assembly_status, posted_status: h.posted_status || null, table_hu: null,
      item_assembly_date: h.item_assembly_date ? h.item_assembly_date + " 00:00:00" : null, manufacturing_date: null, expired_date: null, remarks: h.remarks,
      remarks_2: h.remarks_2, remarks_3: h.remarks_3, ia_v2_job_id: h.ia_v2_job_id || null }) };
  }
  lineRows(id) {
    return this.ia[id].lines.map((l) => ({ j: JSON.stringify({ id: l.id, line_index: String(l.line_index), item_selection: l.item_selection, quantity_uom: l.quantity_uom,
      total_quantity: q8s(l.total_quantity), temp_qty_data: l.temp_qty_data, temp_hu_data: l.temp_hu_data || null, item_name: l.item_name }) }));
  }
  scSource(sql) {
    const ia = (sql.match(/h\.id = ([0-9]+) AND h\.is_deleted/) || [])[1];
    const h = ia && ia !== "0" ? this.ia[ia] : null;
    const SC = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id", "bom_snapshot_json", "planned_output_qty"];
    const stored = h ? Object.assign({ item_id: h.item_id }, ...SC.map((k) => ({ [k]: h[k] === undefined ? (k === "planned_output_qty" ? null : "") : h[k] }))) : null;
    return [{ j: JSON.stringify({ member: 1, stored: stored, line: null, header: null }) }];
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
  constructor(file, model, sc) {
    const items = () => sc.items.map((it) => ({ j: JSON.stringify(it) }));
    super({ dir: path.dirname(file), db: model, mocks: { read: {}, sql: {
      sql_node_ISfacts: (q) => model.facts(q),
      sql_node_ISitems: () => items(),
      sql_node_IScost: () => [],
      sql_node_ISwa: () => [],
      sql_node_ISdup: () => [],
      sql_node_IShdr: (q) => model.byJob(q).map((id) => ({ id: id, stock_movement_no: model.ia[id].stock_movement_no, item_assembly_status: model.ia[id].item_assembly_status,
        ia_v2_job_id: model.ia[id].ia_v2_job_id })),
      sql_node_ISheader: (q) => model.byJob(q).slice(0, 1).map((id) => model.header(id)),
      sql_node_ISosRead: () => [{ j: JSON.stringify({ bins: null, stored: null }) }],
      sql_node_ISlines: (q) => model.byJob(q).slice(0, 1).reduce((a, id) => a.concat(model.lineRows(id)), []),
      sql_node_ISback: (q) => model.back(q),
      sql_node_ISsc: (q) => model.scSource(q),
      sql_node_ISclaimState: (q) => {
        const ia = (q.match(/p\.job_id = 'IAS\|([0-9]+)'/) || [])[1];
        const mine = model.steps.filter((x) => x.job_id === "IAS|" + ia && /^CLAIM\|/.test(x.step_name));
        return [{ j: JSON.stringify({ max: mine.reduce((mx, x) => Math.max(mx, Number(x.step_name.slice(6))), 0), now: model.now }) }];
      },
      sql_node_ISclaims: (q) => {
        const ia = (q.match(/p\.job_id = 'IAS\|([0-9]+)'/) || [])[1];
        const held = model.steps.filter((x) => x.job_id === "IAS|" + ia && /^CLAIM\|/.test(x.step_name) && x.step_status === "HELD" && !Number(x.is_deleted));
        return [{ j: JSON.stringify({ claims: held.length ? held.map((x) => ({ id: x.id, name: x.step_name, started_at: x.started_at })) : null,
          status: model.ia[ia] ? model.ia[ia].item_assembly_status : null, now: model.now }) }];
      },
    } } });
    this.file = file;
    this.model = model;
    this.sc = sc;
    this.batchCalls = [];
  }
  load(name) {
    if (name === "IA_V2_SUBMIT") return JSON.parse(fs.readFileSync(this.file, "utf8"));
    throw new Error("no workflow " + name);
  }
  run(name, params) {
    if (name === "GENERATE_BATCH") {
      this.batchCalls.push(JSON.parse(JSON.stringify(params)));
      return { returned: { batch_number: "1016-005-0003" }, ctx: null };
    }
    return super.run(name, params);
  }
  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined ? "null" : JSON.stringify(v);
    });
  }
  node(nd, ctx) {
    super.node(nd, ctx);
    // the platform: the facts node lists its columns, so it keeps only those
    if (nd.id === "sql_node_ISfacts") {
      const names = (nd.data.response_json || []).map((r) => r.name).filter((x) => x);
      ctx.out[nd.id] = (ctx.out[nd.id] || []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => names.indexOf(k) >= 0)));
    }
  }
}

const pk = (m, loc) => ({ material_id: m, location_id: loc, batch_id: null, balance_id: "9000", sm_quantity: 1, category: "Unrestricted" });
const lineOf = (i, loc, extra) => Object.assign({ item_selection: comp(i), item_name: "C" + i, total_quantity: 1, requested_qty: 1, quantity_uom: UOM, temp_hu_data: "",
  temp_qty_data: JSON.stringify([pk(comp(i), loc || BIN)]) }, extra || {});
const record = (lines, extra) => Object.assign({ organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: "", stock_movement_no_type: "2098266711093927937",
  item_assembly_status: "", item_id: PARENT, item_name: "FG", item_desc: "", item_qty: 1, item_uom: UOM, item_assembly_date: "2026-10-28", issued_by: "t", project_id: "",
  batch_no: "", manufacturing_date: null, expired_date: null, storage_location_id: "2018912759311265793", location_id: RBIN, inventory_category: "Unrestricted", remarks: "",
  remarks_2: "", remarks_3: "", reference_documents: [], page_status: "Add", output_split: [], stock_movement: lines }, extra || {});
const itemRow = (id, extra) => Object.assign({ id: id, material_code: "M" + id.slice(-4), stock_control: 1, serial_number_management: 0, item_batch_management: 0,
  batch_number_genaration: "", material_costing_method: "First In First Out", based_uom: UOM, table_uom_conversion: [] }, extra || {});
const ITEMS = [itemRow(PARENT)].concat(Array.from({ length: 70 }, (_, i) => itemRow(comp(i))));
const keyOf = (id, gen) => "IA:" + ORG + ":" + id + ":0123456789abcdef:" + (gen || 1);
// a stored IA of 60 lines (one pick each at BIN), its line ids from the model
const stored = (status, opts) => {
  const m = new Model(opts);
  m.ia[ID] = Object.assign(record([], { page_status: "Edit", item_assembly_status: status, stock_movement_no: "IA-2610-0007" }), { lines: [] });
  m.writeLines(m.ia[ID], Array.from({ length: 60 }, (_, i) => lineOf(i, BIN, { line_index: i + 1 })));
  return m;
};
const lineIds = (m) => m.ia[ID].lines.map((l) => l.id);
// the form as a stored IA's tab sends it; locs: line index -> pick bin
const formOf = (m, status, locs) => record(m.ia[ID].lines.map((l, i) => Object.assign({}, l, (locs || {})[i] ? { temp_qty_data: JSON.stringify([pk(l.item_selection, locs[i])]) } : {})),
  { id: ID, page_status: "Edit", item_assembly_status: status, stock_movement_no: "IA-2610-0007" });
const rq = (id, no, status, srcs, extra) => Object.assign({ id: id, no: no, status: status, tenant: T, source: ID, purpose: "IA_SUPPLY", deleted: false,
  lines: srcs.map((s, k) => ({ id: String(BigInt(id) + 100n + BigInt(k)), src: s, loc: BIN })) }, extra || {});

function go(file, m, req, sc) {
  const e = new Sim(file, m, Object.assign({ items: ITEMS }, sc || {}));
  let out = null;
  let error = null;
  try {
    out = e.run("IA_V2_SUBMIT", Object.assign({ operation: "SUBMIT", saveAs: "Completed", source: "FORM" }, req)).returned;
  } catch (x) {
    error = x.message;
  }
  return { out: out, error: error, steps: e.trace.map((t) => t.split(" ")[1]), batchCalls: e.batchCalls, writes: m.writes, gates: m.gates };
}
// one scenario on both: make(m) builds the model, req(m) the request
// make7 = the v7 model when it differs (the same scenario without what v8 newly allows)
const both = (label, make, req, sc, files, make7) => {
  const [f7, f8] = files || [V7, V8];
  const m7 = (make7 || make)();
  const m8 = make();
  const a = go(f7, m7, req(m7), sc);
  const b = go(f8, m8, req(m8), sc);
  eq(label + ": answer == v7", [b.error, b.out], [a.error, a.out]);
  eq(label + ": steps == v7", b.steps, a.steps);
  eq(label + ": writes == v7", b.writes, a.writes);
  eq(label + ": GENERATE_BATCH calls == v7", b.batchCalls, a.batchCalls);
  return { v7: a, v8: b, m8: m8 };
};
const stop = (label, res, code, re) => {
  eq(label + ": STOP 400 " + code, [res.error, res.out && res.out.route, res.out && res.out.code, res.out && res.out.error_code], [null, "STOP", "400", code]);
  eq(label + ": its message (" + ((res.out && res.out.message) || "") + ")", re.test((res.out && res.out.message) || ""), true);
  eq(label + ": nothing written, no number generated", [res.writes.length, res.batchCalls.length], [0, 0]);
};
const LIVE_RE = (no, st) => new RegExp("^The materials of this Item Assembly are still being transferred \\(transfer request " + no + " is " + st + "\\): receive it first, or cancel it\\.$");
const PICK_RE = (k, item, bin, no) => new RegExp("^Line " + k + " \\(" + item + "\\): pick it from " + bin + ", where transfer request " + no + " delivered it\\.$");
const submit = (status, locs, gen) => (m) => ({ pageStatus: "Edit", ia_id: ID, idempotency_key: keyOf(ID, gen), form: formOf(m, status, locs) });

// ---- the declared column
{
  const doc = JSON.parse(fs.readFileSync(SRC8, "utf8"));
  const facts = doc.nodes.find((x) => x.id === "sql_node_ISfacts");
  eq("declared: the facts' iatr column (string)", facts.data.response_json.slice(-1).map((r) => [r.name, r.bsonType]), [["iatr", "string"]]);
}
const with_ = (status, reqs, opts) => () => {
  const m = stored(status, opts);
  m.requests = reqs(m);
  return m;
};
const TRANSIT_RE = (no, st) => new RegExp("^The materials of this Item Assembly are being transferred \\(transfer request " + no + " is " + st + "\\): it can't be changed until that request is received\\.$");
const OPEN_RE = (no, st) => new RegExp("^Transfer request " + no + " of this Item Assembly is " + st + ": receive it or cancel it before completing the Item Assembly\\.$");
const STAGING_RE = (k, item, bin, no) => new RegExp("^Line " + k + " \\(" + item + "\\): take it from " + bin + ", where transfer request " + no + " delivered the materials");

// ================================================================ no request / only Cancelled / before the guard: v7
let r = both("Add (no stored IA)", () => new Model(), () => ({ pageStatus: "Add", ia_id: "", idempotency_key: keyOf("new-a1"), form: record(Array.from({ length: 60 }, (_, i) => lineOf(i))) }));
eq("Add: QUEUED, the read's gate closed (no IA)", [r.v8.out.route, r.v8.gates], ["QUEUED", ["0|SUBMIT"]]);
r = both("stored Draft, no request", () => stored("Draft"), submit("Draft"));
eq("stored Draft: QUEUED, the gate open", [r.v8.out.route, r.v8.gates], ["QUEUED", [ID + "|SUBMIT"]]);
r = both("stored Created, no request", () => stored("Created"), submit("Created"));
eq("stored Created: QUEUED", r.v8.out.route, "QUEUED");
const others = (m) => [rq(LOT1, "LOT-R1", "Cancelled", lineIds(m)), rq(LOT2, "LOT-R2", "In Progress", lineIds(m), { source: "2112073133161844799" }),
  rq(LOT3, "LOT-R3", "In Progress", lineIds(m), { purpose: "" }), rq("2113300000000000004", "LOT-R4", "In Progress", lineIds(m), { deleted: true }),
  rq("2113300000000000005", "LOT-R5", "In Progress", lineIds(m), { tenant: "000001" })];
r = both("only a Cancelled request + other IAs' / purposes' / deleted / tenants' ones, picks anywhere", with_("Created", others), submit("Created", { 0: WH, 5: WH }));
eq("only Cancelled: QUEUED", r.v8.out.route, "QUEUED");
r = both("a STATUS poll with a request in transit: answered as v7, the gate closed", with_("Created", (m) => [rq(LOT1, "LOT-R1", "In Progress", lineIds(m))]),
  () => ({ operation: "STATUS", pageStatus: "", ia_id: ID, idempotency_key: "", form: {} }));
eq("STATUS: the gate STATUS", r.v8.gates, [ID + "|STATUS"]);
r = both("a Draft submit with a request in transit: v7's NOT_ELIGIBLE", with_("Created", (m) => [rq(LOT1, "LOT-R1", "In Progress", lineIds(m))]),
  (m) => Object.assign(submit("Created")(m), { saveAs: "Draft" }));
eq("Draft submit: NOT_ELIGIBLE", r.v8.out.route, "NOT_ELIGIBLE");
r = both("a stored Completed IA with a request in transit: v7's STALE (already final)", with_("Completed", (m) => [rq(LOT1, "LOT-R1", "In Progress", lineIds(m))]),
  submit("Completed"));
eq("stored Completed: STALE IA_ALREADY_FINAL", [r.v8.out.route, r.v8.out.error_code], ["STALE", "IA_ALREADY_FINAL"]);
r = both("a stored Processing IA with a request: v7's BUSY", with_("Processing", (m) => [rq(LOT1, "LOT-R1", "Requested", lineIds(m))]), submit("Processing"));
eq("stored Processing: BUSY", r.v8.out.route, "BUSY");
r = both("claim ON, stored Created, no request", () => stored("Created"), submit("Created"), null, [V7_CL, V8_CL]);
eq("claim ON: QUEUED", r.v8.out.route, "QUEUED");

// ================================================================ in transit / open (D4): STOP 400 before any write
for (const st of ["In Progress", "Processing"]) {
  const m = with_("Created", (mm) => [rq(LOT1, "LOT-R1", st, lineIds(mm))])();
  r = go(V8, m, submit("Created")(m));
  stop("stored Created while " + st, r, "IA_TR_TRANSIT", TRANSIT_RE("LOT-R1", st));
  eq("  answered by the entry (no gate, no reads after it)", [r.steps.indexOf("code_node_ISgate"), r.steps.indexOf("condition_all_ISread")], [-1, -1]);
}
{
  const m = with_("Created", (mm) => [rq(LOT1, "LOT-R1", "Requested", lineIds(mm))])();
  stop("stored Created while Requested -> IA_TR_OPEN", go(V8, m, submit("Created")(m)), "IA_TR_OPEN", OPEN_RE("LOT-R1", "Requested"));
}
{
  const m = with_("Created", (mm) => [rq(LOT1, "LOT-R1", "Completed", lineIds(mm)), rq(LOT2, "LOT-R2", "Requested", lineIds(mm).slice(0, 1))])();
  stop("a replacement still open after a receipt -> IA_TR_OPEN", go(V8, m, submit("Created")(m)), "IA_TR_OPEN", OPEN_RE("LOT-R2", "Requested"));
}
{
  const m = with_("Created", (mm) => [rq(LOT1, "LOT-R1", "Draft", lineIds(mm))])();
  stop("a status the guard does not know (fail closed)", go(V8, m, submit("Created")(m)), "IA_TR_TRANSIT", TRANSIT_RE("LOT-R1", "Draft"));
}
{
  const m = stored("Created", { iatrText: "{truncated" });
  stop("an unreadable read", go(V8, m, submit("Created")(m)), "IA_TR_UNREADABLE", /^The transfer requests of this Item Assembly could not be read/);
}
{
  const m = with_("Created", (mm) => [rq(LOT1, "LOT-R1", "In Progress", lineIds(mm))])();
  stop("claim ON: refused before the claim", go(V8_CL, m, submit("Created")(m)), "IA_TR_TRANSIT", TRANSIT_RE("LOT-R1", "In Progress"));
}

// ================================================================ after a receipt (D11): every line a request can carry at the staging bin
const recvAll = with_("Created", (mm) => [rq(LOT1, "LOT-R1", "Completed", lineIds(mm))]);
r = both("received, every line at the staging bin: queued as v7", recvAll, submit("Created"));
eq("  QUEUED", r.v8.out.route, "QUEUED");
{
  const m = with_("Created", (mm) => [rq(LOT1, "LOT-R1", "Completed", lineIds(mm).slice(0, 3))])();
  stop("a line the request never carried, picked in the warehouse -> IA_TR_STAGING (v7 let it pass)", go(V8, m, submit("Created", { 10: WH })(m)), "IA_TR_STAGING",
    STAGING_RE(11, "C10", "PROD-A1", "LOT-R1"));
}
{
  const serial = ITEMS.map((it, i) => (i === 11 ? Object.assign({}, it, { serial_number_management: 1 }) : it));
  const m = recvAll();
  r = go(V8, m, submit("Created", { 10: WH })(m), { items: serial });
  eq("a serial line from the warehouse: not refused for the staging bin (v7's NOT_ELIGIBLE for a serial component follows)", [r.out.route, r.out.error_code !== "IA_TR_STAGING"],
    ["NOT_ELIGIBLE", true]);
}
{
  const m = with_("Created", (mm) => [rq(LOT1, "LOT-R1", "Completed", lineIds(mm))], { bare: true })();
  stop("bare 19-digit numbers: the neighbouring bin is not the staging bin", go(V8, m, submit("Created", { 0: NEIGHBOUR })(m)), "IA_TR_STAGING",
    STAGING_RE(1, "C0", "PROD-A1", "LOT-R1"));
}
r = both("bare 19-digit numbers: the staging bin itself queues as v7", with_("Created", (mm) => [rq(LOT1, "LOT-R1", "Completed", lineIds(mm))], { bare: true }), submit("Created"));
eq("  QUEUED", r.v8.out.route, "QUEUED");
{
  const m = with_("Created", (mm) => [rq(LOT1, "LOT-R1", "Completed", lineIds(mm)), Object.assign(rq(LOT2, "LOT-R2", "Completed", lineIds(mm).slice(0, 1)),
    { lines: [{ id: "2113300000000000301", src: lineIds(mm)[0], loc: WH }] })])();
  stop("the staging bin is the newest received request's", go(V8, m, submit("Created")(m)), "IA_TR_STAGING", STAGING_RE(1, "C0", "WH-01", "LOT-R2"));
}

// the staging bin = the newest received request's first line (by id, not deleted)
{
  const m = stored("Created");
  const ids = lineIds(m);
  m.requests = [Object.assign(rq(LOT1, "LOT-R1", "Completed", []), { lines: [{ id: "2113300000000000201", src: ids[1], loc: NEIGHBOUR }, { id: "2113300000000000101", src: ids[0], loc: BIN }] })];
  eq("the staging bin is the first line's (by id), not the last", go(V8, m, submit("Created")(m)).out.route, "QUEUED");
}
{
  const m = stored("Created");
  const ids = lineIds(m);
  m.requests = [Object.assign(rq(LOT1, "LOT-R1", "Completed", []), { lines: [{ id: "2113300000000000101", src: ids[0], loc: WH, deleted: true },
    { id: "2113300000000000102", src: ids[1], loc: BIN }] })];
  eq("a deleted request line is not the staging bin", go(V8, m, submit("Created")(m)).out.route, "QUEUED");
}

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
