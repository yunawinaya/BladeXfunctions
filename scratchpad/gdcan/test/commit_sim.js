// commit_sim.js <plan.json> <reads.json> <tenant>: the built GD_CANCEL_COMMIT on the interpreter against in-memory tables seeded from a
// PREPARE plan (test/plan_live.js --out) and the same reads (test/run_reads.py, test/augment.js). Nothing touches a database.
// Scenarios: phase A + phase B clean (every step, the Unload loop, the renames); a crash in X4H's writes + resume; a Picking row
// moved by someone else (review); a reservation changed before anything moved (FAILED, GD back to Created); a box refilled before
// the Unload (review); a cancel with no stock to move (one run).
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../../gdc/pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [planFile, readsFile, tenant] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(planFile, "utf8"));
const RD = JSON.parse(fs.readFileSync(readsFile, "utf8"));
const m = P.manifest;
const J = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (x) => (x[0] === '"' ? x : '"' + x + '"')));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const OLD = m.gd_no, NEW = m.new_no;

function world(manifest) {
  const mm = manifest || m;
  const w = { now: Date.UTC(2026, 9, 20, 9, 0, 0), seq: 5000000000000000000n, steps: [], res: {}, creates: [], sol: {}, soh: {}, gdh: null, gdl: {}, pkh: {}, pkl: {},
    ph: {}, pl: {}, ps: {}, pu: {}, hu: {}, items: {}, moves: {}, calls: [], crash: null };
  w.id = () => (w.seq += 1n).toString();
  w.job = { id: mm.job_id, organization_id: mm.organization_id, command: "CANCEL_GD", job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "", attempt_count: 0,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: 3, error_code: null, error_message: null, error_details: null, idempotency_key: "GDC|" + mm.gd_id + "|1",
    correlation_id: "GD|" + mm.gd_id, prepared_payload: JSON.stringify(mm), is_deleted: 0 };
  for (const r of P.result.partRows) w.steps.push(Object.assign({ is_deleted: 0 }, r));
  w.lockRef = w.job.idempotency_key;
  for (const r of RD.alloc.concat(RD.pend)) { const o = J(r.j); w.res[o.id] = o; }
  for (const r of RD.sohl) { const o = J(r.j); w.sol[o.id] = o; }
  for (const r of RD.soh) { const o = J(r.j); w.soh[o.id] = o; }
  w.gdh = Object.assign(J(RD.hdr[0].j), { gd_status: "Processing" });
  for (const r of RD.lines) { const o = J(r.j); w.gdl[o.id] = o; }
  for (const r of RD.pick) { const o = J(r.j); if (r.k === "H") w.pkh[o.id] = Object.assign({ is_deleted: 0 }, o); else w.pkl[o.id] = Object.assign({ is_deleted: 0 }, o); }
  for (const r of RD.pack || []) { const o = J(r.j); (r.k === "H" ? w.ph : r.k === "L" ? w.pl : r.k === "S" ? w.ps : w.pu)[o.id] = Object.assign({ is_deleted: 0 }, o); }
  for (const r of RD.box || []) { const o = J(r.j); if (r.k === "HU") w.hu[o.id] = Object.assign({ is_deleted: 0 }, o); else w.items[o.id] = Object.assign({ is_deleted: 0 }, o); }
  // movements: two of the GD's (the old number), one of another document
  for (const [id, no] of [["9200000000000000001", OLD], ["9200000000000000002", OLD], ["9200000000000000003", "GD/OTHER/1"]]) w.moves[id] = { id: id, trx_no: no, organization_id: mm.organization_id };
  return w;
}
const idsIn = (text) => Array.from(text.matchAll(/JSON_TABLE\('(\[[^']*\])'/g)).map((x) => JSON.parse(x[1]).map(String));
const jrows = (k, list) => list.map((o) => ({ k: k, j: JSON.stringify(o) }));
const byIds = (map, ids) => ids.filter((i) => map[i]).map((i) => map[i]);
function mocks(w) {
  const stepRows = (pfxs) => w.steps.filter((r) => !r.is_deleted && pfxs.some((p) => r.step_name.indexOf(p) === 0)).sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((r) => ({ step_name: r.step_name, result_ref: r.result_ref }));
  const resRows = (text) => {
    const [ids] = idsIn(text);
    const out = byIds(w.res, ids).map((o) => ({ k: "U", j: JSON.stringify(o) }));
    if (/job_line_key LIKE/.test(text)) for (const c of w.creates) out.push({ k: "C", j: JSON.stringify({ id: c.id, job_line_key: c.job_line_key }) });
    return out;
  };
  const itemsOf = (ids) => Object.values(w.items).filter((i) => !i.is_deleted && ids.indexOf(String(i.handling_unit_id)) >= 0);
  const huFacts = (text) => {
    const [boxIds, huIds, rowIds, srcIds] = idsIn(text);
    return jrows("HI", itemsOf(boxIds)).concat(jrows("HU", byIds(w.hu, huIds)), jrows("U", byIds(w.pu, rowIds)), jrows("S", byIds(w.ps, srcIds)));
  };
  return new Proxy({}, {
    get: (_, id) => (text) => {
      const j = w.job;
      if (id === "sql_node_XCjob") return [Object.assign({}, j, { db_now: fmt(w.now), lease_until: fmt(w.now + 1800000),
        lease_live: j.lease_expires_at && Date.parse(j.lease_expires_at.replace(" ", "T") + "Z") > w.now ? 1 : 0,
        due: !j.next_attempt_at || Date.parse(j.next_attempt_at.replace(" ", "T") + "Z") <= w.now ? 1 : 0 })];
      if (id === "sql_node_XCsteps") return w.steps.filter((r) => !r.is_deleted && /^X/.test(r.step_name)).map((r) => ({ step_name: r.step_name, step_status: r.step_status }));
      if (id === "sql_node_XCpayload") return [{ prepared_payload: j.prepared_payload }];
      if (id === "sql_node_XCgd") return [{ gd_status: w.gdh.gd_status, lock_ref: w.lockRef }];
      if (id === "sql_node_XCown") return [{ id: j.id, job_status: j.job_status, lease_owner: j.lease_owner, row_version: j.row_version }];
      if (id === "sql_node_XCx2ops") return [{ intents: "0" }];
      const parts = Array.from(text.matchAll(/LIKE CONCAT\('([^']*)',\s*'([A-Z]+)\|%'\)/g)).map((x) => x[1] + x[2] + "|");
      if (parts.length) return stepRows(parts);
      const intent = text.match(/step_name LIKE '([A-Z0-9]+\|I\|)%'/);
      if (intent) return stepRows([intent[1]]);
      if (/^sql_node_XC(x0rows|x3rows|x3back)$/.test(id)) return resRows(text);
      if (id === "sql_node_XCx0pick") return byIds(w.pkh, idsIn(text)[0]).map((h) => ({ id: h.id, to_id: h.to_id, is_processing: h.is_processing || 0, lock_age_sec: 99999, open_jobs: 0 }));
      if (id === "sql_node_XCx0pack") return byIds(w.ph, idsIn(text)[0]).map((h) => ({ id: h.id, packing_no: h.packing_no, lock_session: h.lock_session || "", lock_user: h.lock_user || "", lock_live: h.lock_live || "0" }));
      if (id === "sql_node_XCx0box") return itemsOf(idsIn(text)[0]).map((i) => ({ handling_unit_id: i.handling_unit_id, material_id: i.material_id, balance_id: i.balance_id, batch_id: i.batch_id, quantity: i.quantity }));
      if (/^sql_node_XCx4(lines|linesB)$/.test(id)) return Object.values(w.sol).map((o) => ({ j: JSON.stringify(o) }));
      if (/^sql_node_XCx4(hdrs|hdrsB)$/.test(id)) return Object.values(w.soh).map((o) => ({ j: JSON.stringify(o) }));
      if (/^sql_node_XCx4p(rows|back)$/.test(id)) { const [l, p] = idsIn(text); return jrows("L", byIds(w.pkl, l)).concat(jrows("P", byIds(w.pkh, p))); }
      if (/^sql_node_XCx4k(rows|back)$/.test(id)) { const [l, h] = idsIn(text); return jrows("L", byIds(w.pl, l)).concat(jrows("H", byIds(w.ph, h))); }
      if (/^sql_node_XCx4h(now|after|back)$/.test(id)) return huFacts(text);
      if (/^sql_node_XCx5rows/.test(id)) { const [h, l, p, i, s] = idsIn(text); return jrows("H", byIds(w.pkh, h)).concat(jrows("L", byIds(w.pkl, l)), jrows("P", byIds(w.ph, p)), jrows("I", byIds(w.pl, i)), jrows("S", byIds(w.ps, s))); }
      if (/^sql_node_XCx5moves/.test(id)) {
        const old = text.match(/m\.trx_no = '((?:[^']|'')*)'/)[1].replace(/''/g, "'");
        return Object.values(w.moves).filter((x) => x.trx_no === old && x.organization_id === m.organization_id).map((x) => ({ id: x.id }));
      }
      if (/^sql_node_XCx6(raw|back)$/.test(id)) return [{ k: "H", j: JSON.stringify(w.gdh) }].concat(Object.values(w.gdl).map((o) => ({ k: "L", j: JSON.stringify(o) })));
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
  const T = { "On Reserved Goods Delivery": "res", sales_order_axszx8cj_sub: "sol", "Sales Order": "soh", goods_delivery_fwii8mvb_sub: "gdl", transfer_order_jz8m9w3h_sub: "pkl",
    "Transfer Order Picking": "pkh", packing_jz8m9w3h_sub: "pl", Packing: "ph", packing_mudjw4xk_sub: "ps", packing_hr4nq20g_sub: "pu", "Handling Unit": "hu", "Inventory Movement": "moves" };
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
      else if (table === "Goods Delivery") for (const r of rows) Object.assign(w.gdh, r, { id: w.gdh.id });
      else if (T[table]) apply(w[T[table]], rows, table);
      else w.calls.push(["update", table, rows.length]);
      return rows.length;
    },
  };
}
let runNo = 0;
function run(w, label) {
  const e = new Engine({ dir: R + "Goods Delivery/CancelV2", db: dbOf(w), mocks: { sql: mocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 48;
  const run0 = e.run.bind(e);
  e.run = (n, p) => {
    if (n === "GD_CANCEL_COMMIT") return run0(n, p);
    w.calls.push(["call", n, p]);
    if (n === "INVENTORY_BULK_APPLY") return { returned: { code: "200", result_code: "APPLIED", message: "ok" }, ctx: {} };
    if (n === "REPACKING_PROCESS") {
      const hu = String((p.source_hu || {}).id);
      const held = Object.values(w.items).filter((i) => !i.is_deleted && String(i.handling_unit_id) === hu);
      if (!held.length) return { returned: { code: "400", message: "No matching HU item" }, ctx: {} };
      if (w.unloadFails && w.unloadFails-- > 0) return { returned: { code: "500", message: "boom" }, ctx: {} };
      for (const i of held) i.is_deleted = 1;
      w.hu[hu].hu_status = "Created";
      return { returned: { code: "200", message: "ok" }, ctx: {} };
    }
    return { returned: { code: "200" }, ctx: {} };
  };
  let out, err = null;
  try {
    out = e.run("GD_CANCEL_COMMIT", { job_id: m.job_id }).returned;
  } catch (x) {
    err = x.message;
  }
  const done = w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort();
  console.log(`${label}: ${err ? "CRASH " + err : JSON.stringify(out).slice(0, 200)}\n    job ${w.job.job_status} ${w.job.error_code || ""} lease ${w.job.lease_owner || "-"} | done ${done.join(",")}`);
  return { out, err };
}
const toPhaseB = (w) => { w.now += 5000; w.job.next_attempt_at = null; };
const calls = (w, n) => w.calls.filter((c) => c[0] === "call" && c[1] === n);
const expectCancelled = (w) => {
  assert.strictEqual(w.job.job_status, "COMPLETED", w.job.error_message);
  assert.strictEqual(w.gdh.gd_status, "Cancelled");
  assert.strictEqual(w.gdh.delivery_no, NEW);
  for (const u of JSON.parse(w.steps.filter((r) => r.step_name.indexOf(m.parts.RES[0].slice(0, -3)) === 0).map((r) => r.result_ref).join("")).updates) assert.strictEqual(w.res[u.id].status, u.after.status);
  for (const r of Object.values(w.pkl)) if (r.gd_id === m.gd_id) assert.deepStrictEqual([r.line_status, Number(r.pending_process_qty), r.gd_no], ["Cancelled", 0, NEW]);
  for (const h of Object.values(w.ph)) assert.deepStrictEqual([h.packing_status, h.gd_status, h.gd_no], ["Cancelled", "Cancelled", NEW]);
  for (const l of Object.values(w.pl)) assert.deepStrictEqual([l.line_status, l.gd_no], ["Cancelled", NEW]);
  assert.strictEqual(w.moves["9200000000000000001"].trx_no, NEW);
  assert.strictEqual(w.moves["9200000000000000003"].trx_no, "GD/OTHER/1", "another document's movement untouched");
};

// 1. phase A then phase B, clean
let w = world();
run(w, "A  clean phase A");
assert.deepStrictEqual(w.steps.filter((r) => r.step_status === "DONE").map((r) => r.step_name).sort(), ["X0_REVALIDATE", "X2_INVENTORY"]);
assert.ok(/^SPLIT\|/.test(w.job.lease_owner));
assert.strictEqual(calls(w, "INVENTORY_BULK_APPLY").length, 1);
toPhaseB(w);
run(w, "B  clean phase B");
expectCancelled(w);
const H1 = "9100000000000000011", H2 = "9100000000000000012", H3 = "9100000000000000013";
if (w.hu[H1]) {
  assert.deepStrictEqual([w.hu[H1].packing_id, w.hu[H2].parent_hu_id, w.hu[H3].packing_id], ["", "", ""]);
  assert.strictEqual(Object.values(w.items).filter((i) => !i.is_deleted && i.handling_unit_id === H1).length, 0, "the box is empty");
  assert.strictEqual(Object.values(w.items).filter((i) => !i.is_deleted && i.handling_unit_id === H3).length, 1, "the locked box keeps its stock");
  assert.deepStrictEqual([w.pu["9100000000000000041"].hu_status, w.pu["9100000000000000041"].temp_data, w.ps["9100000000000000030"].hu_status], ["Unpacked", "[]", "Unpacked"]);
  assert.strictEqual(calls(w, "REPACKING_PROCESS").length, 1);
}
assert.strictEqual(calls(w, "REORDER_SET_REDIS").length, m.parts.AFTER && JSON.parse(w.steps.filter((r) => r.step_name.indexOf("P|") === 0 && r.step_name.indexOf("|AFTER|") > 0).map((r) => r.result_ref).join("")).reorder ? 1 : 0);
console.log("    message:", w.job.progress_message);
console.log("    SO headers:", JSON.stringify(Object.values(w.soh).map((h) => [h.id, h.so_status, h.gd_status])), "| SO lines planned:", JSON.stringify(Object.values(w.sol).map((l) => Number(l.planned_qty))));
run(w, "B' rerun of a COMPLETED job");
assert.strictEqual(w.job.job_status, "COMPLETED");

// 2. a crash in X4H's handling-unit writes after the Unload, then the resume: no second Unload, the box rows still written
if (w.hu[H1]) {
  w = world();
  run(w, "A  phase A");
  toPhaseB(w);
  w.crash = { table: "Handling Unit", n: 1 };
  const c = run(w, "B  crash in X4H's handling-unit write");
  assert.ok(c.err && /crash/.test(c.err));
  w.crash = null;
  w.now += 31 * 60000;
  run(w, "B  resume after the lease expired");
  expectCancelled(w);
  assert.strictEqual(calls(w, "REPACKING_PROCESS").length, 1, "the emptied box is not unloaded again");
}

// 3. someone else moves a Picking row after the stock was released: review, the GD stays Processing
w = world();
run(w, "A  phase A");
toPhaseB(w);
const prow = Object.values(w.pkl).find((r) => r.gd_id === m.gd_id);
if (prow) {
  prow.line_status = "In Progress";
  run(w, "B  a Picking row was moved");
  assert.strictEqual(w.job.job_status, "REQUIRES_REVIEW");
  assert.ok(/X4P_PICKING/.test(w.job.error_message), w.job.error_message);
  assert.strictEqual(w.gdh.gd_status, "Processing");
}

// 4. a reservation changed before anything moved: FAILED, the GD back to Created, no engine call
w = world();
const r0 = Object.values(w.res)[0];
r0.open_qty = Number(r0.open_qty) - 1;
run(w, "A  a reservation changed at X0");
assert.strictEqual(w.job.job_status, "FAILED");
assert.strictEqual(w.job.error_code, "GDX_STALE");
assert.strictEqual(w.gdh.gd_status, "Created");
assert.strictEqual(calls(w, "INVENTORY_BULK_APPLY").length, 0);

// 5. the box got another item after the stock was released: review before any Unload
if (w.hu[H1]) {
  w = world();
  run(w, "A  phase A");
  toPhaseB(w);
  w.items["9100000000000000099"] = { id: "9100000000000000099", handling_unit_id: H1, material_id: "1", balance_id: "2", batch_id: null, quantity: "1", is_deleted: 0 };
  run(w, "B  the box was refilled");
  assert.strictEqual(w.job.job_status, "REQUIRES_REVIEW");
  assert.ok(/X4H_UNPACK/.test(w.job.error_message), w.job.error_message);
  assert.strictEqual(calls(w, "REPACKING_PROCESS").length, 0);
}

// 6. an Unload that fails: retried by the job (the box stays full), then done
if (w.hu[H1]) {
  w = world();
  w.unloadFails = 1;
  run(w, "A  phase A");
  toPhaseB(w);
  run(w, "B  the Unload fails once");
  assert.strictEqual(w.job.job_status, "COMMITTING_GD");
  assert.strictEqual(w.job.error_code, "GDX_STEP_RETRY");
  w.now += 60000;
  run(w, "B  retry");
  expectCancelled(w);
}

// 7. nothing to move (the movements part empty): one run does everything, no engine call
const m0 = JSON.parse(JSON.stringify(m));
m0.counts.movements = 0;
w = world(m0);
run(w, "AB nothing to move");
expectCancelled(w);
assert.strictEqual(calls(w, "INVENTORY_BULK_APPLY").length, 0);
console.log("all scenarios passed");
