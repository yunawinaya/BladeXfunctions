// test_p7.js [--mutate <name>]: Picking V2 stage 1e - PICKING_BULK_COMMIT's P7 (code/p7.js): which deliveries go to GD Complete
// V2 after P6, how each GD_COMPLETE_SUBMIT answer is recorded, and the fill after a failed call. --mutate breaks p7.js on purpose:
// the suite must then fail.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUTANTS = {
  no_status_filter: ['if (p7S(r.gd_status) !== "Created" || p7S(r.picking_status) !== "Completed") continue;', ""],
  no_p7_skip: ["if (!/^[0-9]{1,20}$/.test(gd) || p7S(r.p7)) continue;", "if (!/^[0-9]{1,20}$/.test(gd)) continue;"],
  busy_refused: ['if (route === "BUSY" && job && /already being completed/i.test(msg))', "if (false)"],
  fill_no_open: ["rows.push(p7S(b.open_job)", "rows.push(false"],
  no_cap: ["else if (items.length >= P7_MAX_GDS)", "else if (false)"],
  causation: ['causation_id: "PICKING|" + p7S(entry.jobId)', 'causation_id: ""'],
};
let src = fs.readFileSync(__dirname + "/../code/p7.js", "utf8");
if (mutate) {
  assert(MUTANTS[mutate], "no mutant " + mutate);
  assert(src.indexOf(MUTANTS[mutate][0]) >= 0, "mutant " + mutate + " does not apply");
  src = src.replace(MUTANTS[mutate][0], MUTANTS[mutate][1]);
}
const sb = { JSON, Math, Number, String, Array, Object, RegExp, console };
vm.createContext(sb);
vm.runInContext(src, sb);
const call = (fn, ...args) => { sb.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", sb))); };
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + e.message.split("\n")[0]); } };

const E = { jobId: "2114900000000000001", organizationId: "1996787068457861121", dbNow: "2026-10-27 13:00:00" };
const G = (o) => Object.assign({ gd_id: "2114900000000000101", delivery_no: "GD-2610-0001", gd_status: "Created", picking_status: "Completed", open_job: null, p7: null }, o || {});

// ---- the plan
it("plan: Auto Complete GD off -> the setup-gated read is empty, nothing to request", () => {
  const p = call("p7Plan", E, []);
  assert.deepStrictEqual([p.needLoop, p.needDirect, p.items, p.plannedSql], ["NO", "NO", [], "0"]);
});
it("plan: a delivery left fully picked and Created -> one GD_COMPLETE_SUBMIT request, as classic PICKING's call", () => {
  const p = call("p7Plan", E, [G()]);
  assert.strictEqual(p.needLoop, "YES");
  assert.deepStrictEqual(p.items, [{ gd_id: "2114900000000000101", delivery_no: "GD-2610-0001", operation: "SUBMIT", source: "PICKING", answers: { needCL: "auto" },
    causation_id: "PICKING|2114900000000000001" }]);
  assert.strictEqual(p.plannedSql, "2114900000000000101");
});
it("plan: not fully picked, already Completed or Processing -> not requested", () => {
  const p = call("p7Plan", E, [G({ picking_status: "In Progress" }), G({ gd_status: "Completed" }), G({ gd_status: "Processing" })]);
  assert.deepStrictEqual([p.needLoop, p.needDirect], ["NO", "NO"]);
});
it("plan: a delivery this job already answered (a re-run of phase B) -> not requested again", () => {
  assert.strictEqual(call("p7Plan", E, [G({ p7: "NOT_QUEUED" })]).needLoop, "NO");
});
it("plan: a completion already open -> recorded QUEUED with that job, no call", () => {
  const p = call("p7Plan", E, [G({ open_job: "2114900000000000555" })]);
  assert.deepStrictEqual([p.needLoop, p.directRows.map((r) => [r.step_name, r.step_status, r.result_ref])], ["NO", [["P7|2114900000000000101", "QUEUED", "2114900000000000555"]]]);
});
it("plan: more than 25 deliveries -> 25 requests, the rest NOT_QUEUED for a manual completion", () => {
  const rows = Array.from({ length: 27 }, (_, i) => G({ gd_id: String(2114900000000000101 + i * 2).slice(0, 19).replace(/\d{3}$/, String(100 + i)) }));
  const p = call("p7Plan", E, rows);
  assert.deepStrictEqual([p.items.length, p.directRows.length, p.directRows[0].step_status, p.directRows[0].error_code], [25, 2, "NOT_QUEUED", "P7_TOO_MANY"]);
  assert.ok(/complete it from the Goods Delivery list/.test(p.directRows[0].error_message));
});
it("plan: a gd_id that is not digits never reaches the SQL list", () => {
  const p = call("p7Plan", E, [G({ gd_id: "1 OR 1=1" }), G()]);
  assert.strictEqual(p.plannedSql, "2114900000000000101");
});

