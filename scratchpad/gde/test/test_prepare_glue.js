// test_prepare_glue.js: GD_EDIT_PREPARE's entry and ready code (code/prepare/{entry,ready}.js)
//  entry: only a VALIDATING EDIT_GD job under a live lease is prepared; its request -> the GD and the edit's id lists
//  ready: the plan + the engine's PLAN answer -> READY_TO_COMMIT (the worker's lease kept: those rows carry no lease column),
//         a cascade's job (request.hold 1) parked HELD in the same write (lease released, held 15 minutes), or FAILED with
//         the GD back to its stored status and our Picking lock released
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const D = __dirname + "/../code/prepare/";
const MUT = {
  hold: ["ready.js", "if (Number(req.hold) === 1) {", "if (false) {"],
  hold_lease: ["ready.js", "lease_owner: null, lease_expires_at: null, next_attempt_at: hold", "next_attempt_at: hold"],
  stored: ["ready.js", "gd_status: s(req.stored_status) || \"Created\"", "gd_status: \"Created\""],
  zero_moves: ["ready.js", "Number(p.movementCount) > 0 && ", ""],
  live_lease: ["entry.js", "if (String(job.lease_live) !== \"1\") return", "if (false) return"],
};
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const src = ["alloc_ids.js", "entry.js", "ready.js"].map((f) => {
  let t = fs.readFileSync(D + f, "utf8");
  if (mutate && MUT[mutate][0] === f) { if (t.indexOf(MUT[mutate][1]) < 0) throw new Error("mutant " + mutate + " does not apply"); t = t.replace(MUT[mutate][1], MUT[mutate][2]); }
  const cut = t.search(/^.*\{\{.*$/m);
  return cut >= 0 ? t.slice(0, cut) : t;
}).join("\n");
const ctx = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Date };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const call = (fn, ...args) => { ctx.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", ctx))); };
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0]); } };

const GD = "2100000000000000001";
const req = (o) => Object.assign({ v: 1, gd_id: GD, gd_no: "GD/1", source: "FORM", stored_status: "Created", delta: { header: {}, lines: [{ id: "31", cells: { so_line_item_id: "41", material_id: "51" } }], added: [{ line_so_id: "61", material_id: "52" }], removed: [], layout: [] }, picking_id: "", picking_version: "", hold: 0, cascade_ref: "" }, o || {});
const job = (o) => Object.assign({ db_now: "2026-10-15 10:00:00", id: "501", organization_id: "9", command: "EDIT_GD", job_status: "VALIDATING", lease_live: 1, idempotency_key: "GDE|" + GD + "|5",
  row_version: 3, correlation_id: "GD|" + GD, request_payload: JSON.stringify(req()) }, o || {});
const entryOf = (o) => call("prepareEntry", { jobId: "501", tenantId: "1" }, [job(o)], "0a1b2c3d4e5f");
const planOk = { route: "ENGINE", movementCount: 2, lineCount: 3, payload: "{}", message: "2 movements", gdId: GD, unlockOk: 1, pickUnlockId: "" };

it("entry: a VALIDATING job under a live lease -> GO with the edit's id lists", () => {
  const e = entryOf();
  assert.strictEqual(e.route, "GO"); assert.strictEqual(e.gdId, GD);
  assert.strictEqual(e.deltaMaterialIdsSql, "52,51"); assert.strictEqual(e.deltaSoLineIdsSql, "41"); assert.strictEqual(e.deltaSoIdsSql, "61");
});
it("entry: the rows that may need save-time allocation -> their materials, and the stored lines whose temp_qty_data the edit empties", () => {
  const delta = { header: {}, removed: [], layout: [],
    lines: [{ id: "31", cells: { temp_qty_data: "[]" } }, { id: "32", cells: { gd_qty: 5 } }, { id: "33", cells: { material_id: "53" } }, { id: "34", cells: {}, drop: ["temp_qty_data"] },
      { id: "35", cells: { temp_qty_data: "[{\"location_id\":\"1\"}]" } }],
    added: [{ material_id: "52", gd_qty: 2 }, { material_id: "54", gd_qty: 2, temp_qty_data: "[{\"location_id\":\"1\"}]" }, { material_id: "55", gd_qty: 0 }, { material_id: "", gd_qty: 1 }] };
  const e = entryOf({ request_payload: JSON.stringify(req({ delta })) });
  assert.deepStrictEqual(e.deltaAllocMaterialIdsSql.split(",").sort(), ["52", "53"]);
  assert.deepStrictEqual(e.deltaAllocLineIdsSql.split(",").sort(), ["31", "34"]);
});
it("entry: an edit with nothing to allocate -> '0' lists; a job not prepared -> '0' lists", () => {
  const delta = { header: {}, removed: [], layout: [], lines: [{ id: "32", cells: { gd_qty: 5 } }], added: [{ material_id: "54", gd_qty: 2, temp_qty_data: "[{\"a\":1}]" }] };
  const e = entryOf({ request_payload: JSON.stringify(req({ delta })) });
  assert.strictEqual(e.deltaAllocMaterialIdsSql, "0"); assert.strictEqual(e.deltaAllocLineIdsSql, "0");
  const n = entryOf({ job_status: "HELD" });
  assert.strictEqual(n.deltaAllocMaterialIdsSql, "0"); assert.strictEqual(n.deltaAllocLineIdsSql, "0");
});
it("entry: a lease that expired -> not prepared", () => { const e = entryOf({ lease_live: 0 }); assert.strictEqual(e.route, "NOOP"); assert.strictEqual(e.result_code, "JOB_ROW_VERSION_CONFLICT"); });
it("entry: a job that is not VALIDATING -> not prepared", () => { assert.strictEqual(entryOf({ job_status: "HELD" }).result_code, "JOB_ILLEGAL_TRANSITION"); });
it("entry: an unreadable request fails the job", () => { const e = entryOf({ request_payload: "{" }); assert.strictEqual(e.route, "FAIL"); assert.strictEqual(e.result_code, "GDE_INVALID_REQUEST"); });

