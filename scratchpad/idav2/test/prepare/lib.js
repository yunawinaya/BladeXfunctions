// IDA_V2_PREPARE test harness: the BUILT workflow run end to end by lib/sim/engine.js (SQL rows mocked, INVENTORY_BULK_APPLY answered by a
// stub or the deployed v10 planner, writes recorded), the classic IDA_SAVE v6 (base/) run the same way as the oracle for synthesized
// documents, and the helpers the tests share. Read-only: nothing here touches a database.
const fs = require("fs");
const path = require("path");
const IDAV2 = path.join(__dirname, "..", "..");
const REPO = path.join(IDAV2, "..", "..");
// IDA_PREPARE_OUT: a folder with a mutated IDA_V2_PREPARE.json (test/prepare/mutants.js)
const OUT = process.env.IDA_PREPARE_OUT || path.join(REPO, "Item Disassembly", "AsyncV2");
const { Engine } = require(path.join(IDAV2, "lib", "sim", "engine.js"));
const C = require(path.join(IDAV2, "code", "shared", "ida_common.js"));
const FP = require(path.join(IDAV2, "code", "shared", "fingerprint.js"));
const PR = require(path.join(IDAV2, "code", "shared", "price.js"));

const BIG = /"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g;
const parseBig = (t) => JSON.parse(String(t).replace(BIG, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
const fixturePath = (name) => path.join(__dirname, "fixtures", name + ".json");
const hasFixture = (name) => fs.existsSync(fixturePath(name));
const fixture = (name) => parseBig(fs.readFileSync(fixturePath(name), "utf8"));
const built = () => parseBig(fs.readFileSync(path.join(OUT, "IDA_V2_PREPARE.json"), "utf8"));
const nodeById = (doc, id) => {
  let hit = null;
  const walk = (n) => {
    if (hit || !n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.id === id && n.type) hit = n;
    else Object.values(n).forEach(walk);
  };
  walk(doc.nodes);
  return hit;
};
// a code node's body without its platform tail (the lines from the first {{ token on), plus an export list
const codeOf = (doc, id, names) => {
  const code = nodeById(doc, id).data.script.code;
  const lines = code.split("\n");
  const at = lines.findIndex((l) => l.includes("{{"));
  return new Function((at < 0 ? lines : lines.slice(0, at)).join("\n") + "\nreturn { " + names.join(", ") + " };")();
};

// lib/sim/engine.js + ConditionRule if-nodes (leaves equal / notEqual, branches any / all), a token without a value injected as null
// (the platform's rule), sub-workflows answered by stubs or loaded from another folder (opts.load: the engine snapshot in base/)
class Sim extends Engine {
  constructor(opts) {
    super(opts);
    this.answers = opts.answers || {};
    this.loads = opts.load || {};
    this.calls = [];
  }
  load(name) {
    return this.loads[name] ? JSON.parse(fs.readFileSync(this.loads[name], "utf8")) : super.load(name);
  }
  rule(f, ctx, id) {
    if (f.type === "branch") return f.operator === "all" ? f.children.every((c) => this.rule(c, ctx, id)) : f.children.some((c) => this.rule(c, ctx, id));
    const v = this.resolve(f.prop.replace(/^(workflowparams|node)\./, "$1:"), ctx);
    if (f.operator !== "equal" && f.operator !== "notEqual") throw new Error("operator " + f.operator + " not simulated (" + id + ")");
    return (String(v) === String(f.value)) === (f.operator === "equal");
  }
  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined || v === null ? "null" : JSON.stringify(v);
    });
  }
  run(name, params) {
    const copy = JSON.parse(JSON.stringify(params || {}));
    this.calls.push({ name: name, params: copy });
    const a = this.answers[name];
    if (a === undefined) return super.run(name, params);
    return { returned: typeof a === "function" ? a(copy, this) : a, ctx: {} };
  }
  node(n, ctx) {
    if (n.type === "if" && n.data.condition_type === "ConditionRule") return this.block(n.blocks[this.rule(n.data.filter.list[0], ctx, n.id) ? 0 : 1].blocks, ctx);
    return super.node(n, ctx);
  }
}

