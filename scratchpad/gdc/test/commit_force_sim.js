// commit_force_sim.js <payload.json> <creads.json> <tenant> [unforced payload.json] [unforced creads.json]: the built
// GD_COMPLETE_COMMIT on the interpreter for a Force Complete, against in-memory tables seeded from a PREPARE payload
// (test/plan_live.js with ANSWERS isForceComplete Yes) and live dev reads (test/commit_reads.py), plus in-memory Pickings.
// Nothing touches a database. Scenarios: a clean run closes the GD's own Picking (a shared one and one with a handling-unit
// header row stay open) and stamps the lines; a crash inside the C4P row writes resumes with the intent written once; C0
// refuses a held Picking (device lock <= 900 s, or an open Picking V2 confirm) and changed lines, both before any stock
// moves; a row cancelled after the intent goes to review; a holder at C4P waits; an unforced run never reads a Picking.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [payloadFile, readsFile, tenant, plainPayloadFile, plainReadsFile] = process.argv.slice(2);
const J = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (x) => (x[0] === '"' ? x : '"' + x + '"')));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const DONE_ROW = (r) => r.line_status === "Completed" || r.line_status === "Cancelled";

function world(P, RD) {
  const m = P.manifest;
  const w = { m, now: Date.UTC(2026, 9, 19, 9, 0, 0), seq: 5000000000000000000n, steps: [], res: {}, sol: {}, soh: {}, gdh: null, gdl: {}, calls: [], sqlIds: [], crash: null,
    pkl: {}, pkh: {}, fp: null };
  w.id = () => (w.seq += 1n).toString();
  w.job = { id: m.job_id, organization_id: m.organization_id, command: "COMPLETE_GD", job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "", attempt_count: 0,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: 3, error_code: null, error_message: null, error_details: null, idempotency_key: "GDC|" + m.gd_id + "|1",
    correlation_id: "GD|" + m.gd_id, prepared_payload: JSON.stringify(m), is_deleted: 0 };
  for (const r of P.rows) w.steps.push(Object.assign({ is_deleted: 0 }, r));
  w.lockRef = w.job.idempotency_key;
  for (const r of RD.c3rows.filter((x) => x.k === "U")) { const o = J(r.j); w.res[o.id] = o; }
  for (const r of RD.c4lines) { const o = J(r.j); w.sol[o.id] = o; }
  for (const r of RD.c4hdrs) { const o = J(r.j); w.soh[o.id] = o; }
  for (const r of RD.c5raw) { const o = J(r.j); if (r.k === "H") w.gdh = Object.assign(o, { gd_status: "Processing" }); else w.gdl[o.id] = o; }
  for (const r of RD.c0pick || []) {
    w.pkl[r.id] = { id: r.id, picking_id: r.picking_id, gd_id: r.gd_id, line_status: r.line_status, pending_process_qty: DONE_ROW(r) ? "0.00000000" : "1.00000000", row_type: "", is_deleted: 0 };
    w.pkh[r.picking_id] = w.pkh[r.picking_id] || { id: r.picking_id, to_id: r.picking_no, to_status: "In Progress", is_processing: 0, lock_age_sec: "3600", open_jobs: 0, is_deleted: 0 };
  }
  w.fp = (RD.c0fp || [])[0] || null;
  return w;
}
const idsIn = (text) => {
  const out = [];
  for (const mm of text.matchAll(/JSON_TABLE\('(\[[^']*\])'/g)) out.push(JSON.parse(mm[1]).map(String));
  return out;
};
// sql_node_FcPick: every row of each open Picking that still holds an open row of this GD
const fcPick = (w) => {
  const gd = String(w.m.gd_id);
  const open = (h) => h && !h.is_deleted && ["Completed", "Cancelled", "Draft"].indexOf(h.to_status) < 0;
  const mine = new Set(Object.values(w.pkl).filter((r) => !r.is_deleted && r.gd_id === gd && !DONE_ROW(r) && open(w.pkh[r.picking_id])).map((r) => r.picking_id));
  const cmp = (x, y) => (BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0);
  return Object.values(w.pkl).filter((r) => !r.is_deleted && mine.has(r.picking_id)).sort((a, b) => cmp(a.picking_id, b.picking_id) || cmp(a.id, b.id))
    .map((r) => { const h = w.pkh[r.picking_id]; return { id: r.id, picking_id: r.picking_id, picking_no: h.to_id, gd_id: r.gd_id, line_status: r.line_status, is_processing: String(h.is_processing), lock_age_sec: h.lock_age_sec, open_jobs: String(h.open_jobs) }; });
};
function mocks(w) {
  const stepRows = (pfx) => w.steps.filter((r) => !r.is_deleted && r.step_name.indexOf(pfx) === 0).sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
  const resRows = (text) => {
    const [ids] = idsIn(text);
    return ids.filter((i) => w.res[i]).map((i) => ({ k: "U", j: JSON.stringify(w.res[i]) }));
  };
  return new Proxy({}, {
    get: (_, id) => (text) => {
      w.sqlIds.push(id);
      const j = w.job;
      if (id === "sql_node_CCjob") return [Object.assign({}, j, { db_now: fmt(w.now), lease_until: fmt(w.now + 600000),
        lease_live: j.lease_expires_at && Date.parse(j.lease_expires_at.replace(" ", "T") + "Z") > w.now ? 1 : 0,
        due: !j.next_attempt_at || Date.parse(j.next_attempt_at.replace(" ", "T") + "Z") <= w.now ? 1 : 0 })];
      if (id === "sql_node_CCsteps") return w.steps.filter((r) => !r.is_deleted && /^C/.test(r.step_name)).map((r) => ({ step_name: r.step_name, step_status: r.step_status }));
      if (id === "sql_node_CCpayload") return [{ prepared_payload: j.prepared_payload }];
      if (id === "sql_node_CCgd") return [{ gd_status: w.gdh.gd_status, lock_ref: w.lockRef }];
      if (id === "sql_node_CCown") return [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }];
      if (id === "sql_node_CCc2ops") return [{ intents: "0" }];
      // the force-gated reads: nothing unless the SQL says '<force>' = 'Yes' with Yes filled in
      if (id === "sql_node_CCc0pick" || id === "sql_node_CCc4ppick") return /'Yes' = 'Yes'/.test(text) ? fcPick(w) : [];
      if (id === "sql_node_CCc0fp") return /'Yes' = 'Yes'/.test(text) ? [w.fp] : [{ n: "0", fp: "0" }];
      if (id === "sql_node_CCc4prows" || id === "sql_node_CCc4prowsB") {
        const [lineIds, pickingIds] = idsIn(text);
        return lineIds.filter((i) => w.pkl[i]).map((i) => { const r = w.pkl[i]; return { k: "L", id: r.id, picking_id: r.picking_id, gd_id: r.gd_id, status: r.line_status, pending: String(r.pending_process_qty), is_deleted: String(r.is_deleted) }; })
          .concat(pickingIds.filter((i) => w.pkh[i]).map((i) => { const h = w.pkh[i]; return { k: "P", id: h.id, picking_id: h.id, gd_id: "", status: h.to_status, pending: "", is_deleted: String(h.is_deleted) }; }));
      }
      const part = text.match(/LIKE CONCAT\('([^']*)',\s*'([A-Z]+)\|%'\)/);
      if (part) return stepRows(part[1] + part[2] + "|");
      const intent = text.match(/step_name LIKE '([A-Z0-9]+\|I\|)%'/);
      if (intent) return stepRows(intent[1]);
      if (/^sql_node_CC(c0rows|c3rows|c3back)$/.test(id)) return resRows(text);
      if (/^sql_node_CC(c0hus|c3hhus|c3hhusB|c0huitems|c3hitems|c3hitemsB)$/.test(id)) return [];
      if (id === "sql_node_CCc3hprec") return [];
      if (/^sql_node_CCc4lines/.test(id)) return Object.values(w.sol).map((o) => ({ j: JSON.stringify(o) }));
      if (/^sql_node_CCc4hdrs/.test(id)) return Object.values(w.soh).map((o) => ({ j: JSON.stringify(o) }));
      if (/^sql_node_CCc5(raw|back)$/.test(id)) return [{ k: "H", j: JSON.stringify(w.gdh) }].concat(Object.values(w.gdl).map((o) => ({ k: "L", j: JSON.stringify(o) })));
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
      else if (table === "On Reserved Goods Delivery") apply(w.res, rows, table);
      else if (table === "sales_order_axszx8cj_sub") apply(w.sol, rows, table);
      else if (table === "Sales Order") apply(w.soh, rows, table);
      else if (table === "goods_delivery_fwii8mvb_sub") apply(w.gdl, rows, table);
      else if (table === "Goods Delivery") for (const r of rows) Object.assign(w.gdh, r, { id: w.gdh.id });
      else if (table === "transfer_order_jz8m9w3h_sub") { w.calls.push(["update", table, rows.length]); apply(w.pkl, rows, table); }
      else if (table === "Transfer Order Picking") { w.calls.push(["update", table, rows.length]); apply(w.pkh, rows, table); }
      else w.calls.push(["update", table, rows.length]);
      return rows.length;
    },
  };
}
let runNo = 0;
function run(w, label) {
  const e = new Engine({ dir: process.env.GDC_DIR || R + "Goods Delivery/CompleteV2", db: dbOf(w), mocks: { sql: mocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 48;
  const run0 = e.run.bind(e);
  e.run = (n, p) => {
    if (n === "GD_COMPLETE_COMMIT") return run0(n, p);
    w.calls.push(["call", n]);
    if (n === "INVENTORY_BULK_APPLY") return { returned: { code: "200", result_code: "APPLIED", message: "ok" }, ctx: {} };
    return { returned: { code: "200", message: "ok" }, ctx: {} };
  };
  let out, err = null;
  try {
    out = e.run("GD_COMPLETE_COMMIT", { job_id: w.m.job_id }).returned;
  } catch (x) {
    err = x.message;
  }
  const done = w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort();
  console.log(`${label}: ${err ? "CRASH " + err : JSON.stringify(out).slice(0, 200)}\n    job ${w.job.job_status} ${w.job.error_code || ""} | done ${done.join(",")}`);
  return { out, err };
}
const toPhaseB = (w) => { w.now += 5000; w.job.next_attempt_at = null; };
const later = (w) => { w.now += 11 * 60000; w.job.next_attempt_at = null; };
const engineCalls = (w) => w.calls.filter((c) => c[0] === "call" && c[1] === "INVENTORY_BULK_APPLY").length;
const intentRows = (w) => w.steps.filter((r) => r.step_name.indexOf("C4P|I|") === 0);
const P = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
const RD = JSON.parse(fs.readFileSync(readsFile, "utf8"));
assert.strictEqual(P.manifest.force, 1, "a forced payload (plan_live.js with ANSWERS isForceComplete Yes)");
const GD = String(P.manifest.gd_id);
const gdPatch = JSON.parse(P.rows.filter((r) => r.step_name.split("|")[2] === "GD").map((r) => r.result_ref).join(""));
let passed = 0;
const ok = (name) => { passed++; console.log("ok " + name); };

// 1. clean: phase A, phase B; the own Picking closed, a shared one and one with an HU header row left open, the lines stamped
let w = world(P, RD);
const own = Object.values(w.pkl)[0].picking_id;
w.pkh["7000000000000000001"] = { id: "7000000000000000001", to_id: "PI-SHARED", to_status: "In Progress", is_processing: 0, lock_age_sec: "5000", open_jobs: 0, is_deleted: 0 };
w.pkl["7000000000000000011"] = { id: "7000000000000000011", picking_id: "7000000000000000001", gd_id: GD, line_status: "Open", pending_process_qty: "2", row_type: "", is_deleted: 0 };
w.pkl["7000000000000000012"] = { id: "7000000000000000012", picking_id: "7000000000000000001", gd_id: "7999999999999999999", line_status: "Open", pending_process_qty: "3", row_type: "", is_deleted: 0 };
w.pkh["7000000000000000002"] = { id: "7000000000000000002", to_id: "PI-HU", to_status: "Created", is_processing: 0, lock_age_sec: "5000", open_jobs: 0, is_deleted: 0 };
w.pkl["7000000000000000021"] = { id: "7000000000000000021", picking_id: "7000000000000000002", gd_id: GD, line_status: "Open", pending_process_qty: "4", row_type: "", is_deleted: 0 };
w.pkl["7000000000000000022"] = { id: "7000000000000000022", picking_id: "7000000000000000002", gd_id: "", line_status: "Open", pending_process_qty: "0", row_type: "header", is_deleted: 0 };
const ownOpen = Object.values(w.pkl).filter((r) => r.picking_id === own && !DONE_ROW(r)).map((r) => r.id);
run(w, "A  forced phase A");
assert.deepStrictEqual(w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort(), ["C0_REVALIDATE", "C1_SNAPSHOT", "C2_INVENTORY"]);
toPhaseB(w);
run(w, "B  forced phase B");
assert.strictEqual(w.job.job_status, "COMPLETED");
for (const id of ownOpen.concat(["7000000000000000011", "7000000000000000021"])) {
  assert.strictEqual(w.pkl[id].line_status, "Completed", "row " + id);
  assert.strictEqual(Number(w.pkl[id].pending_process_qty), 0, "pending " + id);
}
assert.strictEqual(w.pkh[own].to_status, "Completed", "the GD's own Picking closed");
assert.strictEqual(w.pkh["7000000000000000001"].to_status, "In Progress", "a Picking shared with another GD stays open");
assert.strictEqual(w.pkl["7000000000000000012"].line_status, "Open", "the other GD's row untouched");
assert.strictEqual(w.pkh["7000000000000000002"].to_status, "Created", "a Picking with an HU header row stays open (as classic)");
assert.strictEqual(w.pkl["7000000000000000022"].line_status, "Open");
for (const l of gdPatch.lines.filter((x) => "picking_status" in x)) assert.strictEqual(w.gdl[l.id].picking_status, "Completed", "GD line " + l.id + " stamped");
assert.strictEqual(w.gdh.gd_status, "Completed");
assert.strictEqual(w.gdh.picking_status, "Completed");
const order = w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name);
assert.ok(order.indexOf("C4P_PICKING") > order.indexOf("C4_SO") && order.indexOf("C4P_PICKING") < order.indexOf("C5_GD"), "C4P runs after C4, before C5: " + order.join(","));
ok("clean forced run: own Picking closed, shared + HU-header Pickings open, " + gdPatch.lines.filter((x) => "picking_status" in x).length + " GD lines stamped, GD Completed");
run(w, "B' rerun of a COMPLETED job");
assert.strictEqual(w.job.job_status, "COMPLETED");

// 2. crash in the 2nd C4P row slice (300 rows of the GD in its Picking), resume after the lease expires: done, intent once
w = world(P, RD);
for (let i = 0; i < 300; i++) {
  const id = String(7100000000000000000n + BigInt(i));
  w.pkl[id] = { id: id, picking_id: own, gd_id: GD, line_status: "Open", pending_process_qty: "1", row_type: "", is_deleted: 0 };
}
run(w, "A  phase A");
toPhaseB(w);
w.crash = { table: "transfer_order_jz8m9w3h_sub", n: 2 };
const c = run(w, "B  crash in C4P row slice 2");
assert.ok(c.err && /crash/.test(c.err));
const nIntent = intentRows(w).length;
assert.ok(nIntent > 0, "intent recorded before the writes");
w.crash = null;
later(w);
run(w, "B  resume after the lease expired");
assert.strictEqual(w.job.job_status, "COMPLETED");
assert.strictEqual(intentRows(w).length, nIntent, "the intent is written once");
assert.ok(Object.values(w.pkl).filter((r) => r.gd_id === GD).every((r) => r.line_status === "Completed" || r.line_status === "Cancelled"));
ok("crash in the 2nd C4P slice, resume: every row closed, the intent written once (" + nIntent + " row(s))");

// 3. C0: a device holds the Picking (lock 100 s old) -> FAILED, GD back to Created, no stock moved; a 901 s lock and an
//    unset age; an open Picking V2 confirm
for (const [lock, jobs, busy] of [["100", 0, true], ["901", 0, false], [null, 0, true], ["5000", 1, true]]) {
  w = world(P, RD);
  w.pkh[own].is_processing = lock === "5000" ? 0 : 1;
  w.pkh[own].lock_age_sec = lock;
  w.pkh[own].open_jobs = jobs;
  run(w, "A  Picking " + (jobs ? "with an open V2 confirm" : "locked " + lock + " s ago"));
  if (busy) {
    assert.strictEqual(w.job.job_status, "FAILED");
    assert.strictEqual(w.job.error_code, "GDC_PICKING_BUSY");
    assert.ok(/is being processed on a device right now/.test(w.job.error_message));
    assert.strictEqual(w.gdh.gd_status, "Created", "GD back to Created");
    assert.strictEqual(engineCalls(w), 0, "no stock moved");
  } else {
    assert.strictEqual(w.job.error_code, null);
    assert.ok(w.steps.some((r) => r.step_name === "C2_INVENTORY"));
  }
}
ok("C0: lock <= 900 s, an unset age and an open V2 confirm refuse before any stock moves; a 901 s lock does not");

// 4. C0: a pick wrote the lines after PREPARE read them -> GDC_STALE, nothing written
w = world(P, RD);
w.fp = { n: w.fp.n, fp: String(Number(w.fp.fp) + 1) };
run(w, "A  lines changed since PREPARE");
assert.strictEqual(w.job.error_code, "GDC_STALE");
assert.strictEqual(w.gdh.gd_status, "Created");
assert.strictEqual(engineCalls(w), 0);
ok("C0: a changed line fingerprint fails the job before any stock moves");

// 5. a row cancelled after the intent -> REQUIRES_REVIEW, the GD stays Processing
w = world(P, RD);
run(w, "A  phase A");
toPhaseB(w);
w.crash = { table: "transfer_order_jz8m9w3h_sub", n: 1 };
run(w, "B  crash before the first C4P row write");
w.crash = null;
w.pkl[ownOpen[0]].line_status = "Cancelled";
later(w);
run(w, "B  resume finds a row cancelled by someone else");
assert.strictEqual(w.job.job_status, "REQUIRES_REVIEW");
assert.ok(/C4P_PICKING/.test(w.job.error_message));
assert.strictEqual(w.gdh.gd_status, "Processing");
ok("a Picking row changed after the intent: REQUIRES_REVIEW, the GD stays Processing");

// 6. a device lock appears after C0 (a crashed run's lock not aged out): C4P waits (retry), then closes
w = world(P, RD);
run(w, "A  phase A");
toPhaseB(w);
w.pkh[own].is_processing = 1;
w.pkh[own].lock_age_sec = "60";
run(w, "B  a holder at C4P");
assert.strictEqual(w.job.job_status, "COMMITTING_GD");
assert.strictEqual(w.job.error_code, "GDC_STEP_RETRY");
assert.strictEqual(intentRows(w).length, 0, "nothing recorded while held");
assert.ok(!w.calls.some((x) => x[1] === "transfer_order_jz8m9w3h_sub"), "nothing closed while held");
w.pkh[own].lock_age_sec = "901";
later(w);
run(w, "B  the lock aged out");
assert.strictEqual(w.job.job_status, "COMPLETED");
ok("a holder at C4P: retry, nothing closed meanwhile; closed once the lock aged out");

// 7. unforced: never reads or writes a Picking, the 14 + 2 line columns rewritten as stored
if (plainPayloadFile) {
  const P2 = JSON.parse(fs.readFileSync(plainPayloadFile, "utf8"));
  const RD2 = JSON.parse(fs.readFileSync(plainReadsFile, "utf8"));
  assert.ok(!P2.manifest.force);
  w = world(P2, Object.assign({}, RD2, { c0pick: RD.c0pick, c0fp: RD.c0fp }));
  const before = JSON.stringify(w.pkl) + JSON.stringify(w.pkh);
  const stamps = JSON.stringify(Object.values(w.gdl).map((l) => [l.id, l.picking_status, l.packing_status]));
  run(w, "A  unforced phase A");
  toPhaseB(w);
  run(w, "B  unforced phase B");
  assert.strictEqual(w.job.job_status, "COMPLETED");
  assert.strictEqual(JSON.stringify(w.pkl) + JSON.stringify(w.pkh), before, "no Picking written");
  assert.ok(!w.sqlIds.some((i) => /^sql_node_CCc4p(pick|rows|intent)/.test(i)), "C4P never ran");
  assert.ok(!w.steps.some((r) => r.step_name === "C4P_PICKING"));
  assert.strictEqual(JSON.stringify(Object.values(w.gdl).map((l) => [l.id, l.picking_status, l.packing_status])), stamps, "line picking / packing status unchanged");
  ok("unforced: no Picking read beyond the gated C0 SQL, none written, line statuses unchanged, COMPLETED");
}
console.log(passed + " passed");
