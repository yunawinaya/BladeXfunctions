// test_worker_sweep_retry.js: GD_ASYNC_WORKER's plan / pick / retry-pass slot / answer (patch_worker_sweep_retry.py), run from the
// patched repo JSON with their placeholders filled as the platform fills them.
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const code = (id) => find(W, id).data.script.code;
const fill = (src, vals) => src.replace(/\{\{(node|workflowparams|system):([A-Za-z0-9_.]+)\}\}/g, (m, k, name) => {
  if (!(name in vals)) throw new Error("no value for " + m);
  return JSON.stringify(vals[name]);
});
const run = (id, vals) => { const log = console.log; console.log = () => {}; try { return new Function(fill(code(id), vals))(); } finally { console.log = log; } };
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 600))); if (!ok) fails += 1; };

const row = (id, extra) => Object.assign({ db_now: "2026-10-23 05:00:00", id: id, organization_id: "9", job_status: "COMMITTING_GD", attempt_count: 0, row_version: 7, dead_lease: 0, claim_id: "", lease_live: 0, due_now: 1, op_live: 0, claim_live: 0, rclaim_live: 0, error_code: null }, extra || {});
const guard = (jobId) => ({ route: "CONTINUE", jobId: jobId, tenantId: "128671", leaseOwner: "WRK|abc" });
const plan = run("code_node_JsJ91wA5", { "code_node_1OvNTk9G2.data": guard("11"), "sql_node_RaVfenlh.data": [row("11"), row("12"), row("13"), row("14")] });
t("plan: 4 due jobs -> 4 first passes + 6 retry passes for the first 3 (22 loop items; LSH 10-25: was 2), count 4, ids once",
  plan.items.length === 22 && plan.count === 4 && plan.jobIdsSql === "11,12,13,14" &&
  plan.items.slice(4).map((i) => i.jobId + "/" + i.retry).join() === [1, 2, 3, 4, 5, 6].map((n) => "11/" + n + ",12/" + n + ",13/" + n).join(), plan.items.map((i) => i.jobId + "/" + (i.retry || 0)));
const idle = run("code_node_JsJ91wA5", { "code_node_1OvNTk9G2.data": guard("0"), "sql_node_RaVfenlh.data": [{ db_now: "2026-10-23 05:00:00" }] });
t("plan: no due job -> IDLE, no items", idle.route === "IDLE" && idle.items.length === 0, idle);

const pick = (index, fresh, runStart) => run("code_node_Qo8Suk1M", {
  "code_node_1OvNTk9G2.data": guard("11"), "code_node_JsJ91wA5.data": Object.assign({}, plan, { runStart: runStart || "2026-10-23 05:00:00" }),
  "get_cache_node_JEpzWu86.data": index, "sql_node_oAHg7l6A.data": [fresh],
});
let p = pick(0, row("11", { db_now: "2026-10-23 05:00:01" }));
t("pick: the first pass of a due job -> CLAIM", p.route === "CLAIM" && p.jobId === "11", p);
p = pick(4, row("11", { db_now: "2026-10-23 05:00:20", job_status: "COMPLETED" }));
t("pick: a retry pass of a job that completed -> SKIP, nothing to retry", p.route === "SKIP" && /nothing to retry/.test(p.result_message), p);
p = pick(4, row("11", { db_now: "2026-10-23 05:00:30", error_code: "GD_INVENTORY_IN_PROGRESS", row_version: 9 }));
t("pick: a retry pass of a job a conflict left waiting, 30 s in -> CLAIM (retry budget 240 s)", p.route === "CLAIM" && p.claimName === "W0_CLAIM_9", p);
p = pick(7, row("11", { db_now: "2026-10-23 05:00:40", error_code: "GD_INVENTORY_RETRYABLE_REJECTION", row_version: 10 }));
t("pick: the second retry pass after a RETRY, 40 s in -> CLAIM", p.route === "CLAIM" && p.claimName === "W0_CLAIM_10", p);
p = pick(4, row("11", { db_now: "2026-10-23 05:00:50", error_code: "GD_INVENTORY_IN_PROGRESS", row_version: 11 }));
t("pick: a retry pass 50 s in -> CLAIM now (the later 16 s / 30 s backoffs are waited out in the run)", p.route === "CLAIM" && p.claimName === "W0_CLAIM_11", p);
p = pick(4, row("11", { db_now: "2026-10-23 05:04:10", error_code: "GD_INVENTORY_IN_PROGRESS" }));
t("pick: a retry pass 250 s in -> SKIP, left for the next tick", p.route === "SKIP" && /retry pass 1: 250 s/.test(p.result_message), p);
p = pick(4, row("11", { db_now: "2026-10-23 05:00:10", error_code: "GD_INVENTORY_IN_PROGRESS", due_now: 0, next_attempt_at: "2026-10-23 05:00:30" }));
t("pick: a retry pass not due yet -> SKIP, not due", p.route === "SKIP" && /not due/.test(p.result_message), p);
p = pick(4, row("11", { db_now: "2026-10-23 05:00:10", error_code: "GD_PREPARE_FAILED" }));
t("pick: a retry pass of a job with another error -> SKIP", p.route === "SKIP" && /nothing to retry/.test(p.result_message), p);
p = pick(2, row("13", { db_now: "2026-10-23 05:00:25" }));
t("pick: a first pass 25 s in (index > 0) -> CLAIM now (budget 240 s; was 20 s)", p.route === "CLAIM" && p.jobId === "13", p);
p = pick(2, row("13", { db_now: "2026-10-23 05:04:05" }));
t("pick: a first pass 245 s in (index > 0) -> SKIP, budget", p.route === "SKIP" && /^budget: 245 s/.test(p.result_message), p);
p = pick(4, row("11", { db_now: "2026-10-23 05:00:10", error_code: "GD_INVENTORY_IN_PROGRESS", lease_live: 1, lease_owner: "WRK|other" }));
t("pick: a retry pass of a job another run holds -> SKIP (live lease)", p.route === "SKIP" && /live lease/.test(p.result_message), p);

