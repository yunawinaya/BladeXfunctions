// commit_sim.js <payload.json> <creads.json> <tenant>: the built GD_COMPLETE_COMMIT on the interpreter against in-memory
// tables seeded from a PREPARE payload (test/plan_live.js) and live dev reads (test/commit_reads.py). Nothing touches a
// database. Scenarios: phase A, phase B, a crash inside the C3H item writes + resume, a conflict, a short handling unit.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [payloadFile, readsFile, tenant] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
const RD = JSON.parse(fs.readFileSync(readsFile, "utf8"));
const m = P.manifest;
const J = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (x) => (x[0] === '"' ? x : '"' + x + '"')));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function world() {
  const w = { now: Date.UTC(2026, 9, 14, 9, 0, 0), seq: 5000000000000000000n, steps: [], res: {}, creates: [], hu: {}, items: {}, sol: {}, soh: {}, gdh: null, gdl: {}, calls: [], crash: null };
  w.id = () => (w.seq += 1n).toString();
  w.job = { id: m.job_id, organization_id: m.organization_id, command: "COMPLETE_GD", job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "", attempt_count: 0,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: 3, error_code: null, error_message: null, error_details: null, idempotency_key: "GDC|" + m.gd_id + "|1",
    correlation_id: "GD|" + m.gd_id, prepared_payload: JSON.stringify(m), is_deleted: 0 };
  for (const r of P.rows) w.steps.push(Object.assign({ is_deleted: 0 }, r));
  w.lockRef = w.job.idempotency_key;
  for (const r of RD.c3rows.filter((x) => x.k === "U")) { const o = J(r.j); w.res[o.id] = o; }
  for (const r of RD.c3hhus) { const o = J(r.j); w.hu[o.id] = o; }
  for (const r of RD.c3hitems) { const o = J(r.j); w.items[o.id] = o; }
  for (const r of RD.c4lines) { const o = J(r.j); w.sol[o.id] = o; }
  for (const r of RD.c4hdrs) { const o = J(r.j); w.soh[o.id] = o; }
  for (const r of RD.c5raw) { const o = J(r.j); if (r.k === "H") w.gdh = Object.assign(o, { gd_status: "Processing" }); else w.gdl[o.id] = o; }
  return w;
}

