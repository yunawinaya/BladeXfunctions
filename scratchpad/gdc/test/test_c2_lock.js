// test_c2_lock.js: COMMIT's C2 answer to a 409 LOCK_BUSY (code/commit/c2.js) and SUBMIT's busy answer for EDIT_GD jobs
// (code/submit/entry.js)
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const D = __dirname + "/../";
const body = (f) => {
  const t = fs.readFileSync(D + f, "utf8");
  // the node's own tail (its {{placeholders}}) is not part of the function under test
  const i = t.indexOf("{{");
  return i < 0 ? t : t.slice(0, t.lastIndexOf("\n", i));
};
const ctx = (files) => {
  const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(files.map((f) => (f.startsWith("+") ? body(f.slice(1)) : fs.readFileSync(D + f, "utf8"))).join("\n") + "\nthis.out = { commitC2: typeof commitC2 !== 'undefined' ? commitC2 : null, submitEntry: typeof submitEntry !== 'undefined' ? submitEntry : null };", sb);
  return sb.out;
};
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };

const { commitC2 } = ctx(["code/commit/_common.js", "code/commit/_cmp.js", "+code/commit/c2.js"]);
const entry = (attempts) => ({ jobId: "1", organizationId: "2", gdId: "3", dbNow: "2026-10-15 12:00:00", attempts: attempts, rowVersion: 5, leaseUntil: "2026-10-15 12:10:00", unlockOk: "YES" });
const busy = { code: "409", result_code: "LOCK_BUSY", message: "ITEM|1|2 (GRC|9)" };
const ok = { ok: "YES" };
const guard = { nonce: "abc" };

t("409 with no intent rows: wait (no review), backoff grows 15 s -> 5 min", () => {
  const r0 = commitC2(entry(0), guard, ok, busy, { intents: "0" });
  eq([r0.route, r0.job_status, r0.jobRows[0].job_status, r0.jobRows[0].error_code, r0.jobRows[0].attempt_count], ["END", "COMMITTING_GD", "COMMITTING_GD", "GDC_LOCK_WAIT", 1]);
  eq(r0.jobRows[0].next_attempt_at, "2026-10-15 12:00:15");
  eq(commitC2(entry(3), guard, ok, busy, { intents: 0 }).jobRows[0].next_attempt_at, "2026-10-15 12:02:00");
  eq(commitC2(entry(7), guard, ok, busy, null).jobRows[0].next_attempt_at, "2026-10-15 12:05:00");
  eq(commitC2(entry(7), guard, ok, busy, null).needUnlock, "NO");
});
t("409 after 8 waits with no intent rows: FAILED, the GD back to Created", () => {
  const r = commitC2(entry(8), guard, ok, busy, { intents: 0 });
  eq([r.job_status, r.jobRows[0].job_status, r.jobRows[0].error_code, r.needUnlock, r.unlockRows], ["FAILED", "FAILED", "GDC_INVENTORY_LOCK_BUSY", "YES", [{ id: "3", gd_status: "Created" }]]);
  assert.ok(/nothing was written/.test(r.result_message));
});
t("409 with intent rows (it may have written): the old retry, review after 3", () => {
  const r1 = commitC2(entry(1), guard, ok, busy, { intents: "4" });
  eq([r1.job_status, r1.jobRows[0].error_code, r1.needUnlock], ["COMMITTING_GD", "GDC_STEP_RETRY", "NO"]);
  const r3 = commitC2(entry(3), guard, ok, busy, { intents: 4 });
  eq([r3.job_status, r3.jobRows[0].job_status, r3.needUnlock], ["REQUIRES_REVIEW", "REQUIRES_REVIEW", "NO"]);
});
t("other answers unchanged: 200 DONE + SPLIT, 400 FAILED + unlock, 500 review", () => {
  eq([commitC2(entry(0), guard, ok, { code: "200", result_code: "OK", message: "x" }, null).route, commitC2(entry(0), guard, ok, { code: "200" }, null).needSplit], ["OK", "YES"]);
  const f = commitC2(entry(0), guard, ok, { code: "400", result_code: "INSUFFICIENT", message: "short" }, null);
  eq([f.job_status, f.needUnlock], ["FAILED", "YES"]);
  eq(commitC2(entry(0), guard, ok, { code: "500", result_code: "REQUIRES_REVIEW", message: "x" }, null).job_status, "REQUIRES_REVIEW");
});

const { submitEntry } = ctx(["code/submit/_common.js", "+code/submit/entry.js"]);
const g = { operation: "SUBMIT", tenantId: "711077", gdId: "3", answers: { isForceComplete: "" } };
const facts = (open, picking) => [{ db_now: "2026-10-15 12:00:00", gd_id: "3", delivery_no: "GD/1", gd_status: "Created", organization_id: "2", plant_id: "4", line_count: 10, last_lock: "LOCK|2", open_jobs: JSON.stringify(open), picking_jobs: picking ? JSON.stringify(picking) : null, last_job: null }];
t("SUBMIT: an open EDIT_GD job is BUSY; one under review says so", () => {
  const r = submitEntry(g, facts([{ id: "9", command: "EDIT_GD", job_status: "COMMITTING_GD" }]));
  eq([r.route, r.code, r.message], ["BUSY", "409", "Its edit is being saved - please wait for it to finish."]);
  const v = submitEntry(g, facts([{ id: "9", command: "EDIT_GD", job_status: "REQUIRES_REVIEW" }]));
  eq(v.message, "Its edit stopped half-way and is under review: please contact support.");
  eq(submitEntry(g, facts([{ id: "8", command: "COMPLETE_GD", job_status: "QUEUED" }])).message, "This delivery is already being completed - please wait for it to finish.");
  eq(submitEntry(g, facts([{ id: "7", command: "COMPLETE_PACKING", job_status: "REQUIRES_REVIEW" }])).message, "Its Packing stopped half-way and is under review: please contact support.");
  eq([submitEntry(g, facts(null)).route, submitEntry(g, facts(null)).lockN], ["GO", 3]);
});
t("SUBMIT: an open Picking V2 confirm of one of its Pickings is BUSY; one under review says so", () => {
  const r = submitEntry(g, facts(null, [{ id: "5", command: "CONFIRM_PICKING", job_status: "COMMITTING_PICKING" }]));
  eq([r.route, r.code, r.message], ["BUSY", "409", "Its Picking is being confirmed in the background - please wait for it to finish."]);
  const v = submitEntry(g, facts(null, [{ id: "5", command: "CONFIRM_PICKING", job_status: "QUEUED" }, { id: "6", command: "CONFIRM_PICKING", job_status: "REQUIRES_REVIEW" }]));
  eq(v.message, "A Picking confirmation of this delivery stopped half-way and is under review: please contact support.");
  eq(submitEntry(g, facts(null, [])).route, "GO");
  // STATUS still answers while a Picking confirm runs
  eq(submitEntry(Object.assign({}, g, { operation: "STATUS" }), facts(null, [{ id: "5", command: "CONFIRM_PICKING", job_status: "QUEUED" }])).route, "STATUS");
});
console.log(n + " tests passed");
