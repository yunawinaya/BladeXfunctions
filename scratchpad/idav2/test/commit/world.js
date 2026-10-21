// The in-memory world the BUILT IDA_V2_COMMIT runs against on lib/sim/engine.js: gd_async_job / gd_publish_step / sm_item_disassembly (+
// lines) / batch / batch_number_config / item, and INVENTORY_BULK_APPLY played by the deployed planner (base v10's planBulk) on
// item_balance / batch balance / FIFO / WA rows. Platform model: the unique Job Step index (tenant, job_id, step_name) refuses a second
// row of a name even when the first is soft-deleted; Batch numbers compare as utf8mb4_general_ci (case-insensitive, trailing spaces
// ignored); a run stops at the first failed node; a crash injected right after the k-th write (insert, update, engine APPLY) kills it.
const assert = require("assert");
const path = require("path");
const { Engine } = require(path.join(__dirname, "../../lib/sim/engine.js"));
const X = require("./fixture.js");
const { JOB, IDAID, ORG, KEY } = X;

const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const parse = (t) => Date.parse(String(t).replace(" ", "T") + "Z");
const J = (o) => JSON.stringify(o);
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const copy = (o) => JSON.parse(J(o));
const TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW"];
const ci = (t) => String(t === undefined || t === null ? "" : t).toLowerCase().replace(/ +$/, "");
// exact decimal sum (SQL SUM over DECIMAL(65,8))
const decSum = (vals) => {
  let t = 0n;
  for (const v of vals) {
    const x = Number(v || 0).toFixed(8);
    t += BigInt(x.replace(".", "").replace(/^(-?)0+(?=\d)/, "$1"));
  }
  const neg = t < 0n;
  const a = (neg ? -t : t).toString().padStart(9, "0");
  return (neg ? "-" : "") + a.slice(0, -8) + "." + a.slice(-8);
};
const unhex = (h) => Buffer.from(h, "hex").toString("utf8");

function world(c, opts) {
  const o = opts || {};
  const w = { c, now: Date.UTC(2026, 9, 21, 2, 0, 0), seq: 2113000000000000000n, steps: [], writes: [], crashAfter: o.crashAfter || 0, crashed: null, failedRuns: [], violations: [],
    engine: { faults: {}, calls: [], applied: {} }, itemDates: {}, idaWrites: [], batchDeletes: [], lineWrites: [], cfgWrites: [], sizes: [], runs: 0, precision: o.precision === undefined ? null : o.precision };
  w.id = () => (w.seq += 1n).toString();
  const req = Object.assign({}, c.request, o.request || {});
  w.job = { id: JOB, organization_id: ORG, command: "COMPLETE_IDA", job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready to commit", attempt_count: 0, next_attempt_at: null,
    lease_owner: "WRK|worker", lease_expires_at: fmt(w.now + 600000), row_version: 4, error_code: null, error_message: null, error_details: null, finished_at: null, idempotency_key: KEY,
    correlation_id: "IDA|" + IDAID, request_payload: J(req), prepared_payload: J(o.manifest || c.manifest), is_deleted: 0, line_count: c.lines.length + c.picks.length };
  w.steps.push({ id: "2112000000000000500", job_id: "IDC|" + IDAID, step_name: "LOCK|1", step_status: "LOCK", result_ref: KEY, is_deleted: 0, finished_at: null });
  for (const r of o.partStepRows || c.partStepRows) w.steps.push(Object.assign({ id: w.id(), is_deleted: 0, finished_at: null }, r));
  w.ida = Object.assign({ is_deleted: 0 }, copy(c.header));
  w.lines = c.lines.map((l) => Object.assign({ is_deleted: 0, sm_item_disassembly_id: IDAID }, copy(l)));
  w.items = copy(c.items);
  w.bal = copy(c.balances);
  w.bbal = [];
  w.fifo = copy(c.layers);
  w.wa = copy(c.waRows);
  w.mv = [];
  w.batches = copy(o.batches || []);
  w.bnc = [X.bnc(o.running)];
  for (const [k, list] of Object.entries(o.faults || {})) w.engine.faults[k] = list.slice();
  return w;
}

