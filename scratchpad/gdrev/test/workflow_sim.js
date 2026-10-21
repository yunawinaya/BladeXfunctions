// workflow_sim.js <reads.json> <tenant>: the built GD_REVERT_PREPARE and GD_REVERT_SUBMIT on the interpreter, every read mocked from the
// reads (test/run_reads.py), writes recorded. Nothing touches a database.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../../gdc/pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [readsFile, tenant] = process.argv.slice(2);
const RD = JSON.parse(fs.readFileSync(readsFile, "utf8")).reads;
RD.dout = RD.dout || [];
const J = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (x) => (x[0] === '"' ? x : '"' + x + '"')));
const hdr = J(RD.hdr[0].j);
const GD = String(hdr.id), NO = String(hdr.delivery_no);
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };
const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const engine = (sql, writes, calls, answers) => {
  const e = new Engine({ dir: R + "Goods Delivery/RevertV2", db: { tenantId: tenant,
    insert: (tb, rows) => { writes.push(["insert", tb, rows]); return rows.map((r, i) => Object.assign({ id: String(8000 + i) }, r)); },
    update: (tb, rows) => { writes.push(["update", tb, rows]); return rows.length; } }, mocks: { sql: sql, read: {} } });
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  const run0 = e.run.bind(e);
  e.run = (name, p) => {
    if (/^GD_REVERT_/.test(name)) return run0(name, p);
    calls.push([name, p]);
    return { returned: (answers || {})[name] || { code: "200", result_code: "PLANNED", message: "ok" }, ctx: {} };
  };
  return e;
};

// ------------------------------------------------------------------------------------------------ PREPARE
const prepare = (o) => {
  const writes = [], calls = [], texts = {};
  const hdrRows = RD.hdr.map((r) => ({ j: r.j.replace(/"gd_status": ?"Completed"/, '"gd_status": "Processing"') }));
  const job = Object.assign({ db_now: "2026-10-21 10:00:00", id: "7100000000000000001", organization_id: hdr.organization_id, command: "REVERT_GD", job_status: "VALIDATING",
    lease_owner: "WRK|1", lease_live: 1, row_version: 2, attempt_count: 0, idempotency_key: "GDC|" + GD + "|1", correlation_id: "GD|" + GD,
    request_payload: JSON.stringify({ v: 1, gd_id: GD, gd_no: NO, source: "LIST", submitted_by: "1" }), is_deleted: 0 }, o.job || {});
  const sql = new Proxy({}, { get: (_, id) => (text) => {
    texts[id] = text;
    if (id === "sql_node_RPjob") return [job];
    if (id === "sql_node_RPhdr") return hdrRows;
    if (id === "sql_node_RPlock") return o.lock === undefined ? [{ step_name: "LOCK|1", result_ref: "GDC|" + GD + "|1" }] : o.lock;
    if (id === "sql_node_RPback") return [{ id: job.id, job_status: "?" }];
    const k = id.replace("sql_node_RP", "");
    if (o.reads && o.reads[k]) return o.reads[k];
    if (RD[k] !== undefined) return RD[k];
    throw new Error("no mock for " + id);
  } });
  const e = engine(sql, writes, calls, o.answers);
  const out = quiet(() => e.run("GD_REVERT_PREPARE", { job_id: job.id }).returned);
  return { out, writes, calls, texts };
};
const upd = (w, table) => w.filter((x) => x[0] === "update" && x[1] === table).map((x) => x[2]).flat().map((r) => { const o = Object.assign({}, r); delete o.__id; return o; });
const ins = (w, table) => w.filter((x) => x[0] === "insert" && x[1] === table).map((x) => x[2]).flat();
const failedWith = (r, code) => {
  const job = upd(r.writes, "GD Async Job")[0];
  assert.deepStrictEqual([job.job_status, job.error_code], ["FAILED", code], JSON.stringify(job).slice(0, 400));
  assert.strictEqual(ins(r.writes, "GD Publish Step").length, 0, "no payload parts");
  return job;
};

