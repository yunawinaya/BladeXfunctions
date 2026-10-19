// node test/commit/commit_sim.js - the BUILT SA_V2_COMMIT on the interpreter (lib/sim/engine.js) against in-memory tables.
// Nothing touches a database. The platform model: an update writes every prop it lists (a whole stock_adjustment /
// table_stock_count keeps the rows sent with an id, inserts the rows without one, soft-deletes the rest; a key a row lacks is
// stored NULL), decimals are stored at the tenant's rule (SA unit_price 2 dp, SC quantities 3 dp), the unique Job Step index
// refuses a second step row, INVENTORY_BULK_APPLY replays an operation key it already applied.
// Scenarios: FORM COMPLETE (+ Stock Count parity), FORM DIRECT, REVIEW - clean; a crash right after EVERY write, then the
// resume; 409 x 8 then FAILED + unlock; 400 FAILED + mapped message + unlock; 500 review; unknown prevStatus; PARK above
// 1,000 entries; node data at 2,000 entries.
const assert = require("assert");
const path = require("path");
const { Engine } = require(path.join(__dirname, "../../lib/sim/engine.js"));
const X = require("./fixture.js");
const { F, JOB, SAID, SCID, ORG, KEY } = X;

const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const parse = (t) => Date.parse(String(t).replace(" ", "T") + "Z");
const J = (o) => JSON.stringify(o);
const r2 = (v) => (v === null || v === undefined || v === "" ? null : Number(Number(v).toFixed(2)));
const r3 = (v) => (v === null || v === undefined || v === "" ? null : Number(Number(v).toFixed(3)));
const TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW"];
let checks = 0;
const ok = (cond, what, extra) => { checks++; assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 600))); };

function world(c, opts) {
  const o = opts || {};
  const w = { c, now: Date.UTC(2026, 9, 16, 2, 0, 0), seq: 2113000000000000000n, steps: [], writes: [], crashAfter: o.crashAfter || 0, crashed: null, engine: { mode: o.engine || [], calls: 0, effects: 0, done: {} },
    reorder: [], items: {}, itemWrites: 0, saInserted: 0, scFullWrites: 0, sclWrites: 0, statusWrites: [], sizes: [], otherProcessing: o.otherProcessing || 0, failedRuns: [],
    saWriteFail: o.saWriteFail || null };
  w.id = () => (w.seq += 1n).toString();
  const req = Object.assign({}, c.request, o.request || {});
  w.job = { id: JOB, organization_id: ORG, command: "COMPLETE_SA", job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready to commit", attempt_count: 0, next_attempt_at: null,
    lease_owner: "WRK|worker", lease_expires_at: fmt(w.now + 600000), row_version: 4, error_code: null, error_message: null, error_details: null, finished_at: null, idempotency_key: KEY,
    correlation_id: "SA|" + SAID, request_payload: J(req), prepared_payload: J(c.manifest), is_deleted: 0, line_count: c.finalLines.length };
  w.steps.push({ id: w.id(), job_id: "SAC|" + SAID, step_name: "LOCK|1", step_status: "LOCK", result_ref: KEY, is_deleted: 0 });
  for (const r of c.partStepRows) w.steps.push(Object.assign({ id: w.id(), is_deleted: 0 }, r));
  w.sa = Object.assign({}, c.header);
  w.saLines = {};
  for (const l of c.storedLines) w.saLines[l.id] = Object.assign({ stock_adjustment_id: SAID, is_deleted: 0 }, l);
  w.sc = c.scHeader ? Object.assign({}, c.scHeader) : null;
  w.scLines = {};
  for (const l of c.scLines) w.scLines[l.id] = Object.assign({ stock_count_id: SCID, is_deleted: 0 }, l);
  return w;
}