class RecDB {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.writes = [];
    this.seq = 2900000000000000000n;
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }
  insert(table, rows) {
    const out = rows.map((r) => Object.assign({ id: this.id() }, r));
    this.writes.push({ op: "insert", table: table, rows: out });
    return out;
  }
  update(table, rows) {
    const out = rows.map((r) => {
      const o = Object.assign({}, r);
      delete o.__id;
      return o;
    });
    this.writes.push({ op: "update", table: table, rows: out });
    return out;
  }
  of(table, op) {
    return this.writes.filter((w) => w.table === table && (!op || w.op === op));
  }
}

const planOk = (params) => ({ code: "200", result_code: "OK", message: "Planned " + params.movements.length + " movements",
  results: params.movements.map((m) => ({ movement_key: m.movement_key, direction: m.direction, code: "200", unit_price: 0, total_price: 0 })),
  summary: { movements: params.movements.length, skipped: 0 } });

const JOB = "2112100000000000001";
const DB_NOW = "2026-10-21 16:30:00";
const ENGINE_FILE = path.join(IDAV2, "base", "INVENTORY_BULK_APPLY.v12.json");
// one PREPARE run of the built IDA_V2_PREPARE.json; spec = { tenant, org, idaId, key, request, hdr, lines, items, bins, typed, job, owner, planI, planR, engine }
function runPrepare(spec) {
  const doc = built();
  const tenant = spec.tenant || "000000";
  const db = new RecDB(tenant);
  const jobRow = Object.assign({ db_now: DB_NOW, id: JOB, organization_id: spec.org, command: "COMPLETE_IDA", job_status: "VALIDATING", lease_owner: "WRK|aaaaaaaaaaaaaaaaaaaaaaaa",
    lease_live: 1, row_version: 3, attempt_count: 0, idempotency_key: spec.key, correlation_id: "IDA|" + spec.idaId, request_payload: JSON.stringify(spec.request), is_deleted: 0,
    linked_ida: null }, spec.job || {});
  const ownerRow = Object.assign({ db_now: DB_NOW, ida_id: spec.idaId, item_disassembly_status: "Processing", ida_v2_job_id: JOB, stock_movement_no: spec.request.idaNo,
    lock_ref: spec.key, lock_step: "LOCK|1" }, spec.owner || {});
  const sqlSeen = {};
  const rows = (id, v) => (sql) => {
    sqlSeen[id] = sql;
    return v;
  };
  const back = (sql) => {
    sqlSeen.sql_node_DPback = sql;
    const ups = db.of("GD Async Job", "update");
    const last = ups.length ? ups[ups.length - 1].rows[0] : {};
    return [{ id: JOB, job_status: last.job_status || "VALIDATING", progress_message: last.progress_message || null, error_code: last.error_code || null,
      error_message: last.error_message || null }];
  };
  const sql = { sql_node_DPjob: rows("sql_node_DPjob", spec.jobRows || [jobRow]), sql_node_DPowner: rows("sql_node_DPowner", [ownerRow]),
    sql_node_DPhdr: rows("sql_node_DPhdr", spec.hdr), sql_node_DPlines: rows("sql_node_DPlines", spec.lines), sql_node_DPitems: rows("sql_node_DPitems", spec.items),
    sql_node_DPbins: rows("sql_node_DPbins", spec.bins || []), sql_node_DPtyped: rows("sql_node_DPtyped", spec.typed || []),
    sql_node_DPstorage: rows("sql_node_DPstorage", spec.storage || []), sql_node_DPback: back };
  // spec.engine = { items, bal, batch, fifo, wa, prec }: the deployed INVENTORY_BULK_APPLY v10 (base/) plans on these rows (its reads mocked)
  const E = spec.engine;
  if (E) {
    Object.assign(sql, { sql_node_IBops: () => [], sql_node_IBitems: () => E.items, sql_node_IBbal: () => E.bal || [], sql_node_IBbatch: () => E.batch || [],
      sql_node_IBfifo: () => E.fifo || [], sql_node_IBwa: () => E.wa || [], sql_node_IBmv: () => [], sql_node_IBprec: () => E.prec || [] });
  }
  const sim = new Sim({
    dir: OUT, db: db, mocks: { sql: sql, read: {} },
    load: E ? { INVENTORY_BULK_APPLY: ENGINE_FILE } : {},
    answers: E ? {} : { INVENTORY_BULK_APPLY: (p) => {
      const side = /\|R$/.test(p.operation_key) ? "R" : "I";
      const a = spec["plan" + side];
      return a === undefined ? planOk(p) : typeof a === "function" ? a(p) : a;
    } },
  });
  const t0 = Date.now();
  const r = sim.run("IDA_V2_PREPARE", { job_id: spec.jobId === undefined ? JOB : spec.jobId });
  const ms = Date.now() - t0;
  const out = r.ctx.out;
  const stepRows = [].concat(...db.of("GD Publish Step", "insert").map((w) => w.rows));
  const jobUps = [].concat(...db.of("GD Async Job", "update").map((w) => w.rows));
  const unlocks = [].concat(...db.of("Item Disassembly", "update").map((w) => w.rows));
  const ready = jobUps.find((j) => j.job_status === "READY_TO_COMMIT") || null;
  const manifest = ready ? parseBig(ready.prepared_payload) : null;
  const parts = {};
  if (manifest) for (const [name, steps] of Object.entries(manifest.parts)) parts[name] = C.idaJoinChunks(stepRows.filter((s) => steps.indexOf(s.step_name) >= 0), steps[0].slice(0, -3));
  const engineAnswers = ["workflow_node_DPplanI", "workflow_node_DPplanR"].map((id) => out[id] || null);
  return { returned: r.returned, out: out, db: db, calls: sim.calls.filter((c) => c.name === "INVENTORY_BULK_APPLY"), engineAnswers: engineAnswers, stepRows: stepRows, jobUps: jobUps,
    unlocks: unlocks, ready: ready, manifest: manifest,
    parts: parts, failed: jobUps.find((j) => j.job_status === "FAILED" || j.job_status === "REQUIRES_REVIEW") || null, sql: sqlSeen, bytes: r.ctx.bytes, ms: ms, sizes: sim.sizes };
}