it("ready: a form job -> READY_TO_COMMIT, the lease kept (the row carries no lease column)", () => {
  const r = call("prepareReady", entryOf(), planOk, { code: "200" });
  assert.strictEqual(r.needReady, "YES"); assert.strictEqual(r.needHold, "NO"); assert.strictEqual(r.job_status, "READY_TO_COMMIT");
  const row = r.readyRows[0];
  assert.strictEqual(row.job_status, "READY_TO_COMMIT"); assert.strictEqual(row.row_version, 4); assert.strictEqual(row.prepared_payload, "{}");
  assert.ok(!("lease_owner" in row) && !("next_attempt_at" in row));
});
it("ready: a cascade job (hold 1) is parked HELD in the same write: lease released, held 15 minutes", () => {
  const r = call("prepareReady", entryOf({ request_payload: JSON.stringify(req({ source: "CASCADE", hold: 1, cascade_ref: "SO|7|n1" })) }), planOk, { code: "200" });
  assert.strictEqual(r.needHold, "YES"); assert.strictEqual(r.needReady, "NO"); assert.strictEqual(r.job_status, "HELD");
  const row = r.holdRows[0];
  assert.strictEqual(row.job_status, "HELD"); assert.strictEqual(row.prepared_payload, "{}"); assert.strictEqual(row.row_version, 4);
  assert.strictEqual(row.lease_owner, null); assert.strictEqual(row.lease_expires_at, null); assert.strictEqual(row.next_attempt_at, "2026-10-15 10:15:00");
});
it("ready: no stock movement -> the engine's answer is not needed", () => {
  assert.strictEqual(call("prepareReady", entryOf(), Object.assign({}, planOk, { movementCount: 0 }), {}).job_status, "READY_TO_COMMIT");
});
it("ready: the engine refuses the movements -> FAILED with its code", () => {
  const r = call("prepareReady", entryOf(), planOk, { code: "400", result_code: "INSUFFICIENT_STOCK", message: "short" });
  assert.strictEqual(r.job_status, "FAILED"); assert.strictEqual(r.result_code, "GDE_INVENTORY_INSUFFICIENT_STOCK");
});
it("ready: a plan failure -> FAILED, the GD back to its stored status (Draft), our Picking lock released", () => {
  const e = entryOf({ request_payload: JSON.stringify(req({ stored_status: "Draft" })) });
  const r = call("prepareReady", e, { route: "FAIL", code: "GDE_400", message: "no", gdId: GD, unlockOk: 1, pickUnlockId: "77" }, {});
  assert.strictEqual(r.jobRows[0].job_status, "FAILED"); assert.strictEqual(r.jobRows[0].lease_owner, null);
  assert.deepStrictEqual(r.unlockRows, [{ id: GD, gd_status: "Draft" }]); assert.deepStrictEqual(r.pickUnlockRows, [{ id: "77", is_processing: 0 }]);
});
it("ready: a plan failure without our lock -> FAILED, nothing unlocked", () => {
  const r = call("prepareReady", entryOf(), { route: "FAIL", code: "GDE_NOT_LOCKED", message: "x", gdId: GD, unlockOk: 0, pickUnlockId: "" }, {});
  assert.strictEqual(r.needUnlock, "NO"); assert.strictEqual(r.needPickUnlock, "NO");
});
const T0 = Date.UTC(2026, 9, 16, 2, 0, 0);
const withClock = (t, f) => { const real = ctx.Date; ctx.Date = class extends real { static now() { return t; } }; try { return f(); } finally { ctx.Date = real; } };
it("ready: FAILED stamps the run's real end: the DB clock at entry + the seconds since (the entry's jsAt)", () => {
  const e = withClock(T0, () => entryOf());
  const r = withClock(T0 + 30500, () => call("prepareReady", e, planOk, { code: "400", result_code: "INSUFFICIENT_STOCK", message: "short" }));
  assert.strictEqual(e.jsAt, String(T0)); assert.strictEqual(r.jobRows[0].finished_at, "2026-10-15 10:00:30");
});

console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
process.exit(failed ? 1 : 0);
