// test_max_retries_20.js: GD_BULK_COMMIT's after-call decision (publishP3) on a LOCK_CONFLICT answer, run from the workflow JSON
// (argv[2], default the repo file): retry 7..20 every 30 s, a clean failure only after 20 (patch_max_retries_20.py, LSH 10-26).
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json", "utf8"));
const MAX = Number(process.argv[3] || 20);
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const quiet = (f) => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 500))); if (!ok) fails += 1; };
const src = find(W, "code_node_7NQFbpmU").data.script.code;
const cut = src.indexOf("const guard = [{{node:code_node_WaEyJtlE.data}}][0];");
const fns = quiet(() => new Function(src.slice(0, cut) + "\nreturn { publishP3: publishP3 };")());
const guard = { route: "CONTINUE", jobId: "77", tenantId: "128671", leaseOwner: "PUB|abc", nonce: "abc" };
const pre = (attempts) => ({ dbNow: "2026-10-26 07:00:00", operationId: "GD|77|" + (attempts + 1), attempt: attempts + 1, rowVersion: 10, organizationId: "1996787068457861121",
  steps: { P3_INVENTORY_APPLY: { id: "S3", status: "STARTED", attempt: attempts + 1, opId: "GD|77|" + (attempts + 1) } }, stepsDone: { P3_INVENTORY_APPLY: "NO" },
  jobRows: [{ id: "77", job_status: "COMMITTING_GD", attempt_count: attempts, row_version: 10, lease_owner: "PUB|abc", lease_expires_at: "2026-10-26 07:30:00" }] });
const p1 = { gdId: "901", gdNo: "GD-2610-9901" };
const p2 = { headerIds: ["901"], lineIds: ["902"], resIds: ["903"], packIds: [], hasHeader: "YES", hasLines: "YES", hasRes: "YES", hasPack: "NO" };
const row = { id: "OP1", operation_status: "REJECTED", result_code: "LOCK_CONFLICT", lease_live: "0", mutation_started_at: "", lease_expires_at: "", gate_taken: "0", gate_owner: "", db_now: "2026-10-26 07:00:05" };
const answer = (attempts) => ({ result_code: "LOCK_CONFLICT", operation_status: "REJECTED", operation_id: "GD|77|" + (attempts + 1) });
const decide = (attempts) => quiet(() => fns.publishP3(guard, pre(attempts), p1, p2, [row], answer(attempts)));

for (const used of [...new Set([0, 5, 6, MAX - 1])].filter((u) => u < MAX)) {
  const d = decide(used);
  const j = (d.jobRows || [])[0] || {};
  const wait = Math.min(30, 2 * Math.pow(2, used));
  const due = new Date(Date.UTC(2026, 9, 25, 23, 0, 5) + wait * 1000).toISOString().replace("T", " ").slice(0, 19).replace(/^2026-10-25 23/, "2026-10-26 07");
  t("LOCK_CONFLICT with " + used + " retries used -> RETRY " + (used + 1) + " of " + MAX + " in " + wait + " s (route RETRY: only FAIL_CLEAN soft-deletes the hidden rows)",
    d.route === "RETRY" && j.attempt_count === used + 1 && j.next_attempt_at === due && j.job_status === "COMMITTING_GD" && j.lease_owner === null &&
    d.nextOperationId === "GD|77|" + (used + 2), { route: d.route, j, due, next: d.nextOperationId });
}
const d = decide(MAX);
const j = (d.jobRows || [])[0] || {};
t("LOCK_CONFLICT with " + MAX + " retries used -> clean failure: job FAILED GD_TRANSIENT_RETRIES_EXHAUSTED, hidden rows soft-deleted",
  d.route === "FAIL_CLEAN" && j.job_status === "FAILED" && j.error_code === "GD_TRANSIENT_RETRIES_EXHAUSTED" && new RegExp("after " + MAX + " retries").test(j.error_message) &&
  d.hasHeader === "YES" && d.headerIds.join() === "901" && d.resIds.join() === "903", { route: d.route, j, hasHeader: d.hasHeader });
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