// ---- the answers
const I = { gd_id: "2114900000000000101" };
it("answer: QUEUED -> the row carries the COMPLETE_GD job for the screens to start", () => {
  const r = call("p7Answer", E, I, { route: "QUEUED", code: "200", message: "queued", job_id: "2114900000000000777" }).rows[0];
  assert.deepStrictEqual(r, { job_id: "2114900000000000001", organization_id: "1996787068457861121", step_name: "P7|2114900000000000101", step_status: "QUEUED", attempt_count: 1,
    started_at: "2026-10-27 13:00:00", finished_at: "2026-10-27 13:00:00", inventory_operation_id: "", result_ref: "2114900000000000777", error_code: null, error_message: null });
});
it("answer: BUSY 'already being completed' (its own open completion) -> the same queued job", () => {
  const r = call("p7Answer", E, I, { route: "BUSY", code: "409", message: "This delivery is already being completed", job_id: "2114900000000000777" }).rows[0];
  assert.deepStrictEqual([r.step_status, r.result_ref, r.error_code], ["QUEUED", "2114900000000000777", "ALREADY_QUEUED"]);
});
it("answer: BUSY on another Picking's open confirm -> NOT_QUEUED with the reason", () => {
  const r = call("p7Answer", E, I, { route: "BUSY", code: "409", message: "Its Picking is being confirmed", job_id: "" }).rows[0];
  assert.deepStrictEqual([r.step_status, r.result_ref, r.error_code], ["NOT_QUEUED", "", "BUSY 409"]);
  assert.ok(/^Its Picking is being confirmed: complete it from the Goods Delivery list$/.test(r.error_message), r.error_message);
});
it("answer: a credit-limit STOP -> NOT_QUEUED with its code and message", () => {
  const r = call("p7Answer", E, I, { route: "STOP", code: "402", message: "Credit limit exceeded", job_id: "" }).rows[0];
  assert.deepStrictEqual([r.step_status, r.error_code], ["NOT_QUEUED", "STOP 402"]);
});
it("answer: no answer at all -> NOT_QUEUED NO_ANSWER", () => {
  const r = call("p7Answer", E, I, null).rows[0];
  assert.deepStrictEqual([r.step_status, r.error_code], ["NOT_QUEUED", "NO_ANSWER"]);
});

// ---- the fill after the loop (a caught failure ends it)
it("fill: answered deliveries are left alone; one queued meanwhile -> QUEUED; one never asked -> NOT_QUEUED", () => {
  const plan = call("p7Plan", E, [G({ gd_id: "11" }), G({ gd_id: "12" }), G({ gd_id: "13" })]);
  const f = call("p7Fill", E, plan, [{ gd_id: "11", p7: "QUEUED", open_job: "71" }, { gd_id: "12", p7: null, open_job: "72" }, { gd_id: "13", p7: null, open_job: null }], "YES");
  assert.deepStrictEqual(f.fillRows.map((r) => [r.step_name, r.step_status, r.result_ref, r.error_code]),
    [["P7|12", "QUEUED", "72", "ALREADY_QUEUED"], ["P7|13", "NOT_QUEUED", "", "CALL_FAILED"]]);
  assert.strictEqual(f.needFill, "YES");
});
it("fill: every planned delivery answered -> nothing to add", () => {
  const plan = call("p7Plan", E, [G({ gd_id: "11" })]);
  assert.strictEqual(call("p7Fill", E, plan, [{ gd_id: "11", p7: "QUEUED" }], null).needFill, "NO");
});

console.log(JSON.stringify({ mutant: mutate || null, cases: n, failed: failed }));
process.exit(failed ? 1 : 0);
