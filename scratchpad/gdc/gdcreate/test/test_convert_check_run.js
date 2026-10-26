// test_convert_check_run.js: GD_SO_CONVERT_CHECK's lost-convert-run lookup (patch_convert_check_run.py) - the guard and the result
// node run from the patched repo JSON with their placeholders filled as the platform fills them.
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json", "utf8"));
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
const run = (id, vals) => new Function(fill(code(id), vals))();
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 500))); if (!ok) fails += 1; };

const guard = (p) => run("code_node_SCguard", Object.assign({ so_ids: null, job_ids: null, run_so_ids: null, run_since_s: null, job_lines: null }, p));
let g = guard({ run_so_ids: ["2113510597718052865", "211", "212"], run_since_s: "75" });
t("guard: a lost batch -> GO, its first sales order, the list, the window", g.route === "GO" && g.runSoId === "2113510597718052865" && g.runIdsJson === '["2113510597718052865","211","212"]' && g.runSinceS === "75", g);
g = guard({ so_ids: ["1", "2"] });
t("guard: so_ids only (the busy check) -> no run asked (0), default window", g.route === "GO" && g.runSoId === "0" && g.runIdsJson === "[]" && g.runSinceS === "600" && g.soIdsJson === '["1","2"]', g);
g = guard({ job_ids: "7,8" });
t("guard: job_ids only (the follow) -> as before", g.route === "GO" && g.runSoId === "0" && g.jobIdsJson === '["7","8"]', g);
t("guard: nothing asked -> REJECT", guard({}).route === "REJECT", guard({}));
t("guard: a run id that is not digits -> REJECT", guard({ run_so_ids: ["12a"] }).route === "REJECT");
t("guard: a window of 0 s or over an hour -> REJECT", guard({ run_so_ids: ["1"], run_since_s: "0" }).route === "REJECT" && guard({ run_so_ids: ["1"], run_since_s: "3601" }).route === "REJECT");
t("guard: 51 sales orders in one run -> REJECT", guard({ run_so_ids: Array.from({ length: 51 }, (_, i) => String(i + 1)) }).route === "REJECT");

const req = (ids) => JSON.stringify({ type: "Workflow", runType: "Api", request_json: { so_ids: ids, gd_type: "multiple", v2: "1" } });
const answer = { code: "200", message: "Created 2 goods deliveries, 2 being created in the background.", created: [{ so_no: "SO-Lee", delivery_no: "GD-1105" }],
  blocked: [], queued: [{ so_no: "SO2610-1541", job_id: "2113510601572618241" }] };
const result = (rows, want) => run("code_node_SCresult", { "sql_node_SCbusy.data": [], "sql_node_SCjobs.data": [], "sql_node_SCrun.data": rows, "sql_node_SClines.data": [], "code_node_SCguard.data.runIdsJson": JSON.stringify(want) });
let r = result([{ run_id: "9", status: "Complete", request: req(["1", "2"]), response: JSON.stringify({ code: 200, data: answer, msg: "ok", success: true }), error_msg: "" }], ["2", "1"]);
let run1 = JSON.parse(r.run_json);
t("result: the run with exactly the batch's sales orders -> its own answer", run1 && run1.run_id === "9" && run1.status === "Complete" && run1.result.queued[0].job_id === "2113510601572618241" && r.busy_json === "[]" && r.jobs_json === "[]", r);
r = result([{ run_id: "10", status: "Complete", request: req(["1"]), response: "{}", error_msg: "" }, { run_id: "9", status: "Complete", request: req(["1", "2"]), response: JSON.stringify({ code: 200, data: answer }), error_msg: "" }], ["1", "2"]);
t("result: a newer run of another selection is skipped", JSON.parse(r.run_json).run_id === "9", r);
r = result([], ["1", "2"]);
t("result: no run yet (still running) -> null", r.run_json === "null", r);
r = result([{ run_id: "11", status: "Fail", request: req(["1", "2"]), response: "", error_msg: "SQL timeout" }], ["1", "2"]);
run1 = JSON.parse(r.run_json);
t("result: a failed run -> Fail, no result, its error", run1.status === "Fail" && run1.result === null && run1.error === "SQL timeout", r);
r = result([{ run_id: "12", status: "Complete", request: "{not json", response: "", error_msg: "" }], ["1"]);
t("result: an unreadable request -> skipped (null)", r.run_json === "null", r);
r = run("code_node_SCresult", { "sql_node_SCbusy.data": [{ so_id: "5", job_id: "6", job_status: "QUEUED" }], "sql_node_SCjobs.data": { job_id: "6", job_status: "QUEUED" }, "sql_node_SCrun.data": [], "sql_node_SClines.data": [], "code_node_SCguard.data.runIdsJson": "[]" });
t("result: the busy and job answers are as before", JSON.parse(r.busy_json).length === 1 && JSON.parse(r.jobs_json)[0].job_id === "6" && r.run_json === "null", r);
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