// the stored rows as PREPARE's SQL returns them (JSON_OBJECT text: ids CAST as text, decimals JSON numbers, dates DATE_FORMAT)
const jrow = (o) => ({ j: JSON.stringify(o) });
const keyOf = (org, idaId) => "IDA:" + org + ":" + idaId + ":0123456789abcdef:1";
// the request SUBMIT wrote (CONTRACT.md section 3), over the given stored rows and item rows
function requestFor(hdr, lines, items, extra) {
  const h = parseBig(hdr[0].j);
  const ls = lines.map((l) => parseBig(l.j));
  const its = (items || []).map((x) => (typeof x.j === "string" ? parseBig(x.j) : x));
  const stock = ls.filter((l) => {
    const it = PR.idaItemOf(its, l.item_selection);
    return it && C.idaS(it.stock_control) !== "0";
  }).length;
  const rec = C.idaRecoveryLines(ls).length;
  return Object.assign({ v: 1, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Edit", idaId: h.id, idaNo: h.stock_movement_no, issuedNo: "",
    lineFingerprint: FP.idaLineFingerprint(lines, hdr), organizationId: h.organization_id, plantId: h.issuing_operation_faci, lineCount: rec, pickCount: C.idaPickCount(h),
    moveCount: C.idaMoveCount(h, ls), stockLines: stock, nonStockLines: rec - stock, uid: "1123598821738675201", source: "FORM", nonce: "sub00001", parts: {} }, extra || {});
}
// a golden's stored rows as PREPARE would have read them under its job: Processing + ida_v2_job_id, the lines' batch numbers as the
// classic's request held them (the classic wrote the generated number into the AUTO line afterwards), no Batch row of the run itself
function goldenSpec(fx) {
  const h = parseBig(fx.db.hdr[0].j);
  h.item_disassembly_status = "Processing";
  h.ida_v2_job_id = JOB;
  h.posted_status = null;
  const hdr = [jrow(h)];
  const sent = {};
  for (const l of fx.parent.allData.stock_movement || []) sent[String(l.line_index)] = l;
  const lines = fx.db.lines.map((r) => {
    const l = parseBig(r.j);
    const s = sent[String(l.line_index)];
    if (s) l.batch_number = s.batch_number;
    return jrow(l);
  });
  const typed = fx.db.typed.filter((r) => BigInt(parseBig(r.j).id) < BigInt(fx.run));
  const request = requestFor(hdr, lines, fx.db.items, { pageStatus: fx.parent.pageStatus === "Add" ? "Add" : "Edit" });
  return { tenant: fx.tenant, org: h.organization_id, idaId: fx.ida_id, key: keyOf(h.organization_id, fx.ida_id), request: request, hdr: hdr, lines: lines,
    items: fx.db.items, bins: fx.db.bins, typed: typed, storage: fx.db.storage || [] };
}

