// test_commit_catch.js: GD_BULK_COMMIT's caught inventory call (patch_commit_catch_engine_call.py) - the normalizer and the
// after-call decision (publishP3) run from the patched repo JSON.
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const code = (id) => find(W, id).data.script.code;
const quiet = (f) => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };
const fill = (src, vals) => src.replace(/\{\{(node|workflowparams|system):([A-Za-z0-9_.]+)\}\}/g, (m, k, name) => {
  if (!(name in vals)) throw new Error("no value for " + m);
  return JSON.stringify(vals[name]);
});
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 700))); if (!ok) fails += 1; };

// the try-catch shape
const tc = find(W, "try_catch_P3invCal");
t("shape: the call sits alone in the try block, the marker in the catch block, the normalizer right after",
  // the platform drops the try block's key / empty data on save, so a deployed copy is matched by type
  (tc.blocks[0].key === "try" || tc.blocks[0].type === "tryBlock") && tc.blocks[0].blocks.map((b) => b.id).join() === "workflow_node_q2vFSyDT" &&
  (tc.blocks[1].key === "catch" || tc.blocks[1].type === "catchBlock") && tc.blocks[1].data.trycatch_type === "Filter" && tc.blocks[1].blocks.map((b) => b.id).join() === "code_node_P3crash0" &&
  find(W, "ifBlock_XzDwQdw0").blocks.map((b) => b.id).slice(0, 2).join() === "try_catch_P3invCal,code_node_rhoiDSOp", tc);
const marker = quiet(() => new Function(code("code_node_P3crash0"))());
t("catch: marks the call as failed", marker.crashed === "YES", marker);

// the normalizer
const norm = (resp, crashed) => quiet(() => new Function(fill(code("code_node_rhoiDSOp"), { "workflow_node_q2vFSyDT.data": resp, "code_node_P3crash0.data.crashed": crashed }))());
let n = norm(null, "YES");
t("normalizer: a caught failure -> crashed YES, no result code", n.crashed === "YES" && n.result_code === "" && n.called === "YES", n);
n = norm({ result_code: "OK", operation_status: "DONE", operation_id: "GD|77|1" }, null);
t("normalizer: an answer -> crashed NO, its result code", n.crashed === "NO" && n.result_code === "OK", n);

// the after-call decision: the node's own functions, its call replaced by the fixtures below
const src = code("code_node_7NQFbpmU");
const cut = src.indexOf("const guard = [{{node:code_node_WaEyJtlE.data}}][0];");
const fns = quiet(() => new Function(src.slice(0, cut) + "\nreturn { publishP3: publishP3, chainStep: chainStep };")());
const guard = { route: "CONTINUE", jobId: "77", tenantId: "000000", leaseOwner: "PUB|abc", nonce: "abc" };
const pre = (attempts) => ({ dbNow: "2026-10-23 06:00:00", operationId: "GD|77|1", attempt: 1, rowVersion: 10, organizationId: "1123598813738675201",
  steps: { P3_INVENTORY_APPLY: { id: "S3", status: "STARTED", attempt: 1, opId: "GD|77|1" } }, stepsDone: { P3_INVENTORY_APPLY: "NO" },
  jobRows: [{ id: "77", job_status: "COMMITTING_GD", attempt_count: attempts || 0, row_version: 10, lease_owner: "PUB|abc", lease_expires_at: "2026-10-23 06:30:00" }] });
const p1 = { gdId: "901", gdNo: "GD/20261023/901" };
const p2 = { headerIds: ["901"], lineIds: ["902"], resIds: ["903"], packIds: [], hasHeader: "YES", hasLines: "YES", hasRes: "YES", hasPack: "NO" };
const clock = { db_now: "2026-10-23 06:00:05" };
const op = (status, live) => Object.assign({ id: "OP1", operation_status: status, result_code: "", lease_live: live ? "1" : "0", mutation_started_at: "", lease_expires_at: "", gate_taken: "0", gate_owner: "" }, clock);
const crashed = { called: "YES", crashed: "YES", operation_id: "", operation_status: "", result_code: "" };
const decide = (rows, response, attempts) => quiet(() => fns.publishP3(guard, pre(attempts), p1, p2, rows, response));

let d = decide([clock], crashed);
const j = (d.jobRows || [])[0] || {};
t("crashed, no operation recorded -> RETRY 1 of 6: lease released, next attempt in 2 s, next operation id",
  d.route === "RETRY" && j.attempt_count === 1 && j.lease_owner === null && j.lease_expires_at === null && j.next_attempt_at === "2026-10-23 06:00:07" &&
  j.error_code === "GD_INVENTORY_RETRYABLE_REJECTION" && /INVENTORY_CALL_FAILED/.test(j.error_message) && j.job_status === "COMMITTING_GD" &&
  d.nextOperationId === "GD|77|2" && d.stepDoneRows[0].step_status === "STARTED" && d.stepDoneRows[0].inventory_operation_id === "GD|77|2", d);
d = decide([clock], crashed, 3);
t("crashed again (3 retries used) -> RETRY 4, backoff 16 s", d.route === "RETRY" && d.jobRows[0].attempt_count === 4 && d.jobRows[0].next_attempt_at === "2026-10-23 06:00:21", d);
d = decide([clock], crashed, 6);
t("crashed with the retries used up -> a clean failure (nothing ran): job FAILED, hidden rows soft-deleted",
  d.route === "FAIL_CLEAN" && d.jobRows[0].job_status === "FAILED" && d.jobRows[0].error_code === "GD_TRANSIENT_RETRIES_EXHAUSTED" && d.hasHeader === "YES" && d.lineIds.join() === "902", d);
d = decide([op("LOCKING", true)], crashed);
t("crashed, a live LOCKING operation -> WAIT for its lease (no retry counted), job lease released",
  d.route === "WAIT" && d.jobRows[0].attempt_count === 0 && d.jobRows[0].lease_owner === null && d.jobRows[0].error_code === "GD_INVENTORY_IN_PROGRESS", d);
d = decide([Object.assign(op("DONE", false), { result_code: "OK" })], crashed);
t("crashed after the operation finished (DONE) -> CONTINUE", d.route === "CONTINUE", d);
d = decide([op("LOCKED", false)], crashed);
t("crashed, a pre-mutation operation whose lease expired -> a counted RETRY (not another call)", d.route === "RETRY" && d.jobRows[0].attempt_count === 1, d);
d = decide([Object.assign(op("MUTATING", true), { mutation_started_at: "2026-10-23 06:00:01" })], crashed);
t("crashed mid-mutation, lease live -> WAIT (the outcome is the engine's to decide)", d.route === "WAIT", d);
d = decide([clock], { called: "YES", crashed: "NO", result_code: "" });
t("not crashed, no answer, no operation -> CALL as before", d.route === "CALL", d);
d = decide([clock], { called: "YES", crashed: "NO", result_code: "LOCK_CONFLICT", operation_status: "REJECTED" });
t("an answer (LOCK_CONFLICT) -> RETRY as before", d.route === "RETRY" && /LOCK_CONFLICT/.test(d.jobRows[0].error_message), d);
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