const wrote = (w, what) => {
  w.writes.push(what);
  if (w.crashAfter && w.writes.length === w.crashAfter) {
    w.crashed = what;
    throw new Error("crash right after write " + w.crashAfter + " (" + what + ")");
  }
};
const liveBatches = (w, mat) => w.batches.filter((b) => !b.is_deleted && (!mat || b.material_id === mat));
const batchJ = (b) => ({ j: J({ id: b.id, batch_number: b.batch_number, material_id: b.material_id, plant_id: b.plant_id, organization_id: b.organization_id, transaction_no: b.transaction_no }) });
const latestLock = (w) => w.steps.filter((r) => !r.is_deleted && r.job_id === "IDC|" + IDAID && r.step_name.indexOf("LOCK|") === 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
const opRows = (w, op) => w.steps.filter((r) => !r.is_deleted && r.job_id === op);
const summaryOf = (plan) => {
  const u = plan.updates || {};
  const c = plan.creates || {};
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  return { movements: n(plan.movements), skipped: (plan.results || []).filter((r) => r.code === "401").length, item_balance: n(u.item_balance) + n(c.item_balance),
    item_batch_balance: n(u.item_batch_balance) + n(c.item_batch_balance), fifo: n(u.fifo) + n(c.fifo), wa: n(u.wa) + n(c.wa) };
};
const headerJ = (w) => ({ j: J(Object.assign({}, w.ida, { is_deleted: undefined })) });
const linesJ = (w) => w.lines.filter((l) => !l.is_deleted).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((l) => ({ j: J(Object.assign({}, l, { is_deleted: undefined, sm_item_disassembly_id: undefined })) }));
const ownerRow = (w) => {
  const lk = latestLock(w);
  const live = !w.ida.is_deleted;
  return [{ db_now: fmt(w.now), ida_id: live ? IDAID : null, item_disassembly_status: live ? w.ida.item_disassembly_status : null, ida_v2_job_id: live ? w.ida.ida_v2_job_id : null,
    stock_movement_no: live ? w.ida.stock_movement_no : null, lock_ref: lk ? lk.result_ref : null, lock_step: lk ? lk.step_name : null }];
};
const holders = (w, text) => {
  const m = text.match(/JSON_TABLE\('(\[[^']*\])', '\$\[\*\]'/);
  assert.ok(m, "BATCH_HOLDERS text " + text.slice(0, 300));
  assert.ok(/b\.organization_id = '1123598813738675201'/.test(text), "BATCH_HOLDERS: the organization");
  const nums = JSON.parse(m[1]).map((h) => ci(unhex(h)));
  return w.batches.filter((b) => !b.is_deleted && b.organization_id === ORG && nums.indexOf(ci(b.batch_number)) >= 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map(batchJ);
};
const ours = (w, text) => {
  assert.ok(new RegExp("b\\.id > " + JOB).test(text) && /h\.id = 2112073133161844738/.test(text), "BATCH_OURS text " + text.slice(0, 300));
  return w.batches.filter((b) => !b.is_deleted && b.organization_id === ORG && BigInt(b.id) > BigInt(JOB) && b.transaction_no === w.ida.stock_movement_no)
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map(batchJ);
};
const intentRows = (w) => w.steps.filter((r) => !r.is_deleted && r.job_id === JOB && r.step_name.indexOf("D1|I|") === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1))
  .map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
const opState = (w, text, side) => {
  const m = text.match(/p\.job_id = 'IDC\|([0-9]+)\|([IR])'/);
  assert.ok(m && m[1] === JOB && m[2] === side, "OP_STATE text (" + side + ")");
  const rows = opRows(w, "IDC|" + JOB + "|" + side);
  const done = rows.filter((r) => r.step_name === "IBA|DONE").slice(-1)[0];
  return [{ intents: rows.filter((r) => r.step_name.indexOf("IBA|I|") === 0).length, review: rows.filter((r) => r.step_name === "IBA|REVIEW").length,
    done_summary: done ? J(JSON.parse(done.result_ref).summary) : null }];
};

