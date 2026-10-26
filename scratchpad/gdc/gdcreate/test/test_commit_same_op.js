// test_commit_same_op.js: GD_BULK_COMMIT after-call decision (publishP3) for a caught failed call (patch_commit_same_op_retry.py):
// an unfinished operation (lease expired, no mutation) is retried with the SAME operation id; every other case as before.
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const quiet = (f) => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 600))); if (!ok) fails += 1; };
const src = find(W, "code_node_7NQFbpmU").data.script.code;
const cut = src.indexOf("const guard = [{{node:code_node_WaEyJtlE.data}}][0];");
const fns = quiet(() => new Function(src.slice(0, cut) + "\nreturn { publishP3: publishP3 };")());
const guard = { route: "CONTINUE", jobId: "77", tenantId: "128671", leaseOwner: "PUB|abc", nonce: "abc" };
const pre = (attempts, opAttempt) => ({ dbNow: "2026-10-26 08:00:00", operationId: "GD|77|" + opAttempt, attempt: opAttempt, rowVersion: 10, organizationId: "1996787068457861121",
  steps: { P3_INVENTORY_APPLY: { id: "S3", status: "STARTED", attempt: opAttempt, opId: "GD|77|" + opAttempt } }, stepsDone: { P3_INVENTORY_APPLY: "NO" },
  jobRows: [{ id: "77", job_status: "COMMITTING_GD", attempt_count: attempts, row_version: 10, lease_owner: "PUB|abc", lease_expires_at: "2026-10-26 08:30:00" }] });
const p1 = { gdId: "901", gdNo: "GD-2610-9901" };
const p2 = { headerIds: ["901"], lineIds: ["902"], resIds: ["903"], packIds: [], hasHeader: "YES", hasLines: "YES", hasRes: "YES", hasPack: "NO" };
const clock = { db_now: "2026-10-26 08:00:05" };
const op = (status, extra) => Object.assign({ id: "OP11", operation_status: status, result_code: "", lease_live: "0", mutation_started_at: "", lease_expires_at: "2026-10-26 07:41:03", gate_taken: "0", gate_owner: "" }, clock, extra || {});
const crashed = { called: "YES", crashed: "YES", operation_id: "", operation_status: "", result_code: "" };
const decide = (rows, response, attempts, opAttempt) => quiet(() => fns.publishP3(guard, pre(attempts, opAttempt), p1, p2, rows, response));

let d = decide([op("LOCKING")], crashed, 10, 11);
let j = (d.jobRows || [])[0] || {};
let st = (d.stepDoneRows || [])[0] || {};
t("crashed, operation LOCKING with an expired lease -> RETRY with the SAME operation (its RECOVER releases the keys)",
  d.route === "RETRY" && d.nextOperationId === "GD|77|11" && st.inventory_operation_id === "GD|77|11" && st.attempt_count === 11 && st.step_status === "STARTED" &&
  j.attempt_count === 11 && j.lease_owner === null && j.error_code === "GD_INVENTORY_RETRYABLE_REJECTION" && /same operation GD\|77\|11/.test(d.result_message), { route: d.route, next: d.nextOperationId, st, j, msg: d.result_message });