// the classic IDA_SAVE v6 (base/) on a form record (an Edit of a stored Draft) with stubbed children: its SUBTRACT / ADD / GENERATE_BATCH params
// are the oracle; GENERATE_BATCH answers Batch-<n> in call order
function runClassic(form, opts) {
  const o = opts || {};
  const db = new RecDB(o.tenant || "000000");
  const items = o.items;
  const stored = o.stored;
  let gen = 0;
  const sim = new Sim({
    dir: path.join(IDAV2, "base"), db: db,
    mocks: { sql: {}, read: {
      search_items: () => ({ total: items.length, count: items.length, data: items }),
      search_batches: () => ({ total: (o.batches || []).length, count: (o.batches || []).length, data: o.batches || [] }),
      get_persisted_ida: () => ({ count: 1, data: Object.assign({}, stored, { item_disassembly_status: "Draft" }) }),
      get_ida: () => ({ count: 1, data: stored }),
      search_movements: () => ({ total: (o.outMovements || []).length, count: (o.outMovements || []).length, data: o.outMovements || [] }),
    } },
    answers: { CHECK_REQUIRED_FIELD: { data: { status: "Passed", message: "" } }, GLOBAL_INVENTORY_VALIDATION: { code: "200" },
      GENERATE_BATCH: () => ({ batch_number: "Batch-" + String(++gen).padStart(5, "0") }), SUBTRACT_INVENTORY: { code: "200" }, ADD_INVENTORY: { code: "200" },
      HANDLING_UNIT: { code: "200" } },
  });
  const r = sim.run("IDA_SAVE.v6", { allData: form, saveAs: "Completed", pageStatus: o.pageStatus || "Edit" });
  const pick = (name) => sim.calls.filter((c) => c.name === name).map((c) => {
    const p = Object.assign({}, c.params);
    delete p.itemData;
    return p;
  });
  return { returned: r.returned, subtracts: pick("SUBTRACT_INVENTORY"), adds: pick("ADD_INVENTORY"), generates: pick("GENERATE_BATCH"), calls: sim.calls, out: r.ctx.out, db: db };
}

let fails = 0;
let passes = 0;
const show = (v) => JSON.stringify(v === undefined ? "<undefined>" : v);
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++;
  else {
    fails++;
    console.log("FAIL " + label + "\n     got  " + show(got).slice(0, 1500) + "\n     want " + show(want).slice(0, 1500));
  }
  return ok;
}
function truthy(label, cond, extra) {
  if (cond) passes++;
  else {
    fails++;
    console.log("FAIL " + label + (extra === undefined ? "" : "  " + show(extra).slice(0, 1500)));
  }
  return !!cond;
}
function section(title) {
  console.log("-- " + title);
}
function note(text) {
  console.log("   " + text);
}
function done() {
  console.log((fails ? fails + " FAILED, " : "") + passes + " checks passed");
  process.exit(fails ? 1 : 0);
}

module.exports = { IDAV2, OUT, C, FP, PR, parseBig, hasFixture, fixture, built, nodeById, codeOf, Sim, RecDB, planOk, runPrepare, jrow, keyOf, requestFor, goldenSpec, runClassic,
  JOB, DB_NOW, ENGINE_FILE, eq, truthy, section, note, done };
