// commit_sim.js <plan.json> <reads.json> <tenant>: the built GD_REVERT_COMMIT on the interpreter against in-memory tables seeded from a
// PREPARE plan (test/plan_live.js --out) and the same reads (test/run_reads.py). Nothing touches a database.
// Scenarios: phase A + phase B clean; a re-run of the COMPLETED job; a reservation changed before anything moved (FAILED, GD back
// to Completed); invoiced meanwhile (FAILED); another delivery of the same SO line written after PREPARE (R3 recomputes on it);
// a crash in R3's header write + resume (no double subtraction); a crash in R2's write + resume; a GD line moved by someone else
// after the stock went back (review, GD stays Processing); nothing to move (one run, no engine call).
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../../gdc/pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [planFile, readsFile, tenant] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(planFile, "utf8"));
const RD = JSON.parse(fs.readFileSync(readsFile, "utf8")).reads;
const m = P.manifest;
const J = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (x) => (x[0] === '"' ? x : '"' + x + '"')));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const partOf = (rows, name) => JSON.parse(rows.filter((r) => r.step_name.split("|")[2] === name).sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((r) => r.result_ref).join(""));
const PARTS = { RES: partOf(P.result.partRows, "RES"), SO: partOf(P.result.partRows, "SO"), GD: partOf(P.result.partRows, "GD") };