function sqlMocks(w) {
  return new Proxy({}, {
    get: (_, id) => (text) => {
      const j = w.job;
      const name = String(id).replace(/^sql_node_DC/, "");
      w.sqlTexts = (w.sqlTexts || 0) + text.length;
      if (name === "job") {
        const q = JSON.parse(j.request_payload);
        return [Object.assign({}, j, { db_now: fmt(w.now), lease_until: fmt(w.now + 600000), lease_live: j.lease_expires_at && parse(j.lease_expires_at) > w.now ? 1 : 0,
          due: !j.next_attempt_at || parse(j.next_attempt_at) <= w.now ? 1 : 0, prev_status: q.prevStatus === undefined ? null : q.prevStatus, req_action: q.action })];
      }
      if (name === "steps") return w.steps.filter((r) => !r.is_deleted && r.job_id === JOB && /^D[0-9]_/.test(r.step_name)).map((r) => ({ step_name: r.step_name, step_status: r.step_status,
        result_ref: r.result_ref, finished_at: r.finished_at }));
      if (name === "intent" || name === "d1intentB" || /oint$/.test(name)) {
        assert.ok(/LIKE 'D1\|I\|%'/.test(text), "intent SQL");
        return intentRows(w);
      }
      if (name === "payload") return [{ prepared_payload: j.prepared_payload }];
      if (name === "own") return [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }];
      if (name === "ida") {
        assert.ok(/g\.is_deleted = 0/.test(text) && /SUBSTRING\(j\.correlation_id, 5\)/.test(text), "the entry's ownership read");
        if (!/^IDA\|[0-9]+$/.test(j.correlation_id) || w.ida.is_deleted) return [];
        const lk = latestLock(w);
        return [{ ida_id: IDAID, item_disassembly_status: w.ida.item_disassembly_status, ida_v2_job_id: w.ida.ida_v2_job_id, stock_movement_no: w.ida.stock_movement_no, lock_ref: lk ? lk.result_ref : null }];
      }
      const part = text.match(/LIKE CONCAT\('([^']*)',\s*'([A-Z_]+)\|%'\)/);
      if (part) {
        assert.strictEqual(part[1], "P|" + X.NONCE + "|", "part prefix");
        w.partReads = (w.partReads || []).concat([name + ":" + part[2]]);
        return w.steps.filter((r) => !r.is_deleted && r.job_id === JOB && r.step_name.indexOf(part[1] + part[2] + "|") === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1))
          .map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
      }
      if (name === "d0hdr") {
        assert.ok(text.indexOf("h.id = " + IDAID) >= 0, "FP_HEADER of another IDA");
        return w.ida.is_deleted ? [] : [headerJ(w)];
      }
      if (name === "d0lines") {
        assert.ok(text.indexOf("l.sm_item_disassembly_id = " + IDAID) >= 0, "FP_LINES of another IDA");
        return linesJ(w);
      }
      if (name === "d1bnc" || name === "d1bncB") {
        assert.ok(/FROM batch_number_config c/.test(text) && /c\.organization_id = '1123598813738675201'/.test(text), "BNC text");
        return w.bnc.filter((r) => !r.is_deleted).map((r) => ({ j: J(r) }));
      }
      if (name === "d1hold" || name === "d1holdB") return holders(w, text);
      if (/oours$/.test(name) || name === "d3ours") return ours(w, text);
      if (name === "op1" || name === "d2ops") return opState(w, text, "I");
      if (name === "op2" || name === "d3ops") return opState(w, text, "R");
      if (name === "d3out") {
        assert.ok(text.indexOf("m.id > " + JOB) >= 0 && text.indexOf("LIKE 'IDC|" + JOB + "|I|%'") >= 0 && text.indexOf("h.id = " + IDAID) >= 0 && /m\.organization_id = '1123598813738675201'/.test(text),
          "OUT_TOTALS text");
        const rows = w.mv.filter((m) => !m.is_deleted && BigInt(m.id) > BigInt(JOB) && m.movement === "OUT" && m.transaction_type === "IDA" && m.trx_no === w.ida.stock_movement_no
          && m.organization_id === ORG && String(m.operation_effect_key).indexOf("IDC|" + JOB + "|I|") === 0);
        return [{ n: rows.length, total: decSum(rows.map((m) => m.total_price)) }];
      }
      if (name === "d4own" || name === "d4back") {
        assert.ok(text.indexOf("h.id = " + IDAID) >= 0 && text.indexOf("'IDC|" + IDAID + "'") >= 0, "OWNER text");
        return ownerRow(w);
      }
      if (name === "d4lines" || name === "d4linesB") {
        assert.ok(text.indexOf("l.sm_item_disassembly_id = " + IDAID) >= 0, "LINES_BATCH text");
        return w.lines.filter((l) => !l.is_deleted).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((l) => ({ j: J({ id: l.id, batch_number: l.batch_number }) }));
      }
      throw new Error("no SQL mock for " + id);
    },
  });
}