const liveSaLines = (w) => Object.values(w.saLines).filter((l) => !l.is_deleted).sort((a, b) => Number(a.line_index) - Number(b.line_index) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
const liveScLines = (w) => Object.values(w.scLines).filter((l) => !l.is_deleted).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
const SA_HDR_JSON = ["id", "stock_adjustment_status", "adjustment_no"].concat(X.SA_HDR);

function sqlMocks(w) {
  const stepRows = (pfx) => w.steps.filter((r) => !r.is_deleted && r.job_id === JOB && r.step_name.indexOf(pfx) === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1))
    .map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
  return new Proxy({}, {
    get: (_, id) => (text) => {
      const j = w.job;
      const name = String(id).replace(/^sql_node_SAC/, "");
      if (name === "job") {
        const q = JSON.parse(j.request_payload);
        return [Object.assign({}, j, { db_now: fmt(w.now), lease_until: fmt(w.now + 600000), lease_live: j.lease_expires_at && parse(j.lease_expires_at) > w.now ? 1 : 0,
          due: !j.next_attempt_at || parse(j.next_attempt_at) <= w.now ? 1 : 0, prev_status: q.prevStatus === undefined ? null : q.prevStatus, req_action: q.action, req_source: q.source,
          req_edited: String(q.edited), req_sc_id: q.scId })];
      }
      if (name === "steps") return w.steps.filter((r) => !r.is_deleted && r.job_id === JOB && /^A[0-9]_/.test(r.step_name)).map((r) => ({ step_name: r.step_name, step_status: r.step_status }));
      if (name === "payload") return [{ prepared_payload: j.prepared_payload }];
      if (name === "sa") {
        if (!/^SA\|[0-9]+$/.test(j.correlation_id) || !w.sa || w.sa.is_deleted) return [];
        const lk = w.steps.filter((r) => !r.is_deleted && r.job_id === "SAC|" + SAID && r.step_name.indexOf("LOCK|") === 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
        return [{ sa_id: SAID, stock_adjustment_status: w.sa.stock_adjustment_status, sa_v2_job_id: w.sa.sa_v2_job_id, adjustment_no: w.sa.adjustment_no, lock_ref: lk ? lk.result_ref : null }];
      }
      if (name === "own") return [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }];
      const part = text.match(/LIKE CONCAT\('([^']*)',\s*'([A-Z]+)\|%'\)/);
      if (part) return stepRows(part[1] + part[2] + "|");
      if (name === "a2ops") return [{ intents: String(w.steps.filter((r) => r.job_id === "SAC|" + JOB && r.step_name.indexOf("IBA|I|") === 0).length) }];
      if (/^a[01]lines|^a1linesB$/.test(name)) {
        assert.ok(text.indexOf("stock_adjustment_id = " + SAID) >= 0, "SA lines SQL of another SA");
        return liveSaLines(w).map(X.fpRow);
      }
      if (/^(a1hdr|a1hdrB|a4now|a4back)$/.test(name)) {
        const h = {};
        for (const k of SA_HDR_JSON) h[k] = w.sa[k] === undefined ? null : w.sa[k];
        return [{ j: J(h) }];
      }
      if (/^(a0sc|a3rlines|a3rlinesB|a3plines|a3plinesB)$/.test(name)) return text.indexOf("stock_count_id = " + SCID) >= 0 ? liveScLines(w).map(X.scFpRow) : [];
      if (/^(a3rhdr|a3rhdrB|a3phdr|a3phdrB)$/.test(name)) {
        if (!w.sc || text.indexOf("c.id = " + SCID) < 0) return [];
        return [{ j: J({ id: SCID, stock_count_no: w.sc.stock_count_no, stock_count_status: w.sc.stock_count_status, review_status: w.sc.review_status, adjustment_status: w.sc.adjustment_status }) }];
      }
      if (name === "a0other") return [{ other: String(w.otherProcessing) }];
      if (name === "a1err") {
        assert.ok(/FROM su_code_workflow_inst i/.test(text) && /'update_node_SACa1full', 'update_node_SACa1lines'/.test(text) && text.indexOf('"job_id":"' + JOB + '"') >= 0, "the A1 error read");
        const f = w.failedRuns.filter((r) => /^update_node_SACa1(full|lines)$/.test(r.current_node_id)).slice(-1);
        return f.map((r) => ({ current_node_id: r.current_node_id, error_msg: r.error_msg }));
      }
      throw new Error("no SQL mock for " + id);
    },
  });
}

// a whole-subform write: rows with an id update that row (every listed column; a key the row lacks is stored NULL), rows
// without one are inserted, the live rows left out are soft-deleted
function subform(map, rows, cols, parentKey, parentId, store, newId, onInsert) {
  const keep = {};
  for (const r of rows) {
    const id = r.id !== undefined && r.id !== null && String(r.id) !== "" ? String(r.id) : null;
    if (id && !map[id]) throw new Error("subform update of unknown row " + id);
    const row = { id: id || newId(), [parentKey]: parentId, is_deleted: 0 };
    for (const k of cols) row[k] = store(k, r[k] === undefined ? null : r[k]);
    map[row.id] = row;
    keep[row.id] = true;
    if (!id) onInsert();
  }
  for (const l of Object.values(map)) if (!l.is_deleted && !keep[l.id]) l.is_deleted = 1;
}
const saStore = (k, v) => (k === "unit_price" ? r2(v) : k === "balance_index" && v !== null && typeof v === "object" ? J(v) : ["total_quantity", "line_index", "uom_id", "material_id"].indexOf(k) >= 0 && v !== null ? String(v) : v);
const SC_LINE_COLS = ["line_index", "line_status", "review_status", "is_counted", "count_qty", "adjusted_qty", "variance_qty", "material_id", "balance_index"];
const scStore = (k, v) => (["count_qty", "adjusted_qty", "variance_qty"].indexOf(k) >= 0 ? r3(v) : k === "is_counted" ? (v === true ? 1 : v === false ? 0 : v) : k === "line_index" && v !== null ? String(v) : v);