function world(manifest) {
  const mm = manifest || m;
  const w = { now: Date.UTC(2026, 9, 21, 9, 0, 0), seq: 5000000000000000000n, steps: [], res: {}, sol: {}, soh: {}, gdh: null, gdl: {}, snap: {}, calls: [], crash: null, si: "" };
  w.id = () => (w.seq += 1n).toString();
  w.job = { id: mm.job_id, organization_id: mm.organization_id, command: "REVERT_GD", job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "", attempt_count: 0,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: 3, error_code: null, error_message: null, error_details: null, idempotency_key: "GDC|" + mm.gd_id + "|1",
    correlation_id: "GD|" + mm.gd_id, prepared_payload: JSON.stringify(mm), is_deleted: 0 };
  for (const r of P.result.partRows) w.steps.push(Object.assign({ is_deleted: 0 }, r));
  w.lockRef = w.job.idempotency_key;
  for (const r of RD.resv.concat(RD.pend)) { const o = J(r.j); w.res[o.id] = Object.assign({ is_deleted: 0 }, o); }
  for (const r of RD.sol) { const o = J(r.j); w.sol[o.id] = o; }
  for (const r of RD.soh) { const o = J(r.j); w.soh[o.id] = o; }
  for (const r of RD.snap) { const o = J(r.j); w.snap[o.id] = Object.assign({ is_deleted: 0 }, o); }
  w.gdh = Object.assign(J(RD.hdr[0].j), { gd_status: "Processing", is_deleted: 0 });
  for (const r of RD.lines) { const o = J(r.j); w.gdl[o.id] = Object.assign({ is_deleted: 0 }, o); }
  return w;
}
const idsIn = (text) => Array.from(text.matchAll(/JSON_TABLE\('(\[[^']*\])'/g)).map((x) => JSON.parse(x[1]).map(String));
const byIds = (map, ids) => ids.filter((i) => map[i]).map((i) => map[i]);
function mocks(w) {
  const stepRows = (pfxs) => w.steps.filter((r) => !r.is_deleted && pfxs.some((p) => r.step_name.indexOf(p) === 0)).sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
  const groupRows = (text) => {
    const groups = Array.from(text.matchAll(/SELECT '([a-z]+)' AS k/g)).map((x) => x[1]);
    const ids = idsIn(text);
    assert.strictEqual(groups.length, ids.length, "one id list per group");
    const map = { res: w.res, frag: w.res, pend: w.res, gdl: w.gdl, snap: w.snap, gdh: { [String(w.gdh.id)]: w.gdh } };
    return groups.flatMap((g, i) => byIds(map[g], ids[i]).map((o) => ({ k: g, j: JSON.stringify(o) })));
  };
  return new Proxy({}, {
    get: (_, id) => (text) => {
      const j = w.job;
      if (id === "sql_node_RCjob") return [Object.assign({}, j, { db_now: fmt(w.now), lease_until: fmt(w.now + 1800000),
        lease_live: j.lease_expires_at && Date.parse(j.lease_expires_at.replace(" ", "T") + "Z") > w.now ? 1 : 0,
        due: !j.next_attempt_at || Date.parse(j.next_attempt_at.replace(" ", "T") + "Z") <= w.now ? 1 : 0 })];
      if (id === "sql_node_RCsteps") return w.steps.filter((r) => !r.is_deleted && /^R/.test(r.step_name)).map((r) => ({ step_name: r.step_name, step_status: r.step_status }));
      if (id === "sql_node_RCpayload") return [{ prepared_payload: j.prepared_payload }];
      if (id === "sql_node_RCgd") return [{ gd_status: w.gdh.gd_status, si_status: w.si, lock_ref: w.lockRef }];
      if (id === "sql_node_RCown") return [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }];
      if (id === "sql_node_RCr1ops") return [{ intents: "0" }];
      const parts = Array.from(text.matchAll(/LIKE CONCAT\('([^']*)',\s*'([A-Z]+)\|%'\)/g)).map((x) => x[1] + x[2] + "|");
      if (parts.length) return stepRows(parts);
      const intent = text.match(/step_name LIKE '([A-Z0-9]+\|I\|)%'/);
      if (intent) return stepRows([intent[1]]);
      if (/^sql_node_RCr[024](rows|back)$/.test(id)) return groupRows(text);
      if (/^sql_node_RCr3lines/.test(id)) return Object.values(w.sol).map((o) => ({ j: JSON.stringify(o) }));
      if (/^sql_node_RCr3hdrs/.test(id)) return Object.values(w.soh).map((o) => ({ j: JSON.stringify(o) }));
      throw new Error("no mock for " + id);
    },
  });
}
function dbOf(w) {
  const apply = (map, rows, label) => {
    for (const r0 of rows) {
      const id = String(r0.id);
      if (!map[id]) throw new Error(label + " update of unknown id " + id);
      Object.assign(map[id], r0);
    }
  };
  const T = { "On Reserved Goods Delivery": "res", sales_order_axszx8cj_sub: "sol", "Sales Order": "soh", goods_delivery_fwii8mvb_sub: "gdl", "GD Completion Snapshot": "snap" };
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
      w.calls.push(["add", table, rows.length]);
      return rows;
    },
    update(table, rows) {
      if (w.crash && w.crash.table === table && --w.crash.n === 0) throw new Error("crash in " + table);
      if (table === "GD Async Job") for (const r of rows) Object.assign(w.job, r, { id: w.job.id });
      else if (table === "Goods Delivery") for (const r of rows) Object.assign(w.gdh, r, { id: w.gdh.id });
      else if (T[table]) apply(w[T[table]], rows, table);
      else throw new Error("unexpected update of " + table);
      w.calls.push(["update", table, rows.length]);
      return rows.length;
    },
  };
}
let runNo = 0;
function run(w, label) {
  const e = new Engine({ dir: R + "Goods Delivery/RevertV2", db: dbOf(w), mocks: { sql: mocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 48;
  const run0 = e.run.bind(e);
  e.run = (n, p) => {
    if (n === "GD_REVERT_COMMIT") return run0(n, p);
    w.calls.push(["call", n, p]);
    if (n === "INVENTORY_BULK_APPLY") return { returned: { code: "200", result_code: "APPLIED", message: "ok" }, ctx: {} };
    return { returned: { code: "200" }, ctx: {} };
  };
  let out, err = null;
  try {
    out = e.run("GD_REVERT_COMMIT", { job_id: m.job_id }).returned;
  } catch (x) {
    err = x.message;
  }
  const done = w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort();
  console.log(`${label}: ${err ? "CRASH " + err : JSON.stringify(out).slice(0, 220)}\n    job ${w.job.job_status} ${w.job.error_code || ""} lease ${w.job.lease_owner || "-"} | done ${done.join(",")}`);
  return { out, err };
}
const toPhaseB = (w) => { w.now += 5000; w.job.next_attempt_at = null; };
const calls = (w, n) => w.calls.filter((c) => c[0] === "call" && c[1] === n);
const num = (v) => Number(v || 0);
const COLS = { res: ["status", "reserved_qty", "open_qty", "delivered_qty", "doc_type", "doc_id", "doc_no", "doc_line_id", "target_gd_id"], frag: ["is_deleted", "status", "open_qty"],
  pend: ["reserved_qty", "open_qty"], gdl: ["picking_status"], snap: ["snapshot_status"], gdh: ["gd_status", "picking_status"] };
const same = (a, b) => (a === null || a === undefined || a === "" ? b === null || b === undefined || b === "" : /^-?[0-9.]+$/.test(String(a)) && String(a).length < 16 ? Math.abs(num(a) - num(b)) < 1e-8 : String(a) === String(b));
const expectReverted = (w, soAfter) => {
  assert.strictEqual(w.job.job_status, "COMPLETED", w.job.error_message);
  assert.strictEqual(w.gdh.gd_status, "Created");
  for (const g of ["res", "frag", "pend"]) for (const r of PARTS.RES[g]) for (const c of COLS[g]) assert.ok(same(w.res[r.id][c], r.after[c]), g + " " + r.id + " " + c + ": " + w.res[r.id][c] + " vs " + r.after[c]);
  for (const r of PARTS.GD.gdl) assert.strictEqual(w.gdl[r.id].picking_status, r.after.picking_status);
  for (const r of PARTS.GD.snap) assert.strictEqual(w.snap[r.id].snapshot_status, "Reverted");
  assert.strictEqual(w.gdh.picking_status, PARTS.GD.gdh[0].after.picking_status);
  for (const r of soAfter || PARTS.SO.sol) for (const c of ["planned_qty", "delivered_qty", "outstanding_quantity", "line_status"]) assert.ok(same(w.sol[r.id][c], r.after[c]), "SO line " + r.id + " " + c + ": " + w.sol[r.id][c] + " vs " + r.after[c]);
  for (const r of PARTS.SO.soh) for (const c of ["so_status", "gd_status", "partially_delivered", "fully_delivered"]) assert.ok(same(w.soh[r.id][c], r.after[c]), "SO " + r.id + " " + c);
};

// 1. phase A then phase B, clean
let w = world();
run(w, "A  clean phase A");
assert.deepStrictEqual(w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort(), ["R0_REVALIDATE", "R1_INVENTORY"]);
assert.ok(/^SPLIT\|/.test(w.job.lease_owner));
assert.strictEqual(calls(w, "INVENTORY_BULK_APPLY").length, 1);
const apply = calls(w, "INVENTORY_BULK_APPLY")[0][2];
assert.strictEqual(apply.mode, "APPLY");
assert.strictEqual(apply.operation_key, "GDR|" + m.job_id);
assert.strictEqual(apply.movements.length, m.counts.movements);
assert.strictEqual(w.gdh.gd_status, "Processing");
toPhaseB(w);
run(w, "B  clean phase B");
expectReverted(w);
console.log("    message:", w.job.progress_message);
run(w, "B' rerun of a COMPLETED job");
assert.strictEqual(w.job.job_status, "COMPLETED");
assert.strictEqual(calls(w, "INVENTORY_BULK_APPLY").length, 1);

// 2. a reservation changed before anything moved: FAILED, the GD back to Completed, no engine call
if (PARTS.RES.res.length) {
  w = world();
  const r0 = w.res[PARTS.RES.res[0].id];
  r0.open_qty = num(r0.open_qty) + 1;
  run(w, "A  a reservation changed at R0");
  assert.strictEqual(w.job.job_status, "FAILED");
  assert.strictEqual(w.job.error_code, "GDR_STALE");
  assert.strictEqual(w.gdh.gd_status, "Completed");
  assert.strictEqual(calls(w, "INVENTORY_BULK_APPLY").length, 0);
}

// 3. invoiced between SUBMIT and R0: FAILED, the GD back to Completed
w = world();
w.si = "Fully Invoiced";
run(w, "A  invoiced meanwhile");
assert.deepStrictEqual([w.job.job_status, w.job.error_code, w.gdh.gd_status], ["FAILED", "GDR_INVOICED", "Completed"]);
assert.strictEqual(calls(w, "INVENTORY_BULK_APPLY").length, 0);

// 4. another delivery of the same SO line completed after PREPARE: R3 takes this delivery's quantity off what the line holds now
w = world();
run(w, "A  phase A");
toPhaseB(w);
const sl = w.sol[PARTS.SO.sol[0].id];
const soQty = num(sl.so_quantity);
sl.so_quantity = soQty + 5;
sl.delivered_qty = num(sl.delivered_qty) + 5;
sl.planned_qty = num(sl.planned_qty);
const gdQty = num(PARTS.SO.sol[0].before.delivered_qty) - num(PARTS.SO.sol[0].after.delivered_qty);
const expectLine = { id: sl.id, after: { delivered_qty: num(sl.delivered_qty) - gdQty, planned_qty: num(sl.planned_qty) + gdQty, outstanding_quantity: soQty + 5 - (num(sl.delivered_qty) - gdQty),
  line_status: num(sl.delivered_qty) - gdQty > 0 ? "Processing" : "Issued" } };
run(w, "B  an SO line moved by another delivery");
assert.strictEqual(w.job.job_status, "COMPLETED", w.job.error_message);
for (const c of Object.keys(expectLine.after)) assert.ok(same(sl[c], expectLine.after[c]), "SO line " + c + ": " + sl[c] + " vs " + expectLine.after[c]);
console.log("    SO line now", JSON.stringify({ delivered: sl.delivered_qty, planned: sl.planned_qty, outstanding: sl.outstanding_quantity, status: sl.line_status }));

// 5. a crash in R3's header write (after the intent and the line writes), then the resume: the lines are not taken off twice
w = world();
run(w, "A  phase A");
toPhaseB(w);
w.crash = { table: "Sales Order", n: 1 };
const c5 = run(w, "B  crash in R3's Sales Order write");
assert.ok(c5.err && /crash/.test(c5.err));
assert.ok(w.steps.some((r) => r.step_name.indexOf("R3|I|") === 0), "the intent was recorded");
w.crash = null;
w.now += 31 * 60000;
run(w, "B  resume after the lease expired");
expectReverted(w);

// 6. a crash in R2's write, then the resume
if (PARTS.RES.res.length) {
w = world();
run(w, "A  phase A");
toPhaseB(w);
w.crash = { table: "On Reserved Goods Delivery", n: 1 };
const c6 = run(w, "B  crash in R2's reservation write");
assert.ok(c6.err && /crash/.test(c6.err));
w.crash = null;
w.now += 31 * 60000;
run(w, "B  resume after the lease expired");
expectReverted(w);
}

// 7. the snapshot changed after the stock went back (someone reverted it another way): review, the GD stays Processing
w = world();
run(w, "A  phase A");
toPhaseB(w);
w.snap[PARTS.GD.snap[0].id].snapshot_status = "Expired";
run(w, "B  the snapshot was changed");
assert.strictEqual(w.job.job_status, "REQUIRES_REVIEW");
assert.ok(/R4_GD/.test(w.job.error_message), w.job.error_message);
assert.strictEqual(w.gdh.gd_status, "Processing");

// 8. nothing to move (the movements count 0): one run does everything, no engine call
const m0 = JSON.parse(JSON.stringify(m));
m0.counts.movements = 0;
w = world(m0);
run(w, "AB nothing to move");
expectReverted(w);
assert.strictEqual(calls(w, "INVENTORY_BULK_APPLY").length, 0);
console.log("all scenarios passed");
