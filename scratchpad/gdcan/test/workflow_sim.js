// workflow_sim.js <reads.json> <tenant>: the built GD_CANCEL_PREPARE and GD_CANCEL_SUBMIT on the interpreter, every read mocked from the
// reads (test/run_reads.py, test/augment.js), writes recorded. Nothing touches a database.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../../gdc/pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [readsFile, tenant] = process.argv.slice(2);
const RD = JSON.parse(fs.readFileSync(readsFile, "utf8"));
const J = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (x) => (x[0] === '"' ? x : '"' + x + '"')));
const hdr = J(RD.hdr[0].j);
const GD = String(hdr.id), NO = String(hdr.delivery_no);
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };
const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const engine = (sql, writes, calls, answers) => {
  const e = new Engine({ dir: R + "Goods Delivery/CancelV2", db: { tenantId: tenant,
    insert: (tb, rows) => { writes.push(["insert", tb, rows]); return rows.map((r, i) => Object.assign({ id: String(8000 + i) }, r)); },
    update: (tb, rows) => { writes.push(["update", tb, rows]); return rows.length; } }, mocks: { sql: sql, read: {} } });
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  const run0 = e.run.bind(e);
  e.run = (name, p) => {
    if (/^GD_CANCEL_/.test(name)) return run0(name, p);
    calls.push([name, p]);
    return { returned: (answers || {})[name] || { code: "200", result_code: "PLANNED", message: "ok" }, ctx: {} };
  };
  return e;
};
const readRows = (k) => RD[k] || [];

// ------------------------------------------------------------------------------------------------ PREPARE
const prepare = (o) => {
  const writes = [], calls = [];
  const hdrRows = RD.hdr.map((r) => ({ j: r.j.replace(/"gd_status": "Created"/, '"gd_status": "Processing"') }));
  const job = Object.assign({ db_now: "2026-10-20 10:00:00", id: "7100000000000000001", organization_id: hdr.organization_id, command: "CANCEL_GD", job_status: "VALIDATING",
    lease_owner: "WRK|1", lease_live: 1, row_version: 2, attempt_count: 0, idempotency_key: "GDC|" + GD + "|1", correlation_id: "GD|" + GD,
    request_payload: JSON.stringify({ v: 1, gd_id: GD, gd_no: NO, source: "LIST", submitted_by: "1" }), is_deleted: 0 }, o.job || {});
  const sql = new Proxy({}, { get: (_, id) => () => {
    if (id === "sql_node_XPjob") return [job];
    if (id === "sql_node_XPhdr") return hdrRows;
    if (id === "sql_node_XPlock") return o.lock === undefined ? [{ step_name: "LOCK|1", result_ref: "GDC|" + GD + "|1" }] : o.lock;
    if (id === "sql_node_XPback") return [{ id: job.id, job_status: "?" }];
    const k = id.replace("sql_node_XP", "");
    if (RD[k] !== undefined) return readRows(k);
    throw new Error("no mock for " + id);
  } });
  const e = engine(sql, writes, calls, o.answers);
  const out = quiet(() => e.run("GD_CANCEL_PREPARE", { job_id: job.id }).returned);
  return { out, writes, calls };
};
const upd = (w, table) => w.filter((x) => x[0] === "update" && x[1] === table).map((x) => x[2]).flat().map((r) => { const o = Object.assign({}, r); delete o.__id; return o; });
const ins = (w, table) => w.filter((x) => x[0] === "insert" && x[1] === table).map((x) => x[2]).flat();