t("  ...backoff counted as before (30 s at 10 retries used)", j.next_attempt_at === "2026-10-26 08:00:35", j.next_attempt_at);
d = decide([op("LOCKED")], crashed, 3, 4);
t("crashed, operation LOCKED with an expired lease -> same operation too", d.route === "RETRY" && d.nextOperationId === "GD|77|4", { route: d.route, next: d.nextOperationId });
d = decide([op("LOCKING")], crashed, 200, 201);
t("crashed, LOCKING, retries used up (200) -> still the SAME operation once more, so its RECOVER can release the keys", d.route === "RETRY" && d.nextOperationId === "GD|77|201" && d.jobRows[0].attempt_count === 201, { route: d.route, next: d.nextOperationId });
d = decide([op("LOCKING")], crashed, 202, 201);
t("crashed, LOCKING, past limit + 2 -> review naming the stuck operation and 'no stock moved' (not the false 'stock moved')", d.route === "REVIEW" && d.job_status === "REQUIRES_REVIEW" && /no stock moved/.test(d.jobRows[0].error_message) && !/Stock moved but/.test(d.jobRows[0].error_message) && d.hasHeader === "YES", { route: d.route, msg: (d.jobRows || [{}])[0].error_message });
// a call that fails before the inventory workflow records anything: its own budget of 6 in a row (error_details.call_failures)
const preWith = (attempts, opAttempt, details) => { const p = pre(attempts, opAttempt); p.jobRows[0].error_details = details ? JSON.stringify(details) : null; return p; };
const decideD = (rows, response, attempts, opAttempt, details) => quiet(() => fns.publishP3(guard, preWith(attempts, opAttempt, details), p1, p2, rows, response));
d = decideD([clock], crashed, 40, 41, { inventory_result_code: "LOCK_CONFLICT" });
t("unrecorded crash after lock conflicts -> RETRY with a new id, call_failures 1 (the 40 lock retries do not count against it)", d.route === "RETRY" && d.nextOperationId === "GD|77|42" && JSON.parse(d.jobRows[0].error_details).call_failures === 1, { route: d.route, det: (d.jobRows || [{}])[0].error_details });
d = decideD([clock], crashed, 45, 46, { inventory_result_code: "INVENTORY_CALL_FAILED", call_failures: 5 });
t("unrecorded crash number 6 in a row -> still RETRY, call_failures 6", d.route === "RETRY" && JSON.parse(d.jobRows[0].error_details).call_failures === 6, { route: d.route });
d = decideD([clock], crashed, 46, 47, { inventory_result_code: "INVENTORY_CALL_FAILED", call_failures: 6 });
t("unrecorded crash number 7 in a row -> clean failure (nothing recorded, nothing held): FAILED, hidden rows soft-deleted", d.route === "FAIL_CLEAN" && d.job_status === "FAILED" && d.hasHeader === "YES" && /7 times in a row/.test(d.jobRows[0].error_message), { route: d.route, job_status: d.job_status });
d = decide([clock], crashed, 2, 3);
t("crashed, no operation row -> RETRY with a NEW operation (unchanged: nothing is held)", d.route === "RETRY" && d.nextOperationId === "GD|77|4", { route: d.route, next: d.nextOperationId });
d = decide([op("REJECTED", { result_code: "LOCK_CONFLICT" })], crashed, 2, 3);
t("crashed, operation already REJECTED -> RETRY with a NEW operation (unchanged)", d.route === "RETRY" && d.nextOperationId === "GD|77|4", { route: d.route, next: d.nextOperationId });
d = decide([op("LOCKING", { lease_live: "1", lease_expires_at: "2026-10-26 08:09:00" })], crashed, 2, 3);
t("crashed, operation LOCKING with a LIVE lease -> WAIT (unchanged)", d.route === "WAIT", { route: d.route });
d = decide([op("MUTATING", { mutation_started_at: "2026-10-26 07:40:00" })], crashed, 2, 3);
t("crashed, mutation started, lease expired -> review, never a retry (unchanged)", d.route === "REVIEW" && d.job_status === "REQUIRES_REVIEW", { route: d.route, job_status: d.job_status });
d = decide([op("REJECTED", { result_code: "LOCK_CONFLICT" })], { result_code: "LOCK_CONFLICT", operation_status: "REJECTED", operation_id: "GD|77|3" }, 2, 3);
t("answered LOCK_CONFLICT (not crashed) -> RETRY with a NEW operation (unchanged)", d.route === "RETRY" && d.nextOperationId === "GD|77|4", { route: d.route, next: d.nextOperationId });
d = decide([op("DONE", { result_code: "OK" })], crashed, 2, 3);
t("crashed but the operation is DONE -> CONTINUE (unchanged)", d.route === "CONTINUE", { route: d.route });
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