function dbOf(w) {
  const wrote = (what) => {
    w.writes.push(what);
    if (w.crashAfter && w.writes.length === w.crashAfter) {
      w.crashed = what;
      throw new Error("crash right after write " + w.crashAfter + " (" + what + ")");
    }
  };
  return {
    tenantId: "000000",
    insert(table, rows) {
      if (table !== "GD Publish Step") throw new Error("unexpected insert into " + table);
      for (const r of rows) {
        if (w.steps.some((x) => !x.is_deleted && x.job_id === r.job_id && x.step_name === r.step_name)) throw new Error("Duplicate entry '" + r.job_id + "-" + r.step_name + "' for key 'Job Step'");
      }
      for (const r of rows) w.steps.push(Object.assign({ id: w.id(), is_deleted: 0 }, r));
      wrote("step " + rows.map((r) => r.step_name).join(","));
      return rows;
    },
    update(table, rows) {
      for (const r0 of rows) {
        const r = Object.assign({}, r0);
        const id = String(r.__id);
        delete r.__id;
        if (table === "GD Async Job") {
          assert.strictEqual(id, JOB);
          Object.assign(w.job, r, { id: JOB });
        } else if (table === "Stock Adjustment") {
          assert.strictEqual(id, SAID, "SA update of another id");
          if ("stock_adjustment" in r && w.saWriteFail) {
            const f = w.saWriteFail;
            if (f.mode === "silent") continue;
            if (f.mode === "throw-partial") {
              // the platform updates the rows it keeps, then throws on the legacy row it must remove (memory: sub_tenant_id cascade)
              for (const row of r.stock_adjustment || []) if (row.id && w.saLines[row.id]) for (const k of X.SA_LINE_COLS) w.saLines[row.id][k] = saStore(k, row[k] === undefined ? null : row[k]);
            }
            throw new Error(f.msg);
          }
          for (const k of Object.keys(r)) if (k !== "id" && k !== "stock_adjustment") w.sa[k] = r[k] === undefined ? null : r[k];
          if ("stock_adjustment_status" in r) w.statusWrites.push(r.stock_adjustment_status);
          if ("stock_adjustment" in r) subform(w.saLines, r.stock_adjustment || [], X.SA_LINE_COLS, "stock_adjustment_id", SAID, saStore, w.id, () => w.saInserted++);
        } else if (table === "Stock Count") {
          assert.strictEqual(id, SCID, "SC update of another id");
          for (const k of Object.keys(r)) if (k !== "id" && k !== "table_stock_count") w.sc[k] = r[k] === undefined ? null : r[k];
          if ("table_stock_count" in r) {
            w.scFullWrites++;
            subform(w.scLines, r.table_stock_count || [], SC_LINE_COLS, "stock_count_id", SCID, scStore, w.id, () => { throw new Error("a Stock Count line was inserted"); });
          }
        } else if (table === "Adjustment Details(Stock Count)") {
          if (!w.scLines[id]) throw new Error("SC line update of unknown id " + id);
          w.scLines[id].line_status = r.line_status;
          w.sclWrites++;
        } else if (table === "Item") {
          w.items[id] = r.last_transaction_date;
        } else throw new Error("unexpected update of " + table);
      }
      if (table === "Item") w.itemWrites++;
      wrote("update " + table + " x" + rows.length);
      return rows.length;
    },
  };
}

let runNo = 0;
function callee(w, name, params) {
  if (name === "INVENTORY_BULK_APPLY") {
    w.engine.calls++;
    const mode = w.engine.mode.length ? w.engine.mode.shift() : "ok";
    let ans;
    if (mode === "none-always") ans = null;
    else if (mode === "409") ans = { code: "409", result_code: "LOCK_BUSY", message: "ITEM|" + X.ORG + "|x held by GDC|9" };
    else if (mode === "400") ans = { code: "400", result_code: "INSUFFICIENT_QTY", message: "Insufficient quantity (movement M3)" };
    else if (mode === "500") ans = { code: "500", result_code: "ERROR", message: "boom" };
    else if (mode === "400env") ans = { code: 400, success: false, data: null, msg: "An error occurred: Duplicate entry '000000-" + X.ORG + "-COST|1|2' for key 'Lock Key'" };
    else if (mode === "none") ans = {};
    else if (mode === "null") ans = null;
    else if (w.engine.done[params.operation_key]) ans = { code: "200", result_code: "REPLAYED", message: "replayed" };
    else if (mode === "applied-none") {
      w.engine.effects += params.movements.length;
      w.engine.done[params.operation_key] = true;
      w.steps.push({ id: w.id(), job_id: params.operation_key, step_name: "IBA|I|001", step_status: "INTENT", result_ref: "{}", is_deleted: 0 });
      w.steps.push({ id: w.id(), job_id: params.operation_key, step_name: "IBA|DONE", step_status: "DONE", result_ref: "{}", is_deleted: 0 });
      ans = null;
    } else {
      assert.strictEqual(params.mode, "APPLY");
      assert.strictEqual(params.operation_key, "SAC|" + JOB);
      w.engine.effects += params.movements.length;
      w.engine.done[params.operation_key] = true;
      w.steps.push({ id: w.id(), job_id: params.operation_key, step_name: "IBA|I|001", step_status: "INTENT", result_ref: "{}", is_deleted: 0 });
      w.steps.push({ id: w.id(), job_id: params.operation_key, step_name: "IBA|DONE", step_status: "DONE", result_ref: "{}", is_deleted: 0 });
      ans = { code: "200", result_code: "APPLIED", message: params.movements.length + " movements" };
    }
    dbOf(w); // (no write of ours)
    w.writes.push("call INVENTORY_BULK_APPLY " + ((ans && ans.code) || "-"));
    if (w.crashAfter && w.writes.length === w.crashAfter) { w.crashed = "engine"; throw new Error("crash right after the engine call"); }
    return { returned: ans, ctx: {} }; // ans null = the parent's node data is null
  }
  if (name === "REORDER_SET_REDIS") {
    assert.strictEqual(params.document_type, "SA_COMPLETED");
    assert.strictEqual(params.organization_id, ORG);
    w.reorder.push(params.latest_data.length);
    w.writes.push("call REORDER_SET_REDIS");
    if (w.crashAfter && w.writes.length === w.crashAfter) { w.crashed = "reorder"; throw new Error("crash right after the reorder call"); }
    return { returned: {}, ctx: {} };
  }
  throw new Error("unexpected call " + name);
}