t("PREPARE: a Processing GD under this job's lock -> payload parts + READY_TO_COMMIT (manifest), the engine planned once", () => {
  const r = prepare({});
  const ready = upd(r.writes, "GD Async Job");
  assert.strictEqual(ready.length, 1);
  assert.strictEqual(ready[0].job_status, "READY_TO_COMMIT", JSON.stringify(ready[0]).slice(0, 300));
  const m = JSON.parse(ready[0].prepared_payload);
  assert.strictEqual(m.prepared_by, "GD_CANCEL_PREPARE");
  assert.strictEqual(m.new_no, NO + "-Cancelled");
  assert.deepStrictEqual(Object.keys(m.parts).sort(), ["AFTER", "ENGINE", "GD", "HU", "NUM", "PACK", "PICK", "RES", "SO"]);
  const parts = ins(r.writes, "GD Publish Step");
  assert.strictEqual(parts.length, Object.values(m.parts).flat().length);
  assert.strictEqual(r.calls.filter((c) => c[0] === "INVENTORY_BULK_APPLY").length, 1);
  assert.strictEqual(r.calls[0][1].mode, "PLAN");
  assert.strictEqual(upd(r.writes, "Goods Delivery").length, 0, "the GD stays Processing");
});
t("PREPARE: the engine refuses the plan -> FAILED, the GD back to Created", () => {
  const r = prepare({ answers: { INVENTORY_BULK_APPLY: { code: "400", result_code: "INSUFFICIENT_STOCK", message: "no Reserved" } } });
  const job = upd(r.writes, "GD Async Job")[0];
  assert.deepStrictEqual([job.job_status, job.error_code], ["FAILED", "GDX_INVENTORY_INSUFFICIENT_STOCK"]);
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery"), [{ id: GD, gd_status: "Created" }]);
  assert.strictEqual(ins(r.writes, "GD Publish Step").length, 0);
});
t("PREPARE: the GD's lock is another job's -> FAILED, the GD left alone", () => {
  const r = prepare({ lock: [{ step_name: "LOCK|2", result_ref: "GDC|" + GD + "|2" }] });
  const job = upd(r.writes, "GD Async Job")[0];
  assert.deepStrictEqual([job.job_status, job.error_code], ["FAILED", "GDX_NOT_LOCKED"]);
  assert.strictEqual(upd(r.writes, "Goods Delivery").length, 0);
});
t("PREPARE: a job that is not VALIDATING -> nothing written", () => {
  const r = prepare({ job: { job_status: "READY_TO_COMMIT" } });
  assert.strictEqual(r.writes.length, 0);
  assert.strictEqual(r.out.result_code, "JOB_ILLEGAL_TRANSITION");
});

