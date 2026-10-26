// test_convert_check_lines.js: GD_SO_CONVERT_CHECK's refused-lines answer (patch_convert_check_lines.py) - the guard and the
// result node run from the workflow JSON with their placeholders filled as the platform fills them (a JS value per placeholder).
// The read itself runs against dev in test_convert_check_lines_sql.py.
// Run: node scratchpad/soautogd/shortfall/test_convert_check_lines.js [GD_SO_CONVERT_CHECK.json]
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const node = (id) => { const n = find(W, id); if (!n) throw new Error("no node " + id); return n; };
const fill = (src, vals) => src.replace(/\{\{(node|workflowparams|system):([A-Za-z0-9_.]+)\}\}/g, (m, k, name) => {
  if (!(name in vals)) throw new Error("no value for " + m);
  return JSON.stringify(vals[name]);
});
const run = (id, vals) => new Function(fill(node(id).data.script.code, vals))();
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 600))); if (!ok) fails += 1; };

(() => {
  const guard = (p) => run("code_node_SCguard", Object.assign({ so_ids: null, job_ids: null, run_so_ids: null, run_since_s: null, job_lines: null }, p));
  let g = guard({ job_ids: ["7", "8"], job_lines: "1" });
  t("guard: the SO list's follow (job ids + job_lines 1) -> the lines are read", g.route === "GO" && g.wantLines === "1" && g.jobIdsJson === '["7","8"]', g);
  g = guard({ job_ids: ["7"] });
  t("guard: job ids without job_lines (the GD form, the GD list) -> not read", g.route === "GO" && g.wantLines === "0", g);
  g = guard({ so_ids: ["1"], job_lines: "1" });
  t("guard: job_lines without job ids -> not read", g.route === "GO" && g.wantLines === "0", g);
  g = guard({ job_ids: ["7"], job_lines: 1 });
  t("guard: job_lines sent as the number 1 -> read", g.wantLines === "1", g);
  g = guard({ job_ids: ["7"], job_lines: "yes" });
  t("guard: any other job_lines -> not read", g.wantLines === "0", g);
  g = guard({ job_ids: ["7a"], job_lines: "1" });
  t("guard: a rejected input -> not read", g.route === "REJECT" && g.wantLines === "0", g);
  const declared = node("code_node_SCguard").data.response_json.map((f) => f.name);
  t("guard: wantLines is declared (else the platform drops it)", declared.includes("wantLines"), declared);

  // the result: the read's rows as job_lines_json; everything else answered as before
  const base = { "sql_node_SCbusy.data": [], "sql_node_SCjobs.data": [], "sql_node_SCrun.data": [], "code_node_SCguard.data.runIdsJson": "[]" };
  const row = { job_id: "2112387426529939457", line_no: "1", code: "GD_INSUFFICIENT_STOCK", message: "auto allocation: Insufficient stock for item P-00002. Available: 15837, Requested: 100000",
    item_code: "P-00002", item_name: "POST 2", uom: "PCS", order_qty: "100000", undelivered_qty: "100000", delivery_qty: "100000", base_qty: "100000" };
  let r = run("code_node_SCresult", Object.assign({}, base, { "sql_node_SClines.data": [row, Object.assign({}, row, { line_no: "2", base_qty: undefined })] }));
  let lines = JSON.parse(r.job_lines_json);
  t("result: the rows in order, every field a string", lines.length === 2 && JSON.stringify(lines[0]) === JSON.stringify(row) && lines[1].line_no === "2" && lines[1].base_qty === "", lines);
  r = run("code_node_SCresult", Object.assign({}, base, { "sql_node_SClines.data": row }));
  t("result: a single row (an object, not a list) -> one line", JSON.parse(r.job_lines_json).length === 1, r.job_lines_json);
  r = run("code_node_SCresult", Object.assign({}, base, { "sql_node_SClines.data": null }));
  t("result: no rows -> []", r.job_lines_json === "[]", r.job_lines_json);
  t("result: the other answers are still there", r.code === "200" && r.busy_json === "[]" && r.jobs_json === "[]" && r.run_json === "null", r);
  const rdecl = node("code_node_SCresult").data.response_json.map((f) => f.name);
  t("result: job_lines_json is declared", rdecl.includes("job_lines_json"), rdecl);

  // the answers: both return nodes and the workflow's response carry job_lines_json
  const done = node("return_node_SCdone").data.response_value.list.find((x) => x.prop === "job_lines_json");
  t("return: job_lines_json from the result", done && done.value === "{{node:code_node_SCresult.data.job_lines_json}}", done);
  const rej = node("return_node_SCreject").data.response_value.list.find((x) => x.prop === "job_lines_json");
  t("reject: job_lines_json [] (a value)", rej && rej.valueType === "value" && rej.value === "[]", rej);
  t("workflow response declares job_lines_json", W.response_json.some((f) => f.name === "job_lines_json"));
  t("workflow request declares job_lines", W.request_json.some((f) => f.name === "job_lines"));
  const reads = node("condition_all_SCreads").blocks.map((b) => b.id);
  t("the read is a fourth parallel branch", JSON.stringify(reads) === JSON.stringify(["cai_SCbusy", "cai_SCjobs", "cai_SCrun", "cai_SClines"]), reads);
  const sqlDecl = node("sql_node_SClines").data.response_json.map((f) => f.name);
  t("the read declares every column the result reads", ["job_id", "line_no", "code", "message", "item_code", "item_name", "uom", "order_qty", "undelivered_qty", "delivery_qty", "base_qty"].every((c) => sqlDecl.includes(c)), sqlDecl);
})();
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
