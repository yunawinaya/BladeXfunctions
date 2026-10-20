// test_summary.js: SO_AUTO_GD v18's code_collect_v2 (every answer shape of GD_ASYNC_SUBMIT, missing fields included) and
// code_summary (classic created / blocked, V2 queued / refused, the plan's and the build's blocked) run offline.
const fs = require("fs"), assert = require("assert");
const wf = JSON.parse(fs.readFileSync("/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/SOconvertGDCreatedWorkflow.json", "utf8"));
const node = (id) => {
  const walk = (o) => {
    if (Array.isArray(o)) { for (const v of o) { const r = walk(v); if (r) return r; } return null; }
    if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = walk(v); if (r) return r; } }
    return null;
  };
  return walk(wf).data.script.code;
};
const run = (code, subst) => {
  let src = code;
  for (const [k, v] of Object.entries(subst)) src = src.split(k).join(v);
  assert.ok(!/\{\{[^}]+\}\}/.test(src), "unsubstituted: " + src.match(/\{\{[^}]+\}\}/g));
  return new Function(src)();
};
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };
const COLLECT = node("code_collect_v2"), SUMMARY = node("code_summary");
const collect = (prev, so, ans) => {
  const f = (k) => (ans[k] === undefined ? "" : JSON.stringify(ans[k])); // a missing output substitutes as nothing
  return run(COLLECT, { "{{node:get_results.data}}": prev, "{{node:loop_payloads.so_no}}": JSON.stringify(so),
    "{{node:wf_v2submit.data.line_errors}}": f("line_errors"), "{{node:wf_v2submit.data.result_code}}": f("result_code"),
    "{{node:wf_v2submit.data.result_message}}": f("result_message"), "{{node:wf_v2submit.data.job_id}}": f("job_id"),
    "{{node:wf_v2submit.data.job_status}}": f("job_status"), "{{node:wf_v2submit.data.gd_no}}": f("gd_no") }).results;
};
let res = collect("[]", "SO-1", { result_code: "", result_message: "", job_id: "J1", job_status: "QUEUED", created: "YES", gd_no: "", line_errors: "[]" });
res = collect(JSON.stringify(res), "SO-2", { result_code: "GD_SO_SAVE_RUNNING", result_message: "Another delivery of this sales order is still saving", job_id: "", line_errors: [] });
res = collect(JSON.stringify(res), "SO-3", { result_code: "GD_VALIDATION_FAILED", result_message: "Validation failed", line_errors: JSON.stringify([{ line_no: 2, message: "Invalid quantity" }, { line_no: null, code: "GD_X" }]) });
res = collect("", "SO-4", {}); // nothing answered at all, and an empty accumulator
assert.strictEqual(res.length, 1);
assert.deepStrictEqual(res[0], { so_no: "SO-4", route: "V2", code: "", message: "", job_id: "", job_status: "", gd_no: "", line_errors: "[]" });
ok("collect: every answer shape, missing fields and an empty cache, no syntax error");

const results = collect(JSON.stringify(collect(JSON.stringify(collect("[]", "SO-1", { job_id: "J1", job_status: "QUEUED" })), "SO-2",
  { result_code: "GD_SO_SAVE_RUNNING", result_message: "Another delivery of this sales order is still saving" })), "SO-3",
  { result_code: "GD_VALIDATION_FAILED", result_message: "Validation failed", line_errors: JSON.stringify([{ line_no: 2, message: "Invalid quantity" }, { line_no: null, code: "GD_X" }]) });
results.push({ so_no: "SO-5", code: "200", message: "", gd_id: "G5", delivery_no: "GD/5" }, { so_no: "SO-6", code: "400", message: "Insufficient stock for item X" });
const sum = run(SUMMARY, { "{{node:get_results_final.data}}": JSON.stringify(results), "{{workflowparams:gd_type}}": '"multiple"',
  "{{workflowparams:so_ids}}": JSON.stringify(["1", "2", "3", "5", "6", "7", "8"]), "{{node:code_build.data.blocked}}": JSON.stringify([{ so_no: "SO-7", reason: "Nothing left to deliver" }]),
  "{{node:code_v2plan.data.blocked}}": JSON.stringify([{ so_no: "SO-8", reason: "More than 2000 lines in one goods delivery." }]) });
assert.deepStrictEqual(sum.queued, [{ so_no: "SO-1", job_id: "J1", gd_no: "" }]);
assert.deepStrictEqual(sum.created, [{ so_no: "SO-5", delivery_no: "GD/5" }]);
assert.deepStrictEqual(sum.blocked.map((b) => b.so_no), ["SO-2", "SO-3", "SO-6", "SO-7", "SO-8"]);
assert.strictEqual(sum.blocked[1].reason, "Validation failed (Line 2: Invalid quantity; Header: GD_X)");
assert.deepStrictEqual([sum.createdCount, sum.queuedCount, sum.blockedCount], [1, 1, 5]);
assert.strictEqual(sum.message, "Created 1 goods delivery, 1 being created in the background, 5 not converted.");
ok("summary: classic created / blocked, V2 queued / refused (with line errors), build + plan blocked");

const empty = run(SUMMARY, { "{{node:get_results_final.data}}": "[]", "{{workflowparams:gd_type}}": '"multiple"', "{{workflowparams:so_ids}}": '["1"]',
  "{{node:code_build.data.blocked}}": "[]", "{{node:code_v2plan.data.blocked}}": "" });
assert.deepStrictEqual([empty.createdCount, empty.queuedCount, empty.blockedCount, empty.message], [0, 0, 0, "Created 0 goods deliveries."]);
ok("summary: nothing at all, and a plan answer that substitutes as nothing");
console.log(n + " passed");