const idsIn = (text) => {
  const out = [];
  for (const mm of text.matchAll(/JSON_TABLE\('(\[[^']*\])'/g)) out.push(JSON.parse(mm[1]).map(String));
  return out;
};
function mocks(w) {
  const stepRows = (pfx) => w.steps.filter((r) => !r.is_deleted && r.step_name.indexOf(pfx) === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
  const huRows = (ids) => ids.filter((i) => w.hu[i]).map((i) => ({ j: JSON.stringify(w.hu[i]) }));
  const itemRows = (ids) => Object.values(w.items).filter((r) => ids.indexOf(String(r.handling_unit_id)) >= 0 && String(r.is_deleted) === "0").sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((r) => ({ j: JSON.stringify(r) }));
  const resRows = (text) => {
    const [ids] = idsIn(text);
    const out = ids.filter((i) => w.res[i]).map((i) => ({ k: "U", j: JSON.stringify(w.res[i]) }));
    if (/job_line_key LIKE/.test(text)) for (const c of w.creates) out.push({ k: "C", j: JSON.stringify({ id: c.id, job_line_key: c.job_line_key }) });
    return out;
  };
  const sql = new Proxy({}, {
    get: (_, id) => (text) => {
      const j = w.job;
      if (id === "sql_node_CCjob") return [Object.assign({}, j, { db_now: fmt(w.now), lease_until: fmt(w.now + 600000),
        lease_live: j.lease_expires_at && Date.parse(j.lease_expires_at.replace(" ", "T") + "Z") > w.now ? 1 : 0,
        due: !j.next_attempt_at || Date.parse(j.next_attempt_at.replace(" ", "T") + "Z") <= w.now ? 1 : 0 })];
      if (id === "sql_node_CCsteps") return w.steps.filter((r) => !r.is_deleted && /^C/.test(r.step_name)).map((r) => ({ step_name: r.step_name, step_status: r.step_status }));
      if (id === "sql_node_CCpayload") return [{ prepared_payload: j.prepared_payload }];
      if (id === "sql_node_CCgd") return [{ gd_status: w.gdh.gd_status, lock_ref: w.lockRef }];
      if (id === "sql_node_CCown") return [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }];
      if (id === "sql_node_CCc2ops") return [{ intents: String(w.engineIntents || 0) }];
      const part = text.match(/LIKE CONCAT\('([^']*)',\s*'([A-Z]+)\|%'\)/);
      if (part) return stepRows(part[1] + part[2] + "|");
      const intent = text.match(/step_name LIKE '([A-Z0-9]+\|I\|)%'/);
      if (intent) return stepRows(intent[1]);
      if (/^sql_node_CC(c0rows|c3rows|c3back)$/.test(id)) return resRows(text);
      if (/^sql_node_CC(c0hus|c3hhus|c3hhusB)$/.test(id)) return huRows(idsIn(text)[0]);
      if (/^sql_node_CC(c0huitems|c3hitems|c3hitemsB)$/.test(id)) return itemRows(idsIn(text)[0]);
      if (id === "sql_node_CCc3hprec") return RD.c3hprec;
      if (/^sql_node_CCc4lines/.test(id)) return Object.values(w.sol).map((o) => ({ j: JSON.stringify(o) }));
      if (/^sql_node_CCc4hdrs/.test(id)) return Object.values(w.soh).map((o) => ({ j: JSON.stringify(o) }));
      if (/^sql_node_CCc5(raw|back)$/.test(id)) return [{ k: "H", j: JSON.stringify(w.gdh) }].concat(Object.values(w.gdl).map((o) => ({ k: "L", j: JSON.stringify(o) })));
      throw new Error("no mock for " + id);
    },
  });
  return sql;
}
function dbOf(w) {
  const apply = (map, rows, label) => {
    for (const r0 of rows) {
      const id = String(r0.id || r0.__id);
      if (!map[id]) throw new Error(label + " update of unknown id " + id);
      const r = Object.assign({}, r0);
      delete r.__id;
      Object.assign(map[id], r);
    }
  };
  return {
    tenantId: tenant,
    insert(table, rows) {
      if (w.crash && w.crash.table === table && --w.crash.n === 0) throw new Error("crash in " + table);
      if (table === "GD Publish Step") {
        for (const r of rows) {
          if (w.steps.some((x) => !x.is_deleted && x.job_id === r.job_id && x.step_name === r.step_name)) throw new Error("Duplicate entry " + r.step_name);
          w.steps.push(Object.assign({ is_deleted: 0, id: w.id() }, r));
        }
        return rows;
      }
      if (table === "On Reserved Goods Delivery") return rows.map((r) => { const o = Object.assign({ id: w.id(), is_deleted: 0 }, r); w.creates.push(o); return o; });
      w.calls.push(["add", table, rows.length]);
      return rows;
    },
    update(table, rows) {
      if (w.crash && w.crash.table === table && --w.crash.n === 0) throw new Error("crash in " + table);
      if (table === "GD Async Job") for (const r of rows) Object.assign(w.job, r, { id: w.job.id });
      else if (table === "On Reserved Goods Delivery") apply(w.res, rows, table);
      else if (table === "Handling Unit") apply(w.hu, rows, table);
      else if (table === "Items(Handling Unit)") apply(w.items, rows, table);
      else if (table === "sales_order_axszx8cj_sub") apply(w.sol, rows, table);
      else if (table === "Sales Order") apply(w.soh, rows, table);
      else if (table === "goods_delivery_fwii8mvb_sub") apply(w.gdl, rows, table);
      else if (table === "Goods Delivery") for (const r of rows) Object.assign(w.gdh, r, { id: w.gdh.id });
      else w.calls.push(["update", table, rows.length]);
      return rows.length;
    },
  };
}
let runNo = 0;
function run(w, label) {
  const e = new Engine({ dir: R + "Goods Delivery/CompleteV2", db: dbOf(w), mocks: { sql: mocks(w), read: {} } });
  // every platform run has its own uuid (= its lease owner PUB|<nonce>)
  e.uuidN = ++runNo * 2 ** 48;
  const run0 = e.run.bind(e);
  e.run = (n, p) => {
    if (n === "GD_COMPLETE_COMMIT") return run0(n, p);
    w.calls.push(["call", n]);
    if (n === "INVENTORY_BULK_APPLY") {
      if (w.lockBusy && w.lockBusy-- > 0) return { returned: { code: "409", result_code: "LOCK_BUSY", message: "ITEM|1|2 (GRC|9)" }, ctx: {} };
      return { returned: { code: "200", result_code: "APPLIED", message: "ok" }, ctx: {} };
    }
    if (n === "GD_COMPLETION_SNAPSHOT") return { returned: { code: "200", message: "ok" }, ctx: {} };
    return { returned: { code: "200" }, ctx: {} };
  };
  let out, err = null;
  try {
    out = e.run("GD_COMPLETE_COMMIT", { job_id: m.job_id }).returned;
  } catch (x) {
    err = x.message;
  }
  const done = w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort();
  console.log(`${label}: ${err ? "CRASH " + err : JSON.stringify(out).slice(0, 260)}\n    job ${w.job.job_status} ${w.job.error_code || ""} lease ${w.job.lease_owner || "-"} | done ${done.join(",")}`);
  return { out, err };
}
const huSum = (w) => Object.values(w.hu).reduce((t, h) => t + Number(h.total_quantity), 0);
const intentOf = (w) => JSON.parse(w.steps.filter((r) => r.step_name.indexOf("C3H|I|") === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((r) => r.result_ref).join(""));
const expectFinal = (w, want) => {
  for (const h of want.hus) assert.strictEqual(Number(w.hu[h.id].total_quantity), h.after, "hu " + h.id);
  for (const r of want.items) assert.strictEqual(Number(w.items[r.id].quantity), r.after, "item " + r.id);
};
const toPhaseB = (w) => {
  w.now += 5000;
  w.job.next_attempt_at = null;
};

// 1. phase A then phase B, all clean
let w = world();
const before = huSum(w);
run(w, "A  clean phase A");
assert.deepStrictEqual(w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort(), ["C0_REVALIDATE", "C1_SNAPSHOT", "C2_INVENTORY"]);
assert.ok(/^SPLIT\|/.test(w.job.lease_owner));
toPhaseB(w);
run(w, "B  clean phase B");
assert.strictEqual(w.job.job_status, "COMPLETED");
const want = intentOf(w);
assert.ok(want.hus.length + want.items.length > 0);
expectFinal(w, want);
console.log(`    HU total ${before} -> ${huSum(w)}; intent ${want.hus.length} HU, ${want.items.length} item rows`);
run(w, "B' rerun of a COMPLETED job");
assert.strictEqual(w.job.job_status, "COMPLETED");

// 2. crash inside the C3H item writes (2nd slice when there is one), then the resume after the lease expires
w = world();
run(w, "A  phase A");
toPhaseB(w);
const slices = Math.ceil(want.items.length / 250);
w.crash = { table: "Items(Handling Unit)", n: Math.min(2, slices) };
const c = run(w, "B  crash in C3H item slice " + Math.min(2, slices));
assert.ok(c.err && /crash/.test(c.err));
assert.strictEqual(w.job.job_status, "COMMITTING_GD");
assert.ok(w.steps.some((r) => r.step_name.indexOf("C3H|I|") === 0), "intent recorded before the writes");
w.crash = null;
run(w, "B  resume while the crashed run's lease lives");
assert.ok(!w.steps.some((r) => r.step_name === "C3H_HU"));
w.now += 11 * 60000;
run(w, "B  resume after the lease expired");
assert.strictEqual(w.job.job_status, "COMPLETED");
expectFinal(w, want);
assert.strictEqual(w.steps.filter((r) => r.step_name.indexOf("C3H|I|") === 0).length, intentOf(w) && w.steps.filter((r) => r.step_name.indexOf("C3H|I|") === 0).length);

// 3. someone else moves an item row after the intent: review, nothing more written
w = world();
run(w, "A  phase A");
toPhaseB(w);
w.crash = { table: "Items(Handling Unit)", n: 1 };
run(w, "B  crash before the first C3H item write");
w.crash = null;
const victim = want.items[want.items.length - 1];
w.items[victim.id].quantity = Number(w.items[victim.id].quantity) - 0.5;
w.now += 11 * 60000;
run(w, "B  resume finds the row moved by someone else");
assert.strictEqual(w.job.job_status, "REQUIRES_REVIEW");
assert.ok(/C3H_HU/.test(w.job.error_message));

// 4. a handling unit short of the delivery before anything moves: FAILED, the GD back to Created
w = world();
const h0 = want.hus[0];
w.hu[h0.id].total_quantity = Number(h0.before) - Number(h0.before) / 2 - 0.001;
run(w, "A  short handling unit at C0");
assert.strictEqual(w.job.job_status, "FAILED");
assert.strictEqual(w.job.error_code, "GDC_HU_SHORT");
assert.strictEqual(w.gdh.gd_status, "Created");
assert.ok(!w.calls.some((x) => x[1] === "INVENTORY_BULK_APPLY"), "no inventory call");

// 5. another operation holds the stock locks for 3 tries, then lets go: the job waits and completes, no review
w = world();
w.lockBusy = 3;
for (let i = 0; i < 4; i++) { run(w, "A  lock busy, try " + (i + 1)); w.now += 6 * 60000; }
assert.strictEqual(w.job.job_status, "COMMITTING_GD");
assert.ok(/^SPLIT\|/.test(w.job.lease_owner));
toPhaseB(w);
run(w, "B  after the locks were freed");
assert.strictEqual(w.job.job_status, "COMPLETED");

// 6. the locks never come free and nothing of this operation was written: FAILED after 8 waits, the GD back to Created
w = world();
w.lockBusy = 99;
for (let i = 0; i < 9; i++) { run(w, "A  lock busy for good, try " + (i + 1)); w.now += 6 * 60000; }
assert.strictEqual(w.job.job_status, "FAILED");
assert.strictEqual(w.job.error_code, "GDC_INVENTORY_LOCK_BUSY");
assert.strictEqual(w.gdh.gd_status, "Created");
assert.ok(!w.steps.some((r) => r.step_name === "C2_INVENTORY" && r.step_status === "DONE"));

// 7. lock busy while the operation has intent rows (it may have written): the old retry, then review
w = world();
w.lockBusy = 99;
w.engineIntents = 3;
for (let i = 0; i < 4; i++) { run(w, "A  lock busy with intent rows, try " + (i + 1)); w.now += 6 * 60000; }
assert.strictEqual(w.job.job_status, "REQUIRES_REVIEW");
assert.strictEqual(w.gdh.gd_status, "Processing");
console.log("all scenarios passed");
