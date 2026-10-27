// test_p7_nodes.js [dir]: stage 1e's code nodes as built into the workflow JSON (default Picking/AsyncV2, or [dir] = patch_pk1e.py's
// output), run as the platform runs them: COMMIT's P7 plan / answer / fill and SUBMIT's STATUS answer. Also checks each node
// declares what it returns (the platform keeps only declared keys).
const fs = require("fs");
const path = require("path");
const { runBody, eq, done } = require("../../gdc/pkv2tools/harness.js");
const DIR = process.argv[2] || path.join(__dirname, "..", "..", "..", "Picking", "AsyncV2");
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const COMMIT = JSON.parse(fs.readFileSync(path.join(DIR, "PICKING_BULK_COMMIT.json"), "utf8"));
const SUBMIT = JSON.parse(fs.readFileSync(path.join(DIR, "PICKING_ASYNC_SUBMIT.json"), "utf8"));
const node = (w, id) => find(w, id);
const body = (w, id) => node(w, id).data.script.code;
const declared = (w, id) => node(w, id).data.response_json.map((f) => f.name);
const keep = (w, id, out) => Object.keys(out).filter((k) => declared(w, id).indexOf(k) < 0);

const E = { "node:code_node_PCentry.data.jobId": "2114900000000000001", "node:code_node_PCentry.data.organizationId": "1996787068457861121",
  "node:code_node_PCentry.data.dbNow": "2026-10-27 13:00:00" };
const G = (o) => Object.assign({ gd_id: "2114900000000000101", delivery_no: "GD-2610-0001", gd_status: "Created", picking_status: "Completed", open_job: null, p7: null }, o || {});

// plan
const plan = runBody(body(COMMIT, "code_node_PCp7plan"), Object.assign({}, E, { "node:sql_node_PCp7gds.data": [G(), G({ gd_id: "2114900000000000102", picking_status: "In Progress" })] }), "plan");
eq("plan: one request, as classic PICKING's GOODS_DELIVERY call", [plan.needLoop, plan.items.map((i) => [i.gd_id, i.operation, i.source, i.answers.needCL, i.causation_id]), plan.plannedSql],
  ["YES", [["2114900000000000101", "SUBMIT", "PICKING", "auto", "PICKING|2114900000000000001"]], "2114900000000000101"]);
eq("plan: every returned key is declared", keep(COMMIT, "code_node_PCp7plan", plan), []);
const none = runBody(body(COMMIT, "code_node_PCp7plan"), Object.assign({}, E, { "node:sql_node_PCp7gds.data": null }), "plan");
eq("plan: Auto Complete GD off (no rows) -> no loop, no direct rows", [none.needLoop, none.needDirect, none.plannedSql], ["NO", "NO", "0"]);

// answer, inside the loop
const ansV = (route, code, message, job) => Object.assign({}, E, { "node:loop_PCp7": plan.items[0], "node:workflow_node_PCp7submit.data.route": route,
  "node:workflow_node_PCp7submit.data.code": code, "node:workflow_node_PCp7submit.data.message": message, "node:workflow_node_PCp7submit.data.job_id": job });
const q = runBody(body(COMMIT, "code_node_PCp7ans"), ansV("QUEUED", "200", "queued", "2114900000000000777"), "answer");
eq("answer: QUEUED -> its job on the P7 row", q.rows.map((r) => [r.job_id, r.step_name, r.step_status, r.result_ref]),
  [["2114900000000000001", "P7|2114900000000000101", "QUEUED", "2114900000000000777"]]);
eq("answer: every returned key is declared", keep(COMMIT, "code_node_PCp7ans", q), []);
const stop = runBody(body(COMMIT, "code_node_PCp7ans"), ansV("STOP", "402", "Credit limit exceeded", ""), "answer");
eq("answer: a STOP -> NOT_QUEUED with its reason", [stop.rows[0].step_status, stop.rows[0].error_code], ["NOT_QUEUED", "STOP 402"]);

