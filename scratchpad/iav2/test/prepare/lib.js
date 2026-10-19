// IA_V2_PREPARE test harness: the BUILT workflow run end to end by lib/sim/engine.js (SQL rows mocked, INVENTORY_BULK_APPLY
// answered by a stub, writes recorded), the classic IA_SAVE v11 run the same way as the oracle for synthesized documents, and the
// helpers the tests share. Read-only: nothing here touches a database.
const fs = require("fs");
const path = require("path");
const IAV2 = path.join(__dirname, "..", "..");
const REPO = path.join(IAV2, "..", "..");
const OUT = path.join(REPO, "Item Assembly & BOM", "AsyncV2");
const { Engine } = require(path.join(IAV2, "lib", "sim", "engine.js"));
const C = require(path.join(IAV2, "code", "shared", "ia_common.js"));
const FP = require(path.join(IAV2, "code", "shared", "fingerprint.js"));

const BIG = /"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g;
const parseBig = (t) => JSON.parse(String(t).replace(BIG, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
// prod-derived goldens live outside every git repo (prod business data never enters the working tree); dev ones in fixtures/
const PROD_FIXTURES = "/Users/yunawinaya/Documents/ASC-dev/iav2-fixtures/a";
const fixturePath = (name) => path.join(/^prod_/.test(name) ? PROD_FIXTURES : path.join(__dirname, "fixtures"), name + ".json");
const hasFixture = (name) => fs.existsSync(fixturePath(name));
const fixture = (name) => parseBig(fs.readFileSync(fixturePath(name), "utf8"));
const built = () => parseBig(fs.readFileSync(path.join(OUT, "IA_V2_PREPARE.json"), "utf8"));
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
    const a = this.answers[name];
    if (a === undefined) return super.run(name, params);
    const copy = JSON.parse(JSON.stringify(params));
    this.calls.push({ name: name, params: copy });
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
const DB_NOW = "2026-10-19 16:30:00";
// one PREPARE run of the built IA_V2_PREPARE.json; spec = { tenant, iaId, key, request, hdr, lines, items, bins, job, owner, planI, planR }
function runPrepare(spec) {
  const doc = built();
  const tenant = spec.tenant || "000000";
  const db = new RecDB(tenant);
  const jobRow = Object.assign({ db_now: DB_NOW, id: JOB, organization_id: spec.org, command: "COMPLETE_IA", job_status: "VALIDATING", lease_owner: "WRK|aaaaaaaaaaaaaaaaaaaaaaaa",
    lease_live: 1, row_version: 3, attempt_count: 0, idempotency_key: spec.key, correlation_id: "IA|" + spec.iaId, request_payload: JSON.stringify(spec.request), is_deleted: 0,
    linked_ia: null }, spec.job || {});
  const ownerRow = Object.assign({ db_now: DB_NOW, ia_id: spec.iaId, item_assembly_status: "Processing", ia_v2_job_id: JOB, stock_movement_no: spec.request.iaNo,
    lock_ref: spec.key, lock_step: "LOCK|1" }, spec.owner || {});
  const sqlSeen = {};
  const rows = (id, v) => (sql) => {
    sqlSeen[id] = sql;
    return v;
  };
  const back = (sql) => {
    sqlSeen.sql_node_IPback = sql;
    const ups = db.of("GD Async Job", "update");
    const last = ups.length ? ups[ups.length - 1].rows[0] : {};
    return [{ id: JOB, job_status: last.job_status || "VALIDATING", progress_message: last.progress_message || null, error_code: last.error_code || null,
      error_message: last.error_message || null }];
  };
  const sql = { sql_node_IPjob: rows("sql_node_IPjob", spec.jobRows || [jobRow]), sql_node_IPowner: rows("sql_node_IPowner", [ownerRow]),
    sql_node_IPhdr: rows("sql_node_IPhdr", spec.hdr), sql_node_IPlines: rows("sql_node_IPlines", spec.lines), sql_node_IPitems: rows("sql_node_IPitems", spec.items),
    sql_node_IPbins: rows("sql_node_IPbins", spec.bins || []), sql_node_IPback: back };
  // spec.engine = { items, bal, batch, fifo, wa }: the real INVENTORY_BULK_APPLY v10 (base/) plans on these rows (its reads mocked)
  const E = spec.engine;
  if (E) {
    const seen = [];
    Object.assign(sql, { sql_node_IBops: () => [], sql_node_IBitems: () => E.items, sql_node_IBbal: () => E.bal || [], sql_node_IBbatch: () => E.batch || [],
      sql_node_IBfifo: () => E.fifo || [], sql_node_IBwa: () => E.wa || [], sql_node_IBmv: () => [], sql_node_IBprec: () => E.prec || [] });
    E.seen = seen;
  }
  const sim = new Sim({
    dir: OUT, db: db, mocks: { sql: sql, read: {} },
    load: E ? { INVENTORY_BULK_APPLY: path.join(IAV2, "base", "INVENTORY_BULK_APPLY.v10.json") } : {},
    answers: E ? {} : { INVENTORY_BULK_APPLY: (p) => {
      const side = /\|R$/.test(p.operation_key) ? "R" : "I";
      const a = spec["plan" + side];
      return a === undefined ? planOk(p) : typeof a === "function" ? a(p) : a;
    } },
  });
  const t0 = Date.now();
  const r = sim.run("IA_V2_PREPARE", { job_id: spec.jobId === undefined ? JOB : spec.jobId });
  const ms = Date.now() - t0;
  const out = r.ctx.out;
  const stepRows = [].concat(...db.of("GD Publish Step", "insert").map((w) => w.rows));
  const jobUps = [].concat(...db.of("GD Async Job", "update").map((w) => w.rows));
  const unlocks = [].concat(...db.of("Item Assembly", "update").map((w) => w.rows));
  const ready = jobUps.find((j) => j.job_status === "READY_TO_COMMIT") || null;
  const manifest = ready ? parseBig(ready.prepared_payload) : null;
  const parts = {};
  if (manifest) for (const [name, steps] of Object.entries(manifest.parts)) parts[name] = C.iaJoinChunks(stepRows.filter((s) => steps.indexOf(s.step_name) >= 0), steps[0].slice(0, -3));
  const engineAnswers = ["workflow_node_IPplanI", "workflow_node_IPplanR"].map((id) => out[id] || null);
  return { returned: r.returned, out: out, db: db, calls: sim.calls, engineAnswers: engineAnswers, stepRows: stepRows, jobUps: jobUps, unlocks: unlocks, ready: ready, manifest: manifest, parts: parts,
    failed: jobUps.find((j) => j.job_status === "FAILED" || j.job_status === "REQUIRES_REVIEW") || null, sql: sqlSeen, bytes: r.ctx.bytes, ms: ms, sizes: sim.sizes };
}

// the stored rows as PREPARE's SQL returns them (JSON_OBJECT text: ids CAST as text, decimals JSON numbers, dates DATE_FORMAT)
const jrow = (o) => ({ j: JSON.stringify(o) });
const keyOf = (org, iaId) => "IA:" + org + ":" + iaId + ":0123456789abcdef:1";
// the request SUBMIT wrote (section 3), over the given stored rows
function requestFor(hdr, lines, extra) {
  const h = parseBig(hdr[0].j);
  const ls = lines.map((l) => parseBig(l.j));
  return Object.assign({ v: 1, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Edit", iaId: h.id, iaNo: h.stock_movement_no, issuedNo: "",
    lineFingerprint: FP.iaLineFingerprint(lines, hdr), organizationId: h.organization_id, plantId: h.issuing_operation_faci, lineCount: ls.length, pickCount: C.iaPickCount(ls),
    nonStockLines: 0, movementCount: C.iaPickCount(ls) + 1, uid: "1123598821738675201", source: "FORM", nonce: "sub00001", parts: {} }, extra || {});
}
// the fixture's stored rows locked by the test job (Processing, ia_v2_job_id = JOB) + its request
function goldenSpec(fx, mutateItems) {
  const h = parseBig(fx.db.hdr[0].j);
  h.item_assembly_status = "Processing";
  h.ia_v2_job_id = JOB;
  const hdr = [jrow(h)];
  const items = mutateItems ? fx.db.items.map((r) => jrow(mutateItems(parseBig(r.j)))) : fx.db.items;
  const request = requestFor(hdr, fx.db.lines, { pageStatus: fx.parent.pageStatus === "Add" ? "Add" : "Edit" });
  return { tenant: fx.tenant, org: h.organization_id, iaId: fx.ia_id, key: keyOf(h.organization_id, fx.ia_id), request: request, hdr: hdr, lines: fx.db.lines,
    items: items, bins: fx.db.bins };
}

// the classic IA_SAVE v11 (base/) run on a form record with stubbed children: its SUBTRACT / ADD params are the oracle
function runClassic(form, opts) {
  const o = opts || {};
  const db = new RecDB(o.tenant || "000000");
  const items = o.items;
  const stored = o.stored;
  const sim = new Sim({
    dir: path.join(IAV2, "base"), db: db,
    mocks: { sql: {}, read: {
      search_items: () => ({ total: items.length, count: items.length, data: items }),
      get_persisted_ia: () => ({ count: 1, data: Object.assign({}, stored, { item_assembly_status: "Draft" }) }),
      get_ia: () => ({ count: 1, data: stored }),
      search_movements: () => ({ total: 0, count: 0, data: o.outMovements || [] }),
    } },
    answers: { CHECK_REQUIRED_FIELD: { data: { status: "Passed", message: "" } }, GLOBAL_INVENTORY_VALIDATION: { code: "200" },
      GENERATE_BATCH: { batch_number: o.batchNumber || "" }, SUBTRACT_INVENTORY: { code: "200" }, ADD_INVENTORY: { code: "200" }, HANDLING_UNIT: { code: "200" } },
  });
  const r = sim.run("IA_SAVE.v11", { allData: form, saveAs: "Completed", pageStatus: o.pageStatus || "Edit" });
  const pick = (name) => sim.calls.filter((c) => c.name === name).map((c) => {
    const p = Object.assign({}, c.params);
    delete p.itemData;
    return p;
  });
  return { returned: r.returned, subtracts: pick("SUBTRACT_INVENTORY"), adds: pick("ADD_INVENTORY"), calls: sim.calls, out: r.ctx.out, db: db };
}

let fails = 0;
let passes = 0;
const show = (v) => JSON.stringify(v === undefined ? "<undefined>" : v);
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++;
  else {
    fails++;
    console.log("FAIL " + label + "\n     got  " + show(got).slice(0, 1200) + "\n     want " + show(want).slice(0, 1200));
  }
  return ok;
}
function truthy(label, cond, extra) {
  if (cond) passes++;
  else {
    fails++;
    console.log("FAIL " + label + (extra === undefined ? "" : "  " + show(extra).slice(0, 1200)));
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

module.exports = { IAV2, OUT, C, FP, parseBig, PROD_FIXTURES, hasFixture, fixture, built, nodeById, codeOf, Sim, RecDB, planOk, runPrepare, jrow, keyOf, requestFor, goldenSpec, runClassic, JOB,
  DB_NOW, eq, truthy, section, note, done };