const slot = (index) => run("code_node_WKslot", { "code_node_JsJ91wA5.data": plan, "get_cache_node_JEpzWu86.data": index });
t("slot: a first pass -> 0 (no wait)", slot(0).retryJobId === "0" && slot(3).retryJobId === "0", [slot(0), slot(3)]);
t("slot: a retry pass -> its job", slot(4).retryJobId === "11" && slot(9).retryJobId === "13", [slot(4), slot(9)]);
t("slot: the sixth pass of the third job -> its job; past the end -> 0", slot(21).retryJobId === "13" && slot(22).retryJobId === "0", [slot(21), slot(22)]);

const readBack = [{ id: "11", job_status: "COMPLETED", error_code: "", gd_id: "1", gd_status: "Created", attempt_count: 1, lease_owner: "" }, { id: "12", job_status: "COMMITTING_GD", error_code: "GD_INVENTORY_IN_PROGRESS", gd_id: "2", gd_status: "Processing", attempt_count: 0, lease_owner: "" }];
const answer = (jobId) => run("code_node_LdCyuBWM", { "code_node_1OvNTk9G2.data.route": "CONTINUE", "code_node_JsJ91wA5.data.route": "WORK", "code_node_1OvNTk9G2.data": guard(jobId), "code_node_JsJ91wA5.data": plan, "sql_node_CObTsMBI.data": readBack });
let a = answer("12");
t("answer: each job listed once (4), the kicked job reported", a.processed === "4" && JSON.parse(a.jobs).length === 4 && a.job_id === "12" && a.job_status === "COMMITTING_GD" && a.result_code === "GD_INVENTORY_IN_PROGRESS", a);
a = answer("0");
t("answer: a list poll (job_id 0) -> the first planned job, as before", a.job_id === "11" && a.job_status === "COMPLETED", a);

const sql = code("sql_node_RaVfenlh");
t("poll: the kicked job, or a stale due job (10 s) that used fewer than 3 attempts",
  sql.includes("OR (j.attempt_count < 3") && sql.includes("(j.next_attempt_at IS NOT NULL AND j.next_attempt_at <= NOW(3) - INTERVAL 10 SECOND)") &&
  sql.includes("OR (j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= NOW(3) - INTERVAL 10 SECOND)") &&
  sql.includes("OR (j.next_attempt_at IS NULL AND j.lease_expires_at IS NULL AND j.id < ((UNIX_TIMESTAMP() * 1000 - 10000 - 1288834974657) << 22))"), sql.slice(-1100));
t("poll: the kicked job first, the sweep in random order, the list's poll oldest first",
  sql.includes("ORDER BY (j.id = {{node:code_node_1OvNTk9G2.data.jobId}}) DESC, CASE WHEN {{node:code_node_1OvNTk9G2.data.jobId}} = 0 THEN 0 ELSE RAND() END, j.create_time, j.id"), sql.slice(-400));
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