t("PREPARE: a Processing GD under this job's lock -> payload parts + READY_TO_COMMIT (manifest), the engine planned once", () => {
  const r = prepare({});
  const ready = upd(r.writes, "GD Async Job");
  assert.strictEqual(ready.length, 1);
  assert.strictEqual(ready[0].job_status, "READY_TO_COMMIT", JSON.stringify(ready[0]).slice(0, 300));
  const m = JSON.parse(ready[0].prepared_payload);
  assert.strictEqual(m.prepared_by, "GD_REVERT_PREPARE");
  assert.deepStrictEqual(Object.keys(m.parts).sort(), ["ENGINE", "GD", "RES", "SO"]);
  const parts = ins(r.writes, "GD Publish Step");
  assert.strictEqual(parts.length, Object.values(m.parts).flat().length);
  const eng = r.calls.filter((c) => c[0] === "INVENTORY_BULK_APPLY");
  assert.strictEqual(eng.length, 1);
  assert.deepStrictEqual([eng[0][1].mode, eng[0][1].operation_key], ["PLAN", "GDR|7100000000000000001"]);
  assert.ok(eng[0][1].movements.every((x) => x.direction === "ADD" && ["Reserved", "Unrestricted"].indexOf(x.inventory_category) >= 0 && x.isMovingInv === 0 && x.transaction_type === "GDL-R"));
  assert.strictEqual(upd(r.writes, "Goods Delivery").length, 0, "the GD stays Processing");
  // round 2 reads what the snapshot names (none here)
  for (const k of ["pend", "prec", "phdr", "hu", "hul"]) assert.ok(/IN \(0\)/.test(r.texts["sql_node_RP" + k]), k + ": " + r.texts["sql_node_RP" + k].slice(-80));
});
t("PREPARE: the engine refuses the plan -> FAILED, the GD back to Completed", () => {
  const r = prepare({ answers: { INVENTORY_BULK_APPLY: { code: "400", result_code: "COST_LOCK_BUSY", message: "busy" } } });
  failedWith(r, "GDR_INVENTORY_COST_LOCK_BUSY");
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery"), [{ id: GD, gd_status: "Completed" }]);
});
t("PREPARE: the GD's lock is another job's -> FAILED, the GD left alone", () => {
  const r = prepare({ lock: [{ step_name: "LOCK|2", result_ref: "GDC|" + GD + "|2" }] });
  failedWith(r, "GDR_NOT_LOCKED");
  assert.strictEqual(upd(r.writes, "Goods Delivery").length, 0);
});
t("PREPARE: a job that is not VALIDATING -> nothing written", () => {
  const r = prepare({ job: { job_status: "READY_TO_COMMIT" } });
  assert.strictEqual(r.writes.length, 0);
  assert.strictEqual(r.out.result_code, "JOB_ILLEGAL_TRANSITION");
});
t("PREPARE: no active snapshot -> FAILED with the classic text, the GD back to Completed", () => {
  const r = prepare({ reads: { snap: [] } });
  const job = failedWith(r, "GDR_NO_SNAPSHOT");
  assert.ok(/No active snapshot found for this Goods Delivery/.test(job.error_message), job.error_message);
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery"), [{ id: GD, gd_status: "Completed" }]);
});
if (RD.resv.length) t("PREPARE: a fragment touched since completion -> FAILED with the classic 409 text + the conflict, the GD back to Completed", () => {
  // a row pointing at the GD that the snapshot does not name is a fragment of the completion: it must still be Cancelled / Pending
  const resv = RD.resv.concat([{ j: JSON.stringify(Object.assign(J(RD.resv[0].j), { id: "9300000000000000001", status: "Allocated", delivered_qty: 0 })) }]);
  const r = prepare({ reads: { resv: resv } });
  const job = failedWith(r, "GDR_CONFLICT");
  assert.ok(/^Revert blocked: state has changed since completion\. Resolve conflicts manually\. Fragment record 9300000000000000001 was modified post-completion/.test(job.error_message), job.error_message);
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery"), [{ id: GD, gd_status: "Completed" }]);
  assert.strictEqual(r.calls.length, 0, "no engine call");
});
if (RD.dout.length) t("PREPARE: delivered with no reservation (straight from Unrestricted) -> what left goes back to Unrestricted at its cost", () => {
  const r = prepare({ reads: { resv: [] } });
  const ready = upd(r.writes, "GD Async Job")[0];
  assert.strictEqual(ready.job_status, "READY_TO_COMMIT", JSON.stringify(ready).slice(0, 300));
  const mv = r.calls.filter((c) => c[0] === "INVENTORY_BULK_APPLY")[0][1].movements;
  const net = {};
  for (const d of RD.dout) if (d.hu === "0") net[d.item] = (net[d.item] || 0) + Number(d.net_bq);
  const back = {};
  for (const m of mv) { assert.strictEqual(m.inventory_category, "Unrestricted"); back[m.material_id] = (back[m.material_id] || 0) + m.quantity; }
  assert.deepStrictEqual(back, net);
});
t("PREPARE: a stock item with no reservation and no movement read -> FAILED GDR_STOCK_NOT_RETURNABLE, not reverted half", () => {
  const r = prepare({ reads: { resv: [], dout: [] } });
  const job = failedWith(r, "GDR_STOCK_NOT_RETURNABLE");
  assert.ok(/was completed without reserved stock for .+: a revert would not put that stock back/.test(job.error_message), job.error_message);
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery"), [{ id: GD, gd_status: "Completed" }]);
  assert.strictEqual(r.calls.length, 0, "no engine call");
});
t("PREPARE: a serial-numbered item -> FAILED GDR_NOT_ELIGIBLE (the list falls back to the classic revert), the GD back to Completed", () => {
  const items = RD.items.map((x) => Object.assign({}, x, { serial_number_management: 1 }));
  const r = prepare({ reads: { items: items } });
  failedWith(r, "GDR_NOT_ELIGIBLE");
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery"), [{ id: GD, gd_status: "Completed" }]);
});