// fill, after a caught failure
const fillV = (back, crashed) => Object.assign({}, E, { "node:code_node_PCp7plan.data": plan, "node:sql_node_PCp7back.data": back, "node:code_node_PCp7crash.data.crashed": crashed });
const f = runBody(body(COMMIT, "code_node_PCp7fill"), fillV([{ gd_id: "2114900000000000101", open_job: null, p7: null }], "YES"), "fill");
eq("fill: the failed call's delivery -> NOT_QUEUED CALL_FAILED", f.fillRows.map((r) => [r.step_name, r.step_status, r.error_code]), [["P7|2114900000000000101", "NOT_QUEUED", "CALL_FAILED"]]);
eq("fill: every returned key is declared", keep(COMMIT, "code_node_PCp7fill", f), []);
eq("fill: nothing missing -> nothing to add", runBody(body(COMMIT, "code_node_PCp7fill"), fillV([{ gd_id: "2114900000000000101", p7: "QUEUED" }], null), "fill").needFill, "NO");

// STATUS answer
const stV = (job) => ({ "node:sql_node_PSstatus.data": job ? [job] : [] });
const job = { id: "2114900000000000001", job_status: "COMPLETED", progress_message: "done", progress_percent: 100, error_code: null, error_message: null, operation: "CONFIRM", kick: null,
  gd_complete: JSON.stringify([{ gd_id: "2114900000000000101", gd_no: "GD-2610-0001", status: "QUEUED", job_id: "2114900000000000777", code: "", message: "" }]) };
const st = runBody(body(SUBMIT, "code_node_PSstatusRes"), stV(job), "status");
eq("STATUS: gd_complete parsed for the screen", st.gd_complete.map((g) => [g.gd_no, g.status, g.job_id]), [["GD-2610-0001", "QUEUED", "2114900000000000777"]]);
eq("STATUS: every returned key is declared", keep(SUBMIT, "code_node_PSstatusRes", st), []);
eq("STATUS: no P7 steps -> an empty list", runBody(body(SUBMIT, "code_node_PSstatusRes"), stV(Object.assign({}, job, { gd_complete: null })), "status").gd_complete, []);
eq("STATUS: no job -> an empty list", runBody(body(SUBMIT, "code_node_PSstatusRes"), stV(null), "status").gd_complete, []);
eq("STATUS: the return node answers gd_complete", node(SUBMIT, "return_node_PSstatus").data.response_value.list.map((p) => p.prop).indexOf("gd_complete") >= 0, true);

// COMMIT shape: P7 sits after the job's COMPLETED write, the calls inside one try-catch, before the job read-back
const p6 = node(COMMIT, "ifBlock_TPCp6").blocks.map((b) => b.id);
eq("COMMIT: P7 after update_node_PCp6job, before sql_node_PCback", p6.slice(p6.indexOf("update_node_PCp6job"), p6.indexOf("sql_node_PCback") + 1),
  ["update_node_PCp6job", "sql_node_PCp7gds", "code_node_PCp7plan", "cor_PCp7direct", "if_PCp7go", "sql_node_PCback"]);
const tc = node(COMMIT, "try_catch_PCp7");
eq("COMMIT: the loop is the try block, the crash marker the catch", [tc.blocks[0].blocks.map((b) => b.id), tc.blocks[1].blocks.map((b) => b.id)], [["loop_PCp7"], ["code_node_PCp7crash"]]);
eq("COMMIT: the call goes to GD_COMPLETE_SUBMIT with the loop item's fields", [node(COMMIT, "workflow_node_PCp7submit").data.workflow.source,
  node(COMMIT, "workflow_node_PCp7submit").data.body_params.list.map((p) => p.prop + "=" + p.value)],
  ["GD_COMPLETE_SUBMIT:Workflow:2110182609618337794", ["operation={{node:loop_PCp7.operation}}", "gd_id={{node:loop_PCp7.gd_id}}", "source={{node:loop_PCp7.source}}",
    "answers={{node:loop_PCp7.answers}}", "causation_id={{node:loop_PCp7.causation_id}}"]]);
done();