function dbOf(w) {
  return {
    tenantId: "000000",
    insert(table, rows) {
      if (table === "GD Publish Step") {
        for (const r of rows) if (w.steps.some((x) => x.job_id === r.job_id && x.step_name === r.step_name)) throw new Error("Duplicate entry '" + r.job_id + "-" + r.step_name + "' for key 'Job Step'");
        for (const r of rows) w.steps.push(Object.assign({ id: w.id(), is_deleted: 0 }, r));
        wrote(w, "step " + rows.map((r) => r.step_name).join(","));
        return rows;
      }
      if (table === "Batch") {
        // a hook may drop the insert (rows that never read back) or add a concurrent writer's row (D1 rows 9 / 10)
        if (w.batchInsertHook && w.batchInsertHook(w, rows) === false) {
          wrote(w, "batch insert x" + rows.length + " (lost)");
          return rows;
        }
        for (const r of rows) {
          assert.deepStrictEqual(Object.keys(r).sort(), X.BATCH_COLS.slice().sort(), "the Batch insert carries add_node_F9KqZLfd's 11 columns");
          assert.ok(typeof r.initial_quantity === "string" && /^[0-9]+\.[0-9]{8}$/.test(r.initial_quantity), "initial_quantity as a fixed-scale string");
          assert.ok(rows.length <= 250, "a Batch insert of at most 250 rows");
          w.batches.push(Object.assign({ id: w.id(), is_deleted: 0, ours: true }, r));
        }
        wrote(w, "batch insert x" + rows.length);
        return rows;
      }
      throw new Error("unexpected insert into " + table);
    },
    update(table, rows) {
      for (const r0 of rows) {
        const r = Object.assign({}, r0);
        const id = String(r.__id);
        delete r.__id;
        if (table === "GD Async Job") {
          assert.strictEqual(id, JOB);
          Object.assign(w.job, r, { id: JOB });
        } else if (table === "Item Disassembly") {
          assert.strictEqual(id, IDAID, "IDA update of another id");
          const keys = Object.keys(r).sort().join(",");
          assert.ok(keys === "id,item_disassembly_status" || keys === "id,item_disassembly_status,posted_status", "an IDA write is { id, item_disassembly_status (, posted_status) }: " + keys);
          if (w.ida.is_deleted) w.violations.push("wrote the soft-deleted IDA: " + J(r));
          if (r.item_disassembly_status === "Draft" && w.mv.length) w.violations.push("unlocked to Draft after stock moved");
          for (const k of Object.keys(r)) if (k !== "id") w.ida[k] = r[k];
          w.idaWrites.push(r.item_disassembly_status);
        } else if (table === "Batch") {
          assert.deepStrictEqual(Object.keys(r).sort(), ["id", "is_deleted"]);
          const b = w.batches.find((x) => x.id === id);
          if (!b) throw new Error("Batch update of unknown id " + id);
          if (!(b.transaction_no === w.ida.stock_movement_no && BigInt(b.id) > BigInt(JOB) && b.ours)) w.violations.push("soft-deleted a Batch row that is not this job's: " + id);
          b.is_deleted = r.is_deleted;
          w.batchDeletes.push(id);
        } else if (table === "Item") {
          assert.deepStrictEqual(Object.keys(r).sort(), ["id", "last_transaction_date"]);
          w.itemDates[id] = r.last_transaction_date;
        } else if (table === "Batch Number Configuration") {
          assert.deepStrictEqual(Object.keys(r).sort(), ["id", "last_reset_date", "running_number"]);
          const b = w.bnc.find((x) => x.id === id);
          if (!b) throw new Error("config update of unknown id " + id);
          if (Number(r.running_number) < Number(b.running_number)) w.violations.push("a running number went back: " + b.running_number + " -> " + r.running_number);
          Object.assign(b, { running_number: r.running_number, last_reset_date: r.last_reset_date });
          w.cfgWrites.push(J(r));
        } else if (table === "Stock movement(Item Disassembly)") {
          assert.deepStrictEqual(Object.keys(r).sort(), ["batch_number", "id"]);
          const l = w.lines.find((x) => x.id === id && !x.is_deleted);
          if (!l) throw new Error("line update of unknown id " + id);
          l.batch_number = r.batch_number;
          w.lineWrites.push(id);
        } else throw new Error("unexpected update of " + table);
      }
      if (rows.length > 250) w.violations.push("an update of " + rows.length + " rows (> 250) on " + table);
      wrote(w, "update " + table + " x" + rows.length);
      return rows.length;
    },
  };
}

