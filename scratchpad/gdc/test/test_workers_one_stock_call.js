// test_workers_one_stock_call.js: GD_COMPLETE_WORKER and GD_CANCEL_WORKER take no further job after a commit call
// (patch_workers_one_stock_call.py, after the LSH freeze of 2026-10-26 20:40). Runs the live code of Split and Pick from the
// workflow files with their placeholders filled as the platform fills them.
// usage: node test_workers_one_stock_call.js [dir with GD_COMPLETE_WORKER.json + GD_CANCEL_WORKER.json]   (repo by default;
// the unpatched files fail the next-index cases)
const fs = require("fs");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/";
const dir = process.argv[2];
const files = { GW: dir ? dir + "/GD_COMPLETE_WORKER.json" : R + "CompleteV2/GD_COMPLETE_WORKER.json",
                XW: dir ? dir + "/GD_CANCEL_WORKER.json" : R + "CancelV2/GD_CANCEL_WORKER.json",
                RW: dir ? dir + "/GD_REVERT_WORKER.json" : R + "RevertV2/GD_REVERT_WORKER.json" };
const guardNode = { GW: "code_node_GWguard3", XW: "code_node_XWguard2", RW: "code_node_RWguard3" };
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const fill = (src, vals) => src.replace(/\{\{(node|workflowparams|system):([A-Za-z0-9_.]+)\}\}/g, (m, k, name) => {
  if (!(name in vals)) throw new Error("no value for " + m);
  return JSON.stringify(vals[name]);
});
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 400))); if (!ok) fails += 1; };

for (const P of ["GW", "XW", "RW"]) {
  const W = JSON.parse(fs.readFileSync(files[P], "utf8"));
  const run = (id, vals) => { const log = console.log; console.log = () => {}; try { return new Function(fill(find(W, id).data.script.code, vals))(); } catch (e) { return { error: String(e.message || e) }; } finally { console.log = log; } };
  const guard = { route: "CONTINUE", jobId: "0", tenantId: "128671", leaseOwner: "WRK|abc", nonce: "abc" };
  const job = (extra) => Object.assign({ db_now: "2026-10-26 13:00:00", id: "11", job_status: "COMPLETED", lease_owner: "", next_attempt_at: "" }, extra || {});
  const split = (midRoute, row) => run("code_node_" + P + "split", { [guardNode[P] + ".data"]: guard,
    ["code_node_" + P + "mid.data"]: midRoute === null ? null : { route: midRoute, jobId: "11", dbNow: "2026-10-26 13:00:00" },
    ["sql_node_" + P + "split.data"]: row ? [row] : [], ["code_node_" + P + "pick.data"]: { nextIndex: 3 } });
  const w = { GW: "GD_COMPLETE_WORKER", XW: "GD_CANCEL_WORKER", RW: "GD_REVERT_WORKER" }[P];

  let r = split("PUBLISH", job({ job_status: "COMMITTING_GD", lease_owner: "SPLIT|abc" }));
  t(w + ": a publish that split -> the second call still runs, next index 9999", r.route === "PUBLISH" && r.nextIndex === 9999, r);
  r = split("PUBLISH", job());
  t(w + ": a publish that finished the job -> next index 9999 (no further job in this run)", r.route === "END" && r.nextIndex === 9999, r);
  r = split("PUBLISH", job({ job_status: "COMMITTING_GD", next_attempt_at: "2026-10-26 13:01:00" }));
  t(w + ": a publish that left the job waiting (stock busy) -> next index 9999 too", r.route === "END" && r.nextIndex === 9999, r);
  r = split("END", null);
  t(w + ": no commit call in this iteration -> Pick's next index", r.route === "END" && r.nextIndex === 3, r);
  r = split("", null);
  t(w + ": an empty publish decision -> Pick's next index", r.nextIndex === 3, r);

  const plan = { route: "WORK", runStart: "2026-10-26 13:00:00", dbNow: "2026-10-26 13:00:00",
                 items: [{ jobId: "11", organizationId: "9" }, { jobId: "12", organizationId: "9" }] };
  const tick = [{ db_now: "2026-10-26 13:00:05", id: "11", organization_id: "9", job_status: "QUEUED", attempt_count: 0, row_version: 1,
                  dead_lease: 0, claim_id: "", lease_live: 0, due_now: 1, claim_live: 0 }];
  const p = run("code_node_" + P + "pick", { [guardNode[P] + ".data"]: guard, ["code_node_" + P + "plan.data"]: plan,
    ["sql_node_" + P + "tick.data"]: tick, ["get_cache_" + P + "idx.data"]: 9999 });
  t(w + ": an iteration past the plan -> SKIP, no claim", p.route === "SKIP" && p.needClaimAdd === "NO" && /no item at index 9999/.test(p.result_message), p);

  const cache = find(W, "set_cache_" + P + "idxN").data.custom_wkbocgni.code;
  const decl = find(W, "code_node_" + P + "split").data.response_json.filter((e) => e.name === "nextIndex");
  t(w + ": the loop index cache stores Split's next index, declared once as int",
    cache === "{{node:code_node_" + P + "split.data.nextIndex}}" && decl.length === 1 && decl[0].bsonType === "int", { cache, decl });
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exitCode = fails ? 1 : 0;