// the interpreter counts node OUTPUTS (the measure the GD / LOT V2 budgets used); the platform's nodes_data records code /
// search / get / sql / return nodes with their inputs too (never update / add nodes: memory project_db_trace_debugging), so a
// second, conservative measure adds every code node's injected script and every sql node's injected text, at every depth
class MeasuredEngine extends Engine {
  node(n, ctx) {
    if (ctx.name === "SA_V2_COMMIT") this.lastNode = n.id;
    const d = n.data || {};
    try {
      if (n.type === "code-node") ctx.inBytes = (ctx.inBytes || 0) + this.injectJs(d.script.code, ctx).length;
      else if (n.type === "sql-node") ctx.inBytes = (ctx.inBytes || 0) + this.injectRaw(d.script.code, ctx).length;
    } catch (e) {
      /* a reference not resolvable yet: the node itself reports it */
    }
    return super.node(n, ctx);
  }
  run(name, params) {
    const r = super.run(name, params);
    if (r && r.ctx && name === "SA_V2_COMMIT") this.inBytes = r.ctx.inBytes || 0;
    return r;
  }
}

function runCommit(w) {
  const e = new MeasuredEngine({ dir: X.OUT, db: dbOf(w), mocks: { sql: sqlMocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 40; // every run its own uuid = its own lease owner PUB|<nonce>
  const run0 = e.run.bind(e);
  e.run = (name, params) => (name === "SA_V2_COMMIT" ? run0(name, params) : callee(w, name, params));
  let out = null, err = null;
  try {
    out = e.run("SA_V2_COMMIT", { job_id: JOB }).returned;
  } catch (x) {
    err = x.message;
    w.failedRuns.push({ current_node_id: e.lastNode, error_msg: err }); // su_code_workflow_inst: status Fail, the dying node, its error
  }
  w.sizes.push(e.sizes["SA_V2_COMMIT"] || 0);
  w.inSizes = (w.inSizes || []).concat([e.inBytes || 0]);
  return { out, err };
}

// the worker's role between runs: a crashed run's lease expires (11 min), a backoff is waited out, SPLIT / PARK go on at once
function drive(w, max) {
  const runs = [];
  for (let i = 0; i < (max || 40); i++) {
    const r = runCommit(w);
    runs.push(r);
    if (TERMINAL.indexOf(w.job.job_status) >= 0 && !r.err) break;
    if (r.err) {
      w.crashAfter = 0;
      w.now += 11 * 60000;
    } else if (w.job.next_attempt_at && parse(w.job.next_attempt_at) > w.now) w.now = parse(w.job.next_attempt_at) + 1000;
    else w.now += 1000;
    if (TERMINAL.indexOf(w.job.job_status) >= 0) break;
  }
  return runs;
}

const done = (w) => w.steps.filter((r) => r.job_id === JOB && /^A[0-9]_/.test(r.step_name)).map((r) => r.step_name).sort();
const finalState = (w) => ({
  job: w.job.job_status, progress: w.job.progress_percent, lease: w.job.lease_owner, sa: w.sa.stock_adjustment_status,
  saHdr: X.SA_HDR.map((k) => (w.sa[k] === undefined ? null : w.sa[k])),
  saLines: F.saLineFpCanonRows(liveSaLines(w)), saLineCount: liveSaLines(w).length,
  sc: w.sc ? [w.sc.stock_count_status, w.sc.review_status, w.sc.adjustment_status] : null,
  scLines: liveScLines(w).map((l) => [l.id, l.line_status, l.count_qty]),
  items: Object.keys(w.items).sort(), effects: w.engine.effects, steps: done(w),
});

function expectCompleted(w, c, label) {
  ok(w.job.job_status === "COMPLETED" && w.job.progress_percent === 100 && w.job.lease_owner === null && w.job.finished_at, label + ": job COMPLETED 100, lease released", w.job);
  ok(w.sa.stock_adjustment_status === "Completed", label + ": SA Completed", w.sa.stock_adjustment_status);
  ok(w.engine.effects === c.movements.length, label + ": the stock moved exactly once (" + c.movements.length + " movements)", w.engine);
  ok(J(F.saLineFpCanonRows(liveSaLines(w)).map((r) => r.slice(0, 4).concat([r[5]]))) === J(F.saLineFpCanonRows(c.finalLines).map((r) => r.slice(0, 4).concat([r[5]]))), label + ": the SA lines are the plan's");
  ok(liveSaLines(w).every((l) => l.unit_price === r2(c.finalLines.find((x) => x.line_index === l.line_index).unit_price)), label + ": unit_price stored at the tenant rule");
  ok(Object.keys(w.items).sort().join() === c.items.map((i) => i.id).sort().join() && Object.values(w.items).every((d) => d === "2026-10-16T03:12:44.120Z"), label + ": Item dates = PREPARE's");
  const want = ["A0_REVALIDATE", "A2_INVENTORY", "A4_FINISH", "A4_REORDER"].concat(c.kind !== "DIRECT" ? ["A1_SA_LINES", "A1_TRY"] : [], c.manifest.parts.SC ? ["A3_STOCK_COUNT"] : []).sort();
  ok(J(done(w)) === J(want), label + ": step rows " + want.join(","), done(w));
  if (c.kind === "COMPLETE") {
    ok(J(X.SA_HDR.map((k) => w.sa[k])) === J(X.SA_HDR.map((k) => c.docHeader[k])) && w.sa.adjustment_no === c.header.adjustment_no, label + ": the DOC header props written, the number untouched");
    const approved = c.scLines.filter((l) => l.line_status === "Approved").length;
    ok(liveScLines(w).every((l) => l.line_status !== "Approved") && w.sclWrites === approved, label + ": PARITY every Approved SC line Adjusted, once (" + approved + ")", w.sclWrites);
    const all = liveScLines(w).every((l) => l.line_status === "Adjusted");
    ok(w.sc.adjustment_status === (all ? "Fully Adjusted" : "Partially Adjusted"), label + ": PARITY adjustment_status recomputed", w.sc.adjustment_status);
  }
  if (c.kind === "REVIEW") {
    ok(w.saInserted === c.finalLines.length && liveSaLines(w).length === c.finalLines.length, label + ": the review's lines inserted exactly once (" + c.finalLines.length + ")", w.saInserted);
    ok(w.scFullWrites === 1 && w.sc.stock_count_status === c.scPart.stock_count_status && w.sc.adjustment_status === c.scPart.adjustment_status, label + ": the SC part written once", w.scFullWrites);
    ok(liveScLines(w).every((l, i) => l.line_status === c.scAfterLines.find((x) => x.id === l.id).line_status) && liveScLines(w)[0].count_qty === 9.877, label + ": SC lines at the part's values (3 dp stored)");
  }
}

// ------------------------------------------------------------------ 1. clean runs
const clean = {};
for (const kind of ["COMPLETE", "DIRECT", "REVIEW"]) {
  const c = X.makeCase(kind);
  const w = world(c);
  const a = runCommit(w);
  ok(!a.err && a.out.path === "SPLIT" && w.job.job_status === "COMMITTING_SA" && /^SPLIT\|/.test(w.job.lease_owner) && w.job.progress_percent === 80 && w.job.attempt_count === 0, kind + ": phase A ends SPLIT", a);
  ok(w.sa.stock_adjustment_status === "Processing" && w.engine.effects === c.movements.length && w.reorder.length === 0, kind + ": after phase A the stock moved, the SA still Processing");
  const b = runCommit(w);
  ok(!b.err && b.out.path === "DONE" && b.out.job_status === "COMPLETED", kind + ": phase B -> DONE", b);
  expectCompleted(w, c, kind + " clean");
  ok(w.reorder.length === 1 && w.reorder[0] === c.finalLines.length, kind + ": REORDER_SET_REDIS once with the SA lines", w.reorder);
  ok(J(w.statusWrites) === J(["Completed"]), kind + ": the status written once (Completed)", w.statusWrites);
  const again = runCommit(w);
  ok(!again.err && again.out.path === "NO_WRITE" && w.job.job_status === "COMPLETED" && w.reorder.length === 1, kind + ": a re-run of a COMPLETED job writes nothing", again.out);
  clean[kind] = { state: finalState(w), writes: w.writes.slice(), sizes: w.sizes.slice() };
  console.log(`ok   ${kind} clean: ${w.writes.length} writes (${w.writes.join(" | ").slice(0, 200)}...)`);
}

// ------------------------------------------------------------------ 2. a crash right after every write, then the resume
for (const kind of ["COMPLETE", "REVIEW", "DIRECT"]) {
  const total = clean[kind].writes.length;
  let atMostOnce = 0;
  let itemRewrites = 0;
  let tryPoints = 0;
  for (let k = 1; k <= total; k++) {
    const c = X.makeCase(kind);
    const w = world(c, { crashAfter: k });
    const runs = drive(w);
    const what = w.crashed;
    ok(runs.filter((r) => r.err).length === 1 && /crash right after/.test(runs.find((r) => r.err).err), kind + " crash@" + k + ": one run died right after write " + k, runs);
    if (/A1_TRY/.test(String(what))) {
      // died between the A1_TRY marker and the write: the resume finds the marker with the lines at before -> a clean failure
      const back = kind === "REVIEW" ? "Cancelled" : "Draft";
      ok(w.job.job_status === "FAILED" && w.job.error_code === "SA_LINES_WRITE_FAILED" && w.sa.stock_adjustment_status === back && w.engine.calls === 0 && w.reorder.length === 0
        && J(F.saLineFpCanonRows(liveSaLines(w))) === J(F.saLineFpCanonRows(c.storedLines)), kind + " crash@" + k + " (A1_TRY): FAILED + " + back + ", nothing written or moved", w.job);
      tryPoints++;
      continue;
    }
    ok(w.job.job_status === "COMPLETED", kind + " crash@" + k + " (" + what + "): resumed to COMPLETED", { job: w.job, runs: runs.map((r) => r.err || r.out.path) });
    expectCompleted(w, c, kind + " crash@" + k);
    const st = finalState(w);
    const want = clean[kind].state;
    for (const key of ["sa", "saHdr", "saLines", "saLineCount", "sc", "scLines", "items", "effects", "steps"]) ok(J(st[key]) === J(want[key]), kind + " crash@" + k + ": " + key + " = the clean run's", { got: st[key], want: want[key] });
    ok(J(w.statusWrites) === J(["Completed"]), kind + " crash@" + k + ": Completed written once", w.statusWrites);
    const idless = c.parts.SALINES ? c.parts.SALINES.stock_adjustment.filter((l) => !l.id).length : 0;
    ok(w.saInserted === idless, kind + " crash@" + k + ": the id-less SALINES rows inserted once (" + idless + ")", w.saInserted);
    itemRewrites += w.itemWrites > 1 ? 1 : 0;
    if (/A4_REORDER/.test(String(what))) {
      // the marker is written BEFORE the call: a run dying between the two never repeats it (at most once, as gdc C6 / gde E7)
      ok(w.reorder.length === 0, kind + " crash@" + k + ": died between the marker and the call -> REORDER skipped (at most once)", w.reorder);
      atMostOnce++;
    } else ok(w.reorder.length === 1, kind + " crash@" + k + " (" + what + "): REORDER_SET_REDIS exactly once", w.reorder);
  }
  ok(atMostOnce === 1, kind + ": exactly one crash point (marker -> call) skips the reorder");
  ok(tryPoints === (kind === "DIRECT" ? 0 : 1), kind + ": one crash point between A1_TRY and the write (a clean failure)", tryPoints);
  console.log(`ok   ${kind}: a crash after each of the ${total} writes, then the resume -> the clean run's final state, the stock moved once, REORDER once (0 only when the run died between its marker and the call)${tryPoints ? "; between A1_TRY and the write -> FAILED + unlock, nothing moved" : ""}; Item dates re-written (same value) at ${itemRewrites} crash point(s)`);
}

// ------------------------------------------------------------------ 3. 409: lock waits, then FAILED + unlock
for (const kind of ["COMPLETE", "REVIEW"]) {
  const c = X.makeCase(kind);
  const w = world(c, { engine: Array(20).fill("409") });
  const waits = [];
  for (let i = 0; i < 12 && TERMINAL.indexOf(w.job.job_status) < 0; i++) {
    const before = w.now;
    runCommit(w);
    if (w.job.error_code === "SA_LOCK_WAIT") {
      waits.push(Math.round((parse(w.job.next_attempt_at) - before) / 1000));
      w.now = parse(w.job.next_attempt_at) + 1000;
    }
  }
  const back = kind === "REVIEW" ? "Cancelled" : "Draft";
  ok(J(waits) === J([15, 30, 60, 120, 240, 300, 300, 300]), kind + ": 8 lock waits 15 s x 2^n capped at 300 s", waits);
  ok(w.job.job_status === "FAILED" && w.job.error_code === "SA_INVENTORY_LOCK_BUSY" && w.engine.calls === 9 && w.engine.effects === 0, kind + ": the 9th 409 -> FAILED SA_INVENTORY_LOCK_BUSY", w.job);
  ok(w.sa.stock_adjustment_status === back && w.reorder.length === 0, kind + ": unlocked back to " + back, w.sa.stock_adjustment_status);
  if (kind === "REVIEW") ok(liveSaLines(w).length === c.finalLines.length && w.scFullWrites === 0, "REVIEW: the Cancelled SA keeps its lines (ruling B4); the Stock Count untouched");
  if (kind === "COMPLETE") ok(w.sclWrites === 0 && w.sc.adjustment_status === null, "COMPLETE: the Stock Count untouched");
  console.log(`ok   ${kind}: 409 x 8 (waits ${waits.join("/")} s) -> FAILED + ${back}`);
}

// ------------------------------------------------------------------ 3b. the platform's 400 envelope without a result_code (a COST key's first seed race)
{
  const c = X.makeCase("COMPLETE");
  const w = world(c, { engine: ["400env"] });
  const first = runCommit(w);
  ok(!first.err && w.job.job_status === "COMMITTING_SA" && w.job.error_code === "SA_LOCK_WAIT" && w.job.attempt_count === 1 && /Duplicate entry/.test(w.job.error_message)
    && w.sa.stock_adjustment_status === "Processing", "400 envelope once -> a lock wait (15 s), the platform msg kept", w.job);
  drive(w);
  ok(w.job.job_status === "COMPLETED" && w.engine.calls === 2 && w.engine.effects === c.movements.length && w.reorder.length === 1, "... then 200 -> DONE -> COMPLETED, the stock moved once", { job: w.job, engine: w.engine });
  const w2 = world(X.makeCase("COMPLETE"), { engine: Array(9).fill("400env") });
  drive(w2);
  ok(w2.job.job_status === "FAILED" && w2.job.error_code === "SA_INVENTORY_LOCK_BUSY" && w2.engine.calls === 9 && w2.engine.effects === 0 && w2.sa.stock_adjustment_status === "Draft"
    && /Duplicate entry/.test(JSON.parse(w2.job.error_details).why), "400 envelope x 9 -> FAILED SA_INVENTORY_LOCK_BUSY + Draft, the platform msg in the details", w2.job);
  console.log("ok   400 envelope without result_code: once -> wait then DONE; x 9 -> FAILED SA_INVENTORY_LOCK_BUSY + Draft");
}

// ------------------------------------------------------------------ 4. 400 -> FAILED + mapped message + unlock
{
  const c = X.makeCase("COMPLETE");
  const w = world(c, { engine: ["400"] });
  runCommit(w);
  const l = c.labels.M3;
  ok(w.job.job_status === "FAILED" && w.job.error_code === "SA_INVENTORY_INSUFFICIENT_QTY" && w.job.error_message === "Insufficient quantity - line " + l.line_index + " (" + l.item_code + "), bin " + l.bin + " (Unrestricted)",
    "400 -> FAILED with the LABELS-mapped message", w.job);
  ok(w.sa.stock_adjustment_status === "Draft" && w.engine.effects === 0 && w.job.lease_owner === null, "400 -> back to Draft, nothing moved, lease released");
  console.log("ok   400 -> FAILED '" + w.job.error_message + "' + Draft");
}

// ------------------------------------------------------------------ 4b. no answer at all (a child's failure leaves the parent's node data null)
{
  let c = X.makeCase("COMPLETE");
  let w = world(c, { engine: ["null"] });
  runCommit(w);
  ok(w.job.error_code === "SA_LOCK_WAIT" && w.job.attempt_count === 1 && w.engine.effects === 0, "no answer, 0 intents -> a lock wait", w.job);
  drive(w);
  ok(w.job.job_status === "COMPLETED" && w.engine.calls === 2 && w.engine.effects === c.movements.length, "... then 200 -> DONE -> COMPLETED", { job: w.job, engine: w.engine });
  c = X.makeCase("REVIEW");
  w = world(c, { engine: ["applied-none"] });
  runCommit(w);
  ok(w.job.error_code === "SA_STEP_RETRY" && w.job.job_status === "COMMITTING_SA" && w.engine.effects === c.movements.length, "applied but no answer (intents > 0) -> retry, not review", w.job);
  drive(w);
  ok(w.job.job_status === "COMPLETED" && w.engine.calls === 2 && w.engine.effects === c.movements.length && w.reorder.length === 1, "... the next APPLY replays (REPLAYED 200) -> COMPLETED, moved once", w.engine);
  w = world(X.makeCase("COMPLETE"), { engine: Array(9).fill("null") });
  drive(w);
  ok(w.job.job_status === "FAILED" && w.job.error_code === "SA_INVENTORY_LOCK_BUSY" && w.engine.calls === 9 && w.sa.stock_adjustment_status === "Draft", "persistent no answer, 0 intents -> 8 waits, FAILED + Draft", w.job);
  w = world(X.makeCase("REVIEW"), { engine: ["applied-none"].concat(Array(5).fill("none-always")) });
  drive(w);
  ok(w.job.job_status === "REQUIRES_REVIEW" && w.job.error_code === "SA_RECONCILIATION_MISMATCH" && w.engine.calls === 4 && w.sa.stock_adjustment_status === "Processing",
    "persistent no answer with intents -> 3 retries, then REQUIRES_REVIEW, no unlock", { job: w.job, calls: w.engine.calls });
  console.log("ok   no answer: 0 intents -> wait -> 200 DONE; intents -> retry -> REPLAYED DONE; persistent -> FAILED + Draft (0 intents) / REQUIRES_REVIEW after 3 retries (intents)");
}

// ------------------------------------------------------------------ 5. 500 -> REQUIRES_REVIEW at once, no unlock
for (const mode of ["500"]) {
  const c = X.makeCase("REVIEW");
  const w = world(c, { engine: [mode] });
  runCommit(w);
  ok(w.job.job_status === "REQUIRES_REVIEW" && w.job.error_code === "SA_RECONCILIATION_MISMATCH" && w.sa.stock_adjustment_status === "Processing", mode + " -> REQUIRES_REVIEW, the SA stays Processing", w.job);
  const again = runCommit(w);
  ok(again.out && again.out.path === "NO_WRITE" && w.engine.calls === 1, mode + ": a REQUIRES_REVIEW job is not run again", again.out);
  console.log("ok   engine " + mode + " -> REQUIRES_REVIEW, no unlock");
}

// ------------------------------------------------------------------ 6. prevStatus unknown -> REQUIRES_REVIEW, no unlock
{
  const c = X.makeCase("COMPLETE");
  const w = world(c, { engine: ["400"], request: { prevStatus: "In Progress" } });
  runCommit(w);
  ok(w.job.job_status === "REQUIRES_REVIEW" && w.job.error_code === "SA_PREV_STATUS_UNKNOWN" && w.sa.stock_adjustment_status === "Processing", "unknown prevStatus + 400 -> REQUIRES_REVIEW, no unlock", w.job);
  const w2 = world(X.makeCase("COMPLETE"), { request: { prevStatus: null } });
  w2.job.prepared_payload = "{broken";
  runCommit(w2);
  ok(w2.job.job_status === "REQUIRES_REVIEW" && w2.job.error_code === "SA_PREV_STATUS_UNKNOWN" && w2.sa.stock_adjustment_status === "Processing", "no prevStatus + bad manifest -> REQUIRES_REVIEW, no unlock (no default)", w2.job);
  console.log("ok   prevStatus unknown / missing -> REQUIRES_REVIEW SA_PREV_STATUS_UNKNOWN, no unlock");
}

// ------------------------------------------------------------------ 7. A0 failures before anything moved
{
  const c = X.makeCase("COMPLETE");
  const w = world(c);
  const first = Object.values(w.saLines)[0];
  first.total_quantity = "999";
  runCommit(w);
  ok(w.job.job_status === "FAILED" && w.job.error_code === "SA_LINES_CHANGED" && w.sa.stock_adjustment_status === "Draft" && w.engine.calls === 0, "A0: lines changed -> FAILED + Draft, no engine call", w.job);
  const r = X.makeCase("REVIEW");
  const w2 = world(r, { otherProcessing: 1 });
  runCommit(w2);
  ok(w2.job.job_status === "FAILED" && w2.job.error_code === "SA_SC_CHANGED" && w2.sa.stock_adjustment_status === "Cancelled" && liveSaLines(w2).length === 0, "A0 REVIEW: a twin Processing SA -> FAILED + Cancelled, no line written", w2.job);
  const w3 = world(X.makeCase("REVIEW"));
  Object.values(w3.scLines)[0].line_status = "Recount";
  runCommit(w3);
  ok(w3.job.job_status === "FAILED" && w3.job.error_code === "SA_SC_CHANGED", "A0 REVIEW: the Stock Count changed -> FAILED", w3.job);
  console.log("ok   A0: SA_LINES_CHANGED / SA_SC_CHANGED -> FAILED + unlock before any write");
}

// ------------------------------------------------------------------ 7b. A1 write failures (controller ruling)
{
  const CASCADE = "级联源数据缺少子租户字段：表[stock_adjustment_1dknywqh_sub]字段[sub_tenant_id]";
  for (const kind of ["COMPLETE", "REVIEW"]) {
    const c = X.makeCase(kind);
    const back = kind === "REVIEW" ? "Cancelled" : "Draft";
    const w = world(c, { saWriteFail: { mode: "throw", msg: CASCADE } });
    const runs = drive(w);
    ok(runs[0].err === CASCADE && w.failedRuns[0].current_node_id === (kind === "REVIEW" ? "update_node_SACa1lines" : "update_node_SACa1full"), kind + ": the A1 write throws (the run dies in it)", w.failedRuns);
    ok(w.job.job_status === "FAILED" && w.job.error_code === "SA_LINES_WRITE_FAILED" && w.job.error_message === "The Stock Adjustment's lines could not be saved: nothing was moved. The platform answered: " + CASCADE
      && w.sa.stock_adjustment_status === back && w.engine.calls === 0 && w.reorder.length === 0, kind + ": the resume -> FAILED + " + back + " with the platform's error, nothing moved", w.job);
    ok(J(F.saLineFpCanonRows(liveSaLines(w))) === J(F.saLineFpCanonRows(c.storedLines)) && w.steps.some((r) => r.step_name === "A1_TRY" && r.step_status === "TRY"), kind + ": lines untouched, A1_TRY recorded");
    console.log(`ok   ${kind}: A1 write throws ("${CASCADE.slice(0, 20)}...") -> resume -> FAILED SA_LINES_WRITE_FAILED + ${back}, the platform's error in the message`);
  }
  const c = X.makeCase("COMPLETE");
  const w = world(c, { saWriteFail: { mode: "throw-partial", msg: CASCADE } });
  drive(w);
  ok(w.job.job_status === "REQUIRES_REVIEW" && w.job.error_code === "SA_RECONCILIATION_MISMATCH" && w.sa.stock_adjustment_status === "Processing" && w.engine.calls === 0,
    "COMPLETE: the write updated the kept rows, then threw -> partial: REQUIRES_REVIEW, no unlock", w.job);
  console.log("ok   COMPLETE: a write that landed half, then threw -> REQUIRES_REVIEW, the SA stays Processing");
  const w2 = world(X.makeCase("COMPLETE"), { saWriteFail: { mode: "silent" } });
  const r2 = runCommit(w2);
  ok(!r2.err && w2.job.job_status === "FAILED" && w2.job.error_code === "SA_LINES_WRITE_FAILED" && w2.sa.stock_adjustment_status === "Draft" && w2.engine.calls === 0,
    "COMPLETE: the write stored nothing (read back unchanged) -> FAILED + Draft in the same run", w2.job);
  console.log("ok   COMPLETE: a write read back unchanged -> FAILED SA_LINES_WRITE_FAILED + Draft in the same run");
}

// ------------------------------------------------------------------ 8. PARK above 1,000 entries
{
  const c = X.makeCase("DIRECT", { lines: 520, perLine: 2 });
  ok(c.movements.length > 1000, "PARK case has " + c.movements.length + " entries");
  const w = world(c);
  const a = runCommit(w);
  ok(a.out.path === "PARK" && w.job.job_status === "COMMITTING_SA" && w.job.lease_owner === null && w.job.lease_expires_at === null && w.job.next_attempt_at === fmt(w.now)
    && w.job.progress_percent === 80 && w.job.attempt_count === 0, "> 1,000 entries -> PARK (no lease, due now, progress 80, attempts 0)", w.job);
  w.now += 5000;
  const b = runCommit(w);
  ok(b.out.path === "DONE" && w.job.job_status === "COMPLETED", "the next tick finishes phase B", b.out);
  console.log("ok   PARK at " + c.movements.length + " entries, phase B on the next call");
}

// ------------------------------------------------------------------ 9. node data at 2,000 entries (interpreter: the JSON of every node output)
{
  const rows = [];
  for (const [kind, o] of [["COMPLETE", { lines: 1000, perLine: 2, scLines: 2000 }], ["REVIEW", { lines: 40, perLine: 50, scLines: 2000 }]]) {
    const c = X.makeCase(kind, o);
    const w = world(c);
    runCommit(w);
    runCommit(w);
    ok(w.job.job_status === "COMPLETED", kind + " 2k: COMPLETED", w.job);
    const mb = w.sizes.map((b) => (b / 1048576).toFixed(1));
    const all = w.sizes.map((b, i) => ((b + w.inSizes[i]) / 1048576).toFixed(1));
    ok(w.sizes[0] <= 20 * 1048576 && w.sizes[1] <= 20 * 1048576, kind + " 2k: COMMIT A " + mb[0] + " MB, B " + mb[1] + " MB of node outputs (<= 20 MB each)", mb);
    ok(w.sizes[0] + w.inSizes[0] <= 25 * 1048576 && w.sizes[1] + w.inSizes[1] <= 25 * 1048576, kind + " 2k: with the recorded inputs A " + all[0] + " MB, B " + all[1] + " MB (well under the ~60 MB chain limit)", all);
    rows.push(kind + " " + c.movements.length + " entries / " + c.finalLines.length + " lines / " + c.scLines.length + " SC lines: A " + mb[0] + " MB outputs, " + all[0] + " MB with inputs; B " + mb[1] + " / " + all[1] + " MB");
  }
  console.log("ok   node data (sum of node outputs): " + rows.join("; "));
}

console.log(checks + " checks passed");