// INVENTORY_BULK_APPLY on the world: the deployed planner over the rows, REPLAYED for a DONE key, 500 for a key under review; faults per
// "<operation_key>|<mode>" queue: 409 | 400 | 500 | null | 400env | applied-none
function engineCall(w, params) {
  const op = s(params.operation_key);
  const mode = s(params.mode).toUpperCase();
  const movements = copy(typeof params.movements === "string" ? JSON.parse(params.movements) : params.movements || []);
  w.engine.calls.push({ op: op, mode: mode, text: J(params.movements), org: s(params.organization_id), keys: Object.keys(params).sort().join(",") });
  const q = w.engine.faults[op + "|" + mode] || [];
  const fault = q.length ? q.shift() : "ok";
  if (fault === "409") return { code: "409", result_code: "LOCK_BUSY", message: "COST|" + movements[0].material_id + "|" + X.PLANT + " is held by GDC|2112000000000000777" };
  if (fault === "400") return { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement " + movements[0].movement_key + ")" };
  if (fault === "500") {
    w.steps.push({ id: w.id(), job_id: op, step_name: "IBA|REVIEW", step_status: "REVIEW", result_ref: "", is_deleted: 0 });
    return { code: "500", result_code: "REQUIRES_REVIEW", message: "read-back differs" };
  }
  if (fault === "null") return null;
  // a 200 whose per-movement results carry a code the engine never sends for a skip (proves D3's refusal branch); nothing applied
  if (fault === "r400") {
    const p0 = X.planBulk({ operationKey: op, items: w.items, itemBalances: copy(w.bal), batchBalances: copy(w.bbal), fifoLayers: copy(w.fifo), waRows: copy(w.wa), movements: copy(movements),
      nowText: fmt(w.now), precision: w.precision });
    return { code: "200", result_code: "OK", message: "Applied", results: (p0.results || []).map((r, i) => (i === 1 ? Object.assign({}, r, { code: "400", message: "refused" }) : r)), summary: {} };
  }
  if (fault === "400env") return { code: 400, success: false, data: null, msg: "An error occurred: Duplicate entry '000000-" + ORG + "-COST|1|2' for key 'Lock Key'" };
  if (!/^[A-Za-z0-9|:._-]{1,32}$/.test(op) || !movements.length || movements.length > 5000 || s(params.organization_id) !== ORG) return { code: "400", result_code: "REQUEST_INVALID", message: "bad request" };
  const plan = () => X.planBulk({ operationKey: op, items: w.items, itemBalances: w.bal, batchBalances: w.bbal, fifoLayers: w.fifo, waRows: w.wa, movements: movements, nowText: fmt(w.now),
    precision: w.precision });
  if (mode === "PLAN") {
    const p = plan();
    if (!p.ok) return { code: "400", result_code: p.failure.code, message: p.failure.message + " (movement " + p.failure.movement_key + ")", results: p.results };
    return { code: "200", result_code: "OK", message: "Planned " + p.results.length + " movements", results: p.results, summary: summaryOf(p) };
  }
  const doneRow = opRows(w, op).find((r) => r.step_name === "IBA|DONE");
  if (doneRow) {
    const st = JSON.parse(doneRow.result_ref);
    return { code: "200", result_code: "REPLAYED", message: "Already applied", results: st.results, summary: st.summary };
  }
  if (opRows(w, op).some((r) => r.step_name === "IBA|REVIEW")) return { code: "500", result_code: "REQUIRES_REVIEW", message: "under review" };
  const p = plan();
  if (!p.ok) return { code: "400", result_code: p.failure.code, message: p.failure.message + " (movement " + p.failure.movement_key + ")", results: p.results };
  // a batch_id the engine is sent must be a live Batch row of the item (the engine never writes Batch rows)
  for (const m of movements) {
    if (m.direction === "ADD" && m.batch_id) {
      const b = w.batches.find((x) => x.id === s(m.batch_id));
      if (!b || b.is_deleted || b.material_id !== s(m.material_id)) w.violations.push("op 2 received " + m.movement_key + " on batch " + m.batch_id + " that is not a live Batch row of " + m.material_id);
    }
  }
  // the writes (intent, rows, DONE) as one: the engine's own resume is the engine owners' (tested there)
  const ids = {};
  const realId = (x) => (String(x).indexOf("new:") === 0 ? ids[x] || (ids[x] = w.id()) : x);
  const tables = { item_balance: w.bal, item_batch_balance: w.bbal, fifo: w.fifo, wa: w.wa };
  for (const t of Object.keys(tables)) {
    for (const u of (p.updates || {})[t] || []) Object.assign(tables[t].find((r) => s(r.id) === s(u.id)), u.after);
    for (const c of (p.creates || {})[t] || []) tables[t].push(Object.assign({}, c, { id: realId(c.id), batch_id: c.batch_id ? realId(c.batch_id) : c.batch_id }));
  }
  for (const m of p.movements) w.mv.push(Object.assign({ is_deleted: 0 }, m, { id: w.id(), batch_number_id: m.batch_number_id ? realId(m.batch_number_id) : null }));
  const sum = summaryOf(p);
  w.steps.push({ id: w.id(), job_id: op, step_name: "IBA|I|001", step_status: "INTENT", result_ref: "{}", is_deleted: 0 });
  w.steps.push({ id: w.id(), job_id: op, step_name: "IBA|DONE", step_status: "DONE", result_ref: J({ results: p.results, summary: sum }), is_deleted: 0 });
  w.engine.applied[op] = (w.engine.applied[op] || 0) + 1;
  const ans = { code: "200", result_code: "OK", message: "Applied " + sum.movements + " movements", results: p.results, summary: sum };
  wrote(w, "engine APPLY " + op);
  return fault === "applied-none" ? null : ans;
}