// ------------------------------------------------------------------------------------------------ SUBMIT
const submit = (o) => {
  const writes = [], calls = [];
  const facts = Object.assign({ db_now: "2026-10-20 10:00:00", gd_id: GD, delivery_no: NO, gd_status: "Created", organization_id: hdr.organization_id, plant_id: String(hdr.plant_id),
    line_count: RD.lines.length, last_lock: null, open_jobs: null, picking_jobs: null, picking_locks: null, packing_leases: null, last_job: null }, o.facts || {});
  const sql = new Proxy({}, { get: (_, id) => (text) => {
    if (id === "sql_node_XSfacts") return [facts];
    if (id === "sql_node_XSback") return [Object.assign({ job_id: "8001", job_status: "QUEUED", gd_status: "Processing", lock_ref: "GDC|" + GD + "|" + (o.lockN || 1), racers: 0 }, o.back || {})];
    const k = id.replace("sql_node_XS", "");
    if (k === "items" && o.serial) return readRows("items").map((r) => ({ j: r.j.replace(/"serial_number_management": 0/, '"serial_number_management": 1') }));
    if (k === "hdr" && o.hdr) return [{ j: JSON.stringify(Object.assign(J(RD.hdr[0].j), o.hdr)) }];
    if (RD[k] !== undefined) return readRows(k);
    throw new Error("no mock for " + id);
  } });
  const e = engine(sql, writes, calls);
  const out = quiet(() => e.run("GD_CANCEL_SUBMIT", Object.assign({ operation: "SUBMIT", gd_id: GD, source: "LIST" }, o.params || {})).returned);
  return { out, writes };
};
t("SUBMIT: a Created GD nothing holds -> the lock, the CANCEL_GD job (correlation GD|<gd>), the GD Processing, the job due -> QUEUED", () => {
  const r = submit({});
  assert.strictEqual(r.out.route, "QUEUED", JSON.stringify(r.out));
  const steps = ins(r.writes, "GD Publish Step"), jobs = ins(r.writes, "GD Async Job");
  assert.deepStrictEqual([steps[0].job_id, steps[0].step_name, steps[0].result_ref], ["GDC|" + GD, "LOCK|1", "GDC|" + GD + "|1"]);
  assert.deepStrictEqual([jobs[0].command, jobs[0].job_status, jobs[0].correlation_id, jobs[0].idempotency_key], ["CANCEL_GD", "QUEUED", "GD|" + GD, "GDC|" + GD + "|1"]);
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery"), [{ id: GD, gd_status: "Processing" }]);
  assert.strictEqual(upd(r.writes, "GD Async Job")[0].next_attempt_at, "2026-10-20 10:00:00", "due now");
});
t("SUBMIT: the next lock number after an earlier one", () => {
  const r = submit({ facts: { last_lock: "LOCK|4" }, lockN: 5 });
  assert.strictEqual(ins(r.writes, "GD Publish Step")[0].step_name, "LOCK|5");
  assert.strictEqual(r.out.route, "QUEUED");
});
for (const [label, facts, re] of [
  ["an open Packing completion", { open_jobs: JSON.stringify([{ id: "1", command: "COMPLETE_PACKING", job_status: "VALIDATING" }]) }, /Packing is being completed/],
  ["a completion under review", { open_jobs: JSON.stringify([{ id: "1", command: "COMPLETE_GD", job_status: "REQUIRES_REVIEW" }]) }, /under review/],
  ["another cancel", { open_jobs: JSON.stringify([{ id: "1", command: "CANCEL_GD", job_status: "QUEUED" }]) }, /already being cancelled/],
  ["a GD V2 create still making its Picking", { open_jobs: JSON.stringify([{ id: "1", command: "CREATE_GD_FROM_FORM", job_status: "CREATING_PICKING" }]) }, /Picking is still being created/],
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
t("SUBMIT: a stale device lock (over 900 s) does not hold the Picking", () => {
  assert.strictEqual(submit({ facts: { picking_locks: JSON.stringify([{ picking_id: "1", picking_no: "PI-1", is_processing: 1, lock_age_sec: 901 }]) } }).out.route, "QUEUED");
});
t("SUBMIT: STOP for a Cancelled / Draft GD, nothing written", () => {
  for (const st of ["Cancelled", "Draft", "Completed"]) {
    const r = submit({ facts: { gd_status: st } });
    assert.strictEqual(r.out.route, "STOP", st);
    assert.strictEqual(r.writes.length, 0);
  }
});
t("SUBMIT: NOT_ELIGIBLE (-> the classic cancel) for serial-numbered items and a GD made from a Picking", () => {
  assert.deepStrictEqual([submit({ serial: true }).out.route, submit({ serial: true }).out.reason], ["NOT_ELIGIBLE", "it has serial-numbered items"]);
  assert.strictEqual(submit({ hdr: { is_select_picking: 1 } }).out.route, "NOT_ELIGIBLE");
});
t("SUBMIT: STOP on a missing required field (CHECK_REQUIRED_FIELD runs on a cancel too)", () => {
  const r = submit({ hdr: { delivery_date: null } });
  assert.strictEqual(r.out.route, "STOP", JSON.stringify(r.out));
  assert.ok(/Delivery Date/.test(r.out.message), r.out.message);
});
t("SUBMIT: a racer that slipped in before the Processing write -> GD back to Created, this job CANCELLED, BUSY", () => {
  const r = submit({ back: { racers: 1 } });
  assert.strictEqual(r.out.route, "BUSY", JSON.stringify(r.out));
  const jobUpd = upd(r.writes, "GD Async Job");
  assert.deepStrictEqual([jobUpd[0].id, jobUpd[0].job_status], ["8001", "CANCELLED"]);
  assert.deepStrictEqual(upd(r.writes, "Goods Delivery").slice(-1), [{ id: GD, gd_status: "Created" }]);
});
t("SUBMIT: STATUS answers the latest cancel job, nothing written", () => {
  const r = submit({ params: { operation: "STATUS" }, facts: { last_job: JSON.stringify({ id: "5", job_status: "COMMITTING_GD", progress_percent: 85, progress_message: "Updating" }) } });
  assert.deepStrictEqual([r.out.route, r.out.job_id, r.out.job_status], ["STATUS", "5", "COMMITTING_GD"]);
  assert.strictEqual(r.writes.length, 0);
});
t("SUBMIT: invalid input is rejected", () => {
  assert.strictEqual(submit({ params: { gd_id: "1 OR 1=1" } }).out.route, "REJECT");
  assert.strictEqual(submit({ params: { source: "FORM" } }).out.route, "REJECT");
});
console.log(n + " passed");