// ------------------------------------------------------------------------------------------------ SUBMIT
const submit = (o) => {
  const writes = [], calls = [];
  const facts = Object.assign({ db_now: "2026-10-21 10:00:00", gd_id: GD, delivery_no: NO, gd_status: "Completed", si_status: "", is_select_picking: 0, organization_id: hdr.organization_id,
    plant_id: String(hdr.plant_id), line_count: RD.lines.length, snapshots: 1, serial_items: 0, hu_lines: 0, last_lock: null, open_jobs: null, picking_jobs: null, picking_locks: null,
    packing_leases: null, last_job: null }, o.facts || {});
  const sql = new Proxy({}, { get: (_, id) => () => {
    if (id === "sql_node_RSfacts") return [facts];
    if (id === "sql_node_RSback") return [Object.assign({ job_id: "8001", job_status: "QUEUED", gd_status: "Processing", lock_ref: "GDC|" + GD + "|" + (o.lockN || 1), racers: 0 }, o.back || {})];
    throw new Error("no mock for " + id);
  } });
  const e = engine(sql, writes, calls);
  const out = quiet(() => e.run("GD_REVERT_SUBMIT", Object.assign({ operation: "SUBMIT", gd_id: GD, source: "LIST" }, o.params || {})).returned);
  return { out, writes };
};
t("SUBMIT: a Completed GD nothing holds -> the lock, the REVERT_GD job (correlation GD|<gd>), the GD Processing, the job due -> QUEUED", () => {
  const r = submit({});
  assert.strictEqual(r.out.route, "QUEUED", JSON.stringify(r.out));
  const steps = ins(r.writes, "GD Publish Step"), jobs = ins(r.writes, "GD Async Job");
  assert.deepStrictEqual([steps[0].job_id, steps[0].step_name, steps[0].result_ref], ["GDC|" + GD, "LOCK|1", "GDC|" + GD + "|1"]);
  assert.deepStrictEqual([jobs[0].command, jobs[0].job_status, jobs[0].correlation_id, jobs[0].idempotency_key], ["REVERT_GD", "QUEUED", "GD|" + GD, "GDC|" + GD + "|1"]);
  assert.deepStrictEqual(JSON.parse(jobs[0].request_payload).gd_id, GD);
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery"), [{ id: GD, gd_status: "Processing" }]);
  assert.strictEqual(upd(r.writes, "GD Async Job")[0].next_attempt_at, "2026-10-21 10:00:00", "due now");
});
t("SUBMIT: the next lock number after an earlier one (a completion's)", () => {
  const r = submit({ facts: { last_lock: "LOCK|4" }, lockN: 5 });
  assert.strictEqual(ins(r.writes, "GD Publish Step")[0].step_name, "LOCK|5");
  assert.strictEqual(r.out.route, "QUEUED");
});
for (const [label, facts, re] of [
  ["an open Packing completion", { open_jobs: JSON.stringify([{ id: "1", command: "COMPLETE_PACKING", job_status: "VALIDATING" }]) }, /Packing is being completed/],
  ["a completion under review", { open_jobs: JSON.stringify([{ id: "1", command: "COMPLETE_GD", job_status: "REQUIRES_REVIEW" }]) }, /completion stopped half-way and is under review/],
  ["another revert", { open_jobs: JSON.stringify([{ id: "1", command: "REVERT_GD", job_status: "QUEUED" }]) }, /already being reverted/],
  ["a revert under review", { open_jobs: JSON.stringify([{ id: "1", command: "REVERT_GD", job_status: "REQUIRES_REVIEW" }]) }, /revert stopped half-way/],
  ["a Picking V2 confirm", { picking_jobs: JSON.stringify([{ id: "1", command: "CONFIRM_PICKING", job_status: "COMMITTING_PICKING" }]) }, /Picking is being confirmed/],
  ["a Picking held on a device", { picking_locks: JSON.stringify([{ picking_id: "1", picking_no: "PI-1", is_processing: 1, lock_age_sec: 30 }]) }, /PI-1 is being processed on a device/],
  ["a Packing open on a phone", { packing_leases: JSON.stringify([{ packing_no: "PACK-1", lock_user: "Ali" }]) }, /PACK-1 \(open on mobile by Ali\)/],
  ["a Processing GD", { gd_status: "Processing" }, /being processed/],
]) {
  t("SUBMIT: BUSY on " + label + ", nothing written", () => {
    const r = submit({ facts });
    assert.strictEqual(r.out.route, "BUSY", JSON.stringify(r.out));
    assert.ok(re.test(r.out.message), r.out.message);
    assert.strictEqual(r.writes.length, 0);
  });
}
for (const [label, facts, re] of [
  ["a Created GD", { gd_status: "Created" }, /^Only Completed Goods Deliveries can be reverted$/],
  ["a Cancelled GD", { gd_status: "Cancelled" }, /^Only Completed Goods Deliveries can be reverted$/],
  ["an invoiced GD", { si_status: "Partially Invoiced" }, /Already invoiced \(Partially Invoiced\)\. Please cancel the sales invoice first\./],
  ["no active snapshot", { snapshots: 0 }, /^No active snapshot found for this Goods Delivery/],
  ["a missing GD", { gd_id: null }, /not found/],
]) {
  t("SUBMIT: STOP for " + label + ", nothing written", () => {
    const r = submit({ facts });
    assert.strictEqual(r.out.route, "STOP", JSON.stringify(r.out));
    assert.ok(re.test(r.out.message), r.out.message);
    assert.strictEqual(r.writes.length, 0);
  });
}
t("SUBMIT: a cancelled invoice does not hold the revert", () => assert.strictEqual(submit({ facts: { si_status: "Cancelled" } }).out.route, "QUEUED"));
t("SUBMIT: NOT_ELIGIBLE (-> the classic revert) for a Picking Plan GD, serial-numbered items, stock from a handling unit; STOP above 500 lines", () => {
  for (const f of [{ is_select_picking: 1 }, { serial_items: 2 }, { hu_lines: 1 }]) {
    const r = submit({ facts: Object.assign({ line_count: 3 }, f) });
    assert.strictEqual(r.out.route, "NOT_ELIGIBLE", JSON.stringify(f));
    assert.ok(/classic revert/.test(r.out.reason), r.out.reason);
    assert.strictEqual(r.writes.length, 0);
  }
  const big = submit({ facts: { hu_lines: 1, line_count: 501 } });
  assert.strictEqual(big.out.route, "STOP");
  assert.ok(/501 lines/.test(big.out.message), big.out.message);
});
t("SUBMIT: a stale device lock (over 900 s) does not hold the Picking", () => {
  assert.strictEqual(submit({ facts: { picking_locks: JSON.stringify([{ picking_id: "1", picking_no: "PI-1", is_processing: 1, lock_age_sec: 901 }]) } }).out.route, "QUEUED");
});
t("SUBMIT: a racer that slipped in before the Processing write -> GD back to Completed, this job CANCELLED, BUSY", () => {
  const r = submit({ back: { racers: 1 } });
  assert.strictEqual(r.out.route, "BUSY", JSON.stringify(r.out));
  const jobUpd = upd(r.writes, "GD Async Job");
  assert.deepStrictEqual([jobUpd[0].id, jobUpd[0].job_status], ["8001", "CANCELLED"]);
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery").slice(-1), [{ id: GD, gd_status: "Completed" }]);
});
t("SUBMIT: STATUS answers the latest revert job, nothing written", () => {
  const r = submit({ params: { operation: "STATUS" }, facts: { last_job: JSON.stringify({ id: "5", job_status: "COMMITTING_GD", progress_percent: 85, progress_message: "Updating" }) } });
  assert.deepStrictEqual([r.out.route, r.out.job_id, r.out.job_status], ["STATUS", "5", "COMMITTING_GD"]);
  assert.strictEqual(r.writes.length, 0);
});
t("SUBMIT: invalid input is rejected", () => {
  assert.strictEqual(submit({ params: { gd_id: "1 OR 1=1" } }).out.route, "REJECT");
  assert.strictEqual(submit({ params: { source: "FORM" } }).out.route, "REJECT");
});
console.log(n + " passed");