// the interpreter counts node OUTPUTS; a second, conservative measure adds every code node's injected script and every sql node's
// injected text (the platform's nodes_data records them)
class MeasuredEngine extends Engine {
  node(n, ctx) {
    if (ctx.name === "IDA_V2_COMMIT") this.lastNode = n.id;
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
    if (r && r.ctx && name === "IDA_V2_COMMIT") this.inBytes = r.ctx.inBytes || 0;
    return r;
  }
}

let runNo = 0;
function runCommit(w) {
  const e = new MeasuredEngine({ dir: X.OUT, db: dbOf(w), mocks: { sql: sqlMocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 40;
  const run0 = e.run.bind(e);
  e.run = (name, params) => {
    if (name === "IDA_V2_COMMIT") return run0(name, params);
    if (name === "INVENTORY_BULK_APPLY") return { returned: engineCall(w, params), ctx: {} };
    throw new Error("unexpected call " + name);
  };
  let out = null;
  let err = null;
  w.runs++;
  try {
    out = e.run("IDA_V2_COMMIT", { job_id: JOB }).returned;
  } catch (x) {
    err = x.message;
    w.failedRuns.push({ current_node_id: e.lastNode, error_msg: err });
  }
  w.sizes.push({ out: e.sizes["IDA_V2_COMMIT"] || 0, in: e.inBytes || 0 });
  return { out, err };
}

// the worker between COMMIT runs: SPLIT / PARK / a due job -> again at once; a backoff / wait is waited out; a dead run's lease expires and
// the worker's claim counts it (attempt + 1, row_version + 1; a READY_TO_COMMIT job gets a new WRK lease)
function drive(w, max) {
  const runs = [];
  for (let i = 0; i < (max || 80); i++) {
    const r = runCommit(w);
    runs.push(r);
    if (TERMINAL.indexOf(w.job.job_status) >= 0 && !r.err) break;
    if (r.err) {
      w.crashAfter = 0;
      w.now = Math.max(w.now + 11 * 60000, w.job.lease_expires_at ? parse(w.job.lease_expires_at) + 1000 : 0);
      if (TERMINAL.indexOf(w.job.job_status) >= 0) break;
      assert.ok(w.job.attempt_count < 3, "a crash test would exhaust the worker's retries");
      w.job.attempt_count += 1;
      w.job.row_version += 1;
      if (w.job.job_status === "READY_TO_COMMIT") Object.assign(w.job, { lease_owner: "WRK|resume" + i, lease_expires_at: fmt(w.now + 600000) });
    } else if (w.job.next_attempt_at && parse(w.job.next_attempt_at) > w.now) w.now = parse(w.job.next_attempt_at) + 1000;
    else w.now += 1000;
  }
  return runs;
}

const stepNames = (w) => w.steps.filter((r) => r.job_id === JOB && /^D[0-9]/.test(r.step_name)).map((r) => r.step_name + ":" + r.step_status).sort();
const opCalls = (w, side, mode) => w.engine.calls.filter((c) => c.op === "IDC|" + JOB + "|" + side && c.mode === (mode || "APPLY"));

module.exports = { assert, X, J, s, fmt, parse, copy, decSum, ci, TERMINAL, world, runCommit, drive, liveBatches, stepNames, opCalls, engineCall, latestLock,
  __internals: (w) => ({ sql: sqlMocks(w), db: dbOf(w) }) };
