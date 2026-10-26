// test_commit_fifo.js: GD_BULK_COMMIT before-call decision (patch_commit_fifo.py): with an older waiting delivery on the same stock
// a new stock call is not started (WAIT 30 s, uncounted); without one it calls; recovering its own stale operation is never delayed.
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const quiet = (f) => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + String(JSON.stringify(got)).slice(0, 600))); if (!ok) fails += 1; };
const src = find(W, "code_node_a4HIjyaU").data.script.code;
const cut = src.indexOf("const guard = [{{node:code_node_WaEyJtlE.data}}][0];");
const fns = quiet(() => new Function(src.slice(0, cut) + "\nreturn { publishP3: publishP3 };")());
const guard = { route: "CONTINUE", jobId: "77", tenantId: "128671", leaseOwner: "PUB|abc", nonce: "abc" };
const pre = (attempts, opAttempt) => ({ dbNow: "2026-10-26 08:20:00", operationId: "GD|77|" + opAttempt, attempt: opAttempt, rowVersion: 10, organizationId: "1996787068457861121",
  steps: { P3_INVENTORY_APPLY: { id: "S3", status: "STARTED", attempt: opAttempt, opId: "GD|77|" + opAttempt } }, stepsDone: { P3_INVENTORY_APPLY: "NO" },
  jobRows: [{ id: "77", job_status: "COMMITTING_GD", attempt_count: attempts, row_version: 10, lease_owner: "PUB|abc", lease_expires_at: "2026-10-26 08:50:00" }] });
const p1 = { gdId: "901", gdNo: "GD-2610-9901" };
const p2 = { headerIds: ["901"], lineIds: ["902"], resIds: ["903"], packIds: [], hasHeader: "YES", hasLines: "YES", hasRes: "YES", hasPack: "NO" };
const facts = (extra) => Object.assign({ db_now: "2026-10-26 08:20:05", id: null, operation_id: null, operation_status: null, p3_id: "S3", p3_status: "STARTED", p3_attempt: 12, p3_op: "GD|77|12", older_waiting: null }, extra || {});
const decide = (rows, attempts, opAttempt) => quiet(() => fns.publishP3(guard, pre(attempts, opAttempt), p1, p2, rows, null));

let d = decide([facts({ older_waiting: "GD-2610-1479" })], 11, 12);
let j = (d.jobRows || [])[0] || {};
t("fresh call, an older delivery waits on the same stock -> WAIT 30 s, uncounted, names it",
  d.route === "WAIT" && d.call !== "YES" && j.attempt_count === 11 && j.next_attempt_at === "2026-10-26 08:20:35" && j.error_code === "GD_INVENTORY_IN_PROGRESS" &&
  /GD-2610-1479/.test(j.error_message) && j.lease_owner === null, { route: d.route, call: d.call, j });
d = decide([facts()], 11, 12);
t("fresh call, no older delivery on the same stock -> CALL (unchanged)", d.route === "CALL" && d.call === "YES", { route: d.route, call: d.call });
d = decide([facts({ id: "OP12", operation_id: "GD|77|12", operation_status: "LOCKING", lease_live: "0", lease_expires_at: "2026-10-26 08:10:00.000000", older_waiting: "GD-2610-1479" })], 11, 12);
t("own operation LOCKING with an expired lease -> CALL to recover it, even with an older waiter (never delayed)", d.route === "CALL" && d.call === "YES", { route: d.route, call: d.call, msg: d.result_message });
d = decide([facts({ id: "OP12", operation_id: "GD|77|12", operation_status: "REJECTED", result_code: "LOCK_CONFLICT", older_waiting: "GD-2610-1479" })], 11, 12);
t("own operation REJECTED -> RETRY to a new operation as before (the next fresh call is where the older waiter is honoured)", d.route === "RETRY", { route: d.route });
d = decide([facts({ id: "OP12", operation_id: "GD|77|12", operation_status: "DONE", result_code: "OK", older_waiting: "GD-2610-1479" })], 11, 12);
t("own operation DONE -> CONTINUE (unchanged)", d.route === "CONTINUE", { route: d.route });
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
